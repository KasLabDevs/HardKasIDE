import { lookup } from "node:dns/promises";
import { promises as fs } from "node:fs";
import { isIP } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startJob, subscribe } from "./runner.js";
import { exists, getRoot, WorkspaceError } from "./workspace.js";

/**
 * External plugin support for the IDE:
 *   - fetch a manifest from any http(s) URL (the browser would hit CORS)
 *   - install an npm package under <workspace>/.hardkas/ide/plugins and read its
 *     "hardkasPlugin" manifest from package.json
 *   - serve installed packages and the bundled example plugins as static files
 */

export const PLUGINS_DIR = ".hardkas/ide/plugins";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".wasm": "application/wasm",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".webp": "image/webp",
  ".webmanifest": "application/manifest+json",
  ".txt": "text/plain; charset=utf-8",
  ".map": "application/json"
};

export function examplesDir(): string {
  // packages/ide-server/src/plugins.ts → repo root/examples/plugins
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "examples", "plugins");
}

/** True for addresses that are this machine or a private / link-local network (never fetched on a page's behalf). */
export function isInternalAddress(address: string): boolean {
  let a = address.toLowerCase().replace(/^\[|\]$/g, "");
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(a);
  if (mapped) a = mapped[1];
  if (isIP(a) === 4) {
    const [p, q] = a.split(".").map(Number);
    return p === 0 || p === 10 || p === 127 || (p === 169 && q === 254) || (p === 172 && q >= 16 && q <= 31) || (p === 192 && q === 168) || (p === 100 && q >= 64 && q <= 127) || p >= 224;
  }
  if (isIP(a) === 6) {
    return a === "::" || a === "::1" || a.startsWith("fc") || a.startsWith("fd") || a.startsWith("fe8") || a.startsWith("fe9") || a.startsWith("fea") || a.startsWith("feb") || a.startsWith("::ffff:");
  }
  return false;
}

/** Refuses a URL whose host is, or resolves to, this machine or a private network. */
async function assertPublicUrl(u: URL): Promise<void> {
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new WorkspaceError(400, "BLOCKED_URL", "Only http(s) URLs");
  const host = u.hostname.toLowerCase().replace(/\.$/, "").replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || isInternalAddress(host)) throw new WorkspaceError(400, "BLOCKED_URL", "Refusing to fetch an internal or loopback URL");
  if (isIP(host)) return;
  const addresses = await lookup(host, { all: true }).catch(() => []);
  if (addresses.length === 0) throw new WorkspaceError(400, "CANNOT_RESOLVE", `Cannot resolve ${host}`);
  if (addresses.some((r) => isInternalAddress(r.address))) throw new WorkspaceError(400, "BLOCKED_URL", `Refusing to fetch ${host}: it resolves to an internal address`);
}

/**
 * Fetches a plugin manifest for the IDE page (the browser would hit CORS). Only public hosts: every redirect hop is
 * checked again, and a name that resolves to this machine or a private network is refused. The bundled example
 * manifests are read from disk, not fetched.
 */
export async function fetchText(url: string): Promise<string> {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new WorkspaceError(400, "BAD_URL", "Not a valid URL");
  }
  for (let hop = 0; hop < 5; hop++) {
    await assertPublicUrl(u);
    const res = await fetch(u, { headers: { accept: "application/json, text/plain, */*" }, redirect: "manual", signal: AbortSignal.timeout(10_000) });
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      u = new URL(res.headers.get("location")!, u);
      continue;
    }
    if (!res.ok) throw new Error(`${res.status} ${res.statusText} from ${u.host}`);
    const text = await res.text();
    if (text.length > 512 * 1024) throw new Error("Manifest too large");
    return text;
  }
  throw new Error("Too many redirects");
}

export function pluginsRoot(): string {
  const root = getRoot();
  if (!root) throw new WorkspaceError(409, "NO_WORKSPACE", "No workspace is open");
  return path.join(root, PLUGINS_DIR);
}

/** Installs an npm package for plugins and returns its manifest. Streams output through a job. */
export async function installNpmPlugin(pkg: string): Promise<{ manifest: Record<string, unknown>; package: string; version: string; jobId: string }> {
  if (!/^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*(@[\w.^~<>=|-]+)?$/.test(pkg)) throw new WorkspaceError(400, "BAD_PACKAGE", "Invalid npm package name");
  const dir = pluginsRoot();
  await fs.mkdir(dir, { recursive: true });
  const pkgJson = path.join(dir, "package.json");
  if (!(await exists(pkgJson))) await fs.writeFile(pkgJson, JSON.stringify({ name: "hardkas-ide-plugins", private: true }, null, 2));
  // A plugin is a static web page: its install scripts never need to run on the user's machine.
  const job = await startJob({ command: "npm", args: ["install", pkg, "--ignore-scripts", "--no-audit", "--no-fund", "--loglevel=error"], cwd: dir });
  await new Promise<void>((resolve) => subscribe(job.id, () => undefined, resolve));
  if (job.status !== "succeeded") throw new Error(`npm install failed (exit ${job.exitCode}): ${job.stderr.trim().split("\n").slice(-3).join(" ")}`);

  const bare = pkg.replace(/(?!^)@.*$/, "");
  const pkgDir = path.join(dir, "node_modules", ...bare.split("/"));
  const meta = JSON.parse(await fs.readFile(path.join(pkgDir, "package.json"), "utf8")) as Record<string, unknown>;
  const hp = (meta.hardkasPlugin ?? {}) as Record<string, unknown>;
  const entry = String(hp.url ?? hp.entry ?? "index.html");
  const manifest: Record<string, unknown> = {
    name: String(hp.name ?? bare.replace(/^@/, "").replace(/\//g, "-")),
    displayName: String(hp.displayName ?? meta.name ?? bare),
    description: hp.description ?? meta.description,
    version: meta.version,
    author: typeof meta.author === "string" ? meta.author : (meta.author as { name?: string } | undefined)?.name,
    url: `/api/plugins/static/${bare}/${entry.replace(/^\.?\//, "")}`,
    location: hp.location ?? "sidePanel",
    methods: hp.methods ?? [],
    events: hp.events ?? [],
    permissions: hp.permissions ?? []
  };
  return { manifest, package: bare, version: String(meta.version ?? ""), jobId: job.id };
}

/** Resolves a file under a base dir, refusing escapes. */
export async function readStatic(baseDir: string, relative: string): Promise<{ body: Buffer; type: string } | null> {
  const target = path.resolve(baseDir, relative.replace(/^\/+/, ""));
  const rel = path.relative(baseDir, target);
  if (rel.startsWith("..") || path.isAbsolute(rel)) return null;
  try {
    const stat = await fs.stat(target);
    const file = stat.isDirectory() ? path.join(target, "index.html") : target;
    const body = await fs.readFile(file);
    return { body, type: MIME[path.extname(file).toLowerCase()] ?? "application/octet-stream" };
  } catch {
    return null;
  }
}

export interface SearchHit {
  name: string;
  version: string;
  description: string;
  author?: string;
  date?: string;
  links?: { npm?: string; homepage?: string; repository?: string };
  score?: number;
}

/** Searches npm for packages tagged `hardkas-plugin` (plus free text). */
export async function searchNpmPlugins(query: string): Promise<SearchHit[]> {
  const text = `keywords:hardkas-plugin ${query}`.trim();
  const url = `https://registry.npmjs.org/-/v1/search?text=${encodeURIComponent(text)}&size=25`;
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`npm search failed: ${res.status}`);
  const json = (await res.json()) as { objects?: Array<{ package: { name: string; version: string; description?: string; author?: { name?: string }; publisher?: { username?: string }; date?: string; links?: SearchHit["links"] }; score?: { final?: number } }> };
  return (json.objects ?? []).map((o) => ({
    name: o.package.name,
    version: o.package.version,
    description: o.package.description ?? "",
    author: o.package.author?.name ?? o.package.publisher?.username,
    date: o.package.date,
    links: o.package.links,
    score: o.score?.final
  }));
}

export interface RegistryEntry {
  name: string;
  displayName: string;
  description?: string;
  version?: string;
  author?: string;
  tags?: string[];
  manifestUrl: string;
  homepage?: string;
}

/**
 * Curated plugin registry: the repo's registry/plugins.json, optionally merged with a
 * remote registry (HARDKAS_PLUGIN_REGISTRY, e.g. a raw GitHub URL) so a community
 * list can exist without npm.
 */
export async function loadRegistry(): Promise<RegistryEntry[]> {
  const entries: RegistryEntry[] = [];
  const local = path.resolve(examplesDir(), "..", "..", "registry", "plugins.json");
  try {
    const j = JSON.parse(await fs.readFile(local, "utf8")) as { plugins?: RegistryEntry[] };
    entries.push(...(j.plugins ?? []));
  } catch {
    // no local registry
  }
  const remote = process.env.HARDKAS_PLUGIN_REGISTRY;
  if (remote) {
    try {
      const j = JSON.parse(await fetchText(remote)) as { plugins?: RegistryEntry[] };
      for (const e of j.plugins ?? []) if (!entries.some((x) => x.name === e.name)) entries.push(e);
    } catch {
      // remote registry unreachable: keep local
    }
  }
  return entries;
}

export async function listExamples(): Promise<Array<{ name: string; manifestUrl: string }>> {
  const dir = examplesDir();
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const out: Array<{ name: string; manifestUrl: string }> = [];
    for (const e of entries) {
      if (e.isDirectory() && (await exists(path.join(dir, e.name, "hardkas-plugin.json")))) {
        out.push({ name: e.name, manifestUrl: `/api/plugins/examples/${e.name}/hardkas-plugin.json` });
      }
    }
    return out;
  } catch {
    return [];
  }
}
