import { create } from "zustand";

/** The local cluster: the HardKAS node plus the extra nodes the IDE starts next to it (see ide-server cluster.ts). */

export interface NodeChain {
  daa: number;
  sink: string;
  tips: number;
  blocks: number;
  headers: number;
  network: string;
  peers: Array<{ address: string; outbound: boolean }>;
  synced: boolean;
  version: string;
  mempool: number;
  difficulty: number;
}

export interface ClusterNode {
  name: string;
  index: number;
  role: "hardkas" | "extra";
  state: string;
  startedAt: string | null;
  rpcPort: number | null;
  ip: string | null;
  chain: NodeChain | null;
  mem?: string;
  cpu?: string;
  inSync: boolean | null;
  behind: number | null;
}

export interface ClusterStatus {
  docker: boolean;
  image: string;
  nodes: ClusterNode[];
  reference: string | null;
  max: number;
}

/** [timestamp ms, progress units] per node, to estimate how fast a joining node is catching up. */
export type Sample = [number, number];

interface ClusterState {
  status: ClusterStatus | null;
  error: string | null;
  busy: string | null;
  loading: boolean;
  updatedAt: number | null;
  samples: Record<string, Sample[]>;
  /** node whose log is open */
  logFor: string | null;
  logText: string;
  set(p: Partial<Omit<ClusterState, "set">>): void;
}

export const useCluster = create<ClusterState>((set) => ({
  status: null,
  error: null,
  busy: null,
  loading: false,
  updatedAt: null,
  samples: {},
  logFor: null,
  logText: "",
  set: (p) => set(p)
}));

/** How far a node has got along the reference node's chain, 0..1 (headers first, then blocks count as the same units). */
export function progressOf(node: ClusterNode, reference: ClusterNode | undefined): number | null {
  if (!node.chain || !reference?.chain) return null;
  const target = Math.max(reference.chain.blocks, reference.chain.headers, 1);
  const have = Math.max(node.chain.blocks, node.chain.headers);
  return Math.min(1, have / target);
}
