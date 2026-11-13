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
  try {
    return await fs.readFile(resolveInRoot(relative), "utf8");
  } catch (error: any) {
    if (error?.code === "ENOENT") {
      throw new FsError(404, "NOT_FOUND", `File not found: ${relative}`);
    }
    throw error;
  }
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

export interface SearchMatchLine {
  line: number;
  column: number;
  matchLength: number;
  lineText: string;
  matchText: string;
}

export interface SearchFileResult {
  path: string;
  matches: SearchMatchLine[];
}

export interface WorkspaceSearchOptions {
  query: string;
  caseSensitive?: boolean;
  regex?: boolean;
  wholeWord?: boolean;
  filePatterns?: string;
  scopeDir?: string;
  includeFiles?: string[];
  maxResults?: number;
}

export interface WorkspaceSearchResponse {
  query: string;
  files: SearchFileResult[];
  totalMatches: number;
  totalFiles: number;
  truncated: boolean;
}

function compileFilePatternMatcher(patternsRaw?: string): (relPath: string, fileName: string) => boolean {
  const raw = (patternsRaw ?? "").trim();
  if (!raw || raw === "*" || raw === "*.*") return () => true;
  const parts = raw
    .split(/[,;]+/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 0) return () => true;

  const regexes = parts.map((p) => {
    const escaped = p
      .replace(/\\/g, "/")
      .replace(/[.+^${}()|[\]\\]/g, "\\$&")
      .replace(/\*/g, ".*")
      .replace(/\?/g, ".");
    return { hasSlash: p.includes("/") || p.includes("\\"), re: new RegExp(`^${escaped}$`, "i") };
  });

  return (relPath: string, fileName: string) =>
    regexes.some((r) => (r.hasSlash ? r.re.test(relPath) : r.re.test(fileName)));
}

function buildSearchRegExp(opts: WorkspaceSearchOptions): RegExp {
  const flags = opts.caseSensitive ? "g" : "gi";
  let source = opts.query;
  if (!opts.regex) {
    // Support Eclipse wildcard style (* and ?) when not in regex mode if present, otherwise literal escape
    source = source.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  if (opts.wholeWord) {
    source = `\\b(?:${source})\\b`;
  }
  return new RegExp(source, flags);
}

const BINARY_EXTS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".ico",
  ".pdf",
  ".zip",
  ".gz",
  ".tar",
  ".wasm",
  ".exe",
  ".dll",
  ".so",
  ".dylib",
  ".db",
  ".sqlite"
]);

export async function searchWorkspace(opts: WorkspaceSearchOptions): Promise<WorkspaceSearchResponse> {
  const q = (opts.query ?? "").trim();
  if (!q) {
    return { query: "", files: [], totalMatches: 0, totalFiles: 0, truncated: false };
  }

  const maxResults = opts.maxResults ?? 1500;
  const matchFile = compileFilePatternMatcher(opts.filePatterns);
  const re = buildSearchRegExp({ ...opts, query: q });

  const candidateFiles: string[] = [];
  if (opts.includeFiles && opts.includeFiles.length > 0) {
    for (const rel of opts.includeFiles) {
      const norm = rel.replace(/\\/g, "/").replace(/^\/+/, "");
      const name = path.posix.basename(norm);
      if (matchFile(norm, name)) candidateFiles.push(norm);
    }
  } else {
    const startDir = resolveInRoot(opts.scopeDir ?? "");
    async function collect(current: string, depth: number): Promise<void> {
      if (depth > 8 || candidateFiles.length > 2000) return;
      let entries;
      try {
        entries = await fs.readdir(current, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        const abs = path.join(current, entry.name);
        if (entry.isDirectory()) {
          if (!IGNORED_DIRS.has(entry.name)) await collect(abs, depth + 1);
        } else {
          const ext = path.extname(entry.name).toLowerCase();
          if (BINARY_EXTS.has(ext)) continue;
          const rel = toRelative(abs);
          if (matchFile(rel, entry.name)) {
            candidateFiles.push(rel);
          }
        }
      }
    }
    await collect(startDir, 0);
  }

  const files: SearchFileResult[] = [];
  let totalMatches = 0;
  let truncated = false;

  for (const rel of candidateFiles) {
    if (totalMatches >= maxResults) {
      truncated = true;
      break;
    }
    let content: string;
    try {
      const stat = await fs.stat(resolveInRoot(rel));
      if (stat.size > 1_000_000) continue; // skip >1MB files
      content = await fs.readFile(resolveInRoot(rel), "utf8");
    } catch {
      continue;
    }

    const lines = content.split(/\r?\n/);
    const fileMatches: SearchMatchLine[] = [];

    for (let i = 0; i < lines.length; i++) {
      const lineText = lines[i];
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(lineText)) !== null) {
        const matchText = m[0];
        if (matchText.length === 0) {
          re.lastIndex++;
          continue;
        }
        fileMatches.push({
          line: i + 1,
          column: m.index + 1,
          matchLength: matchText.length,
          lineText: lineText.slice(0, 300),
          matchText
        });
        totalMatches++;
        if (totalMatches >= maxResults) {
          truncated = true;
          break;
        }
      }
      if (truncated) break;
    }

    if (fileMatches.length > 0) {
      files.push({ path: rel, matches: fileMatches });
    }
  }

  return {
    query: q,
    files,
    totalMatches,
    totalFiles: files.length,
    truncated
  };
}

export async function replaceInWorkspace(
  opts: WorkspaceSearchOptions & { replacement: string; targetFiles?: string[] }
): Promise<{ replacedFiles: number; replacedMatches: number }> {
  const searchRes = await searchWorkspace({
    ...opts,
    includeFiles: opts.targetFiles && opts.targetFiles.length > 0 ? opts.targetFiles : opts.includeFiles,
    maxResults: 5000
  });
  const re = buildSearchRegExp(opts);
  let replacedFiles = 0;
  let replacedMatches = 0;

  for (const fileResult of searchRes.files) {
    try {
      const abs = resolveInRoot(fileResult.path);
      const original = await fs.readFile(abs, "utf8");
      let count = 0;
      const updated = original.replace(re, () => {
        count++;
        return opts.replacement;
      });
      if (count > 0 && updated !== original) {
        await fs.writeFile(abs, updated, "utf8");
        replacedFiles++;
        replacedMatches += count;
      }
    } catch {
      // ignore individual file errors
    }
  }

  return { replacedFiles, replacedMatches };
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
