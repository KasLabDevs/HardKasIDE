/** The server's short reading of an artifact (packages/ide-server/src/artifactSummary.ts), as the Lineage rows show it. */
export interface ArtifactSummary {
  verb: string;
  subject?: string;
  from?: string;
  to?: string;
  kas?: string;
  note?: string;
}

/** "kaspasim:qryj23rch0n5…5980": enough to tell addresses apart, short enough for a row. */
export function shortAddress(address: string): string {
  const i = address.indexOf(":");
  const body = i >= 0 ? address.slice(i + 1) : address;
  if (body.length <= 14) return address;
  return `${i >= 0 ? address.slice(0, i + 1) : ""}${body.slice(0, 6)}…${body.slice(-4)}`;
}

/** An account name when the address is one of the project's accounts, else a short address. */
export function partyName(party: string, accounts: ReadonlyArray<{ name: string; address: string }>): string {
  const hit = accounts.find((a) => a.address === party || a.name === party);
  if (hit) return hit.name;
  // The simulator's address for an account is "kaspa:sim_<name>": the name is already in it.
  const sim = /^kaspa:sim_([A-Za-z0-9_-]+)$/.exec(party);
  if (sim) return sim[1];
  return /^kaspa[a-z]*:/.test(party) ? shortAddress(party) : party;
}

export interface SummaryText {
  /** "Deploy VaultGuard" */
  title: string;
  /** "alice → bob · 10 KAS · confirmed" */
  detail: string;
}

export function describeSummary(s: ArtifactSummary, accounts: ReadonlyArray<{ name: string; address: string }> = []): SummaryText {
  const title = [s.verb, s.subject].filter(Boolean).join(" ");
  // Only the side the artifact states: a spend names who receives, not who sent.
  const from = s.from ? partyName(s.from, accounts) : undefined;
  const to = s.to ? partyName(s.to, accounts) : undefined;
  const who = from && to ? `${from} → ${to}` : to ? `to ${to}` : from ? `from ${from}` : undefined;
  const detail = [who, s.kas ? `${s.kas} KAS` : undefined, s.note].filter(Boolean).join(" · ");
  return { title, detail };
}
