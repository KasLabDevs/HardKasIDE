import { create } from "zustand";

/** SilverScript contracts: ABI of compiled contracts, deployed instances, spends. */

export interface SilParam {
  name: string;
  kind: string; // sig | pubkey | bytes | int | bool | …
}

export interface SilEntry {
  name: string;
  dispatchTag?: string;
  params: SilParam[];
}

export interface SilContractAbi {
  name: string;
  entries: SilEntry[];
  address?: string;
  lockingScript?: string;
}

export interface CompiledRecord {
  recordPath: string; // workspace-relative
  contentHash: string;
  sourcePath?: string;
  networkId?: string;
  contracts: SilContractAbi[];
}

export interface DeployRecord {
  recordPath: string; // workspace-relative
  contentHash: string;
  contract: string;
  address: string;
  txId: string;
  outpoint: { transactionId: string; index: number };
  valueSompi: string;
  feeSompi?: string;
  status: string;
  networkId?: string;
  createdAt?: string;
  compileRecordPath?: string;
  /** Filled when the compile record could be read: entries to call. */
  abi?: SilContractAbi;
  /** Set once a spend confirmed it is gone. */
  spent?: boolean;
}

export interface SpendRecord {
  recordPath: string;
  txId: string;
  contract: string;
  entry: string;
  to: string;
  outputSompi: string;
  feeSompi?: string;
  status: string;
  createdAt?: string;
  deployContentHash?: string;
}

interface SilverState {
  compiled: CompiledRecord | null;
  deployments: DeployRecord[];
  spends: SpendRecord[];
  busy: string | null;
  error: string | null;
  setCompiled(c: CompiledRecord | null): void;
  setDeployments(d: DeployRecord[]): void;
  upsertDeployment(d: DeployRecord): void;
  addSpend(s: SpendRecord): void;
  setBusy(b: string | null): void;
  setError(e: string | null): void;
}

export const useSilver = create<SilverState>((set) => ({
  compiled: null,
  deployments: [],
  spends: [],
  busy: null,
  error: null,
  setCompiled: (compiled) => set({ compiled }),
  setDeployments: (deployments) => set({ deployments }),
  upsertDeployment: (d) =>
    set((s) => ({
      deployments: s.deployments.some((x) => x.contentHash === d.contentHash)
        ? s.deployments.map((x) => (x.contentHash === d.contentHash ? { ...x, ...d } : x))
        : [d, ...s.deployments]
    })),
  addSpend: (sp) => set((s) => ({ spends: [sp, ...s.spends] })),
  setBusy: (busy) => set({ busy }),
  setError: (error) => set({ error })
}));

/** Parses the silverc artifact JSON (string or object) stored in a compile record into ABIs. */
export function parseSilArtifact(artifactJson: unknown, contracts?: Array<{ name: string; address?: string; lockingScript?: { script?: string } }>): SilContractAbi[] {
  let obj: Record<string, unknown> | null = null;
  try {
    obj = typeof artifactJson === "string" ? (JSON.parse(artifactJson) as Record<string, unknown>) : (artifactJson as Record<string, unknown>);
  } catch {
    obj = null;
  }
  const out: SilContractAbi[] = [];
  const cs = (obj?.contracts ?? {}) as Record<string, { entries?: Record<string, { dispatch_tag?: string; params?: Array<{ name: string; type?: { kind?: string } }> }> }>;
  for (const [name, c] of Object.entries(cs)) {
    const entries: SilEntry[] = Object.entries(c.entries ?? {}).map(([en, e]) => ({
      name: en,
      dispatchTag: e.dispatch_tag,
      params: (e.params ?? []).map((p) => ({ name: p.name, kind: p.type?.kind ?? "bytes" }))
    }));
    const meta = contracts?.find((x) => x.name === name);
    out.push({ name, entries, address: meta?.address, lockingScript: meta?.lockingScript?.script });
  }
  // Fallback: compile record "contracts" list with entries as a name → tag map, no params.
  if (out.length === 0 && contracts) {
    for (const c of contracts) {
      const raw = (c as { entries?: Record<string, string> | unknown[] }).entries;
      const entries: SilEntry[] = Array.isArray(raw)
        ? raw.map((e) => ({ name: typeof e === "string" ? e : String((e as { name?: string }).name ?? ""), params: [] }))
        : Object.keys(raw ?? {}).map((n) => ({ name: n, dispatchTag: (raw as Record<string, string>)[n], params: [] }));
      out.push({ name: c.name, entries, address: c.address, lockingScript: c.lockingScript?.script });
    }
  }
  return out;
}
