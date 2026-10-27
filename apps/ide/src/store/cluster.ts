import { create } from "zustand";

/** The local cluster: the HardKAS node plus the extra nodes the IDE starts next to it (see ide-server cluster.ts). */

export interface PeerDetail {
  id: string;
  address: string;
  outbound: boolean;
  userAgent: string;
  synced: boolean;
  lastPingMs: number | null;
  timeOffsetMs: number | null;
}

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
  pruningPoint?: string;
  pastMedianTime?: number;
  p2pId?: string;
  utxoIndexed?: boolean;
  peerDetails?: PeerDetail[];
}

export interface NodeInspectDetail {
  id: string;
  name: string;
  index: number;
  role: "hardkas" | "extra";
  state: string;
  status: string;
  running: boolean;
  restarts: number;
  exitCode: number;
  oomKilled: boolean;
  pid: number;
  image: string;
  imageId: string;
  platform: string;
  createdAt: string | null;
  startedAt: string | null;
  rpcPort: number | null;
  ip: string | null;
  networks: Array<{ name: string; ip: string; gateway: string }>;
  ports: Array<{ containerPort: string; hostIp: string; hostPort: string }>;
  cmd: string[];
  env: Array<{ key: string; value: string }>;
  labels: Record<string, string>;
  mounts: Array<{ type: string; source: string; destination: string; rw: boolean }>;
  restartPolicy: string;
  memoryLimitBytes: number;
  nanoCpus: number;
  mem?: string;
  memLimit?: string;
  memPercent?: string;
  cpu?: string;
  pids?: string;
  netIo?: string;
  chain: NodeChain | null;
  reference: { name: string; daa: number; blocks: number; headers: number; sink: string } | null;
  inSync: boolean | null;
  behind: number | null;
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

export type InspectTab = "details" | "peers" | "env" | "logs";

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
  /** selected pod opened in center view */
  selectedNode: string | null;
  inspect: NodeInspectDetail | null;
  inspectLoading: boolean;
  inspectError: string | null;
  inspectLogs: string;
  inspectTab: InspectTab;
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
  selectedNode: null,
  inspect: null,
  inspectLoading: false,
  inspectError: null,
  inspectLogs: "",
  inspectTab: "details",
  set: (p) => set(p)
}));

/** How far a node has got along the reference node's chain, 0..1 (headers first, then blocks count as the same units). */
export function progressOf(node: ClusterNode, reference: ClusterNode | undefined): number | null {
  if (!node.chain || !reference?.chain) return null;
  const target = Math.max(reference.chain.blocks, reference.chain.headers, 1);
  const have = Math.max(node.chain.blocks, node.chain.headers);
  return Math.min(1, have / target);
}
