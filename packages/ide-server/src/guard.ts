/**
 * Which `Host` headers the IDE server answers on /api.
 *
 * The server listens on loopback, but a page on any web site can still reach it through DNS rebinding: the
 * attacker's name first resolves to their server, then to 127.0.0.1, and from then on the browser treats the IDE
 * server as same-origin with the attacker's page. Origin checks do not catch that for GET requests (a same-origin
 * GET carries no Origin header), but the `Host` header still names the attacker's domain. So every /api request
 * must name a loopback host; anything else is refused before any route runs.
 *
 * Extra host names (a reverse proxy, a container alias) can be allowed with HARDKAS_IDE_ALLOWED_HOSTS, a
 * comma-separated list of host names without ports.
 */

const LOOPBACK_HOSTNAMES = ["localhost", "127.0.0.1", "[::1]"];

export function allowedHostnames(env: NodeJS.ProcessEnv = process.env): Set<string> {
  const extra = (env.HARDKAS_IDE_ALLOWED_HOSTS ?? "")
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
  return new Set([...LOOPBACK_HOSTNAMES, ...extra]);
}

/** True when `host` (a Host header, port optional) names one of the allowed host names. */
export function isAllowedHost(host: string | undefined, allowed: Set<string> = allowedHostnames()): boolean {
  if (!host) return false;
  let hostname: string;
  try {
    hostname = new URL(`http://${host}`).hostname.toLowerCase();
  } catch {
    return false;
  }
  return allowed.has(hostname);
}

/**
 * The exact origins the IDE page itself is served from: this server's port on every allowed host name, plus the
 * Vite dev server in development. A page on any other port of this machine (a dApp dev server, another tool, a
 * dependency's test server) is a different origin and gets nothing: being on localhost is not being the IDE.
 *
 * HARDKAS_IDE_EXTRA_ORIGINS adds exact origins (comma-separated, e.g. "http://localhost:5174").
 */
export function ideOrigins(port: number, options: { dev: boolean; env?: NodeJS.ProcessEnv }): Set<string> {
  const env = options.env ?? process.env;
  const origins = new Set<string>();
  for (const host of allowedHostnames(env)) origins.add(`http://${host}:${port}`);
  if (options.dev) {
    origins.add("http://localhost:5173");
    origins.add("http://127.0.0.1:5173");
  }
  for (const extra of (env.HARDKAS_IDE_EXTRA_ORIGINS ?? "").split(",")) {
    const o = extra.trim().replace(/\/+$/, "").toLowerCase();
    if (o) origins.add(o);
  }
  return origins;
}

/**
 * Plugin and extension files other origins may load. They are code the user installed, not project data, and the
 * server sends them with a sandbox CSP (see `SANDBOX_CSP`), so a plugin page runs on an opaque origin and cannot
 * call the API as the IDE.
 */
export function isPublicStatic(pathname: string): boolean {
  return /^\/api\/plugins\/(static|examples)\//.test(pathname) || /^\/api\/vsx\/file\//.test(pathname);
}

/** CSP for plugin pages and the workspace's dapp/: scripts run, but on an opaque origin with no access to the IDE API. */
export const SANDBOX_CSP = "sandbox allow-scripts allow-forms allow-popups allow-modals allow-downloads";

export interface RequestFacts {
  method: string;
  path: string;
  host?: string;
  origin?: string;
  /** The browser's Sec-Fetch-Site header: "same-origin", "same-site", "cross-site" or "none". */
  secFetchSite?: string;
  referer?: string;
}

export type Verdict = { ok: true } | { ok: false; status: 403; code: "FORBIDDEN_HOST" | "FORBIDDEN_ORIGIN"; message: string };

/**
 * Who may use the IDE API (every method, WebSocket upgrades included):
 *   - the IDE page itself: its Origin is one of `origins`, or it sends no Origin and the browser says same-origin;
 *   - a local program that is not a browser (the MCP server, a script): no Origin and no Sec-Fetch-Site. Such a
 *     program already runs with the user's rights and can read the project's files directly.
 * Anything a browser marks as coming from another page (`Origin` not the IDE's, `Origin: null`, or Sec-Fetch-Site
 * "same-site" / "cross-site") is refused, GETs included: a GET can start the CLI or read a file.
 */
export function checkRequest(facts: RequestFacts, allowedHosts: Set<string>, origins: Set<string>): Verdict {
  if (!isAllowedHost(facts.host, allowedHosts)) {
    return { ok: false, status: 403, code: "FORBIDDEN_HOST", message: "the IDE server only answers on localhost, 127.0.0.1 or [::1]" };
  }
  const method = facts.method.toUpperCase();
  const safe = method === "GET" || method === "HEAD" || method === "OPTIONS";
  if (safe && isPublicStatic(facts.path)) return { ok: true };
  const refused: Verdict = { ok: false, status: 403, code: "FORBIDDEN_ORIGIN", message: "only the IDE page may call the IDE server" };
  // The browser's own word that another page sent this wins over any Origin.
  const site = facts.secFetchSite?.toLowerCase();
  if (site && site !== "same-origin" && site !== "none") return refused;
  if (facts.origin !== undefined) return origins.has(facts.origin.toLowerCase()) ? { ok: true } : refused;
  // No Origin (a plain GET from a browser that sends no Sec-Fetch-Site): a Referer from another page is refused too.
  if (facts.referer) {
    let from = "";
    try {
      from = new URL(facts.referer).origin.toLowerCase();
    } catch {
      return refused;
    }
    if (!origins.has(from)) return refused;
  }
  return { ok: true };
}
