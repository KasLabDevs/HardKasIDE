const ANSI_OSC_RE = /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g;
const ANSI_CSI_RE = /\x1b\[[0-9;?]*[ -/]*[@-~]/g;
const ANSI_ESC_RE = /\x1b[@-Z\\-_]/g;
const LOCAL_URL_RE = /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]|\[::\]):(\d{2,5})(?:\/[^\s"'`<>)\]]*)?/gi;

export function stripAnsi(text: string): string {
  return text.replace(ANSI_OSC_RE, "").replace(ANSI_CSI_RE, "").replace(ANSI_ESC_RE, "");
}

function normalizeLocalUrl(raw: string): string | null {
  const trimmed = raw.replace(/[.,;:!?]+$/, "");
  try {
    const u = new URL(trimmed);
    const port = Number(u.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
    if (u.hostname === "0.0.0.0" || u.hostname === "::" || u.hostname === "[::]" || u.hostname === "[::1]" || u.hostname === "::1") {
      u.hostname = "localhost";
    }
    return u.toString();
  } catch {
    return null;
  }
}

/**
 * Extracts normalized loopback URLs (e.g. from Vite/Next/Wrangler terminal banners)
 * while removing ANSI sequences and trimming trailing punctuation.
 */
export function extractLocalUrls(text: string): string[] {
  const clean = stripAnsi(text);
  const found: string[] = [];
  const seen = new Set<string>();
  let match: RegExpExecArray | null;
  LOCAL_URL_RE.lastIndex = 0;
  while ((match = LOCAL_URL_RE.exec(clean)) !== null) {
    const normalized = normalizeLocalUrl(match[0]);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    found.push(normalized);
  }
  return found;
}

export function portOfUrl(url: string): string | null {
  try {
    const u = new URL(url);
    return u.port || null;
  } catch {
    return null;
  }
}
