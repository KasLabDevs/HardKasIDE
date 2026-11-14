import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { ensureHardkasConfig } from "./frontendScaffold.js";

/**
 * Workspace state for the IDE server: which HardKas project folder is open, whether the user trusts it, plus the
 * list of recently opened projects (stored in the user's home dir).
 *
 * Trust. A HardKas project is code: the CLI runs its `hardkas.config.ts` on every command, `npm` runs its scripts and
 * the tests run its files. So a folder the user has not trusted is opened read-only: files can be browsed and
 * edited, but nothing of the project runs (no CLI, no npm, no tests, no debugger, no AI agent) until the user says
 * "Trust this folder". Folders the IDE creates itself (New project) are trusted. Trust covers subfolders.
 */

const IDE_HOME = path.join(os.homedir(), ".hardkas-ide");
const RECENTS_FILE = path.join(IDE_HOME, "recents.json");
const TRUSTED_FILE = path.join(IDE_HOME, "trusted.json");
const MAX_RECENTS = 12;

const CONFIG_NAMES = ["hardkas.config.ts", "hardkas.config.mts", "hardkas.config.js", "hardkas.config.mjs"];

export class WorkspaceError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string
  ) {
    super(message);
  }
}

export interface WorkspaceInfo {
  root: string | null;
  name: string | null;
  hasConfig: boolean;
  configFile: string | null;
  hasHardkasDir: boolean;
  hasDevServerToken: boolean;
  /** The user trusts this folder: its code (config, scripts, tests) may run. */
  trusted: boolean;
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

/** Path comparison key: Windows paths are case-insensitive. */
function key(p: string): string {
  const resolved = path.resolve(p);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function isInside(child: string, parent: string): boolean {
  const rel = path.relative(key(parent), key(child));
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

async function readTrusted(): Promise<string[]> {
  try {
    const parsed = JSON.parse(await fs.readFile(TRUSTED_FILE, "utf8")) as unknown;
    return Array.isArray(parsed) ? parsed.filter((p): p is string => typeof p === "string") : [];
  } catch {
    return [];
  }
}

export async function isTrusted(dir: string): Promise<boolean> {
  return (await readTrusted()).some((t) => isInside(dir, t));
}

export async function trustFolder(dir: string): Promise<void> {
  const real = await fs.realpath(path.resolve(dir));
  const list = (await readTrusted()).filter((t) => key(t) !== key(real));
  list.push(real);
  await fs.mkdir(IDE_HOME, { recursive: true });
  await fs.writeFile(TRUSTED_FILE, JSON.stringify(list, null, 2), "utf8");
}

/** Throws UNTRUSTED_WORKSPACE when `dir` (default: the open workspace) is not trusted. */
export async function requireTrusted(dir: string | null | undefined = currentRoot): Promise<void> {
  if (!dir) return;
  if (!(await isTrusted(dir))) {
    throw new WorkspaceError(
      403,
      "UNTRUSTED_WORKSPACE",
      `This folder is not trusted yet, so none of its code runs (CLI, npm scripts, tests, the AI agent). Choose "Trust this folder" in the IDE if you know where it comes from: ${dir}`
    );
  }
}

/**
 * Folders that are never a project: the home folder (it holds HardKAS' global ~/.hardkas, the IDE's settings and
 * everything else of the user), drive and filesystem roots, and the HardKAS / IDE settings folders themselves.
 * Opening one would let a reset, a search or the agent reach far more than a project.
 */
function refusedReason(dir: string): string | null {
  const resolved = path.resolve(dir);
  if (path.parse(resolved).root === resolved) return "a drive or filesystem root is not a project folder";
  if (key(resolved) === key(os.homedir())) return "your home folder is not a project folder: open or create a project inside it";
  for (const settings of [IDE_HOME, path.join(os.homedir(), ".hardkas")]) {
    if (isInside(resolved, settings)) return `${settings} holds settings and keys, not a project`;
  }
  return null;
}

export async function describeWorkspace(): Promise<WorkspaceInfo> {
  if (!currentRoot) {
    return { root: null, name: null, hasConfig: false, configFile: null, hasHardkasDir: false, hasDevServerToken: false, trusted: false };
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
    hasDevServerToken: await exists(path.join(currentRoot, ".hardkas", "dev-server-token")),
    trusted: await isTrusted(currentRoot)
  };
}

export interface OpenOptions {
  /** Only folders that are HardKas projects (a hardkas.config.* or a package.json naming @hardkas/). Used for MCP. */
  requireProject?: boolean;
}

export async function openWorkspace(dir: string, options: OpenOptions = {}): Promise<WorkspaceInfo> {
  const resolved = path.resolve(dir);
  const stat = await fs.stat(resolved).catch(() => null);
  if (!stat || !stat.isDirectory()) {
    throw new WorkspaceError(400, "NOT_A_DIRECTORY", `Not a directory: ${path.basename(resolved) || resolved}`);
  }
  // The real path: a junction or symlink to another place opens that place, so every check sees where files really are.
  const real = await fs.realpath(resolved);
  const refused = refusedReason(real);
  if (refused) throw new WorkspaceError(400, "NOT_A_PROJECT_FOLDER", refused);
  if (options.requireProject && !(await looksLikeProject(real))) {
    throw new WorkspaceError(400, "NOT_A_HARDKAS_PROJECT", "Only HardKas projects can be opened here (a folder with hardkas.config.ts or a package.json that uses @hardkas/).");
  }
  if (await isTrusted(real)) {
    try {
      const pkgRaw = await fs.readFile(path.join(real, "package.json"), "utf8");
      if (pkgRaw.includes("@hardkas/")) await ensureHardkasConfig(real);
    } catch {
      // no package.json or unreadable
    }
  }
  currentRoot = real;
  await addRecent(real);
  return describeWorkspace();
}

async function looksLikeProject(dir: string): Promise<boolean> {
  for (const name of CONFIG_NAMES) if (await exists(path.join(dir, name))) return true;
  try {
    return (await fs.readFile(path.join(dir, "package.json"), "utf8")).includes("@hardkas/");
  } catch {
    return false;
  }
}

export function closeWorkspace(): void {
  currentRoot = null;
}

export async function listRecents(): Promise<RecentEntry[]> {
  try {
    const raw = await fs.readFile(RECENTS_FILE, "utf8");
    const parsed = JSON.parse(raw) as RecentEntry[];
    const alive: RecentEntry[] = [];
    for (const entry of Array.isArray(parsed) ? parsed : []) {
      if (entry && typeof entry.path === "string" && (await exists(entry.path))) alive.push(entry);
    }
    return alive;
  } catch {
    return [];
  }
}

async function addRecent(dir: string): Promise<void> {
  const recents = (await listRecents()).filter((r) => key(r.path) !== key(dir));
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
