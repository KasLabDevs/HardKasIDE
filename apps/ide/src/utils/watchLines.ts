/**
 * `hardkas watch <address> --json` (HardKas 0.13.0-rc.3+): one compact JSON document per line. The first is a
 * `snapshot` (every UTXO the node holds for the address and its balance), then `added` / `removed` / `matured` per
 * transaction, a `resync` after every reconnect (the whole difference), connection notices, `error`s, and `end` last.
 * Covenant-bound outputs are labelled. This module reads those lines and applies them to the card's UTXO view.
 */

export interface WatchOutput {
  transactionId: string;
  index: number;
  amountSompi: string;
  /** "pending" | "mature" as kaspa-wasm reports it, when the CLI gives it. */
  state?: string;
  covenantBound: boolean;
  covenantId?: string;
}

export interface WatchBalance {
  mature: string;
  pending: string;
  stasisCount: number;
}

export type WatchEvent =
  | { event: "snapshot"; at: string; address: string; network: string; utxos: WatchOutput[]; balance: WatchBalance }
  | { event: "added" | "removed" | "matured"; at: string; txid: string; outputs: WatchOutput[] }
  | { event: "resync"; at: string; reason: string; added: WatchOutput[]; removed: WatchOutput[] }
  | { event: "error"; at: string; code: string; message: string; fatal: boolean }
  | { event: "end"; at: string; reason: string; events: number }
  /** A connection notice (`disconnected`, `reconnected`, …) or an event this IDE does not know. */
  | { event: "notice"; at: string; name: string; raw: Record<string, unknown> };

type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec => (v && typeof v === "object" && !Array.isArray(v) ? (v as Rec) : {});
const str = (v: unknown, fallback = ""): string => (typeof v === "string" ? v : typeof v === "number" || typeof v === "bigint" ? String(v) : fallback);

function output(raw: unknown): WatchOutput {
  const o = rec(raw);
  const covenantId = typeof o.covenantId === "string" && o.covenantId !== "" ? o.covenantId : undefined;
  return {
    transactionId: str(o.transactionId),
    index: Number(o.index ?? 0),
    amountSompi: str(o.amountSompi, "0"),
    state: typeof o.state === "string" ? o.state : undefined,
    covenantBound: o.covenantBound === true || covenantId !== undefined,
    covenantId
  };
}

const outputs = (v: unknown): WatchOutput[] => (Array.isArray(v) ? v.map(output) : []);

/** One line of the stream. Returns null for a blank line or one that is not a JSON document. */
export function parseWatchLine(line: string): WatchEvent | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("{")) return null;
  let doc: Rec;
  try {
    doc = rec(JSON.parse(trimmed));
  } catch {
    return null;
  }
  const at = str(doc.at);
  const name = str(doc.event);
  switch (name) {
    case "snapshot": {
      const b = rec(doc.balance);
      return { event: "snapshot", at, address: str(doc.address), network: str(doc.network), utxos: outputs(doc.utxos), balance: { mature: str(b.mature, "0"), pending: str(b.pending, "0"), stasisCount: Number(b.stasisCount ?? 0) } };
    }
    case "added":
    case "removed":
    case "matured":
      return { event: name, at, txid: str(doc.txid), outputs: outputs(doc.outputs) };
    case "resync":
      return { event: "resync", at, reason: str(doc.reason), added: outputs(doc.added), removed: outputs(doc.removed) };
    case "error":
      return { event: "error", at, code: str(doc.code, "WALLET_WATCH_ERROR"), message: str(doc.message), fatal: doc.fatal === true };
    case "end":
      return { event: "end", at, reason: str(doc.reason), events: Number(doc.events ?? 0) };
    case "":
      return null;
    default:
      return { event: "notice", at, name, raw: doc };
  }
}

/** Splits a stream of chunks into whole lines; a partial last line waits for the next chunk. */
export class LineBuffer {
  private rest = "";
  push(chunk: string): string[] {
    this.rest += chunk;
    const parts = this.rest.split(/\r?\n/);
    this.rest = parts.pop() ?? "";
    return parts.filter((l) => l.trim() !== "");
  }
  /** The last line when the stream ends without a newline. */
  flush(): string[] {
    const last = this.rest.trim();
    this.rest = "";
    return last ? [last] : [];
  }
}

/** A UTXO as the card lists it (shared with `hardkas rpc utxos`). */
export interface LiveUtxo {
  txId: string;
  index: number;
  amountSompi: string;
  /** The accepting block's DAA score; the watch does not report it, so a watched output has none until reloaded. */
  daa: number | null;
  coinbase: boolean;
  state?: string;
  covenantId?: string;
}

export interface LiveUtxoSet {
  address: string;
  totalSompi: string;
  count: number;
  rows: LiveUtxo[];
}

const key = (o: { txId: string; index: number } | { transactionId: string; index: number }) => `${"txId" in o ? o.txId : o.transactionId}:${o.index}`;
const toRow = (o: WatchOutput): LiveUtxo => ({ txId: o.transactionId, index: o.index, amountSompi: o.amountSompi, daa: null, coinbase: false, state: o.state, covenantId: o.covenantId });
const sum = (rows: LiveUtxo[]): string => rows.reduce((s, r) => s + BigInt(r.amountSompi || "0"), 0n).toString();

/** Biggest first, then newest DAA; a watched output without DAA sorts after one with it at the same amount. */
export function sortUtxos(rows: LiveUtxo[]): LiveUtxo[] {
  return [...rows].sort((a, b) => {
    const aa = BigInt(a.amountSompi || "0");
    const bb = BigInt(b.amountSompi || "0");
    if (aa !== bb) return bb > aa ? 1 : -1;
    return (b.daa ?? -1) - (a.daa ?? -1);
  });
}

/**
 * Applies one watch event to the UTXO set shown for its address: a snapshot replaces it (it is the node's full list),
 * added / removed / matured / resync change it in place. Events that do not touch the set (notices, errors, end)
 * return it unchanged. Totals are recomputed from the rows, never guessed.
 */
export function applyWatchEvent(set: LiveUtxoSet | null, event: WatchEvent, address: string): LiveUtxoSet | null {
  switch (event.event) {
    case "snapshot": {
      const rows = sortUtxos(event.utxos.map(toRow));
      return { address: event.address || address, totalSompi: sum(rows), count: rows.length, rows };
    }
    case "added":
    case "removed":
    case "matured":
    case "resync": {
      const base = set && set.address === address ? set : { address, totalSompi: "0", count: 0, rows: [] };
      const byKey = new Map(base.rows.map((r) => [key(r), r]));
      const removed = event.event === "removed" ? event.outputs : event.event === "resync" ? event.removed : [];
      const added = event.event === "added" ? event.outputs : event.event === "resync" ? event.added : [];
      for (const o of removed) byKey.delete(key(o));
      for (const o of added) byKey.set(key(o), { ...(byKey.get(key(o)) ?? {}), ...toRow(o), daa: byKey.get(key(o))?.daa ?? null, coinbase: byKey.get(key(o))?.coinbase ?? false });
      if (event.event === "matured") {
        for (const o of event.outputs) {
          const k = key(o);
          const prev = byKey.get(k);
          byKey.set(k, prev ? { ...prev, state: o.state ?? "mature" } : { ...toRow(o), state: o.state ?? "mature" });
        }
      }
      const rows = sortUtxos([...byKey.values()]);
      return { address, totalSompi: sum(rows), count: rows.length, rows };
    }
    default:
      return set;
  }
}

/** A short line for the event feed. */
export function describeWatchEvent(e: WatchEvent, formatAmount: (sompi: string) => string): string {
  const total = (list: WatchOutput[]) => formatAmount(list.reduce((s, o) => s + BigInt(o.amountSompi || "0"), 0n).toString());
  const n = (list: WatchOutput[]) => `${list.length} output${list.length === 1 ? "" : "s"}`;
  const covenant = (list: WatchOutput[]) => (list.some((o) => o.covenantBound) ? " · covenant-bound" : "");
  switch (e.event) {
    case "snapshot":
      return `watching on ${e.network}: ${e.utxos.length} output${e.utxos.length === 1 ? "" : "s"}, mature ${formatAmount(e.balance.mature)}, pending ${formatAmount(e.balance.pending)}`;
    case "added":
      return `+ ${total(e.outputs)} (${n(e.outputs)}${covenant(e.outputs)}) · tx ${e.txid.slice(0, 10)}…`;
    case "removed":
      return `− ${total(e.outputs)} (${n(e.outputs)} spent${covenant(e.outputs)}) · tx ${e.txid.slice(0, 10)}…`;
    case "matured":
      return `matured ${total(e.outputs)} (${n(e.outputs)})`;
    case "resync":
      return `resync after reconnect (${e.reason}): ${e.added.length} added, ${e.removed.length} removed`;
    case "error":
      return `error ${e.code}${e.fatal ? " (fatal)" : ""}: ${e.message}`;
    case "end":
      return `watch ended (${e.reason}) after ${e.events} event${e.events === 1 ? "" : "s"}`;
    default:
      return e.name === "disconnected" ? "disconnected from the node (resyncs when it reconnects)" : e.name === "reconnected" ? "reconnected (resyncing)" : e.name;
  }
}
