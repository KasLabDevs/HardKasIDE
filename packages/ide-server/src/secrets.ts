import { execFile } from "node:child_process";

/**
 * API keys for the Anthropic and OpenAI-compatible assistant providers.
 *
 * Environment variables (ANTHROPIC_API_KEY / OPENAI_API_KEY) take precedence so users can configure
 * keys via generic shell commands (`setx` on Windows, `export` on macOS/Linux) and have the IDE detect
 * them cleanly. Stored OpenAI keys live in the OS credential store under service "hardkas-ide".
 */

export type KeyProvider = "anthropic" | "openai";
/** Where the key in use came from. "file" is a key left in assistant.json because no credential store was available. */
export type KeySource = "env" | "keychain" | "file";

export interface SecretStore {
  get(account: string): Promise<string | null>;
  set(account: string, value: string): Promise<void>;
  delete(account: string): Promise<void>;
}

const SERVICE = "hardkas-ide";
export const KEY_ENV: Record<KeyProvider, string> = { anthropic: "ANTHROPIC_API_KEY", openai: "OPENAI_API_KEY" };
const BASE_URL_ENV: Record<KeyProvider, string> = { anthropic: "ANTHROPIC_BASE_URL", openai: "OPENAI_BASE_URL" };
const OFFICIAL_ORIGIN: Record<KeyProvider, string> = { anthropic: "https://api.anthropic.com", openai: "https://api.openai.com" };
const account = (p: KeyProvider) => `${p}-api-key`;
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

type AsyncEntryClass = typeof import("@napi-rs/keyring").AsyncEntry;

/** The native module is loaded on first use: a platform without it must not stop the server, only key storage. */
async function entry(acct: string): Promise<InstanceType<AsyncEntryClass>> {
  const mod = (await import("@napi-rs/keyring")) as unknown as { AsyncEntry?: AsyncEntryClass; default?: { AsyncEntry: AsyncEntryClass } };
  const AsyncEntry = mod.AsyncEntry ?? mod.default?.AsyncEntry;
  if (!AsyncEntry) throw new Error("the system credential store is not available on this platform");
  return new AsyncEntry(SERVICE, acct);
}

const osStore: SecretStore = {
  async get(acct) {
    return (await (await entry(acct)).getPassword()) ?? null;
  },
  async set(acct, value) {
    await (await entry(acct)).setPassword(value);
  },
  async delete(acct) {
    await (await entry(acct)).deletePassword();
  }
};

let store: SecretStore = osStore;
let usingCustomStore = false;
type EnvReader = (name: string) => Promise<string | undefined>;
let customEnvReader: EnvReader | null = null;

/** Tests swap in an in-memory store so they never touch the real credential store; null restores it. */
export function setSecretStore(next: SecretStore | null): void {
  usingCustomStore = next !== null;
  store = next ?? osStore;
}

/** Tests can override OS-level env registry fallback without touching Windows Registry. */
export function setEnvFallbackReader(reader: EnvReader | null): void {
  customEnvReader = reader;
}

/** Parses `reg query <key> /v <name>` stdout for REG_SZ / REG_EXPAND_SZ values cleanly. */
export function parseRegQueryValue(stdout: string, name: string): string | undefined {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`^\\s*${escaped}\\s+REG_(?:EXPAND_)?SZ\\s+(.*)$`, "im");
  const m = re.exec(stdout);
  const val = m?.[1]?.trim();
  return val || undefined;
}

async function queryWindowsRegEnv(hiveKey: string, name: string): Promise<string | undefined> {
  if (!/^[A-Z0-9_]+$/.test(name)) return undefined;
  return await new Promise<string | undefined>((resolve) => {
    execFile("reg", ["query", hiveKey, "/v", name], { timeout: 2000, windowsHide: true }, (err, stdout) => {
      if (err || !stdout) return resolve(undefined);
      resolve(parseRegQueryValue(stdout, name));
    });
  });
}

/**
 * Reads an environment variable from `process.env`, falling back on Windows to live HKCU\Environment / HKLM
 * Registry entries so `setx ANTHROPIC_API_KEY "..."` is detected immediately without restarting the IDE.
 */
export async function readEnvVar(name: string): Promise<string | undefined> {
  const direct = process.env[name]?.trim();
  if (direct) return direct;
  if (customEnvReader) return (await customEnvReader(name))?.trim() || undefined;
  // Unit tests swap in a custom SecretStore or set HARDKAS_IDE_NO_LISTEN=1; avoid leaking host registry vars into tests.
  if (usingCustomStore || process.env.HARDKAS_IDE_NO_LISTEN === "1") return undefined;
  if (process.platform !== "win32") return undefined;
  return (await queryWindowsRegEnv("HKCU\\Environment", name))
    ?? (await queryWindowsRegEnv("HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment", name));
}

export function isKeyProvider(p: unknown): p is KeyProvider {
  return p === "anthropic" || p === "openai";
}

/** Scheme + host + port of a URL, lowercased; "" when it is not a URL. */
export function originOf(url: string | undefined | null): string {
  if (!url) return "";
  try {
    return new URL(url).origin.toLowerCase();
  } catch {
    return "";
  }
}

/** The origin a provider's requests go to when its URL setting is empty. */
export function officialOrigin(p: KeyProvider): string {
  return OFFICIAL_ORIGIN[p];
}

interface StoredKey {
  key: string;
  /** Origin the key may be sent to. */
  origin: string;
}

/** Stored entries are `{"key":…,"origin":…}`; an older bare key is bound to the provider's official host. */
function parseStored(p: KeyProvider, raw: string | null): StoredKey | null {
  const text = raw?.trim();
  if (!text) return null;
  if (text.startsWith("{")) {
    try {
      const parsed = JSON.parse(text) as Partial<StoredKey>;
      if (typeof parsed.key === "string" && parsed.key.trim()) return { key: parsed.key.trim(), origin: originOf(parsed.origin) || OFFICIAL_ORIGIN[p] };
    } catch {
      return null;
    }
    return null;
  }
  return { key: text, origin: OFFICIAL_ORIGIN[p] };
}

export interface ResolvedKey {
  key: string;
  source: Exclude<KeySource, "file"> | null;
  /** Set when a key exists but belongs to another host than `baseUrl`: it is not used. */
  boundTo: string | null;
}

/**
 * The key to use for requests to `baseUrl`, and where it came from. Never throws: an unreadable store means no key.
 * A key bound to another host is not returned (`boundTo` says which host it belongs to).
 */
export async function resolveApiKey(p: unknown, baseUrl?: string): Promise<ResolvedKey> {
  if (!isKeyProvider(p)) return { key: "", source: null, boundTo: null };
  const target = originOf(baseUrl) || OFFICIAL_ORIGIN[p];
  const fromEnv = await readEnvVar(KEY_ENV[p]);
  if (fromEnv) {
    const envOrigin = originOf(await readEnvVar(BASE_URL_ENV[p])) || OFFICIAL_ORIGIN[p];
    return envOrigin === target ? { key: fromEnv, source: "env", boundTo: null } : { key: "", source: null, boundTo: envOrigin };
  }
  try {
    const saved = parseStored(p, await store.get(account(p)));
    if (!saved) return { key: "", source: null, boundTo: null };
    return saved.origin === target ? { key: saved.key, source: "keychain", boundTo: null } : { key: "", source: null, boundTo: saved.origin };
  } catch {
    return { key: "", source: null, boundTo: null };
  }
}

/** True when the store already holds a key for `p` (whatever host it is bound to). */
export async function hasStoredKey(p: KeyProvider): Promise<boolean> {
  try {
    return parseStored(p, await store.get(account(p))) !== null;
  } catch {
    return false;
  }
}

/** Saves `key` for `p`, bound to the host of `baseUrl` (the provider's official host when empty). */
export async function saveApiKey(p: KeyProvider, key: string, baseUrl?: string): Promise<void> {
  const value: StoredKey = { key, origin: originOf(baseUrl) || OFFICIAL_ORIGIN[p] };
  try {
    await store.set(account(p), JSON.stringify(value));
  } catch (e) {
    throw new Error(`Could not save the key in the system credential store (${message(e)}). Set ${KEY_ENV[p]} in your environment instead.`);
  }
}

export async function deleteApiKey(p: KeyProvider): Promise<void> {
  try {
    await store.delete(account(p));
  } catch (e) {
    throw new Error(`Could not remove the key from the system credential store (${message(e)}).`);
  }
}
