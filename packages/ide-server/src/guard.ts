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
