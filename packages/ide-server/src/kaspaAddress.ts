/**
 * Lightweight Kaspa Bech32 address and P2PK public key extraction helpers.
 * Used to index artifacts so Lineage filtering matches full Bech32 addresses,
 * substrings, and 32-byte x-only hex public keys seamlessly.
 */

const CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
const KASPA_ADDRESS_RE = /^kaspa(?:sim|test|dev)?:[qpzry9x8gf2tvdw0s3jn54khce6mua7l]{12,}$/i;
const P2PK_SCRIPT_RE = /^000020([0-9a-f]{64})ac$/i;
const HEX_PUBKEY_RE = /^(?:0x)?([0-9a-f]{64})$/i;
const PARTY_FIELD_KEYS = new Set([
  "from",
  "to",
  "address",
  "contractAddress",
  "change",
  "inputs",
  "outputs",
  "utxos",
  "accounts",
  "args",
  "constructorArgs",
  "pubkey",
  "publicKey",
  "pubkeys"
]);
const PUBKEY_PROP_RE = /pub(?:lic)?key/i;

/** Decodes a Bech32 Kaspa v0 P2PK address into its 32-byte x-only lowercase hex public key, or null otherwise. */
export function pubkeyHexFromAddress(address: string): string | null {
  const idx = address.indexOf(":");
  if (idx < 0) return null;
  const data = address.slice(idx + 1).toLowerCase();
  const values: number[] = [];
  for (const ch of data) {
    const v = CHARSET.indexOf(ch);
    if (v < 0) return null;
    values.push(v);
  }
  if (values.length <= 8) return null;
  const body = values.slice(0, -8);
  const bytes: number[] = [];
  let acc = 0;
  let bits = 0;
  for (const v of body) {
    acc = (acc << 5) | v;
    bits += 5;
    while (bits >= 8) {
      bits -= 8;
      bytes.push((acc >> bits) & 0xff);
    }
  }
  // Version 0 + 32-byte Schnorr x-only public key.
  if (bytes.length !== 33 || bytes[0] !== 0) return null;
  return bytes
    .slice(1)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Extracts the 32-byte hex public key from a standard P2PK scriptPublicKey (`000020<64hex>ac`), or null. */
export function pubkeyHexFromScriptPublicKey(spk: string): string | null {
  const m = P2PK_SCRIPT_RE.exec(spk.trim());
  return m ? m[1].toLowerCase() : null;
}

/** Extracts unique lowercased Kaspa addresses and 64-hex public keys referenced inside an artifact JSON record. */
export function extractArtifactKeys(json: Record<string, unknown>, maxKeys = 64): string[] {
  const seen = new Set<string>();
  const add = (value: string | null | undefined) => {
    if (!value || seen.size >= maxKeys) return;
    seen.add(value.toLowerCase());
  };
  const addAddress = (raw: string) => {
    const addr = raw.trim().toLowerCase();
    add(addr);
    add(pubkeyHexFromAddress(addr));
  };

  const scan = (val: unknown, keyHint: string, depth: number) => {
    if (depth > 4 || seen.size >= maxKeys || val === null || val === undefined) return;
    if (typeof val === "string") {
      const trimmed = val.trim();
      if (KASPA_ADDRESS_RE.test(trimmed)) {
        addAddress(trimmed);
        return;
      }
      if (keyHint === "scriptPublicKey") {
        add(pubkeyHexFromScriptPublicKey(trimmed));
        return;
      }
      if (PUBKEY_PROP_RE.test(keyHint)) {
        const m = HEX_PUBKEY_RE.exec(trimmed);
        if (m) add(m[1]);
      }
      return;
    }
    if (Array.isArray(val)) {
      for (const item of val) scan(item, keyHint, depth + 1);
      return;
    }
    if (typeof val === "object") {
      const rec = val as Record<string, unknown>;
      const kind = typeof rec.kind === "string" ? rec.kind.toLowerCase() : "";
      if ((kind === "pubkey" || kind === "bytes") && typeof rec.value === "string") {
        const m = HEX_PUBKEY_RE.exec(rec.value.trim());
        if (m) add(m[1]);
      }
      for (const [k, v] of Object.entries(rec)) {
        if (depth === 0 && !PARTY_FIELD_KEYS.has(k) && !PUBKEY_PROP_RE.test(k)) continue;
        scan(v, k, depth + 1);
      }
    }
  };

  scan(json, "", 0);
  return [...seen];
}
