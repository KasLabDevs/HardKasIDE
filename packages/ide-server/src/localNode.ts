import { constants as fsConstants, promises as fs } from "node:fs";
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
 * Key material. A reset never deletes it:
 *   - `dev-accounts` (the simnet dev keystores, re-created by the seeding after a reset) is moved to the backup;
 *   - `accounts.real.json` can hold real accounts for other networks (testnet keys with funds) next to the simnet
 *     ones. It is not chain state, so it stays where it is and only a copy goes to the backup: a local reset never
 *     takes a testnet account out of use.
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
  /** Key paths saved in `backupDir` (moved or copied). */
  backedUp: string[];
  /** Key paths moved into `backupDir` (no longer in place). */
  moved: string[];
  /** Key paths copied into `backupDir` (still in place). */
  copied: string[];
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
  // A .hardkas that is a link would make the reset delete chain state wherever it points.
  const hardkasStat = await fs.lstat(hardkasDir).catch(() => null);
  if (hardkasStat?.isSymbolicLink()) {
    throw new LocalNodeError(409, "HARDKAS_DIR_IS_LINK", ".hardkas is a link to another folder: the reset only works on a real .hardkas folder. Nothing was changed.");
  }
  const stamp = now.toISOString().replace(/[:.]/g, "-");
  // Never reuse a backup folder (or a file in its way): a second reset in the same millisecond gets reset-<time>-2,
  // so it can never overwrite the keys an earlier reset saved.
  let backupRel = `.hardkas/backups/reset-${stamp}`;
  for (let n = 2; await exists(path.join(root, ...backupRel.split("/"))); n++) backupRel = `.hardkas/backups/reset-${stamp}-${n}`;
  const backupAbs = path.join(root, ...backupRel.split("/"));

  const moved: string[] = [];
  const copied: string[] = [];
  const fail = (rel: string, verb: string, error: unknown) =>
    new LocalNodeError(
      409,
      "KEY_BACKUP_FAILED",
      `Could not ${verb} .hardkas/${rel} to ${backupRel} (${error instanceof Error ? error.message : String(error)}). Nothing was deleted${copied.length ? `; a copy of ${copied.join(", ")} is in ${backupRel}` : ""}.`
    );
  // First the copy (nothing leaves its place), then the move: a failure at either step deletes nothing.
  const realAccounts = path.join(hardkasDir, "accounts.real.json");
  if (await exists(realAccounts)) {
    try {
      await fs.mkdir(backupAbs, { recursive: true });
      await fs.copyFile(realAccounts, path.join(backupAbs, "accounts.real.json"), fsConstants.COPYFILE_EXCL);
    } catch (error) {
      throw fail("accounts.real.json", "copy", error);
    }
    copied.push(".hardkas/accounts.real.json");
  }
  const devAccounts = path.join(hardkasDir, "dev-accounts");
  if (await exists(devAccounts)) {
    try {
      await fs.mkdir(backupAbs, { recursive: true });
      await fs.rename(devAccounts, path.join(backupAbs, "dev-accounts"));
    } catch (error) {
      throw fail("dev-accounts", "move", error);
    }
    moved.push(".hardkas/dev-accounts");
  }
  const backedUp = [...moved, ...copied];

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

  return { wiped, backedUp, moved, copied, backupDir: backedUp.length > 0 ? backupRel : null };
}

/**
 * The Docker Hub `kaspanet/cpuminer` image HardKas runs, as `docker inspect` names it: with or without the Docker Hub
 * registry, by tag and/or digest. A copy under another registry or namespace (ghcr.io/x/kaspanet/cpuminer) is not it.
 */
const HARDKAS_MINER_IMAGE = /^(?:(?:docker\.io|index\.docker\.io|registry-1\.docker\.io)\/)?kaspanet\/cpuminer(?::[A-Za-z0-9_][A-Za-z0-9_.-]{0,127})?(?:@sha256:[0-9a-f]+)?$/;

/**
 * True when a container, as `docker inspect` describes it, is the CPU miner HardKas starts for its localnet:
 * the `kaspanet/cpuminer` image, running inside another container's network namespace (the node's).
 */
export function isHardkasMiner(container: { image: string; networkMode: string }): boolean {
  return HARDKAS_MINER_IMAGE.test(container.image.trim()) && container.networkMode.trim().startsWith("container:");
}
