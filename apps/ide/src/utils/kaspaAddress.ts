/**
 * Kaspa address decoding (bech32 variant with an 8-character checksum).
 *
 * A P2PK address (version 0) carries the 32-byte x-only Schnorr public key, which is
 * exactly what a SilverScript `pubkey` constructor parameter wants. This lets the IDE
 * fill constructor args from an account's address without touching its private key.
 */

const CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";

export interface DecodedAddress {
  prefix: string;
  version: number;
  payload: number[];
}

export function decodeKaspaAddress(address: string): DecodedAddress {
  const idx = address.indexOf(":");
  if (idx < 0) throw new Error("Address must look like kaspa…:…");
  const prefix = address.slice(0, idx).toLowerCase();
  const data = address.slice(idx + 1).toLowerCase();
  const values = [...data].map((c) => CHARSET.indexOf(c));
  if (values.some((v) => v < 0)) throw new Error("Address contains invalid characters");
  if (values.length <= 8) throw new Error("Address too short");
  const body = values.slice(0, -8); // drop the checksum
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
  if (bytes.length < 2) throw new Error("Address payload too short");
  return { prefix, version: bytes[0], payload: bytes.slice(1) };
}

/** x-only public key bytes of a P2PK (Schnorr) address, or null for other address kinds. */
export function pubkeyFromAddress(address: string): number[] | null {
  try {
    const d = decodeKaspaAddress(address);
    if (d.version !== 0 || d.payload.length !== 32) return null;
    return d.payload;
  } catch {
    return null;
  }
}

export function bytesToHex(bytes: number[]): string {
  return bytes.map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function hexToBytes(hex: string): number[] {
  const clean = hex.trim().replace(/^0x/, "");
  if (clean.length % 2 !== 0 || /[^0-9a-fA-F]/.test(clean)) throw new Error("Invalid hex");
  const out: number[] = [];
  for (let i = 0; i < clean.length; i += 2) out.push(parseInt(clean.slice(i, i + 2), 16));
  return out;
}
