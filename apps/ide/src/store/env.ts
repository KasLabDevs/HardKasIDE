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
  /** Whether a plaintext private key is available to copy (accounts.real.json). */
  hasPlainKey: boolean;
  keystore: "plain" | "encrypted" | "synthetic" | "unknown";
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
  setAccounts: (accounts) => set({ accounts }),
  patchAccount: (name, patch) => set((s) => ({ accounts: s.accounts.map((a) => (a.name === name ? { ...a, ...patch } : a)) })),
  setAccountsBusy: (accountsBusy) => set({ accountsBusy }),
  setError: (error) => set({ error }),
  touch: () => set({ lastRefresh: new Date().toISOString() })
}));

export function formatKas(sompi: string | null): string {
  if (sompi === null) return "…";
  const n = Number(sompi);
  if (!Number.isFinite(n)) return sompi;
  return (n / 1e8).toLocaleString(undefined, { maximumFractionDigits: 8 }) + " KAS";
}
