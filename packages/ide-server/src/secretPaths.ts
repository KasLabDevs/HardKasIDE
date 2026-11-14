/**
 * The one list of project files that hold secrets, shared by the file routes, the MCP server's requests and both
 * AI agents (the IDE's own and the hosted OpenCode agent), so no door is left open by a list that drifted.
 *
 * Two kinds:
 *   - key stores: private keys and the dev-server token. No route of the IDE reads, searches, writes, renames or
 *     deletes them, for anyone. Keys leave only through `/api/devkeys/reveal`, which exports simnet keys only.
 *   - private files (`.env*`, SSH keys, PEM files): the user may open them in the editor; an AI agent may not.
 */

function segments(relPath: string): string[] {
  return relPath
    .replace(/\\/g, "/")
    .split("/")
    .filter((s) => s && s !== ".")
    .map((s) => s.toLowerCase().replace(/[. ]+$/, "").replace(/:.*$/, "")); // Windows ignores trailing dots/spaces; drop :streams
}

/** Private keys and bearer tokens of the project (and of HardKAS / the IDE when a path reaches their folders). */
export function isKeyStorePath(relPath: string): boolean {
  const parts = segments(relPath);
  if (parts.length === 0) return false;
  const name = parts[parts.length - 1];
  if (name === "accounts.real.json" || name === "dev-server-token") return true;
  if (name.includes("keystore")) return true;
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (p === ".hardkas-ide") return true;
    if (p === ".hardkas" && i + 1 < parts.length) {
      const next = parts[i + 1];
      if (next === "dev-accounts" || next === "keystore" || next === "keystores" || next === "backups") return true;
    }
    if (p === "dev-accounts" && parts.includes(".hardkas")) return true;
  }
  return false;
}

const ENV_TEMPLATES = new Set([".env.example", ".env.sample", ".env.template", ".env.dist"]);

/** Files a person may open but an AI agent must not read: environment files and SSH / PEM keys. */
export function isPrivateFile(relPath: string): boolean {
  const parts = segments(relPath);
  if (parts.length === 0) return false;
  const name = parts[parts.length - 1];
  if ((name === ".env" || name.startsWith(".env.")) && !ENV_TEMPLATES.has(name)) return true;
  if (/^id_(rsa|dsa|ecdsa|ed25519)(\.|$)/.test(name)) return true;
  if (name.endsWith(".pem") || name.endsWith(".p12") || name.endsWith(".pfx")) return true;
  return false;
}

/** Everything an AI agent must never read or write. */
export function isAgentForbidden(relPath: string): boolean {
  return isKeyStorePath(relPath) || isPrivateFile(relPath);
}
