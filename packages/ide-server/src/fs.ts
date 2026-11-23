import { promises as fs } from "node:fs";
import path from "node:path";
import { isAgentForbidden, isKeyStorePath } from "./secretPaths.js";
import { getRoot } from "./workspace.js";

/**
 * Workspace file system, scoped to the open project root.
 * Every path from the client is relative to the root and is resolved and checked so that nothing outside the root
 * can be read or written, neither by `..` nor through a link (junction, symlink) inside the project that points
 * elsewhere. Key stores are never served (see secretPaths.ts); `.env` and SSH/PEM keys are refused to AI agents.
 */

const IGNORED_DIRS = new Set(["node_modules", ".git", ".turbo", "dist", "coverage"]);
/**
 * In the file tree: listed but not read (flagged `hidden`, no children), so the Explorer can show them on request and
 * load them one level at a time (`readDir`). `.git` is never listed.
 */
const HIDDEN_DIRS = new Set(["node_modules", ".turbo", "dist", "coverage"]);
/** One level of a folder read on demand stops here (a node_modules can hold thousands of entries). */
const DIR_LIST_LIMIT = 2000;

/** Who asks: the person in the IDE, or an AI agent (the MCP server marks its requests). */
export type FsClient = "user" | "agent";

/** The real path of `target`, resolving links in every existing part of it (the missing tail is kept as is). */
async function realPathOf(target: string): Promise<string> {
  const tail: string[] = [];
  let probe = target;
  for (;;) {
    try {
      return path.join(await fs.realpath(probe), ...tail);
    } catch (error: any) {
      if (error?.code !== "ENOENT" && error?.code !== "ENOTDIR") throw error;
      const parent = path.dirname(probe);
      if (parent === probe) return target;
      tail.unshift(path.basename(probe));
      probe = parent;
    }
  }
}

function secretError(rel: string): FsError {
  return new FsError(
    403,
    "SECRET_FILE",
    `${rel} holds private keys or other secrets, so the IDE does not open, search or change it. Keys are exported only through the Accounts view (simnet only).`
  );
}

/**
 * Resolves a workspace path for an operation and refuses: paths outside the root, paths that leave it through a
 * link, key stores (for everyone) and private files (for agents). Returns the absolute path to use.
 */
export async function safeTarget(relative: string, client: FsClient = "user"): Promise<string> {
  const target = resolveInRoot(relative);
  const root = getRoot()!;
  const rootReal = await fs.realpath(root).catch(() => root);
  const real = await realPathOf(target);
  const realRel = path.relative(rootReal, real);
  if (realRel.startsWith("..") || path.isAbsolute(realRel)) {
    throw new FsError(400, "OUTSIDE_WORKSPACE", `Path leaves the workspace through a link: ${relative}`);
  }
  for (const rel of [path.relative(root, target), realRel]) {
    const forward = rel.replace(/\\/g, "/");
    if (isKeyStorePath(forward) || (client === "agent" && isAgentForbidden(forward))) throw secretError(forward);
  }
  return target;
}

/** True when a file found by a walk may be shown to `client` (search and replace skip the others silently). */
function visible(relPath: string, client: FsClient): boolean {
  return !(isKeyStorePath(relPath) || (client === "agent" && isAgentForbidden(relPath)));
}

export interface TreeNode {
  name: string;
  path: string;
  type: "file" | "dir";
  children?: TreeNode[];
  /** Build output or dependencies (node_modules, dist…): not read with the tree; `readDir` loads it on request. */
  hidden?: true;
  /** A key store (see secretPaths.ts): listed so people know it is there, never read. */
  locked?: true;
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
  // On Windows a ':' inside a workspace path names an alternate data stream (note.txt:hidden), never a normal file.
  if (process.platform === "win32" && rel.includes(":")) {
    throw new FsError(400, "BAD_PATH", `Paths with ':' are not workspace files: ${relative}`);
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
    if (entry.isDirectory() && IGNORED_DIRS.has(entry.name) && !HIDDEN_DIRS.has(entry.name)) continue;
    const node = nodeOf(dir, entry);
    // A link (junction, symlink) is listed but never followed: it may point outside the project.
    if (entry.isDirectory() && !entry.isSymbolicLink() && !node.hidden && !node.locked) {
      node.children = await readTree(node.path);
    }
    nodes.push(node);
  }
  return sortNodes(nodes);
}

function nodeOf(dir: string, entry: import("node:fs").Dirent): TreeNode {
  const node: TreeNode = { name: entry.name, path: toRelative(path.join(dir, entry.name)), type: entry.isDirectory() ? "dir" : "file" };
  if (entry.isDirectory() && HIDDEN_DIRS.has(entry.name)) node.hidden = true;
  if (isKeyStorePath(node.path)) node.locked = true;
  return node;
}

function sortNodes(nodes: TreeNode[]): TreeNode[] {
  return nodes.sort((a, b) => {
    if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

/**
 * One level of a folder, for the Explorer to open a hidden folder (node_modules, dist…) or one below it without
 * reading the whole subtree. Sub-folders come without children. Refuses what `safeTarget` refuses (outside the
 * workspace, through a link, key stores); `.git` is never listed.
 */
export async function readDir(relative: string): Promise<{ nodes: TreeNode[]; truncated: boolean }> {
  const dir = await safeTarget(relative);
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const nodes: TreeNode[] = [];
  for (const entry of entries) {
    if (entry.isDirectory() && entry.name === ".git") continue;
    nodes.push(nodeOf(dir, entry));
    if (nodes.length >= DIR_LIST_LIMIT) break;
  }
  return { nodes: sortNodes(nodes), truncated: entries.length > nodes.length };
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
      if (entry.isSymbolicLink()) continue;
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

export async function readFile(relative: string, client: FsClient = "user"): Promise<string> {
  const target = await safeTarget(relative, client);
  try {
    return await fs.readFile(target, "utf8");
  } catch (error: any) {
    if (error?.code === "ENOENT") {
      throw new FsError(404, "NOT_FOUND", `File not found: ${relative}`);
    }
    throw error;
  }
}

export async function writeFile(relative: string, content: string, client: FsClient = "user"): Promise<void> {
  const target = await safeTarget(relative, client);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, content, "utf8");
}

export async function mkdir(relative: string, client: FsClient = "user"): Promise<void> {
  await fs.mkdir(await safeTarget(relative, client), { recursive: true });
}

/** Folders that hold key stores are never deleted or moved from the IDE, even as part of a parent folder. */
async function containsKeyStore(abs: string): Promise<boolean> {
  const stat = await fs.lstat(abs).catch(() => null);
  if (!stat || !stat.isDirectory() || stat.isSymbolicLink()) return false;
  const stack = [abs];
  while (stack.length) {
    const dir = stack.pop()!;
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const e of entries) {
      const child = path.join(dir, e.name);
      if (isKeyStorePath(toRelative(child))) return true;
      if (e.isDirectory() && !e.isSymbolicLink() && e.name !== "node_modules" && e.name !== ".git") stack.push(child);
    }
  }
  return false;
}

export async function remove(relative: string, client: FsClient = "user"): Promise<void> {
  const target = await safeTarget(relative, client);
  if (target === getRoot()) throw new FsError(400, "REFUSED", "Refusing to delete the workspace root");
  if (await containsKeyStore(target)) throw secretError(`${toRelative(target)} (it contains key files)`);
  await fs.rm(target, { recursive: true, force: true });
}

export async function rename(from: string, to: string, client: FsClient = "user"): Promise<void> {
  const source = await safeTarget(from, client);
  const target = await safeTarget(to, client);
  if (await containsKeyStore(source)) throw secretError(`${toRelative(source)} (it contains key files)`);
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

export async function searchWorkspace(opts: WorkspaceSearchOptions, client: FsClient = "user"): Promise<WorkspaceSearchResponse> {
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
        if (entry.isSymbolicLink()) continue;
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
      if (!visible(rel, client)) continue;
      const abs = await safeTarget(rel, client);
      const stat = await fs.stat(abs);
      if (stat.size > 1_000_000) continue; // skip >1MB files
      content = await fs.readFile(abs, "utf8");
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
  opts: WorkspaceSearchOptions & { replacement: string; targetFiles?: string[] },
  client: FsClient = "user"
): Promise<{ replacedFiles: number; replacedMatches: number }> {
  const searchRes = await searchWorkspace(
    {
      ...opts,
      includeFiles: opts.targetFiles && opts.targetFiles.length > 0 ? opts.targetFiles : opts.includeFiles,
      maxResults: 5000
    },
    client
  );
  const re = buildSearchRegExp(opts);
  let replacedFiles = 0;
  let replacedMatches = 0;

  for (const fileResult of searchRes.files) {
    try {
      const abs = await safeTarget(fileResult.path, client);
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

export interface IntelliSenseFile {
  path: string;
  content: string;
}

export interface IntelliSenseContext {
  sourceFiles: IntelliSenseFile[];
  typeDefs: IntelliSenseFile[];
  truncated: boolean;
}

const INTELLISENSE_SOURCE_EXTS = new Set([".sil", ".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"]);
const INTELLISENSE_CONFIG_NAMES = new Set(["package.json", "tsconfig.json", "jsconfig.json"]);
const INTELLISENSE_SKIP_DIRS = new Set(["node_modules", ".git", ".turbo", "dist", "build", "coverage", ".hardkas", ".next", ".svelte-kit", ".nuxt"]);

/**
 * Collects workspace source files (`.sil`, `.ts`/`.tsx`/`.js`/`.jsx`, `constructor-args.json`, `tsconfig.json`)
 * plus `.d.ts` declarations for declared dependencies in `node_modules`, keeping strict secret filtering and caps.
 */
export async function readIntelliSenseContext(): Promise<IntelliSenseContext> {
  const root = getRoot();
  if (!root) throw new FsError(409, "NO_WORKSPACE", "No workspace is open");
  const rootReal = await fs.realpath(root).catch(() => root);

  const sourceFiles: IntelliSenseFile[] = [];
  const typeDefs: IntelliSenseFile[] = [];
  const pkgRoots = new Set<string>();
  const depsWanted = new Set<string>();
  let sourceBytes = 0;
  let typeBytes = 0;
  let truncated = false;

  const MAX_SOURCE_FILES = 220;
  const MAX_SOURCE_BYTES = 2 * 1024 * 1024;
  const MAX_FILE_BYTES = 180 * 1024;
  // Declarations are bigger than sources: @types/node alone is 2.5 MB (fs.d.ts ~200 KB), a bundled SDK index.d.ts
  // 270 KB. A file left out makes the editor say the module does not exist, so the type budget is generous.
  const MAX_DTS_FILE_BYTES = 2 * 1024 * 1024;
  const MAX_TYPE_FILES = 1500;
  const MAX_TYPE_BYTES = 12 * 1024 * 1024;

  const isSourceRelevant = (name: string): boolean => {
    const lower = name.toLowerCase();
    if (INTELLISENSE_CONFIG_NAMES.has(lower)) return true;
    if (lower.endsWith(".constructor-args.json") || lower.endsWith(".spend-args.json")) return true;
    return INTELLISENSE_SOURCE_EXTS.has(path.posix.extname(lower));
  };

  async function walkSource(current: string, depth: number): Promise<void> {
    if (depth > 7 || sourceFiles.length >= MAX_SOURCE_FILES || sourceBytes >= MAX_SOURCE_BYTES) {
      truncated = true;
      return;
    }
    const entries = await fs.readdir(current, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (sourceFiles.length >= MAX_SOURCE_FILES || sourceBytes >= MAX_SOURCE_BYTES) {
        truncated = true;
        return;
      }
      if (entry.isSymbolicLink()) continue;
      const abs = path.join(current, entry.name);
      const rel = toRelative(abs);
      if (entry.isDirectory()) {
        if (!INTELLISENSE_SKIP_DIRS.has(entry.name)) await walkSource(abs, depth + 1);
        continue;
      }
      if (!isSourceRelevant(entry.name) || !visible(rel, "agent")) continue;
      const stat = await fs.stat(abs).catch(() => null);
      if (!stat || stat.size > MAX_FILE_BYTES) continue;
      const content = await fs.readFile(abs, "utf8").catch(() => null);
      if (content === null) continue;
      sourceFiles.push({ path: rel, content });
      sourceBytes += Buffer.byteLength(content, "utf8");

      if (entry.name.toLowerCase() === "package.json") {
        pkgRoots.add(path.dirname(abs));
        try {
          const parsed = JSON.parse(content) as Record<string, unknown>;
          for (const field of ["dependencies", "devDependencies", "peerDependencies"] as const) {
            const map = parsed[field];
            if (map && typeof map === "object") {
              for (const name of Object.keys(map as Record<string, unknown>)) {
                depsWanted.add(name);
                if (!name.startsWith("@")) depsWanted.add(`@types/${name}`);
              }
            }
          }
        } catch {
          // ignore malformed package.json
        }
      }
    }
  }

  await walkSource(root, 0);

  // Also check transitive @hardkas/* and @types/react packages installed in workspace node_modules
  if (depsWanted.has("react") || depsWanted.has("react-dom")) {
    depsWanted.add("@types/react");
    depsWanted.add("@types/react-dom");
    depsWanted.add("csstype");
  }

  const visitedPkgDirs = new Set<string>();
  const addedTypePaths = new Set<string>();
  const pkgQueue = Array.from(depsWanted);

  /**
   * `as`: the path the editor sees the file under. A package pnpm keeps only in `.pnpm/…/node_modules/<dep>` (a
   * dependency of a dependency) is presented as `node_modules/<dep>/…`, where the editor's module resolution looks.
   */
  const pushTypeFile = async (absFile: string, as?: string): Promise<string | null> => {
    if (typeDefs.length >= MAX_TYPE_FILES || typeBytes >= MAX_TYPE_BYTES) {
      truncated = true;
      return null;
    }
    const real = await realPathOf(absFile).catch(() => absFile);
    const realRel = path.relative(rootReal, real);
    if (realRel.startsWith("..") || path.isAbsolute(realRel)) return null;
    const rel = as ?? toRelative(absFile);
    if (addedTypePaths.has(rel) || !visible(rel, "agent")) return null;
    const stat = await fs.stat(absFile).catch(() => null);
    const limit = /\.d\.[cm]?ts$/i.test(absFile) ? MAX_DTS_FILE_BYTES : MAX_FILE_BYTES;
    if (!stat || !stat.isFile() || stat.size > limit) return null;
    const content = await fs.readFile(absFile, "utf8").catch(() => null);
    if (content === null) return null;
    addedTypePaths.add(rel);
    typeDefs.push({ path: rel, content });
    typeBytes += Buffer.byteLength(content, "utf8");
    return content;
  };

  /** `asDir`: where the package is presented to the editor (see pushTypeFile), when it is not where it was found. */
  async function walkDts(dir: string, depth: number, asDir?: string): Promise<void> {
    if (depth > 4 || typeDefs.length >= MAX_TYPE_FILES || typeBytes >= MAX_TYPE_BYTES) return;
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (typeDefs.length >= MAX_TYPE_FILES || typeBytes >= MAX_TYPE_BYTES) return;
      if (entry.isSymbolicLink()) continue;
      const abs = path.join(dir, entry.name);
      const as = asDir ? `${asDir}/${entry.name}` : undefined;
      if (entry.isDirectory()) {
        if (entry.name !== "node_modules" && entry.name !== ".git") await walkDts(abs, depth + 1, as);
      } else if (/\.d\.[cm]?ts$/i.test(entry.name)) {
        await pushTypeFile(abs, as);
      }
    }
  }

  const nmSearchRoots = Array.from(pkgRoots).map((dir) => path.join(dir, "node_modules"));
  if (!nmSearchRoots.includes(path.join(root, "node_modules"))) nmSearchRoots.unshift(path.join(root, "node_modules"));
  // pnpm keeps a package's own dependencies beside it in `.pnpm/<pkg>@<v>/node_modules`, not at the top: where to
  // look for a dependency queued by a package found there.
  const extraRootsFor = new Map<string, string[]>();
  const foundPkgs = new Set<string>();

  while (pkgQueue.length > 0 && typeDefs.length < MAX_TYPE_FILES && typeBytes < MAX_TYPE_BYTES) {
    const pkgName = pkgQueue.shift()!;
    const roots = [...nmSearchRoots, ...(extraRootsFor.get(pkgName) ?? [])];
    for (const nmRoot of roots) {
      const pkgDir = path.join(nmRoot, ...pkgName.split("/"));
      if (visitedPkgDirs.has(pkgDir)) continue;
      const hoisted = nmSearchRoots.includes(nmRoot);
      const asDir = hoisted ? undefined : `node_modules/${pkgName}`;
      const pkgJsonText = await pushTypeFile(path.join(pkgDir, "package.json"), asDir ? `${asDir}/package.json` : undefined);
      if (!pkgJsonText) continue;
      visitedPkgDirs.add(pkgDir);
      foundPkgs.add(pkgName);

      let declared = new Set<string>();
      try {
        const parsed = JSON.parse(pkgJsonText) as Record<string, unknown>;
        for (const field of ["dependencies", "peerDependencies", "optionalDependencies"]) {
          const deps = parsed[field];
          if (deps && typeof deps === "object") for (const d of Object.keys(deps)) declared.add(d);
        }
      } catch {
        declared = new Set();
      }
      const before = typeDefs.length;
      await walkDts(pkgDir, 0, asDir);

      // The packages this one's types import (`export * from "@trystero-p2p/nostr"`, `import("@hardkas/core")`),
      // and for @hardkas/* every @hardkas dependency. Under pnpm they sit beside this package's real folder.
      const wanted = new Set<string>();
      if (pkgName.startsWith("@hardkas/")) for (const d of declared) if (d.startsWith("@hardkas/")) wanted.add(d);
      for (const td of typeDefs.slice(before)) {
        for (const spec of importedPackages(td.content)) if (declared.has(spec) && spec !== pkgName) wanted.add(spec);
      }
      if (wanted.size > 0) {
        const real = await fs.realpath(pkgDir).catch(() => pkgDir);
        const siblingRoot = pkgName.startsWith("@") ? path.dirname(path.dirname(real)) : path.dirname(real);
        for (const dep of wanted) {
          extraRootsFor.set(dep, [...(extraRootsFor.get(dep) ?? []), siblingRoot]);
          // Queued again when an earlier pass looked only at the top and did not find it.
          if (!depsWanted.has(dep) || (!foundPkgs.has(dep) && !pkgQueue.includes(dep))) {
            depsWanted.add(dep);
            pkgQueue.push(dep);
          }
        }
      }
      break; // one copy of a package is enough
    }
  }

  return { sourceFiles, typeDefs, truncated };
}

/** The package names a type file imports or re-exports (`from "x"`, `import("x")`, `/// <reference types="x" />`). */
export function importedPackages(dts: string): Set<string> {
  const out = new Set<string>();
  const re = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|<reference\s+types\s*=\s*)["']([^"'./][^"']*)["']/g;
  for (const m of dts.matchAll(re)) {
    const spec = m[1];
    if (spec.startsWith("node:")) continue;
    const parts = spec.split("/");
    out.add(spec.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0]);
  }
  return out;
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
