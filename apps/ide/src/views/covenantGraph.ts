import type { Edge, Node } from "@xyflow/react";
import { formatKas } from "@/store/env";
import type { CompiledRecord, DeployRecord, SilContractAbi, SpendRecord } from "@/store/silver";

/**
 * The data side of the Covenant graph, kept apart from React so it can be tested against record
 * fixtures: which contracts can be drawn, which deploys and spends belong to each, how the nodes
 * are laid out, and how the records compare with what the node actually holds.
 */

// ---------------------------------------------------------------- subjects

/** One contract the graph can show, with the compile record it comes from. */
export interface Subject {
  key: string;
  contract: SilContractAbi;
  recordPath: string;
  contentHash: string;
  sourcePath?: string;
  networkId?: string;
  /** Known only through a deploy record (no compile in this session). */
  fromDeploy: boolean;
}

/**
 * The contracts of the last compile in this session, plus every contract that has a deploy record in the
 * workspace (its ABI comes from the compile record the deploy points at).
 */
export function selectSubjects(compiled: CompiledRecord | null, deployments: DeployRecord[]): Subject[] {
  const list: Subject[] = (compiled?.contracts ?? []).map((c) => ({
    key: `c:${c.name}`,
    contract: c,
    recordPath: compiled!.recordPath,
    contentHash: compiled!.contentHash,
    sourcePath: compiled!.sourcePath,
    networkId: compiled!.networkId,
    fromDeploy: false
  }));
  for (const d of deployments) {
    if (!d.abi || !d.compileRecordPath) continue;
    if (list.some((s) => s.contract.name === d.contract && s.recordPath === d.compileRecordPath)) continue;
    list.push({ key: `d:${d.contract}:${d.compileRecordPath}`, contract: d.abi, recordPath: d.compileRecordPath, contentHash: "", networkId: d.networkId, fromDeploy: true });
  }
  return list;
}

/**
 * Deploys made from the subject's compile record; for a contract compiled in this session and never deployed
 * from that record, earlier deploys of a contract with the same name.
 */
export function deploysFor(subject: Subject, deployments: DeployRecord[]): DeployRecord[] {
  const own = deployments.filter((d) => d.contract === subject.contract.name && d.compileRecordPath === subject.recordPath);
  return own.length > 0 || subject.fromDeploy ? own : deployments.filter((d) => d.contract === subject.contract.name);
}

/** Spends of the contract that consumed one of `deploys` (or name an unknown deploy, for older records). */
export function spendsFor(contract: SilContractAbi, deploys: DeployRecord[], spends: SpendRecord[]): SpendRecord[] {
  const hashes = new Set(deploys.map((d) => d.contentHash));
  return spends.filter((s) => s.contract === contract.name && (!s.deployContentHash || hashes.has(s.deployContentHash)));
}

// ---------------------------------------------------------------- chain reconciliation

/** One UTXO the node holds at the covenant address (`hardkas rpc utxos`). */
export interface ChainUtxo {
  txId: string;
  index: number;
  amountSompi: string;
  daa: number;
}

export interface ChainCheck {
  address: string;
  checkedAt: number;
  utxos: ChainUtxo[];
}

/** Records against the chain: which deploy outputs still exist, which are gone, and what the records never saw. */
export interface Reconciled {
  address: string;
  checkedAt: number;
  /** recordPath of every deploy whose output the node still holds. */
  unspent: Set<string>;
  /** recordPath of every deploy whose output is gone (spent, with or without a spend record). */
  spent: Set<string>;
  /** Outputs at the address that no deploy record describes (a deploy the CLI did not write a record for). */
  unrecorded: ChainUtxo[];
}

/** Reads the `hardkas rpc utxos --json` result into ChainUtxo rows. */
export function parseUtxos(result: unknown): ChainUtxo[] | null {
  const r = result as { utxos?: unknown } | null;
  if (!r || !Array.isArray(r.utxos)) return null;
  return r.utxos.map((u) => {
    const row = (u ?? {}) as Record<string, unknown>;
    const o = (row.outpoint ?? {}) as { transactionId?: string; index?: number };
    return { txId: String(o.transactionId ?? ""), index: Number(o.index ?? 0), amountSompi: String(row.amountSompi ?? "0"), daa: Number(row.blockDaaScore ?? 0) };
  });
}

export function reconcile(deploys: DeployRecord[], check: ChainCheck): Reconciled {
  const onChain = new Set(check.utxos.map((u) => `${u.txId}:${u.index}`));
  const recorded = new Set<string>();
  const unspent = new Set<string>();
  const spent = new Set<string>();
  for (const d of deploys) {
    if (d.address !== check.address) continue;
    const key = `${d.outpoint.transactionId}:${d.outpoint.index}`;
    recorded.add(key);
    (onChain.has(key) ? unspent : spent).add(d.recordPath);
  }
  return { address: check.address, checkedAt: check.checkedAt, unspent, spent, unrecorded: check.utxos.filter((u) => !recorded.has(`${u.txId}:${u.index}`)) };
}

/** What a deploy looks like once the chain has been asked; falls back to the records alone. */
export type DeployState = "live" | "spent" | "spent on chain" | "on chain" | string;

export function deployState(d: DeployRecord, chain: Reconciled | null): DeployState {
  if (chain && d.address === chain.address) {
    if (chain.spent.has(d.recordPath)) return d.spent ? "spent" : "spent on chain";
    if (chain.unspent.has(d.recordPath)) return "on chain";
  }
  if (d.spent) return "spent";
  return accepted(d.status) ? "live" : d.status || "?";
}

export const accepted = (status: string): boolean => /accepted|confirmed|submitted/i.test(status) && !/reject/i.test(status);

// ---------------------------------------------------------------- layout

export type DeployNodeData = { deploy: DeployRecord; state: DeployState; selected: boolean; [key: string]: unknown };
export type CovenantNodeData = {
  contract: SilContractAbi;
  address: string | null;
  deployCount: number;
  liveCount: number;
  /** Whether liveCount comes from the node (true) or from the records alone. */
  fromChain: boolean;
  selected: boolean;
  [key: string]: unknown;
};
export type EntryNodeData = { contractName: string; entry: SilContractAbi["entries"][number]; spendCount: number; selected: boolean; [key: string]: unknown };
export type SpendNodeData = { spend: SpendRecord; selected: boolean; [key: string]: unknown };
export type UnrecordedNodeData = { utxos: ChainUtxo[]; address: string; selected: boolean; [key: string]: unknown };

export type GraphNode =
  | Node<DeployNodeData, "deploy">
  | Node<CovenantNodeData, "covenant">
  | Node<EntryNodeData, "entry">
  | Node<SpendNodeData, "spend">
  | Node<UnrecordedNodeData, "unrecorded">;

export const COL = { deploy: 40, covenant: 380, entry: 720, spend: 1060 };
export const GAP = 170;

export function buildGraph(contract: SilContractAbi, deploys: DeployRecord[], spends: SpendRecord[], selectedId: string | null, chain: Reconciled | null = null): { nodes: GraphNode[]; edges: Edge[] } {
  const nodes: GraphNode[] = [];
  const edges: Edge[] = [];
  const sel = (id: string) => id === selectedId;

  const address = deploys[0]?.address ?? contract.address ?? null;
  const chainHere = chain && chain.address === address ? chain : null;
  const unrecorded = chainHere?.unrecorded ?? [];
  const leftCount = deploys.length + (unrecorded.length > 0 ? 1 : 0);

  // Entries, each followed by its spends, set the height of the right side.
  const perEntry = contract.entries.map((entry) => ({ entry, spends: spends.filter((s) => s.entry === entry.name) }));
  let y = 40;
  const entryRows = perEntry.map(({ entry, spends: es }) => {
    const top = y;
    y += Math.max(1, es.length) * GAP;
    return { entry, spends: es, top };
  });
  const rightHeight = Math.max(y - 40, GAP);
  const leftHeight = Math.max(leftCount, 1) * GAP;
  const height = Math.max(rightHeight, leftHeight);
  const centerY = 40 + height / 2 - GAP / 2;

  const liveCount = chainHere ? chainHere.unspent.size : deploys.filter((d) => !d.spent).length;
  nodes.push({
    id: "covenant",
    type: "covenant",
    position: { x: COL.covenant, y: centerY },
    data: { contract, address, deployCount: deploys.length, liveCount, fromChain: chainHere !== null, selected: sel("covenant") }
  });

  const leftTop = 40 + (height - leftCount * GAP) / 2;
  deploys.forEach((d, i) => {
    const id = `deploy:${d.recordPath}`;
    const state = deployState(d, chainHere);
    const gone = state === "spent" || state === "spent on chain";
    nodes.push({ id, type: "deploy", position: { x: COL.deploy, y: leftTop + i * GAP }, data: { deploy: d, state, selected: sel(id) } });
    edges.push({ id: `e:${id}`, source: id, target: "covenant", animated: !gone, label: formatKas(d.valueSompi), style: { stroke: "var(--info)", strokeWidth: 2, opacity: gone ? 0.5 : 1 } });
  });
  if (unrecorded.length > 0 && address) {
    const id = "unrecorded";
    nodes.push({ id, type: "unrecorded", position: { x: COL.deploy, y: leftTop + deploys.length * GAP }, data: { utxos: unrecorded, address, selected: sel(id) } });
    edges.push({ id: `e:${id}`, source: id, target: "covenant", animated: true, label: formatKas(sumSompi(unrecorded)), style: { stroke: "var(--warn)", strokeWidth: 2, strokeDasharray: "6 4" } });
  }

  entryRows.forEach(({ entry, spends: es, top }) => {
    const id = `entry:${entry.name}`;
    nodes.push({ id, type: "entry", position: { x: COL.entry, y: top }, data: { contractName: contract.name, entry, spendCount: es.length, selected: sel(id) } });
    edges.push({ id: `e:${id}`, source: "covenant", target: id, animated: false, style: { stroke: "var(--accent)", strokeWidth: 2 } });
    es.forEach((s, j) => {
      const sid = `spend:${s.recordPath}`;
      nodes.push({ id: sid, type: "spend", position: { x: COL.spend, y: top + j * GAP }, data: { spend: s, selected: sel(sid) } });
      edges.push({ id: `e:${sid}`, source: id, target: sid, animated: false, label: accepted(s.status) ? "accepted" : s.status, style: { stroke: "var(--ok)", strokeWidth: 2 } });
    });
  });

  return { nodes, edges };
}

export function sumSompi(utxos: Array<{ amountSompi: string }>): string {
  let total = 0n;
  for (const u of utxos) {
    try {
      total += BigInt(u.amountSompi);
    } catch {
      // not a number: skip
    }
  }
  return total.toString();
}
