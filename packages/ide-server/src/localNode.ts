import { promises as fs } from "node:fs";
import path from "node:path";

/**
 * The local node is HardKas' own: one rusty-kaspad container (and its CPU miner) per machine, the same one the
 * HardKas CLI, its test gates and any other project on this machine use. The IDE therefore changes it only
 * through the HardKas CLI (`localnet start|stop`, `node reset --yes`), with two narrow exceptions that the CLI
 * has no command for: starting and stopping the miner container, and only after checking it is HardKas' miner.
 */

/** Chain-derived workspace state: safe to delete on a reset, the fresh node rebuilds it. */
export const CHAIN_STATE = ["node-data", "localnet"] as const;

/**
 * Key material. A reset never deletes it: `accounts.real.json` can hold real accounts for other networks
 * (testnet keys with funds) next to the simnet ones, so it is moved to a timestamped backup instead.
 */
export const KEY_STATE = ["dev-accounts", "accounts.real.json"] as const;

export class LocalNodeError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string
  ) {
    super(message);
  }
}

export interface ResetResult {
  /** Chain-derived paths that were deleted (relative to the workspace, forward slashes). */
  wiped: string[];
  /** Key paths that were moved to `backupDir`. */
  backedUp: string[];
  /** Where the keys went (relative to the workspace), or null when there were none. */
  backupDir: string | null;
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Prepares a workspace for a fresh local chain: moves the account keys to `.hardkas/backups/reset-<time>/` and
 * deletes the chain-derived state. Keys are moved first; if one cannot be moved (a locked file), nothing is
 * deleted and the call fails.
 */
export async function resetWorkspaceChainState(root: string, now: Date = new Date()): Promise<ResetResult> {
  const hardkasDir = path.join(root, ".hardkas");
  const stamp = now.toISOString().replace(/[:.]/g, "-");
  const backupRel = `.hardkas/backups/reset-${stamp}`;
  const backupAbs = path.join(root, ...backupRel.split("/"));

  const backedUp: string[] = [];
  for (const rel of KEY_STATE) {
    const from = path.join(hardkasDir, rel);
    if (!(await exists(from))) continue;
    try {
      await fs.mkdir(backupAbs, { recursive: true });
      await fs.rename(from, path.join(backupAbs, rel));
    } catch (error) {
      throw new LocalNodeError(
        409,
        "KEY_BACKUP_FAILED",
        `Could not move .hardkas/${rel} to ${backupRel} (${error instanceof Error ? error.message : String(error)}). Nothing was deleted.`
      );
    }
    backedUp.push(`.hardkas/${rel}`);
  }

  const wiped: string[] = [];
  for (const rel of CHAIN_STATE) {
    const p = path.join(hardkasDir, rel);
    if (!(await exists(p))) continue;
    try {
      await fs.rm(p, { recursive: true, force: true });
      wiped.push(`.hardkas/${rel}`);
    } catch {
      // a locked file: `hardkas node reset` reports what it could not remove
    }
  }

  return { wiped, backedUp, backupDir: backedUp.length > 0 ? backupRel : null };
}

/**
 * True when a container, as `docker inspect` describes it, is the CPU miner HardKas starts for its localnet:
 * the `kaspanet/cpuminer` image, running inside another container's network namespace (the node's).
 */
export function isHardkasMiner(container: { image: string; networkMode: string }): boolean {
  const image = container.image.trim();
  return /(^|\/)kaspanet\/cpuminer([:@]|$)/.test(image) && container.networkMode.trim().startsWith("container:");
}
