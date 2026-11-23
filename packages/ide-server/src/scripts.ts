import { promises as fs } from "node:fs";
import path from "node:path";
import { WorkspaceError } from "./workspace.js";

export type PackageManager = "pnpm" | "npm" | "yarn" | "bun";
export type ScriptKind = "launch" | "deploy" | "test" | "build" | "other";

export interface PackageScriptEntry {
  name: string;
  command: string;
  kind: ScriptKind;
  manager: PackageManager;
  cliPreview: string;
}

export interface WorkspacePackageScripts {
  id: string;
  name: string;
  relDir: string;
  manifestPath: string;
  manager: PackageManager;
  scripts: PackageScriptEntry[];
}

export interface ResolvedPackageScript {
  cwd: string;
  relDir: string;
  manifestPath: string;
  packageName: string;
  manager: PackageManager;
  script: string;
  command: string;
  kind: ScriptKind;
  cliPreview: string;
}

const MAX_SCAN_DEPTH = 4;
const IGNORED_DIRS = new Set([
  "node_modules",
  "dist",
  "build",
  "coverage",
  "target",
  "out",
  "__pycache__"
]);
const UNSAFE_SCRIPT_NAME = /[\0\r\n&|<>^%!"]/;

async function exists(file: string): Promise<boolean> {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

function normalizeKey(p: string): string {
  const resolved = path.resolve(p);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function isInsideRealDir(child: string, realParent: string): boolean {
  const rel = path.relative(normalizeKey(realParent), normalizeKey(child));
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

function parsePackageManagerField(raw: unknown): PackageManager | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim().toLowerCase();
  for (const pm of ["pnpm", "yarn", "bun", "npm"] as const) {
    if (trimmed === pm || trimmed.startsWith(`${pm}@`)) return pm;
  }
  return null;
}

async function readJsonObject(file: string): Promise<Record<string, unknown> | null> {
  try {
    const raw = await fs.readFile(file, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function formatScriptCli(manager: PackageManager, scriptName: string): string {
  return `${manager} run ${scriptName}`;
}

export function classifyScript(name: string, command: string): ScriptKind {
  const n = name.trim();
  const cmd = command.trim();
  const combined = `${n} ${cmd}`;
  if (/(?:^|[:._-])deploy(?:[:._-]|$)|\b(?:wrangler\s+pages\s+deploy|vercel\b|netlify\s+deploy)\b/i.test(combined) || /^(?:publish|release)(?:[:._-]|$)/i.test(n)) {
    return "deploy";
  }
  if (
    /^(?:dev|start|serve|preview|watch|up|node|localnet|server|web|api|frontend|backend|app|dapp)(?:[:._-]|$)/i.test(n) ||
    /\b(?:next\s+dev|wrangler\s+dev|nodemon|tsx\s+watch|ts-node-dev|uvicorn|flask\s+run|astro\s+dev|nuxt\s+dev|svelte-kit\s+dev|webpack(?:-dev-server|\s+serve)|live-server|http-server|concurrently)\b/i.test(cmd) ||
    /\bvite(?:\s+preview)?(?!\s+build)\b/i.test(cmd) ||
    /\bserve(?:\.[cm]?[jt]s)?\b/i.test(cmd) ||
    /\bhardkas\s+(?:dev|node|localnet\s+start)\b/i.test(cmd)
  ) {
    return "launch";
  }
  if (
    /^(?:test|e2e|spec|vitest|jest|playwright|cypress)(?:[:._-]|$)/i.test(n) ||
    /\b(?:vitest|jest|playwright|cypress|mocha|node\s+--test)\b/i.test(cmd)
  ) {
    return "test";
  }
  if (/^(?:build|compile|typecheck|tsc|lint|eslint|prettier|format|fmt|clean|check|codegen|gen|pack)(?:[:._-]|$)/i.test(n)) {
    return "build";
  }
  return "other";
}

export async function detectPackageManager(
  pkgDir: string,
  root: string,
  ownPackageJson?: Record<string, unknown> | null
): Promise<PackageManager> {
  const realRoot = await fs.realpath(path.resolve(root)).catch(() => path.resolve(root));
  let cur = await fs.realpath(path.resolve(pkgDir)).catch(() => path.resolve(pkgDir));

  while (isInsideRealDir(cur, realRoot)) {
    const manifest = cur === pkgDir && ownPackageJson ? ownPackageJson : await readJsonObject(path.join(cur, "package.json"));
    const fromField = parsePackageManagerField(manifest?.packageManager);
    if (fromField) return fromField;

    if (await exists(path.join(cur, "pnpm-lock.yaml"))) return "pnpm";
    if (await exists(path.join(cur, "yarn.lock"))) return "yarn";
    if ((await exists(path.join(cur, "bun.lock"))) || (await exists(path.join(cur, "bun.lockb")))) return "bun";
    if ((await exists(path.join(cur, "package-lock.json"))) || (await exists(path.join(cur, "npm-shrinkwrap.json")))) return "npm";

    if (normalizeKey(cur) === normalizeKey(realRoot)) break;
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  return "npm";
}

export async function discoverWorkspaceScripts(root: string): Promise<WorkspacePackageScripts[]> {
  const realRoot = await fs.realpath(path.resolve(root));
  const results: WorkspacePackageScripts[] = [];

  const scanDir = async (dir: string, relDir: string, depth: number): Promise<void> => {
    const pkgPath = path.join(dir, "package.json");
    const json = await readJsonObject(pkgPath);
    if (json && json.scripts && typeof json.scripts === "object" && !Array.isArray(json.scripts)) {
      const rawScripts = json.scripts as Record<string, unknown>;
      const entries = Object.entries(rawScripts).filter((e): e is [string, string] => typeof e[1] === "string" && e[1].trim().length > 0);
      if (entries.length > 0) {
        const manager = await detectPackageManager(dir, realRoot, json);
        const normRel = relDir || ".";
        const name = typeof json.name === "string" && json.name.trim() ? json.name.trim() : relDir ? path.basename(dir) : path.basename(realRoot);
        results.push({
          id: normRel,
          name,
          relDir: normRel,
          manifestPath: relDir ? `${relDir}/package.json` : "package.json",
          manager,
          scripts: entries.map(([scriptName, command]) => ({
            name: scriptName,
            command,
            kind: classifyScript(scriptName, command),
            manager,
            cliPreview: formatScriptCli(manager, scriptName)
          }))
        });
      }
    }

    if (depth >= MAX_SCAN_DEPTH) return;
    let children;
    try {
      children = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of children) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
      if (entry.name.startsWith(".") || IGNORED_DIRS.has(entry.name)) continue;
      const nextDir = path.join(dir, entry.name);
      const nextReal = await fs.realpath(nextDir).catch(() => null);
      if (!nextReal || !isInsideRealDir(nextReal, realRoot)) continue;
      const nextRel = relDir ? `${relDir}/${entry.name}` : entry.name;
      await scanDir(nextReal, nextRel, depth + 1);
    }
  };

  await scanDir(realRoot, "", 0);
  results.sort((a, b) => {
    if (a.relDir === "." && b.relDir !== ".") return -1;
    if (b.relDir === "." && a.relDir !== ".") return 1;
    return a.relDir.localeCompare(b.relDir);
  });
  return results;
}

export async function resolvePackageScript(root: string, relDir: string | undefined, scriptName: string): Promise<ResolvedPackageScript> {
  if (!scriptName || UNSAFE_SCRIPT_NAME.test(scriptName)) {
    throw new WorkspaceError(400, "BAD_SCRIPT_NAME", `Invalid script name: ${scriptName}`);
  }
  const realRoot = await fs.realpath(path.resolve(root));
  const cleanRel = (relDir ?? ".").replace(/\\/g, "/").replace(/^\.\/+/, "").replace(/^\/+|\/+$/g, "") || ".";
  const candidateDir = cleanRel === "." ? realRoot : path.resolve(realRoot, cleanRel);
  if (!isInsideRealDir(candidateDir, realRoot)) {
    throw new WorkspaceError(400, "OUTSIDE_WORKSPACE", `Package directory escapes workspace: ${cleanRel}`);
  }
  const realPkgDir = await fs.realpath(candidateDir).catch(() => {
    throw new WorkspaceError(404, "PACKAGE_NOT_FOUND", `Package directory not found: ${cleanRel}`);
  });
  if (!isInsideRealDir(realPkgDir, realRoot)) {
    throw new WorkspaceError(400, "OUTSIDE_WORKSPACE", `Package directory escapes workspace: ${cleanRel}`);
  }
  const json = await readJsonObject(path.join(realPkgDir, "package.json"));
  if (!json || !json.scripts || typeof json.scripts !== "object" || Array.isArray(json.scripts)) {
    throw new WorkspaceError(404, "SCRIPT_NOT_FOUND", `No scripts defined in ${cleanRel}/package.json`);
  }
  const scripts = json.scripts as Record<string, unknown>;
  if (!Object.hasOwn(scripts, scriptName) || typeof scripts[scriptName] !== "string") {
    throw new WorkspaceError(404, "SCRIPT_NOT_FOUND", `Script "${scriptName}" not found in ${cleanRel}/package.json`);
  }
  const command = scripts[scriptName] as string;
  const manager = await detectPackageManager(realPkgDir, realRoot, json);
  const packageName = typeof json.name === "string" && json.name.trim() ? json.name.trim() : path.basename(realPkgDir);
  return {
    cwd: realPkgDir,
    relDir: cleanRel,
    manifestPath: cleanRel === "." ? "package.json" : `${cleanRel}/package.json`,
    packageName,
    manager,
    script: scriptName,
    command,
    kind: classifyScript(scriptName, command),
    cliPreview: formatScriptCli(manager, scriptName)
  };
}
