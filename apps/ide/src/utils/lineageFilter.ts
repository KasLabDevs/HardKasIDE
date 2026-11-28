import { shortSchema, type ArtifactRow } from "@/store/lineage";
import { describeSummary } from "./artifactSummary";
import { bytesToHex, pubkeyFromAddress } from "./kaspaAddress";

export interface KnownAccount {
  name: string;
  address: string;
}

const HEX_64_RE = /^[0-9a-f]{64}$/i;

function normalizedTermsForAccounts(accounts: ReadonlyArray<KnownAccount>) {
  return accounts.map((acc) => {
    const addr = acc.address.toLowerCase();
    const pk = pubkeyFromAddress(acc.address);
    const hex = pk ? bytesToHex(pk).toLowerCase() : null;
    return { name: acc.name.toLowerCase(), rawName: acc.name, addr, rawAddr: acc.address, hex };
  });
}

/**
 * Collects searchable lowercase addresses and x-only hex public keys for an artifact row,
 * bridging account aliases, full Bech32 addresses, and decoded 32-byte Schnorr public keys.
 */
export function collectArtifactKeys(row: ArtifactRow, accounts: ReadonlyArray<KnownAccount> = []): { addresses: string[]; pubkeys: string[]; aliases: string[] } {
  const addresses = new Set<string>();
  const pubkeys = new Set<string>();
  const aliases = new Set<string>();
  const known = normalizedTermsForAccounts(accounts);

  const addAddress = (addr: string) => {
    const lower = addr.trim().toLowerCase();
    if (!lower) return;
    addresses.add(lower);
    const pk = pubkeyFromAddress(lower);
    if (pk) pubkeys.add(bytesToHex(pk).toLowerCase());
    for (const acc of known) {
      if (acc.addr === lower || (acc.hex && pubkeys.has(acc.hex))) aliases.add(acc.name);
    }
  };

  const inspectToken = (raw?: string) => {
    if (!raw) return;
    const trimmed = raw.trim();
    const lower = trimmed.toLowerCase();
    if (/^kaspa(?:sim|test|dev)?:/.test(lower)) {
      const sim = /^kaspa:sim_([a-z0-9_-]+)$/i.exec(lower);
      if (sim) aliases.add(sim[1]);
      else addAddress(lower);
    }
    const bareHex = lower.startsWith("0x") ? lower.slice(2) : lower;
    if (HEX_64_RE.test(bareHex)) pubkeys.add(bareHex);

    for (const acc of known) {
      if (acc.name === lower || acc.addr === lower || `kaspa:sim_${acc.name}` === lower || (acc.hex && bareHex === acc.hex)) {
        aliases.add(acc.name);
        addresses.add(acc.addr);
        if (acc.hex) pubkeys.add(acc.hex);
      }
    }
  };

  for (const k of row.keys ?? []) inspectToken(k);
  inspectToken(row.summary?.from);
  inspectToken(row.summary?.to);

  // Also link known account names if any extracted pubkey matches one of their P2PK addresses.
  for (const acc of known) {
    if (addresses.has(acc.addr) || (acc.hex && pubkeys.has(acc.hex))) {
      aliases.add(acc.name);
      addresses.add(acc.addr);
      if (acc.hex) pubkeys.add(acc.hex);
    }
  }

  return { addresses: [...addresses], pubkeys: [...pubkeys], aliases: [...aliases] };
}

/** Matches an artifact row against a Lineage filter query (account name, Bech32 address, 0x/hex public key, kind, id, or tx). */
export function matchesArtifactFilter(
  row: ArtifactRow,
  filter: string,
  accounts: ReadonlyArray<KnownAccount> = [],
  styleLabel = ""
): boolean {
  const q = filter.trim().toLowerCase();
  if (!q) return true;
  const qNo0x = q.startsWith("0x") ? q.slice(2) : q;

  const summary = row.summary ? describeSummary(row.summary, accounts) : null;
  const { addresses, pubkeys, aliases } = collectArtifactKeys(row, accounts);

  const textFields = [
    summary?.title ?? "",
    summary?.detail ?? "",
    row.summary?.from ?? "",
    row.summary?.to ?? "",
    row.artifactId,
    row.contentHash ?? "",
    row.txId ?? "",
    row.schema,
    styleLabel,
    shortSchema(row.schema),
    row.networkId ?? "",
    row.mode ?? "",
    ...addresses,
    ...aliases
  ];

  if (textFields.some((s) => s.toLowerCase().includes(q))) return true;
  if (qNo0x.length > 0 && /^[0-9a-f]+$/.test(qNo0x) && pubkeys.some((pk) => pk.includes(qNo0x))) return true;

  // If the user pasted a full valid P2PK Bech32 address, also match via its decoded hex public key.
  const pkQuery = pubkeyFromAddress(q);
  if (pkQuery) {
    const queryHex = bytesToHex(pkQuery).toLowerCase();
    if (pubkeys.includes(queryHex)) return true;
  }

  return false;
}
