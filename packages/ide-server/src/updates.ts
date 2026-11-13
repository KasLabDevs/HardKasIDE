import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cliInfo, HARDKAS_CLI_VERSION } from "./runner.js";
import { exists } from "./workspace.js";

const REPO_SLUG = "KasLabDevs/HardKasIDE";
const RELEASES_PAGE = `https://github.com/${REPO_SLUG}/releases`;
const DEFAULT_GITHUB_API = `https://api.github.com/repos/${REPO_SLUG}/releases/latest`;
const DEFAULT_NPM_API = "https://registry.npmjs.org/-/package/@hardkas/cli/dist-tags";
const CACHE_TTL_MS = 15 * 60 * 1000;

export interface IdeUpdateInfo {
  currentVersion: string;
  latestVersion: string | null;
  hasUpdate: boolean;
  releaseName: string | null;
  releaseUrl: string;
  downloadUrl: string | null;
  publishedAt: string | null;
  notes: string | null;
  error: string | null;
}

export interface CliUpdateInfo {
  runtimeVersion: string | null;
  runtimeSource: "project" | "env" | "repo" | "npx";
  projectVersion: string | null;
  pinnedVersion: string;
  npmLatest: string | null;
  npmNext: string | null;
  targetVersion: string;
  hasUpdate: boolean;
  reason: "project-behind" | "npm-newer" | "mismatch" | "missing" | null;
  updateCommand: string;
  error: string | null;
}

export interface UpdateReport {
  checkedAt: string;
  ide: IdeUpdateInfo;
  cli: CliUpdateInfo;
}

interface ParsedSemver {
  major: number;
  minor: number;
  patch: number;
  pre: Array<number | string>;
}

/** Parses major.minor.patch[-prerelease][+build] strictly enough for release tags like "v0.13.0-rc.1". */
export function parseSemver(raw: string | null | undefined): ParsedSemver | null {
  if (!raw) return null;
  const cleaned = raw.trim().replace(/^[^\d]*/, "");
  const m = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(cleaned);
  if (!m) return null;
  const pre = m[4]
    ? m[4].split(".").map((part) => (/^\d+$/.test(part) ? Number(part) : part))
    : [];
  return {
    major: Number(m[1]),
    minor: Number(m[2]),
    patch: Number(m[3]),
    pre
  };
}

/** SemVer 2.0.0 ordering: returns 1 if a > b, -1 if a < b, 0 if equal (or invalid). */
export function compareSemver(a: string | null | undefined, b: string | null | undefined): number {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  if (!pa || !pb) return 0;
  for (const [x, y] of [
    [pa.major, pb.major],
    [pa.minor, pb.minor],
    [pa.patch, pb.patch]
  ] as const) {
    if (x !== y) return x > y ? 1 : -1;
  }
  if (pa.pre.length === 0 && pb.pre.length === 0) return 0;
  if (pa.pre.length === 0) return 1;
  if (pb.pre.length === 0) return -1;
  const len = Math.max(pa.pre.length, pb.pre.length);
  for (let i = 0; i < len; i++) {
    const x = pa.pre[i];
    const y = pb.pre[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    if (x === y) continue;
    if (typeof x === "number" && typeof y === "number") return x > y ? 1 : -1;
    if (typeof x === "number") return -1;
    if (typeof y === "number") return 1;
    return String(x) > String(y) ? 1 : -1;
  }
  return 0;
}

async function readServerPackageVersion(): Promise<string> {
  try {
    const pkgPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "package.json");
    const parsed = JSON.parse(await fs.readFile(pkgPath, "utf8")) as { version?: unknown };
    if (typeof parsed.version === "string" && parseSemver(parsed.version)) {
      return parsed.version;
    }
  } catch {
    // ignore
  }
  return "0.2.0";
}

interface RemoteReleaseCache {
  at: number;
  url: string;
  latestVersion: string | null;
  releaseName: string | null;
  releaseUrl: string;
  downloadUrl: string | null;
  publishedAt: string | null;
  notes: string | null;
  error: string | null;
}

interface RemoteNpmCache {
  at: number;
  url: string;
  latest: string | null;
  next: string | null;
  error: string | null;
}

let releaseCache: RemoteReleaseCache | null = null;
let npmCache: RemoteNpmCache | null = null;

function pickPlatformAsset(assets: Array<{ name?: string; browser_download_url?: string }>): string | null {
  const names = assets.filter((a) => typeof a.name === "string" && typeof a.browser_download_url === "string");
  const findByExt = (pred: (lower: string) => boolean) =>
    names.find((a) => pred(a.name!.toLowerCase()))?.browser_download_url ?? null;
  if (process.platform === "win32") {
    return (
      findByExt((n) => n === "hardkas-ide-setup.exe") ??
      findByExt((n) => n.endsWith("-setup.exe") || n.endsWith(".exe")) ??
      findByExt((n) => n.endsWith(".msi"))
    );
  }
  if (process.platform === "darwin") {
    return findByExt((n) => n.endsWith(".dmg"));
  }
  return findByExt((n) => n.endsWith(".appimage")) ?? findByExt((n) => n.endsWith(".deb"));
}

async function fetchIdeRelease(currentVersion: string, force: boolean): Promise<RemoteReleaseCache> {
  const url = process.env.HARDKAS_IDE_UPDATES_URL?.trim() || DEFAULT_GITHUB_API;
  if (!force && releaseCache && releaseCache.url === url && Date.now() - releaseCache.at < CACHE_TTL_MS) {
    return releaseCache;
  }
  try {
    const res = await fetch(url, {
      headers: {
        accept: "application/vnd.github+json",
        "user-agent": `HardKas-IDE/${currentVersion}`
      },
      redirect: "follow",
      signal: AbortSignal.timeout(4_000)
    });
    if (!res.ok) {
      const entry: RemoteReleaseCache = {
        at: Date.now(),
        url,
        latestVersion: null,
        releaseName: null,
        releaseUrl: RELEASES_PAGE,
        downloadUrl: null,
        publishedAt: null,
        notes: null,
        error: res.status === 404 ? "No releases published yet" : `GitHub HTTP ${res.status}`
      };
      releaseCache = entry;
      return entry;
    }
    const json = (await res.json()) as {
      tag_name?: string;
      name?: string;
      html_url?: string;
      published_at?: string;
      body?: string;
      assets?: Array<{ name?: string; browser_download_url?: string }>;
    };
    const parsedTag = parseSemver(json.tag_name) ? json.tag_name!.trim().replace(/^v/i, "") : null;
    const entry: RemoteReleaseCache = {
      at: Date.now(),
      url,
      latestVersion: parsedTag,
      releaseName: json.name ?? json.tag_name ?? null,
      releaseUrl: json.html_url ?? RELEASES_PAGE,
      downloadUrl: pickPlatformAsset(json.assets ?? []),
      publishedAt: json.published_at ?? null,
      notes: typeof json.body === "string" && json.body.trim() ? json.body.trim().slice(0, 1500) : null,
      error: null
    };
    releaseCache = entry;
    return entry;
  } catch (err) {
    const entry: RemoteReleaseCache = {
      at: Date.now(),
      url,
      latestVersion: null,
      releaseName: null,
      releaseUrl: RELEASES_PAGE,
      downloadUrl: null,
      publishedAt: null,
      notes: null,
      error: err instanceof Error ? err.message : "Could not reach GitHub releases"
    };
    releaseCache = entry;
    return entry;
  }
}

async function fetchCliDistTags(force: boolean): Promise<RemoteNpmCache> {
  const url = process.env.HARDKAS_CLI_NPM_URL?.trim() || DEFAULT_NPM_API;
  if (!force && npmCache && npmCache.url === url && Date.now() - npmCache.at < CACHE_TTL_MS) {
    return npmCache;
  }
  try {
    const res = await fetch(url, {
      headers: { accept: "application/json" },
      redirect: "follow",
      signal: AbortSignal.timeout(4_000)
    });
    if (!res.ok) {
      const entry: RemoteNpmCache = {
        at: Date.now(),
        url,
        latest: null,
        next: null,
        error: res.status === 404 ? "Package not on npm yet" : `npm HTTP ${res.status}`
      };
      npmCache = entry;
      return entry;
    }
    const json = (await res.json()) as { latest?: unknown; next?: unknown };
    const latest = typeof json.latest === "string" && parseSemver(json.latest) ? json.latest : null;
    const next = typeof json.next === "string" && parseSemver(json.next) ? json.next : null;
    const entry: RemoteNpmCache = { at: Date.now(), url, latest, next, error: null };
    npmCache = entry;
    return entry;
  } catch (err) {
    const entry: RemoteNpmCache = {
      at: Date.now(),
      url,
      latest: null,
      next: null,
      error: err instanceof Error ? err.message : "Could not reach npm registry"
    };
    npmCache = entry;
    return entry;
  }
}

async function detectPackageManager(cwd: string): Promise<"pnpm" | "yarn" | "bun" | "npm"> {
  if (await exists(path.join(cwd, "pnpm-lock.yaml"))) return "pnpm";
  if (await exists(path.join(cwd, "yarn.lock"))) return "yarn";
  if ((await exists(path.join(cwd, "bun.lock"))) || (await exists(path.join(cwd, "bun.lockb")))) return "bun";
  return "npm";
}

async function readWorkspaceCliSpec(cwd: string): Promise<{ installed: string | null; declared: string | null; isDep: boolean; isDevDep: boolean }> {
  let installed: string | null = null;
  let declared: string | null = null;
  let isDep = false;
  let isDevDep = false;
  try {
    const raw = await fs.readFile(path.join(cwd, "node_modules", "@hardkas", "cli", "package.json"), "utf8");
    const v = (JSON.parse(raw) as { version?: unknown }).version;
    if (typeof v === "string" && parseSemver(v)) installed = v;
  } catch {
    // not installed in workspace node_modules
  }
  try {
    const raw = await fs.readFile(path.join(cwd, "package.json"), "utf8");
    const pkg = JSON.parse(raw) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const depSpec = pkg.dependencies?.["@hardkas/cli"];
    const devSpec = pkg.devDependencies?.["@hardkas/cli"];
    isDep = typeof depSpec === "string";
    isDevDep = typeof devSpec === "string";
    const spec = depSpec ?? devSpec;
    if (typeof spec === "string") {
      const m = /\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?/.exec(spec);
      if (m) declared = m[0];
    }
  } catch {
    // no workspace package.json
  }
  return { installed, declared, isDep, isDevDep };
}

function buildCliUpgradeCommand(pm: "pnpm" | "yarn" | "bun" | "npm", target: string, hasWorkspacePkg: boolean, isDevDep: boolean): string {
  const pkg = `@hardkas/cli@${target}`;
  if (!hasWorkspacePkg) {
    return pm === "pnpm" ? `pnpm add -g ${pkg}` : `npm install -g ${pkg}`;
  }
  if (pm === "pnpm") return isDevDep ? `pnpm add -D ${pkg}` : `pnpm add ${pkg}`;
  if (pm === "yarn") return isDevDep ? `yarn add -D ${pkg}` : `yarn add ${pkg}`;
  if (pm === "bun") return isDevDep ? `bun add -d ${pkg}` : `bun add ${pkg}`;
  return isDevDep ? `npm install -D ${pkg}` : `npm install ${pkg}`;
}

/**
 * Checks IDE release status on GitHub and HardKas CLI version alignment in the active workspace.
 * Cached for 15 minutes unless `force` is true; offline/network failures degrade cleanly without throwing.
 */
export async function checkUpdates(opts: {
  cwd: string;
  currentIdeVersion?: string;
  force?: boolean;
}): Promise<UpdateReport> {
  const force = Boolean(opts.force);
  const currentIdeVersion =
    opts.currentIdeVersion && parseSemver(opts.currentIdeVersion)
      ? opts.currentIdeVersion.trim().replace(/^v/i, "")
      : await readServerPackageVersion();

  const [release, cli, npmTags, pm, wsCli] = await Promise.all([
    fetchIdeRelease(currentIdeVersion, force),
    cliInfo(opts.cwd, force),
    fetchCliDistTags(force),
    detectPackageManager(opts.cwd),
    readWorkspaceCliSpec(opts.cwd)
  ]);

  const ideHasUpdate = release.latestVersion !== null && compareSemver(release.latestVersion, currentIdeVersion) > 0;

  const projectCliVersion = wsCli.installed ?? wsCli.declared;
  const prereleaseChannel = HARDKAS_CLI_VERSION.includes("-");
  const candidates = [HARDKAS_CLI_VERSION, npmTags.latest, prereleaseChannel ? npmTags.next : null].filter(
    (v): v is string => typeof v === "string" && parseSemver(v) !== null
  );
  let targetVersion = HARDKAS_CLI_VERSION;
  for (const c of candidates) {
    if (compareSemver(c, targetVersion) > 0) targetVersion = c;
  }

  const projectBehind = projectCliVersion !== null && compareSemver(targetVersion, projectCliVersion) > 0;
  const runtimeBehindNpm =
    cli.version !== null &&
    compareSemver(targetVersion, HARDKAS_CLI_VERSION) > 0 &&
    compareSemver(targetVersion, cli.version) > 0;
  const runtimeMissing = cli.version === null;
  const runtimeMismatch = cli.version !== null && cli.version !== cli.pinned;

  const reason: CliUpdateInfo["reason"] = projectBehind
    ? "project-behind"
    : runtimeBehindNpm
      ? "npm-newer"
      : runtimeMissing
        ? "missing"
        : runtimeMismatch
          ? "mismatch"
          : null;

  const cliHasUpdate = projectBehind || runtimeBehindNpm || runtimeMissing || (runtimeMismatch && compareSemver(cli.pinned, cli.version) > 0);
  const hasWorkspacePkg = wsCli.isDep || wsCli.isDevDep;
  const updateCommand = buildCliUpgradeCommand(pm, targetVersion, hasWorkspacePkg, wsCli.isDevDep);

  return {
    checkedAt: new Date().toISOString(),
    ide: {
      currentVersion: currentIdeVersion,
      latestVersion: release.latestVersion,
      hasUpdate: ideHasUpdate,
      releaseName: release.releaseName,
      releaseUrl: release.releaseUrl,
      downloadUrl: release.downloadUrl,
      publishedAt: release.publishedAt,
      notes: release.notes,
      error: release.error
    },
    cli: {
      runtimeVersion: cli.version,
      runtimeSource: cli.source,
      projectVersion: projectCliVersion,
      pinnedVersion: cli.pinned,
      npmLatest: npmTags.latest,
      npmNext: npmTags.next,
      targetVersion,
      hasUpdate: cliHasUpdate,
      reason,
      updateCommand,
      error: cli.error ?? npmTags.error
    }
  };
}
