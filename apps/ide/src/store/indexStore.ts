import { create } from "zustand";

/** The Index view: what HardKAS's SQLite query store holds (artifacts, events, lineage), read through ide-server. */

export type IndexTab = "overview" | "artifacts" | "transactions" | "sql" | "problems";

export interface Facet {
  name: string;
  count: number;
}

export interface StoreHealth {
  exists: boolean;
  path: string;
  sizeBytes?: number;
  walBytes?: number;
  counts?: { artifacts: number; events: number; lineageEdges: number; lineageClosure: number; traces: number };
  byKind?: Facet[];
  byMode?: Facet[];
  byNetwork?: Facet[];
  eventsByDomain?: Facet[];
  tracesByStatus?: Facet[];
  indexedAt?: string | null;
  newestArtifact?: string | null;
  migrations?: Array<{ version: number; name: string; appliedAt: string }>;
  metadata?: Record<string, string>;
  disk?: { files: number; newestMs: number; ledgerMs: number | null };
  stale?: boolean;
  staleSince?: string | null;
}

export interface ArtifactRow {
  artifact_id: string;
  content_hash: string;
  schema: string;
  kind: string | null;
  mode: string | null;
  network_id: string | null;
  tx_id: string | null;
  created_at: string | null;
  file_path: string | null;
  indexed_at: string | null;
}

export interface LineageRef {
  artifact_id: string;
  schema: string | null;
  created_at: string | null;
  tx_id: string | null;
  depth: number;
}

export interface ArtifactDetail {
  artifact: ArtifactRow;
  json: unknown;
  ancestors: LineageRef[];
  descendants: LineageRef[];
}

export interface ArtifactFilters {
  schema: string;
  mode: string;
  network: string;
  q: string;
}

interface IndexState {
  tab: IndexTab;
  filters: ArtifactFilters;
  /** artifact_id shown in the Artifacts tab detail pane */
  selectedId: string | null;
  /** transaction shown in the Transactions tab */
  txId: string;
  health: StoreHealth | null;
  healthError: string | null;
  loading: boolean;
  /** what the last maintenance action (sync, rebuild, verify…) said */
  actionMessage: string | null;
  busyAction: string | null;
  set(p: Partial<Omit<IndexState, "set">>): void;
}

export const useIndex = create<IndexState>((set) => ({
  tab: "overview",
  filters: { schema: "", mode: "", network: "", q: "" },
  selectedId: null,
  txId: "",
  health: null,
  healthError: null,
  loading: false,
  actionMessage: null,
  busyAction: null,
  set: (p) => set(p)
}));

/** "hardkas.txReceipt" → "txReceipt", "hardkas.snapshot.v1" → "snapshot" */
export const shortKind = (schema: string | null | undefined): string => (schema ?? "?").replace(/^hardkas\./, "").replace(/\.v\d+$/, "");
