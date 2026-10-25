/**
 * Permission handler for external plugins (Remix's permission-handler idea):
 * an external plugin may call `plugin.method` only if its manifest declares it,
 * or the user granted it once. Grants are remembered per plugin in localStorage.
 */

const KEY = "hardkas-ide.permissions";

type Grants = Record<string, Record<string, boolean>>; // from → "plugin.method" → allowed

function load(): Grants {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "{}") as Grants;
  } catch {
    return {};
  }
}

function save(g: Grants): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(g));
  } catch {
    // storage unavailable: grants last for the session only
  }
}

let memory: Grants | null = null;
function grants(): Grants {
  if (!memory) memory = load();
  return memory;
}

/** Calls every external plugin may make without asking (harmless, read-only UI things). */
const ALWAYS_ALLOWED = new Set(["console.log", "console.info", "console.warn", "console.error", "console.logJson", "fileManager.getCurrentFile"]);

export function isAllowed(from: string, target: string, method: string, declared: string[] | undefined): boolean | null {
  const key = `${target}.${method}`;
  if (ALWAYS_ALLOWED.has(key)) return true;
  if (declared?.includes(key) || declared?.includes(`${target}.*`)) return true;
  const g = grants()[from]?.[key];
  return typeof g === "boolean" ? g : null;
}

export function grant(from: string, target: string, method: string, allowed: boolean): void {
  const g = grants();
  g[from] = { ...(g[from] ?? {}), [`${target}.${method}`]: allowed };
  save(g);
}

export function grantsOf(from: string): Record<string, boolean> {
  return { ...(grants()[from] ?? {}) };
}

export function clearGrants(from: string): void {
  const g = grants();
  delete g[from];
  save(g);
}

/** Asks the user (blocking confirm, like Remix's modal) and remembers the answer. */
export function askPermission(from: string, displayName: string, target: string, method: string): boolean {
  const ok = window.confirm(`Plugin "${displayName}" wants to call ${target}.${method}.\n\nAllow? Your answer is remembered for this plugin.`);
  grant(from, target, method, ok);
  return ok;
}
