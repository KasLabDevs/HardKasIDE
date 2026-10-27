import { create } from "zustand";

/** Live view of the local node: DAG, mempool, blocks the miner found, and the UTXOs of one address. */

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

export interface UtxoRow {
  txId: string;
  index: number;
  amountSompi: string;
  daa: number;
  coinbase: boolean;
}

export interface UtxoView {
  address: string;
  totalSompi: string;
  count: number;
  /** The biggest ones first, capped for the screen. */
  rows: UtxoRow[];
  loadedAt: number;
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
  busy: false,
  error: null,
  updatedAt: null,
  patch: (p) => set(p),
  pushDaa: (daa) => set((s) => ({ daaSamples: [...s.daaSamples, [Date.now(), daa] as [number, number]].slice(-40) })),
  reset: () => set({ dag: null, daaSamples: [], mempool: null, miner: null, utxos: null, error: null, updatedAt: null })
}));
