/**
 * `hardkas history <address> --json` (HardKas 0.13.0-rc.3+, schema hardkas.addressHistory.v1): a bounded window of the
 * node's selected chain, every accepted transaction in it that pays the address or spends from it, the workspace's own
 * records merged in, paged. The result says what the window covered; the parser keeps that and never fills in what
 * the CLI did not say.
 */

export type HistorySource = "node" | "node+workspace" | "workspace";
export type HistoryDirection = "in" | "out" | "self";

export interface HistoryOutput {
  /** Absent for a workspace-only record (a plan does not fix the output order). */
  index?: number;
  amountSompi: string;
  covenantId?: string;
  /** The transaction of this window that spent it, when the window holds one. */
  spentBy?: string;
}

export interface HistorySpend {
  /** `txId:index` of the output of the address this transaction spent. */
  outpoint: string;
  amountSompi?: string;
  covenantId?: string;
  coinbase?: boolean;
  matchedBy: string;
}

export interface HistoryAcceptance {
  chainBlockHash: string;
  daaScore: string;
  blueScore: string;
  previousChainBlockHash: string;
  /** Depth below the node's virtual DAA score at the end of the read. */
  confirmationsDaa: string;
  /** Depth below the node's sink blue score (HardKas' confirmation unit). */
  confirmationsBlue: string;
}

export interface HistoryWorkspaceRecord {
  submissionArtifactId?: string;
  receiptArtifactId?: string;
  planArtifactId?: string;
  submittedAt?: string;
  state?: string;
  acceptingBlockHash?: string;
}

export interface HistoryEntry {
  txId: string;
  source: HistorySource;
  direction: HistoryDirection;
  /** Plain KAS paid to the address; covenant-bound outputs are counted apart. */
  receivedSompi: string;
  covenantBoundReceivedSompi: string;
  /** Absent when the amount spent is unknown (see spends). */
  spentSompi?: string;
  /** received (plain and covenant-bound) − spent, when both are known. */
  netSompi?: string;
  outputs: HistoryOutput[];
  spends: HistorySpend[];
  coinbase: boolean;
  covenantBound: boolean;
  /** The covenant an output or a spend of this transaction is bound to, when there is one. */
  covenantId?: string;
  acceptance?: HistoryAcceptance;
  workspace?: HistoryWorkspaceRecord;
  /** A workspace record the window does not show: the CLI's reason. */
  outsideWindow?: string;
}

export interface HistoryWindow {
  requestedKind: string;
  lookback?: number;
  /** The window starts AFTER this chain block. */
  fromHash: string;
  fromDaa: string;
  firstCoveredDaaScore: string;
  toHash?: string;
  toDaa?: string;
  chainBlocks: number;
  reachedTip: boolean;
  startsAtPruningPoint: boolean;
  pruningPointIsGenesis: boolean;
  clampedToPruningPoint: boolean;
  requestedStartNotReached: boolean;
  startOffSelectedChain: boolean;
  stoppedBy: string;
  /** When the window did not reach the tip: the `--since` that reads the next window. */
  continueFrom?: string;
}

export interface HistoryView {
  address: string;
  networkId: string;
  entries: HistoryEntry[];
  /** Entries in the whole window, over every page. */
  total: number;
  offset: number;
  limit: number;
  /** The cursor this page was read with (none for the first page). */
  cursor?: string;
  nextCursor?: string;
  window: HistoryWindow;
  /** The node's tip when the read ended: the confirmations are measured from it. */
  tipDaa: string;
  sinkBlueScore: string;
  nodeSynced?: boolean;
  serverVersion?: string;
  spendsCoverage: string;
  inputsWithoutEntry: number;
  workspace: { merged: boolean; records: number; outsideWindow: number; rejected: number };
  /** What this result does not cover, in the CLI's words. */
  notCovered: string[];
  loadedAt: number;
}

type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec => (v && typeof v === "object" && !Array.isArray(v) ? (v as Rec) : {});
const str = (v: unknown): string | undefined => (typeof v === "string" ? v : typeof v === "number" || typeof v === "bigint" ? String(v) : undefined);
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && /^\d+$/.test(v) ? Number(v) : undefined);
const bool = (v: unknown): boolean => v === true;

export const HISTORY_SCHEMA = "hardkas.addressHistory.v1";

/**
 * Reads a `hardkas history --json` result. Returns the view, or the CLI's own error when the result is a refusal
 * (`ok: false`), or a parse error when the document is not a history result at all.
 */
export function parseHistoryResult(result: unknown, options?: { cursor?: string; now?: number }): { view: HistoryView; error: null } | { view: null; error: string } {
  const r = rec(result);
  if (r.ok === false) return { view: null, error: `${str(r.code) ?? "ERROR"}: ${str(r.message) ?? "hardkas history failed"}` };
  if (!Array.isArray(r.entries) || typeof r.address !== "string" || !r.coverage) {
    return { view: null, error: "hardkas history returned no history result (an older CLI? the command needs HardKas 0.13.0-rc.3 or later)" };
  }
  if (r.schema !== undefined && r.schema !== HISTORY_SCHEMA) {
    return { view: null, error: `hardkas history wrote schema ${String(r.schema)}; this IDE reads ${HISTORY_SCHEMA}` };
  }
  const coverage = rec(r.coverage);
  const w = rec(coverage.window);
  const from = rec(w.from);
  const to = w.to ? rec(w.to) : null;
  const pp = rec(w.pruningPoint);
  const point = rec(coverage.point);
  const node = rec(coverage.node);
  const ws = rec(coverage.workspace);
  const page = rec(r.page);

  const entries: HistoryEntry[] = r.entries.map((raw) => parseEntry(rec(raw)));
  const window: HistoryWindow = {
    requestedKind: str(rec(w.requested).kind) ?? "default",
    lookback: num(rec(w.requested).lookback),
    fromHash: str(from.hash) ?? "",
    fromDaa: str(from.daaScore) ?? "?",
    firstCoveredDaaScore: str(w.firstCoveredDaaScore) ?? "?",
    toHash: to ? str(to.hash) : undefined,
    toDaa: to ? str(to.daaScore) : undefined,
    chainBlocks: num(w.chainBlocks) ?? 0,
    reachedTip: bool(w.reachedTip),
    startsAtPruningPoint: bool(w.startsAtPruningPoint),
    pruningPointIsGenesis: bool(pp.isGenesis),
    clampedToPruningPoint: bool(w.clampedToPruningPoint),
    requestedStartNotReached: bool(w.requestedStartNotReached),
    startOffSelectedChain: bool(w.startOffSelectedChain),
    stoppedBy: str(w.stoppedBy) ?? "?",
    continueFrom: str(w.continueFrom)
  };
  return {
    view: {
      address: r.address,
      networkId: str(r.networkId) ?? "?",
      entries,
      total: num(r.total) ?? entries.length,
      offset: num(page.offset) ?? 0,
      limit: num(page.limit) ?? entries.length,
      cursor: options?.cursor,
      nextCursor: str(page.nextCursor),
      window,
      tipDaa: str(point.virtualDaaScore) ?? "?",
      sinkBlueScore: str(point.sinkBlueScore) ?? "?",
      nodeSynced: typeof node.isSynced === "boolean" ? node.isSynced : undefined,
      serverVersion: str(node.serverVersion),
      spendsCoverage: str(coverage.spends) ?? "?",
      inputsWithoutEntry: num(coverage.inputsWithoutEntry) ?? 0,
      workspace: { merged: bool(ws.merged), records: num(ws.records) ?? 0, outsideWindow: num(ws.outsideWindow) ?? 0, rejected: num(ws.rejected) ?? 0 },
      notCovered: Array.isArray(coverage.notCovered) ? coverage.notCovered.map(String) : [],
      loadedAt: options?.now ?? Date.now()
    },
    error: null
  };
}

function parseEntry(e: Rec): HistoryEntry {
  const outputs: HistoryOutput[] = (Array.isArray(e.outputs) ? e.outputs : []).map((raw) => {
    const o = rec(raw);
    return { index: num(o.index), amountSompi: str(o.amountSompi) ?? "0", covenantId: str(o.covenantId), spentBy: str(o.spentBy) };
  });
  const spends: HistorySpend[] = (Array.isArray(e.spends) ? e.spends : []).map((raw) => {
    const s = rec(raw);
    return { outpoint: str(s.outpoint) ?? "", amountSompi: str(s.amountSompi), covenantId: str(s.covenantId), coinbase: typeof s.coinbase === "boolean" ? s.coinbase : undefined, matchedBy: str(s.matchedBy) ?? "?" };
  });
  const source = str(e.source);
  const direction = str(e.direction);
  const acc = e.acceptance ? rec(e.acceptance) : null;
  const wsr = e.workspace ? rec(e.workspace) : null;
  return {
    txId: str(e.txId) ?? "",
    source: source === "node+workspace" || source === "workspace" ? source : "node",
    direction: direction === "out" || direction === "self" ? direction : "in",
    receivedSompi: str(e.receivedSompi) ?? "0",
    covenantBoundReceivedSompi: str(e.covenantBoundReceivedSompi) ?? "0",
    spentSompi: str(e.spentSompi),
    netSompi: str(e.netSompi),
    outputs,
    spends,
    coinbase: bool(e.coinbase),
    covenantBound: bool(e.covenantBound),
    covenantId: outputs.find((o) => o.covenantId)?.covenantId ?? spends.find((s) => s.covenantId)?.covenantId,
    acceptance: acc
      ? {
          chainBlockHash: str(acc.chainBlockHash) ?? "",
          daaScore: str(acc.daaScore) ?? "?",
          blueScore: str(acc.blueScore) ?? "?",
          previousChainBlockHash: str(acc.previousChainBlockHash) ?? "",
          confirmationsDaa: str(acc.confirmationsDaa) ?? "?",
          confirmationsBlue: str(acc.confirmationsBlue) ?? "?"
        }
      : undefined,
    workspace: wsr
      ? {
          submissionArtifactId: str(wsr.submissionArtifactId),
          receiptArtifactId: str(wsr.receiptArtifactId),
          planArtifactId: str(wsr.planArtifactId),
          submittedAt: str(wsr.submittedAt),
          state: str(wsr.state),
          acceptingBlockHash: str(wsr.acceptingBlockHash)
        }
      : undefined,
    outsideWindow: str(e.outsideWindow)
  };
}

/** The amount an entry moved for the address, signed when known ("+", "−") or the amount received when the spent side is unknown. */
export function entryAmount(e: HistoryEntry): { sompi: string; sign: "+" | "-" | ""; known: boolean } {
  if (e.netSompi !== undefined) {
    const neg = e.netSompi.startsWith("-");
    return { sompi: neg ? e.netSompi.slice(1) : e.netSompi, sign: neg ? "-" : e.netSompi === "0" ? "" : "+", known: true };
  }
  const received = BigInt(e.receivedSompi || "0") + BigInt(e.covenantBoundReceivedSompi || "0");
  return { sompi: received.toString(), sign: received > 0n ? "+" : "", known: false };
}

/** The direction as the card labels it. */
export function directionLabel(d: HistoryDirection): "paid" | "spent" | "self" {
  return d === "in" ? "paid" : d === "out" ? "spent" : "self";
}

/**
 * One sentence on what the node's window covered, from the result's own coverage facts: where it starts and ends,
 * whether it reached the tip or stopped early, and whether its start is the pruning point.
 */
export function describeWindow(v: HistoryView): string {
  const w = v.window;
  const start = w.startsAtPruningPoint
    ? w.pruningPointIsGenesis
      ? `from the node's genesis (DAA ${w.fromDaa}: its whole history)`
      : `from the node's pruning point (DAA ${w.fromDaa}: nothing older is readable on it)`
    : `after chain block DAA ${w.fromDaa}${w.requestedKind === "default" && w.lookback ? ` (the last ${w.lookback} chain blocks)` : ""}`;
  const end = w.reachedTip ? `to the node's tip (DAA ${w.toDaa ?? v.tipDaa})` : w.toDaa ? `to DAA ${w.toDaa}, where it stopped (${w.stoppedBy})` : `stopped (${w.stoppedBy}) before reading a block`;
  const flags: string[] = [];
  if (w.clampedToPruningPoint) flags.push("the requested start was below the pruning point and was moved up to it");
  if (w.requestedStartNotReached) flags.push("the requested start was not reached: the window starts later than asked");
  if (w.startOffSelectedChain) flags.push("the start block was not on the selected chain: the window starts at its selected-chain ancestor");
  if (!w.reachedTip && w.continueFrom) flags.push("what follows is not covered; the next window continues from the block the result names");
  return `The node covered ${w.chainBlocks} chain block${w.chainBlocks === 1 ? "" : "s"} ${start} ${end}.${flags.length ? " " + flags.join("; ") + "." : ""}`;
}
