import { create } from "zustand";

/** Environment view state: node status and accounts (Eclipse "Servers" view equivalent). */

export interface NodeStatus {
  profile: string;
  status: string;
  running: boolean;
  rpcReady: boolean;
  containerName?: string;
  image?: string;
  network?: string;
  rpcUrl?: string;
  ports?: { rpc?: number; borshRpc?: number; jsonRpc?: number };
  serverVersion?: string;
  isSynced?: boolean;
  virtualDaaScore?: string;
  miner?: { running: boolean; status: string };
  lastError?: string | null;
  checkedAt?: string;
  raw: unknown;
}

export interface AccountInfo {
  name: string;
  kind: string;
  address: string;
  /** Balance in sompi for the network last queried, or null while unknown. */
  balanceSompi: string | null;
  utxoCount: number | null;
  balanceNetwork: string | null;
  /** Whether a private key is exportable/copyable (plaintext dev key or simnet dev keystore). */
  hasPlainKey: boolean;
  keystore: "plain" | "encrypted" | "synthetic" | "dev-keystore" | "unknown";
}

/** One visible stage of a node operation (stop, wipe, start, wait for RPC, load accounts…). */
export interface NodeOpStep {
  label: string;
  status: "pending" | "running" | "done" | "error";
  detail?: string;
}

/**
 * A node operation in progress or just finished. While `state` is "running" the Accounts, Servers and
 * Deploy & Run views show a loading state instead of stale balances and enabled buttons.
 */
export interface NodeOp {
  kind: "start" | "stop" | "restart" | "reset";
  title: string;
  steps: NodeOpStep[];
  state: "running" | "done" | "error";
  startedAt: number;
  error?: string;
  /** Shown when finished: what the user can do next. */
  next?: string;
}

export interface DockerStatus {
  installed: boolean;
  running: boolean;
  clientVersion: string | null;
  serverVersion: string | null;
  error: string | null;
}

interface EnvState {
  node: NodeStatus | null;
  docker: DockerStatus | null;
  setDocker(d: DockerStatus | null): void;
  nodeBusy: string | null;
  nodeOp: NodeOp | null;
  setNodeOp(op: NodeOp | null): void;
  /** Immutable patch of one step (and optionally the whole op). */
  patchNodeOp(stepIndex: number | null, step?: Partial<NodeOpStep>, op?: Partial<NodeOp>): void;
  accounts: AccountInfo[];
  accountsBusy: boolean;
  lastRefresh: string | null;
  error: string | null;
  setNode(node: NodeStatus | null): void;
  setNodeBusy(b: string | null): void;
  setAccounts(a: AccountInfo[]): void;
  patchAccount(name: string, patch: Partial<AccountInfo>): void;
  setAccountsBusy(b: boolean): void;
  setError(e: string | null): void;
  touch(): void;
}

export const useEnv = create<EnvState>((set) => ({
  node: null,
  docker: null,
  setDocker: (docker) => set({ docker }),
  nodeBusy: null,
  accounts: [],
  accountsBusy: false,
  lastRefresh: null,
  error: null,
  setNode: (node) => set({ node }),
  setNodeBusy: (nodeBusy) => set({ nodeBusy }),
  nodeOp: null,
  setNodeOp: (nodeOp) => set({ nodeOp }),
  patchNodeOp: (stepIndex, step, op) =>
    set((s) => {
      if (!s.nodeOp) return s;
      const steps = stepIndex === null || !step ? s.nodeOp.steps : s.nodeOp.steps.map((st, i) => (i === stepIndex ? { ...st, ...step } : st));
      return { nodeOp: { ...s.nodeOp, ...(op ?? {}), steps } };
    }),
  setAccounts: (accounts) => set({ accounts }),
  patchAccount: (name, patch) => set((s) => ({ accounts: s.accounts.map((a) => (a.name === name ? { ...a, ...patch } : a)) })),
  setAccountsBusy: (accountsBusy) => set({ accountsBusy }),
  setError: (error) => set({ error }),
  touch: () => set({ lastRefresh: new Date().toISOString() })
}));

export function formatKas(sompi: string | null): string {
  if (sompi === null) return "…";
  const trimmed = sompi.trim();
  if (/^-?\d+$/.test(trimmed)) {
    try {
      const raw = BigInt(trimmed);
      const neg = raw < 0n ? "-" : "";
      const abs = raw < 0n ? -raw : raw;
      const whole = abs / 100_000_000n;
      const frac = abs % 100_000_000n;
      const wholeStr = whole.toLocaleString();
      if (frac === 0n) return `${neg}${wholeStr} KAS`;
      const fracStr = frac.toString().padStart(8, "0").replace(/0+$/, "");
      return `${neg}${wholeStr}.${fracStr} KAS`;
    } catch {
      // fall through
    }
  }
  const n = Number(sompi);
  if (!Number.isFinite(n)) return sompi;
  return (n / 1e8).toLocaleString(undefined, { maximumFractionDigits: 8 }) + " KAS";
}
