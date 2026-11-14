/**
 * API keys for the Anthropic and OpenAI-compatible assistant providers.
 *
 * They live in the operating system's credential store (Windows Credential Manager, macOS Keychain, the Secret
 * Service on Linux) under the service "hardkas-ide", never in a file the IDE writes: a key in a plain file can be
 * read by any program, and by the hosted agent's file tools. An environment variable (ANTHROPIC_API_KEY /
 * OPENAI_API_KEY) takes precedence, so a key set for the whole system, or a Linux machine without a keyring,
 * also works.
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

/** Tests swap in an in-memory store so they never touch the real credential store; null restores it. */
export function setSecretStore(next: SecretStore | null): void {
  store = next ?? osStore;
}

export function isKeyProvider(p: unknown): p is KeyProvider {
  return p === "anthropic" || p === "openai";
}

/** The key to use for a provider and where it came from. Never throws: an unreadable store means no key. */
export async function resolveApiKey(p: unknown): Promise<{ key: string; source: Exclude<KeySource, "file"> | null }> {
  if (!isKeyProvider(p)) return { key: "", source: null };
  const fromEnv = process.env[KEY_ENV[p]]?.trim();
  if (fromEnv) return { key: fromEnv, source: "env" };
  try {
    const saved = (await store.get(account(p)))?.trim();
    return saved ? { key: saved, source: "keychain" } : { key: "", source: null };
  } catch {
    return { key: "", source: null };
  }
}

export async function saveApiKey(p: KeyProvider, key: string): Promise<void> {
  try {
    await store.set(account(p), key);
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
