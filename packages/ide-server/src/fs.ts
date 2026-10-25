import { promises as fs } from "node:fs";
import path from "node:path";
import { getRoot } from "./workspace.js";

/**
 * Workspace file system, scoped to the open project root.
 * Every path from the client is relative to the root and is resolved and
 * checked so that nothing outside the root can be read or written.
 */

const IGNORED_DIRS = new Set(["node_modules", ".git", ".turbo", "dist", "coverage"]);

export interface TreeNode {
  name: string;
  path: string;
  type: "file" | "dir";
  children?: TreeNode[];
}

export function resolveInRoot(relative: string): string {
  const root = getRoot();
  if (!root) throw new FsError(409, "NO_WORKSPACE", "No workspace is open");
  const normalized = relative.replace(/\\/g, "/").replace(/^\/+/, "");
  const target = path.resolve(root, normalized);
  const rel = path.relative(root, target);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new FsError(400, "OUTSIDE_WORKSPACE", `Path escapes the workspace: ${relative}`);
  }
  return target;
}

export function toRelative(absolute: string): string {
  const root = getRoot();
  if (!root) return absolute;
  return path.relative(root, absolute).replace(/\\/g, "/");
}

export async function readTree(relative = ""): Promise<TreeNode[]> {
  const dir = resolveInRoot(relative);
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const nodes: TreeNode[] = [];
  for (const entry of entries) {
    if (entry.isDirectory() && IGNORED_DIRS.has(entry.name)) continue;
    const abs = path.join(dir, entry.name);
    const node: TreeNode = {
      name: entry.name,
      path: toRelative(abs),
      type: entry.isDirectory() ? "dir" : "file"
    };
    if (entry.isDirectory()) {
      node.children = await readTree(node.path);
    }
    nodes.push(node);
  }
  nodes.sort((a, b) => {
    if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  return nodes;
}

/**
 * Finds files under `dir` whose name ends with `suffix`, newest first.
 * Used to locate CLI-written artifacts whose names carry a timestamp
 * (e.g. `.hardkas/artifacts/<ts>-plan-<planId>.plan.json`).
 */
export async function findBySuffix(dir: string, suffix: string, limit = 20): Promise<string[]> {
  const base = resolveInRoot(dir);
  const hits: Array<{ path: string; mtime: number }> = [];
  async function walk(current: string, depth: number): Promise<void> {
    if (depth > 6) return;
    let entries;
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const abs = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (!IGNORED_DIRS.has(entry.name)) await walk(abs, depth + 1);
      } else if (entry.name.endsWith(suffix)) {
        const stat = await fs.stat(abs);
        hits.push({ path: toRelative(abs), mtime: stat.mtimeMs });
      }
    }
  }
  await walk(base, 0);
  return hits
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, limit)
    .map((h) => h.path);
}

export async function readFile(relative: string): Promise<string> {
  return fs.readFile(resolveInRoot(relative), "utf8");
}

export async function writeFile(relative: string, content: string): Promise<void> {
  const target = resolveInRoot(relative);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, content, "utf8");
}

export async function mkdir(relative: string): Promise<void> {
  await fs.mkdir(resolveInRoot(relative), { recursive: true });
}

export async function remove(relative: string): Promise<void> {
  const target = resolveInRoot(relative);
  if (target === getRoot()) throw new FsError(400, "REFUSED", "Refusing to delete the workspace root");
  await fs.rm(target, { recursive: true, force: true });
}

export async function rename(from: string, to: string): Promise<void> {
  const source = resolveInRoot(from);
  const target = resolveInRoot(to);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.rename(source, target);
}

export class FsError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string
  ) {
    super(message);
  }
}
