import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { CLI_CATALOG_DUMP_SCRIPT } from "./cliCatalogDump.js";
import { exists, getRoot } from "./workspace.js";

export interface CliArgument {
  name: string;
  description: string;
  required: boolean;
  variadic: boolean;
  defaultValue?: unknown;
  choices?: string[];
}

export interface CliOption {
  flags: string;
  long: string | null;
  short: string | null;
  attribute: string | null;
  description: string;
  takesValue: boolean;
  valueOptional: boolean;
  variadic: boolean;
  mandatory: boolean;
  negate: boolean;
  defaultValue?: unknown;
  choices?: string[];
}

export interface CliCommandNode {
  name: string;
  path: string[];
  aliases: string[];
  description: string;
  summary: string;
  hidden: boolean;
  arguments: CliArgument[];
  options: CliOption[];
  commands: CliCommandNode[];
}

export interface CliCatalog {
  ok: boolean;
  version: string | null;
  globalOptions: CliOption[];
  commands: CliCommandNode[];
  error?: string;
}

let cachedCatalog: { path: string; mtime: number; catalog: CliCatalog } | null = null;

async function findPublicJs(cwd: string): Promise<string | null> {
  const candidates = [
    path.join(cwd, "node_modules", "@hardkas", "cli", "dist", "public.js"),
    path.resolve(process.cwd(), "examples", "demo-workspace", "node_modules", "@hardkas", "cli", "dist", "public.js")
  ];
  for (const c of candidates) {
    if (await exists(c)) return c;
  }
  return null;
}

export async function getCliCatalog(cwd?: string): Promise<CliCatalog> {
  const targetDir = cwd ?? getRoot() ?? process.cwd();
  const publicJs = await findPublicJs(targetDir);
  if (!publicJs) {
    return {
      ok: false,
      version: null,
      globalOptions: [],
      commands: [],
      error: "Could not find @hardkas/cli/dist/public.js in project or demo workspace"
    };
  }

  try {
    const stat = await fs.stat(publicJs);
    if (cachedCatalog && cachedCatalog.path === publicJs && cachedCatalog.mtime === stat.mtimeMs) {
      return cachedCatalog.catalog;
    }

    const json = await new Promise<string>((resolve, reject) => {
      execFile(
        process.execPath,
        ["--input-type=module", "-e", CLI_CATALOG_DUMP_SCRIPT, publicJs],
        { timeout: 15_000, maxBuffer: 16 * 1024 * 1024, windowsHide: true },
        (err, stdout, stderr) => {
          if (err && !stdout) {
            return reject(new Error(stderr || err.message));
          }
          resolve(stdout.trim());
        }
      );
    });

    const parsed = JSON.parse(json) as CliCatalog;
    if (parsed.ok) {
      cachedCatalog = { path: publicJs, mtime: stat.mtimeMs, catalog: parsed };
    }
    return parsed;
  } catch (err) {
    return {
      ok: false,
      version: null,
      globalOptions: [],
      commands: [],
      error: err instanceof Error ? err.message : String(err)
    };
  }
}
