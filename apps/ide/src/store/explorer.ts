import { create } from "zustand";
import type { HistoryView } from "@/utils/nodeHistory";
import type { LiveUtxo, LiveUtxoSet, WatchBalance, WatchEvent } from "@/utils/watchLines";

/** Live view of the local node: DAG, mempool, blocks the miner found, the UTXOs and the history of one address. */

export interface DagInfo {
  networkId: string;
  virtualDaaScore: number;
  tipHashes: string[];
  virtualParentHashes: string[];
  sink: string;
  isSynced?: boolean;
  serverVersion?: string;
}

export interface MempoolEntry {
  txId: string;
  feeSompi?: string;
  raw: unknown;
}

export interface MinedBlock {
  hash: string;
  at: string;
}

export interface MinerInfo {
  exists: boolean;
  running: boolean;
  perSecond: number;
  windowBlocks: number;
  /** How many times, in the log window, the node refused a block because it could not keep up. */
  routeFull: number;
  blocks: MinedBlock[];
}

/** A UTXO as `hardkas rpc utxos` lists it, or as `hardkas watch` reports it (then without a DAA score). */
export type UtxoRow = LiveUtxo;

export interface UtxoView extends LiveUtxoSet {
  /** `rpc`: one `hardkas rpc utxos` reading; `watch`: kept live by `hardkas watch`. */
  source: "rpc" | "watch";
  loadedAt: number;
}

export interface WatchFeedItem {
  at: string;
  kind: WatchEvent["event"];
  text: string;
  txid?: string;
}

export interface WatchState {
  address: string;
  jobId: string | null;
  /** starting: the job runs but no snapshot yet; live: the snapshot arrived; stopped / failed: the job ended. */
  status: "starting" | "live" | "stopped" | "failed";
  network?: string;
  balance?: WatchBalance;
  /** Newest last, capped. */
  feed: WatchFeedItem[];
  events: number;
  startedAt: number;
  /** Why it ended, when it did (the watch's own `end` reason, "node stopped", "toggle off", …). */
  endReason?: string;
  error?: string;
}

interface ExplorerState {
  dag: DagInfo | null;
  /** [timestamp ms, DAA] samples, newest last, to draw the growth and derive blocks per second. */
  daaSamples: Array<[number, number]>;
  mempool: MempoolEntry[] | null;
  miner: MinerInfo | null;
  utxos: UtxoView | null;
  utxosBusy: boolean;
  utxosError: string | null;
  /** The current page of `hardkas history` for one address. */
  history: HistoryView | null;
  historyBusy: boolean;
  historyError: string | null;
  /** The cursors of the pages before the current one (the first page has none), so "previous" can go back. */
  historyTrail: Array<string | undefined>;
  watch: WatchState | null;
  busy: boolean;
  error: string | null;
  updatedAt: number | null;
  patch(p: Partial<Omit<ExplorerState, "patch" | "pushDaa" | "reset">>): void;
  pushDaa(daa: number): void;
  reset(): void;
}

export const useExplorer = create<ExplorerState>((set) => ({
  dag: null,
  daaSamples: [],
  mempool: null,
  miner: null,
  utxos: null,
  utxosBusy: false,
  utxosError: null,
  history: null,
  historyBusy: false,
  historyError: null,
  historyTrail: [],
  watch: null,
  busy: false,
  error: null,
  updatedAt: null,
  patch: (p) => set(p),
  pushDaa: (daa) => set((s) => ({ daaSamples: [...s.daaSamples, [Date.now(), daa] as [number, number]].slice(-40) })),
  reset: () => set({ dag: null, daaSamples: [], mempool: null, miner: null, utxos: null, history: null, historyError: null, historyTrail: [], watch: null, error: null, updatedAt: null })
}));
