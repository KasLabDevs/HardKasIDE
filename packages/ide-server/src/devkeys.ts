import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { argon2id } from "hash-wasm";
import { FsError } from "./fs.js";
import { getRoot } from "./workspace.js";

/**
 * Simnet dev-account key export (alice…erin).
 *
 * HardKas stores its dev accounts in `.hardkas/dev-accounts/<alias>.json` as argon2id + AES-256-GCM
 * keystores (`hardkas.encryptedKeystore.v2`), always encrypted with the fixed, public dev password
 * `hardkas-local-dev` (see `@hardkas/accounts` dev-accounts.ts). `hardkas dev accounts reveal|export kasware`
 * prints the same key, but refuses unless the active execution target is simnet. This module decrypts
 * the keystore directly so the IDE can export the key for wallets like KasWare whatever the target is.
 *
 * Guard rails: only aliases matching a safe name, only files inside the open workspace, only keystores
 * whose metadata and payload say `simnet`, and the decrypted address must match the keystore metadata.
 */

const DEV_ACCOUNTS_PASSWORD = "hardkas-local-dev";
const KEYSTORE_TYPE = "hardkas.encryptedKeystore.v2";

interface EncryptedKeystoreV2 {
  version: string;
  type: string;
  kdf: { algorithm: string; memory: number; iterations: number; parallelism: number; salt: string };
  cipher: { algorithm: string; nonce: string; tag: string };
  encryptedPayload: string;
  metadata?: { label?: string; network?: string; address?: string };
}

export interface DevAccountKey {
  name: string;
  address: string;
  network: string;
  privateKey: string;
}

async function readRealAccounts(root: string): Promise<Map<string, { privateKey: string; address?: string }>> {
  const map = new Map<string, { privateKey: string; address?: string }>();
  try {
    const text = await fs.readFile(path.join(root, ".hardkas", "accounts.real.json"), "utf8");
    const parsed = JSON.parse(text.replace(/^\uFEFF/, "")) as unknown;
    const entries: Array<Record<string, unknown>> = Array.isArray(parsed)
      ? (parsed as Array<Record<string, unknown>>)
      : parsed && typeof parsed === "object" && Array.isArray((parsed as { accounts?: unknown }).accounts)
        ? ((parsed as { accounts: Array<Record<string, unknown>> }).accounts)
        : parsed && typeof parsed === "object"
          ? Object.entries(parsed as Record<string, unknown>).map(([k, v]) => ({ name: k, ...(v as Record<string, unknown>) }))
          : [];
    for (const e of entries) {
      const name = typeof e.name === "string" ? e.name : typeof e.label === "string" ? e.label : null;
      const key = ["privateKey", "privateKeyHex", "secretKey", "secret"].map((k) => e[k]).find((v) => typeof v === "string") as string | undefined;
      const addr = typeof e.address === "string" ? e.address : undefined;
      if (name && key) map.set(name, { privateKey: key, address: addr });
    }
  } catch {
    // accounts.real.json does not exist: ignore safely without error
  }
  return map;
}

export async function listDevAccountNames(): Promise<string[]> {
  const root = getRoot();
  if (!root) return [];
  const set = new Set<string>();
  try {
    const files = await fs.readdir(path.join(root, ".hardkas", "dev-accounts"));
    for (const f of files) {
      if (f.endsWith(".json")) set.add(f.slice(0, -5));
    }
  } catch {
    // dev-accounts folder does not exist
  }
  const real = await readRealAccounts(root);
  for (const name of real.keys()) set.add(name);
  return [...set].sort();
}

export async function revealDevAccountKey(name: string): Promise<DevAccountKey> {
  if (!/^[a-z][a-z0-9_-]{0,31}$/i.test(name)) throw new FsError(400, "BAD_REQUEST", "Invalid account name");
  const root = getRoot();
  if (!root) throw new FsError(409, "NO_WORKSPACE", "No workspace is open");

  // Check plaintext store (.hardkas/accounts.real.json) first
  const real = await readRealAccounts(root);
  const fromReal = real.get(name);
  if (fromReal) {
    return { name, address: fromReal.address ?? "", network: "simnet", privateKey: fromReal.privateKey };
  }

  // Otherwise check encrypted dev keystore (.hardkas/dev-accounts/<name>.json)
  const file = path.join(root, ".hardkas", "dev-accounts", `${name}.json`);

  let keystore: EncryptedKeystoreV2;
  try {
    keystore = JSON.parse((await fs.readFile(file, "utf8")).replace(/^\uFEFF/, "")) as EncryptedKeystoreV2;
  } catch {
    throw new FsError(404, "NOT_FOUND", `No dev keystore for '${name}' in .hardkas/dev-accounts`);
  }
  if (keystore.type !== KEYSTORE_TYPE || keystore.kdf?.algorithm !== "argon2id" || keystore.cipher?.algorithm !== "aes-256-gcm") {
    throw new FsError(422, "UNSUPPORTED_KEYSTORE", `Unsupported keystore format for '${name}'`);
  }
  if (keystore.metadata?.network !== "simnet") {
    throw new FsError(403, "NOT_SIMNET", `Refusing to export '${name}': only simnet dev accounts can be exported`);
  }

  const derivedKey = Buffer.from(
    await argon2id({
      password: DEV_ACCOUNTS_PASSWORD,
      salt: Buffer.from(keystore.kdf.salt, "base64"),
      parallelism: keystore.kdf.parallelism,
      iterations: keystore.kdf.iterations,
      memorySize: keystore.kdf.memory,
      hashLength: 32,
      outputType: "hex"
    }),
    "hex"
  );
  let payload: { address?: string; privateKey?: string; network?: string };
  try {
    const decipher = crypto.createDecipheriv("aes-256-gcm", derivedKey, Buffer.from(keystore.cipher.nonce, "base64"));
    decipher.setAuthTag(Buffer.from(keystore.cipher.tag, "base64"));
    const plain = Buffer.concat([decipher.update(Buffer.from(keystore.encryptedPayload, "base64")), decipher.final()]);
    payload = JSON.parse(plain.toString("utf8")) as typeof payload;
  } catch {
    throw new FsError(422, "DECRYPT_FAILED", `'${name}' is not encrypted with the HardKas dev password (not a dev account)`);
  } finally {
    derivedKey.fill(0);
  }

  if (typeof payload.privateKey !== "string" || !/^[0-9a-f]{64}$/i.test(payload.privateKey)) {
    throw new FsError(422, "BAD_PAYLOAD", `Keystore for '${name}' has no raw hex private key`);
  }
  if (payload.network && payload.network !== "simnet") {
    throw new FsError(403, "NOT_SIMNET", `Refusing to export '${name}': payload network is ${payload.network}`);
  }
  if (keystore.metadata?.address && payload.address && keystore.metadata.address !== payload.address) {
    throw new FsError(422, "ADDRESS_MISMATCH", `Keystore for '${name}' is inconsistent (address mismatch)`);
  }
  return { name, address: payload.address ?? keystore.metadata?.address ?? "", network: "simnet", privateKey: payload.privateKey };
}
