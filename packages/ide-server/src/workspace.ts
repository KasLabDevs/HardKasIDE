import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Workspace state for the IDE server: which HardKas project folder is open,
 * plus the list of recently opened projects (stored in the user's home dir).
 */

const IDE_HOME = path.join(os.homedir(), ".hardkas-ide");
const RECENTS_FILE = path.join(IDE_HOME, "recents.json");
const MAX_RECENTS = 12;

const CONFIG_NAMES = ["hardkas.config.ts", "hardkas.config.mts", "hardkas.config.js", "hardkas.config.mjs"];

export interface WorkspaceInfo {
  root: string | null;
  name: string | null;
  hasConfig: boolean;
  configFile: string | null;
  hasHardkasDir: boolean;
  hasDevServerToken: boolean;
}

export interface RecentEntry {
  path: string;
  name: string;
  openedAt: string;
}

let currentRoot: string | null = null;

export function getRoot(): string | null {
  return currentRoot;
}

export async function describeWorkspace(): Promise<WorkspaceInfo> {
  if (!currentRoot) {
    return { root: null, name: null, hasConfig: false, configFile: null, hasHardkasDir: false, hasDevServerToken: false };
  }
  let configFile: string | null = null;
  for (const name of CONFIG_NAMES) {
    if (await exists(path.join(currentRoot, name))) {
      configFile = name;
      break;
    }
  }
  return {
    root: currentRoot,
    name: path.basename(currentRoot),
    hasConfig: configFile !== null,
    configFile,
    hasHardkasDir: await exists(path.join(currentRoot, ".hardkas")),
    hasDevServerToken: await exists(path.join(currentRoot, ".hardkas", "dev-server-token"))
  };
}

export async function openWorkspace(dir: string): Promise<WorkspaceInfo> {
  const resolved = path.resolve(dir);
  const stat = await fs.stat(resolved).catch(() => null);
  if (!stat || !stat.isDirectory()) {
    throw new Error(`Not a directory: ${resolved}`);
  }
  currentRoot = resolved;
  await addRecent(resolved);
  return describeWorkspace();
}

export function closeWorkspace(): void {
  currentRoot = null;
}

export async function listRecents(): Promise<RecentEntry[]> {
  try {
    const raw = await fs.readFile(RECENTS_FILE, "utf8");
    const parsed = JSON.parse(raw) as RecentEntry[];
    const alive: RecentEntry[] = [];
    for (const entry of parsed) {
      if (await exists(entry.path)) alive.push(entry);
    }
    return alive;
  } catch {
    return [];
  }
}

async function addRecent(dir: string): Promise<void> {
  const recents = (await listRecents()).filter((r) => r.path !== dir);
  recents.unshift({ path: dir, name: path.basename(dir), openedAt: new Date().toISOString() });
  await fs.mkdir(IDE_HOME, { recursive: true });
  await fs.writeFile(RECENTS_FILE, JSON.stringify(recents.slice(0, MAX_RECENTS), null, 2), "utf8");
}

/** Reads the dev-server bearer token written by `hardkas dev`, if any. */
export async function readDevServerToken(): Promise<string | null> {
  if (process.env.HARDKAS_DEV_TOKEN) return process.env.HARDKAS_DEV_TOKEN;
  if (!currentRoot) return null;
  try {
    const raw = await fs.readFile(path.join(currentRoot, ".hardkas", "dev-server-token"), "utf8");
    return raw.trim() || null;
  } catch {
    return null;
  }
}

export async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}
