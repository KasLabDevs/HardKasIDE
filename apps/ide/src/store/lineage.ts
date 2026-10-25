import { create } from "zustand";

export interface ArtifactRow {
  artifactId: string;
  contentHash?: string;
  schema: string;
  kind?: string;
  mode?: string;
  networkId?: string;
  txId?: string | null;
  createdAt?: string;
  path?: string;
  integrityStatus?: string;
  parentArtifactId?: string | null;
  flowId?: string;
}

export interface LineageEdge {
  id: string;
  source: string;
  target: string;
}

export interface ReplayVerdict {
  status: string;
  detail?: unknown;
}

interface LineageState {
  artifacts: ArtifactRow[];
  edges: LineageEdge[];
  byId: Map<string, ArtifactRow>;
  fresh: Set<string>;
  replays: Record<string, ReplayVerdict>;
  live: boolean;
  loading: boolean;
  error: string | null;
  selected: string | null;
  setGraph(artifacts: ArtifactRow[], edges: LineageEdge[]): void;
  markFresh(id: string): void;
  setReplay(id: string, verdict: ReplayVerdict): void;
  setLive(live: boolean): void;
  setLoading(loading: boolean): void;
  setError(error: string | null): void;
  select(id: string | null): void;
}

export const useLineage = create<LineageState>((set) => ({
  artifacts: [],
  edges: [],
  byId: new Map(),
  fresh: new Set(),
  replays: {},
  live: false,
  loading: false,
  error: null,
  selected: null,
  setGraph: (artifacts, edges) => set({ artifacts, edges, byId: new Map(artifacts.map((a) => [a.artifactId, a])) }),
  markFresh: (id) => {
    set((s) => ({ fresh: new Set([...s.fresh, id]) }));
    setTimeout(() => set((s) => {
      const next = new Set(s.fresh);
      next.delete(id);
      return { fresh: next };
    }), 6000);
  },
  setReplay: (id, verdict) => set((s) => ({ replays: { ...s.replays, [id]: verdict } })),
  setLive: (live) => set({ live }),
  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error }),
  select: (selected) => set({ selected })
}));

/** Short, human schema name: "hardkas.txReceipt" → "txReceipt", "hardkas.txSubmission.v1" → "txSubmission". */
export function shortSchema(schema: string): string {
  return schema.replace(/^hardkas\./, "").replace(/\.v\d+$/, "");
}
