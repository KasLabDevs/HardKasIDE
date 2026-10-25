import AdmZip from "adm-zip";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * VS Code extensions from Open VSX (the open registry used by Theia, Gitpod, VSCodium).
 *
 * We support the declarative part of an extension: themes, TextMate grammars,
 * language definitions and snippets. They are plain files inside the .vsix (a zip),
 * so we download, unzip under ~/.hardkas-ide/vsx/<namespace>.<name>/ and serve them.
 * Extensions that need the VS Code extension host (language servers, commands…)
 * are reported as "not supported" with the reason.
 */

const VSX_API = process.env.OPENVSX_API ?? "https://open-vsx.org/api";
export const VSX_DIR = path.join(os.homedir(), ".hardkas-ide", "vsx");
const INDEX = path.join(VSX_DIR, "index.json");

export interface VsxSearchHit {
  id: string; // namespace.name
  namespace: string;
  name: string;
  version: string;
  displayName: string;
  description: string;
  downloadCount?: number;
  verified?: boolean;
  icon?: string;
  download?: string;
  timestamp?: string;
}

export interface VsxTheme {
  label: string;
  uiTheme: string; // vs | vs-dark | hc-black | hc-light
  path: string; // relative inside the extension
}
export interface VsxGrammar {
  language?: string;
  scopeName: string;
  path: string;
  embeddedLanguages?: Record<string, string>;
}
export interface VsxLanguage {
  id: string;
  extensions?: string[];
  aliases?: string[];
  filenames?: string[];
  configuration?: string;
}
export interface VsxSnippet {
  language: string;
  path: string;
}

export interface InstalledVsx {
  id: string;
  namespace: string;
  name: string;
  version: string;
  displayName: string;
  description: string;
  publisher?: string;
  icon?: string;
  installedAt: string;
  dir: string; // relative path under VSX_DIR
  contributes: {
    themes: VsxTheme[];
    grammars: VsxGrammar[];
    languages: VsxLanguage[];
    snippets: VsxSnippet[];
  };
  /** Things in the package we cannot run (extension host code, commands, …). */
  unsupported: string[];
  enabled: boolean;
}

export async function searchVsx(query: string, size = 24): Promise<{ total: number; hits: VsxSearchHit[] }> {
  const url = `${VSX_API}/-/search?query=${encodeURIComponent(query)}&size=${size}&sortBy=relevance&sortOrder=desc`;
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`Open VSX search failed: ${res.status}`);
  const json = (await res.json()) as {
    totalSize?: number;
    extensions?: Array<{ namespace: string; name: string; version: string; displayName?: string; description?: string; downloadCount?: number; verified?: boolean; timestamp?: string; files?: { download?: string; icon?: string } }>;
  };
  return {
    total: json.totalSize ?? 0,
    hits: (json.extensions ?? []).map((e) => ({
      id: `${e.namespace}.${e.name}`,
      namespace: e.namespace,
      name: e.name,
      version: e.version,
      displayName: e.displayName ?? e.name,
      description: e.description ?? "",
      downloadCount: e.downloadCount,
      verified: e.verified,
      icon: e.files?.icon,
      download: e.files?.download,
      timestamp: e.timestamp
    }))
  };
}

export async function readIndex(): Promise<InstalledVsx[]> {
  try {
    return JSON.parse(await fs.readFile(INDEX, "utf8")) as InstalledVsx[];
  } catch {
    return [];
  }
}

async function writeIndex(list: InstalledVsx[]): Promise<void> {
  await fs.mkdir(VSX_DIR, { recursive: true });
  await fs.writeFile(INDEX, JSON.stringify(list, null, 2), "utf8");
}

export async function installVsx(namespace: string, name: string, version?: string): Promise<InstalledVsx> {
  if (!/^[\w.-]+$/.test(namespace) || !/^[\w.-]+$/.test(name)) throw new Error("Invalid extension id");
  // Resolve metadata (latest version if none given).
  const metaUrl = version ? `${VSX_API}/${namespace}/${name}/${version}` : `${VSX_API}/${namespace}/${name}`;
  const metaRes = await fetch(metaUrl, { headers: { accept: "application/json" } });
  if (!metaRes.ok) throw new Error(`Open VSX: ${namespace}.${name} not found (${metaRes.status})`);
  const meta = (await metaRes.json()) as { version: string; displayName?: string; description?: string; files?: { download?: string; icon?: string }; publishedBy?: { loginName?: string } };
  const download = meta.files?.download;
  if (!download) throw new Error("No .vsix download available for this extension");

  const dl = await fetch(download);
  if (!dl.ok) throw new Error(`Download failed: ${dl.status}`);
  const buf = Buffer.from(await dl.arrayBuffer());
  if (buf.length > 80 * 1024 * 1024) throw new Error("Extension larger than 80 MB; refusing");

  const id = `${namespace}.${name}`;
  const dirRel = id;
  const dir = path.join(VSX_DIR, dirRel);
  await fs.rm(dir, { recursive: true, force: true });
  await fs.mkdir(dir, { recursive: true });
  const zip = new AdmZip(buf);
  for (const entry of zip.getEntries()) {
    if (entry.isDirectory) continue;
    const target = path.resolve(dir, entry.entryName);
    if (!target.startsWith(dir + path.sep) && target !== dir) continue; // zip-slip guard
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, entry.getData());
  }

  const pkgPath = path.join(dir, "extension", "package.json");
  const pkg = JSON.parse(await fs.readFile(pkgPath, "utf8")) as Record<string, unknown>;
  const contributes = (pkg.contributes ?? {}) as Record<string, unknown>;
  const themes = ((contributes.themes as VsxTheme[] | undefined) ?? []).map((t) => ({ label: t.label, uiTheme: t.uiTheme ?? "vs-dark", path: norm(t.path) }));
  const grammars = ((contributes.grammars as VsxGrammar[] | undefined) ?? []).map((g) => ({ language: g.language, scopeName: g.scopeName, path: norm(g.path), embeddedLanguages: g.embeddedLanguages }));
  const languages = ((contributes.languages as VsxLanguage[] | undefined) ?? []).map((l) => ({ id: l.id, extensions: l.extensions, aliases: l.aliases, filenames: l.filenames, configuration: l.configuration ? norm(l.configuration) : undefined }));
  const snippets = ((contributes.snippets as VsxSnippet[] | undefined) ?? []).map((s) => ({ language: s.language, path: norm(s.path) }));

  const unsupported: string[] = [];
  if (pkg.main || pkg.browser) unsupported.push("extension code (needs the VS Code extension host)");
  for (const key of ["commands", "languageServers", "debuggers", "taskDefinitions", "viewsContainers", "views", "menus", "keybindings", "configuration"]) {
    if (contributes[key]) unsupported.push(`contributes.${key}`);
  }

  // localized displayName ("%ext.displayName%") → try package.nls.json
  let displayName = String(meta.displayName ?? pkg.displayName ?? name);
  let description = String(meta.description ?? pkg.description ?? "");
  if (displayName.startsWith("%") || description.startsWith("%")) {
    try {
      const nls = JSON.parse(await fs.readFile(path.join(dir, "extension", "package.nls.json"), "utf8")) as Record<string, string>;
      displayName = nls[displayName.replace(/%/g, "")] ?? displayName;
      description = nls[description.replace(/%/g, "")] ?? description;
    } catch {
      // keep raw
    }
  }

  const installed: InstalledVsx = {
    id,
    namespace,
    name,
    version: meta.version,
    displayName,
    description,
    publisher: meta.publishedBy?.loginName,
    icon: meta.files?.icon,
    installedAt: new Date().toISOString(),
    dir: dirRel,
    contributes: { themes, grammars, languages, snippets },
    unsupported,
    enabled: true
  };
  const list = (await readIndex()).filter((e) => e.id !== id);
  list.push(installed);
  await writeIndex(list);
  return installed;
}

export async function uninstallVsx(id: string): Promise<void> {
  const list = await readIndex();
  const e = list.find((x) => x.id === id);
  if (e) await fs.rm(path.join(VSX_DIR, e.dir), { recursive: true, force: true });
  await writeIndex(list.filter((x) => x.id !== id));
}

export async function setVsxEnabled(id: string, enabled: boolean): Promise<void> {
  const list = await readIndex();
  const e = list.find((x) => x.id === id);
  if (!e) throw new Error(`${id} is not installed`);
  e.enabled = enabled;
  await writeIndex(list);
}

/** Reads a file of an installed extension (theme JSON, grammar, snippets); path is relative to the extension dir. */
export async function readVsxFile(id: string, relative: string): Promise<{ body: Buffer; type: string } | null> {
  const list = await readIndex();
  const e = list.find((x) => x.id === id);
  if (!e) return null;
  const base = path.join(VSX_DIR, e.dir, "extension");
  const target = path.resolve(base, relative.replace(/^\/+/, ""));
  if (!target.startsWith(base)) return null;
  try {
    const body = await fs.readFile(target);
    const ext = path.extname(target).toLowerCase();
    const type = ext === ".json" ? "application/json; charset=utf-8" : ext === ".plist" || ext === ".tmlanguage" ? "application/xml; charset=utf-8" : ext === ".png" ? "image/png" : ext === ".svg" ? "image/svg+xml" : "text/plain; charset=utf-8";
    return { body, type };
  } catch {
    return null;
  }
}

function norm(p: string): string {
  return p.replace(/^\.?\//, "");
}
