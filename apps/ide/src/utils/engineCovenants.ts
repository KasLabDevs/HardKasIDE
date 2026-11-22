import { parseJsonRecord, type Parsed } from "./silverRecords";

/**
 * Readers for the records HardKAS's v1 engine writes when `hardkas silver covenant start | advance` and
 * `hardkas kcc20 deploy | transfer` run (HardKAS 0.13). Unlike `genesis` and `transition`, those commands write no
 * `silverCovenant` record: a covenant made by them lives in the engine's own artifacts under `.hardkas/artifacts/`:
 *
 *   plans/txPlan-<hash>.json             schema hardkas.txPlan, txVersion 1   (what was planned: inputs, outputs, states)
 *   signed/signedTx-<hash>.json          schema hardkas.signedTx, txVersion 1 (the transaction itself, its txId)
 *   receipts/txSubmission-<hash>.json    schema hardkas.txSubmission.v1       (what the node answered)
 *
 * This file follows a covenant through those records the way HardKAS's own `sdk.covenants.lineage` does (a plan's
 * covenant inputs and bound outputs, linked by outpoints), with the tolerance of `silverRecords.ts`: every reader
 * checks the schema, reports what it could not read as `problems` and keeps going with what it could. What it does
 * NOT do: recompute the genesis covenant id, or ask the node. The tip it gives is "what this workspace recorded and
 * nothing recorded spends"; `hardkas silver covenant inspect <id>` is the check against the node.
 */

/** The record schemas of the v1 engine this IDE understands. These two carry no version suffix; the submission does. */
export const ENGINE_SCHEMAS = {
  plan: "hardkas.txPlan",
  signed: "hardkas.signedTx",
  submission: "hardkas.txSubmission.v1"
} as const;

const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isInteger(v) ? v : undefined);
const asObject = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const asArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const hex64 = (v: unknown): string | undefined => (typeof v === "string" && /^[0-9a-fA-F]{64}$/.test(v) ? v.toLowerCase() : undefined);

/** A field's declared value in a v1 plan: `{ kind, value }` as the engine writes it. */
export type DeclaredState = Record<string, unknown>;

/** The contract a plan names: its compile record (path when the workspace has it), contract and constructor args. */
export interface EngineContractRef {
  compileRecordPath?: string;
  compileContentHash?: string;
  artifactSha256?: string;
  contract: string;
  constructorArgs: unknown[];
}

export interface EnginePlanInput {
  outpoint: string; // "txid:index"
  covenantId?: string;
  kind?: string;
  entry?: string;
  computeBudget?: number;
  address?: string;
  amountSompi: string;
}

export interface EnginePlanOutput {
  index: number;
  address: string;
  amountSompi: string;
  /** The covenant this output is bound to, when the plan binds it. */
  covenantId?: string;
  /** The state the plan declared for it (a genesis group's or a next state's), when one was declared. */
  declaredState?: DeclaredState;
  /** The contract that holds that state. */
  contract?: EngineContractRef;
  role?: string;
}

export interface EnginePlanRecord {
  recordPath: string;
  contentHash: string;
  planId?: string;
  createdAt?: string;
  networkId?: string;
  hardkasVersion?: string;
  estimatedFeeSompi?: string;
  inputs: EnginePlanInput[];
  outputs: EnginePlanOutput[];
  /** The covenant ids this plan creates (genesis groups) or continues (next states). */
  covenantIds: string[];
}

export interface EngineSignedRecord {
  recordPath: string;
  contentHash: string;
  txId: string;
  /** The plan it was signed from (`lineage.parentArtifactId`, the plan's contentHash). */
  planContentHash?: string;
  createdAt?: string;
  /** The transaction's inputs' previous outpoints, in input order ("txid:index"). */
  spends: string[];
  /** For each output: the covenant id the signed transaction binds it to, or undefined. */
  outputCovenantIds: Array<string | undefined>;
  outputAmounts: string[];
}

export interface EngineSubmissionRecord {
  recordPath: string;
  txId: string;
  outcome: "accepted" | "rejected" | "unknown";
  createdAt?: string;
}

function schemaProblem(raw: Record<string, unknown>, expected: string): string[] {
  const s = raw.schema;
  if (typeof s !== "string") return [s === undefined ? "no schema field: not a HardKas record, or an older CLI" : `unknown schema ${String(s)}`];
  if (s === expected) return [];
  // "hardkas.txSubmission.v2" against ".v1": newer than this IDE knows
  const base = expected.replace(/\.v\d+$/, "");
  if (s.startsWith(`${base}.v`)) return [`schema ${s} is newer than this IDE understands (${expected}); some fields may be missing`];
  return [`schema ${s} is not a ${expected} record`];
}

function outpointKey(v: unknown): string | undefined {
  const o = asObject(v);
  const tx = str(o?.transactionId);
  const index = Number(o?.index);
  return tx && Number.isInteger(index) ? `${tx.toLowerCase()}:${index}` : undefined;
}

function contractRefOf(v: unknown): EngineContractRef | undefined {
  const c = asObject(v);
  if (!c) return undefined;
  const cr = asObject(c.compileRecord);
  const contract = str(c.contract);
  if (!contract) return undefined;
  return {
    compileRecordPath: str(cr?.path)?.replace(/\\/g, "/"),
    compileContentHash: str(cr?.contentHash),
    artifactSha256: str(cr?.artifactSha256),
    contract,
    constructorArgs: asArray(c.constructorArgs)
  };
}

/** A v1 engine plan: its inputs (which covenant each spends), its outputs (which covenant each is bound to, the state declared). */
export function parseEnginePlan(recordPath: string, raw: Record<string, unknown>): Parsed<EnginePlanRecord> {
  const problems = schemaProblem(raw, ENGINE_SCHEMAS.plan);
  if (problems.length > 0 && !String(raw.schema ?? "").startsWith(ENGINE_SCHEMAS.plan)) return { record: null, problems };
  if (raw.txVersion !== 1) return { record: null, problems: [...problems, `txVersion ${String(raw.txVersion ?? 0)}: not a v1 engine plan (a payment)`] };
  const contentHash = str(raw.contentHash);
  if (!contentHash) return { record: null, problems: [...problems, "missing contentHash"] };

  const inputs: EnginePlanInput[] = [];
  asArray(raw.inputs).forEach((v, n) => {
    const i = asObject(v);
    const outpoint = outpointKey(i?.outpoint);
    if (!i || !outpoint) {
      problems.push(`inputs[${n}]: missing outpoint {transactionId, index}`);
      return;
    }
    const contract = asObject(i.contract);
    inputs.push({
      outpoint,
      covenantId: hex64(i.covenantId),
      kind: str(i.kind),
      entry: str(contract?.entry),
      computeBudget: num(i.computeBudget),
      address: str(i.address),
      amountSompi: str(i.amountSompi) ?? "0"
    });
  });

  // Where each output's covenant id and declared state come from: the genesis groups (a start / deploy) and the next
  // states (an advance / transfer), both lists of output indexes.
  const bound = new Map<number, { covenantId?: string; state?: DeclaredState; contract?: EngineContractRef }>();
  for (const v of asArray(raw.genesisCovenantGroups)) {
    const g = asObject(v);
    if (!g) continue;
    const contract = contractRefOf(g.contract);
    const states = asArray(g.states);
    asArray(g.outputs).forEach((k, j) => {
      if (typeof k !== "number") return;
      const state = asObject(states[j]) ?? undefined;
      bound.set(k, { covenantId: hex64(g.covenantId), state, contract });
    });
  }
  for (const v of asArray(raw.nextState)) {
    const n = asObject(v);
    if (!n) continue;
    const covenantId = hex64(n.covenantId);
    const inputIdx = num(n.input);
    const contract = inputIdx !== undefined ? contractRefOf(asObject(asArray(raw.inputs)[inputIdx])?.contract) : undefined;
    const states = asArray(n.states);
    const successorState = asObject(asObject(n.successor)?.state) ?? undefined;
    asArray(n.outputs).forEach((k, j) => {
      if (typeof k !== "number") return;
      bound.set(k, { covenantId, state: asObject(states[j]) ?? successorState, contract });
    });
  }

  const outputs: EnginePlanOutput[] = [];
  asArray(raw.outputs).forEach((v, k) => {
    const o = asObject(v);
    const address = str(o?.address);
    if (!o || !address) {
      problems.push(`outputs[${k}]: missing address`);
      return;
    }
    const cov = asObject(o.covenant);
    const b = bound.get(k);
    const covenantId = hex64(cov?.covenantId) ?? b?.covenantId;
    outputs.push({
      index: k,
      address,
      amountSompi: str(o.amountSompi) ?? "0",
      ...(covenantId ? { covenantId } : {}),
      ...(b?.state ? { declaredState: b.state } : {}),
      ...(b?.contract ? { contract: b.contract } : {}),
      ...(str(o.role) ? { role: str(o.role) } : {})
    });
  });

  const covenantIds = [...new Set([...outputs.map((o) => o.covenantId), ...inputs.map((i) => i.covenantId)].filter((x): x is string => !!x))];
  return {
    record: {
      recordPath,
      contentHash,
      planId: str(raw.planId),
      createdAt: str(raw.createdAt),
      networkId: str(raw.networkId),
      hardkasVersion: str(raw.hardkasVersion),
      estimatedFeeSompi: str(raw.estimatedFeeSompi),
      inputs,
      outputs,
      covenantIds
    },
    problems
  };
}

/** A v1 signed transaction: its txId, the plan it came from, what it spends and which covenant each output is bound to. */
export function parseEngineSigned(recordPath: string, raw: Record<string, unknown>): Parsed<EngineSignedRecord> {
  const problems = schemaProblem(raw, ENGINE_SCHEMAS.signed);
  if (problems.length > 0 && !String(raw.schema ?? "").startsWith(ENGINE_SCHEMAS.signed)) return { record: null, problems };
  if (raw.txVersion !== 1) return { record: null, problems: [...problems, `txVersion ${String(raw.txVersion ?? 0)}: not a v1 engine transaction (a payment)`] };
  const contentHash = str(raw.contentHash);
  const txId = hex64(raw.txId);
  if (!contentHash || !txId) return { record: null, problems: [...problems, `missing ${[!contentHash && "contentHash", !txId && "txId"].filter(Boolean).join(", ")}`] };

  const payloadText = str(asObject(raw.signedTransaction)?.payload);
  let tx: Record<string, unknown> | null = null;
  if (payloadText) {
    const parsed = parseJsonRecord(payloadText);
    tx = parsed.raw;
    if (parsed.problem) problems.push(`signedTransaction.payload: ${parsed.problem}`);
  } else problems.push("missing signedTransaction.payload: the transaction's inputs and outputs are unknown");

  const spends: string[] = [];
  asArray(tx?.inputs).forEach((v, n) => {
    const k = outpointKey(asObject(v)?.previousOutpoint);
    if (k) spends.push(k);
    else problems.push(`signedTransaction inputs[${n}]: missing previousOutpoint`);
  });
  const outs = asArray(tx?.outputs).map((v) => asObject(v));
  return {
    record: {
      recordPath,
      contentHash,
      txId,
      planContentHash: str(asObject(raw.lineage)?.parentArtifactId),
      createdAt: str(raw.createdAt),
      spends,
      outputCovenantIds: outs.map((o) => hex64(asObject(o?.covenant)?.covenantId)),
      outputAmounts: outs.map((o) => (o?.amount === undefined ? "0" : String(o.amount)))
    },
    problems
  };
}

/** What the node answered to a submission: accepted, rejected (final), or unknown (the node may hold it). */
export function parseEngineSubmission(recordPath: string, raw: Record<string, unknown>): Parsed<EngineSubmissionRecord> {
  const problems = schemaProblem(raw, ENGINE_SCHEMAS.submission);
  if (problems.length > 0 && !String(raw.schema ?? "").startsWith("hardkas.txSubmission")) return { record: null, problems };
  const txId = hex64(raw.txId);
  if (!txId) return { record: null, problems: [...problems, "missing txId"] };
  const r = asObject(raw.submitResult);
  const outcome: EngineSubmissionRecord["outcome"] = r?.accepted === true ? "accepted" : r?.accepted === false || r?.error !== undefined ? "rejected" : "unknown";
  if (!r) problems.push("missing submitResult: the node's answer is unknown");
  return { record: { recordPath, txId, outcome, createdAt: str(raw.createdAt) }, problems };
}

// ----- following a covenant through the records -------------------------------------------------------------------

export interface EngineCovenantOutput {
  outpoint: string;
  index: number;
  address: string;
  amountSompi: string;
  declaredState?: DeclaredState;
  contract?: EngineContractRef;
}

export interface EngineCovenantTx {
  txId: string;
  kind: "genesis" | "transition";
  /** The covenant's own outpoints it spends (leader first, as the transaction orders them). */
  spends: string[];
  /** Its outputs bound to the covenant. */
  outputs: EngineCovenantOutput[];
  /** Outputs not bound to the covenant (payments out of it, change). */
  payments: Array<{ outpoint: string; address: string; amountSompi: string }>;
  /** The node's recorded answer, or "not-submitted" when no submission record names the transaction. */
  recorded: "accepted" | "rejected" | "unknown" | "not-submitted";
  feeSompi?: string;
  createdAt?: string;
  planPath: string;
  signedPath: string;
  entries: string[];
}

export interface EngineCovenantChain {
  covenantId: string;
  contract?: EngineContractRef;
  /** Genesis first, then the transitions in the order they spend each other's outputs. */
  transactions: EngineCovenantTx[];
  /** Transactions the node rejected (final): history, not part of the chain. */
  rejected: EngineCovenantTx[];
  /** Signed but never submitted: not part of the chain. */
  unsent: EngineCovenantTx[];
  /** Outputs of the chain that no recorded transaction spends: where the covenant should live, by these records. */
  tip: Array<EngineCovenantOutput & { createdBy: string }>;
  /** Gaps and conflicts in the records, in words. */
  findings: string[];
  createdAt?: string;
  lastAt?: string;
}

/**
 * Groups the engine's records into covenant chains. Pure. Each signed transaction needs its plan (for the states and
 * the covenant each input belongs to); a signed transaction whose plan is missing is reported as a finding.
 */
export function groupEngineCovenants(plans: EnginePlanRecord[], signed: EngineSignedRecord[], submissions: EngineSubmissionRecord[]): EngineCovenantChain[] {
  const planByHash = new Map(plans.map((p) => [p.contentHash, p]));
  const outcomes = new Map<string, Set<EngineSubmissionRecord["outcome"]>>();
  for (const s of submissions) outcomes.set(s.txId, new Set([...(outcomes.get(s.txId) ?? []), s.outcome]));
  const recordedOf = (txId: string): EngineCovenantTx["recorded"] => {
    const set = outcomes.get(txId);
    if (!set) return "not-submitted";
    return set.has("accepted") ? "accepted" : set.has("unknown") ? "unknown" : "rejected";
  };

  const byCovenant = new Map<string, { txs: Map<string, EngineCovenantTx>; findings: string[] }>();
  const bucket = (id: string) => {
    let b = byCovenant.get(id);
    if (!b) byCovenant.set(id, (b = { txs: new Map(), findings: [] }));
    return b;
  };

  for (const s of signed) {
    const plan = s.planContentHash ? planByHash.get(s.planContentHash) : undefined;
    const ids = new Set<string>([...s.outputCovenantIds.filter((x): x is string => !!x), ...(plan?.covenantIds ?? [])]);
    if (ids.size === 0) continue; // a v1 transaction of no covenant (a plain contract spend)
    for (const id of ids) {
      const b = bucket(id);
      if (!plan) {
        b.findings.push(`${s.txId}: its plan (${s.planContentHash ?? "unknown"}) is not in this workspace's records: its states and inputs cannot be read`);
      }
      const spends = (plan?.inputs ?? []).map((i, n) => ({ i, n })).filter(({ i }) => i.covenantId === id).map(({ i, n }) => s.spends[n] ?? i.outpoint);
      const outputs: EngineCovenantOutput[] = [];
      const payments: EngineCovenantTx["payments"] = [];
      s.outputCovenantIds.forEach((cid, k) => {
        const po = plan?.outputs[k];
        const target = cid ?? po?.covenantId;
        const amount = po?.amountSompi ?? s.outputAmounts[k] ?? "0";
        if (target === id) {
          outputs.push({ outpoint: `${s.txId}:${k}`, index: k, address: po?.address ?? "", amountSompi: amount, ...(po?.declaredState ? { declaredState: po.declaredState } : {}), ...(po?.contract ? { contract: po.contract } : {}) });
        } else if (!target) payments.push({ outpoint: `${s.txId}:${k}`, address: po?.address ?? "", amountSompi: amount });
      });
      if (outputs.length === 0 && spends.length === 0) continue;
      b.txs.set(s.txId, {
        txId: s.txId,
        kind: spends.length === 0 ? "genesis" : "transition",
        spends,
        outputs,
        payments,
        recorded: recordedOf(s.txId),
        feeSompi: plan?.estimatedFeeSompi,
        createdAt: s.createdAt ?? plan?.createdAt,
        planPath: plan?.recordPath ?? "",
        signedPath: s.recordPath,
        entries: (plan?.inputs ?? []).filter((i) => i.covenantId === id && i.entry).map((i) => i.entry!)
      });
    }
  }

  const chains: EngineCovenantChain[] = [];
  for (const [covenantId, b] of byCovenant) {
    const all = [...b.txs.values()];
    const findings = [...b.findings];
    const rejected = all.filter((t) => t.recorded === "rejected");
    const unsent = all.filter((t) => t.recorded === "not-submitted");
    const live = all.filter((t) => t.recorded !== "rejected" && t.recorded !== "not-submitted");
    for (const t of live) if (t.recorded === "unknown") findings.push(`${t.kind} ${t.txId}: the outcome of its submission is unknown (the node may hold it)`);
    const geneses = live.filter((t) => t.kind === "genesis");
    if (geneses.length === 0) findings.push("no genesis of this covenant is recorded in this workspace");
    if (geneses.length > 1) findings.push(`${geneses.length} geneses are recorded for one covenant id`);

    const created = new Map<string, { tx: EngineCovenantTx; output: EngineCovenantOutput }>();
    for (const t of live) for (const o of t.outputs) created.set(o.outpoint, { tx: t, output: o });
    const spentBy = new Map<string, string[]>();
    for (const t of live) for (const s of t.spends) spentBy.set(s, [...(spentBy.get(s) ?? []), t.txId]);
    for (const [outpoint, spenders] of spentBy) {
      if (spenders.length > 1) findings.push(`${outpoint} is spent by ${spenders.length} recorded transactions (${spenders.join(", ")}): the consensus accepts at most one`);
    }

    // chain order: a transition after the transactions that created what it spends
    const ordered: EngineCovenantTx[] = [...geneses];
    const placed = new Set(geneses.map((g) => g.txId));
    const pending = live.filter((t) => t.kind === "transition");
    while (pending.length > 0) {
      const i = pending.findIndex((t) => t.spends.every((s) => !created.has(s) || placed.has(created.get(s)!.tx.txId)));
      const next = pending.splice(i >= 0 ? i : 0, 1)[0]!;
      for (const s of next.spends) if (!created.has(s)) findings.push(`transition ${next.txId} spends ${s}, which no recorded transaction of this covenant created (a gap in this workspace's records)`);
      ordered.push(next);
      placed.add(next.txId);
    }

    const tip = [...created.entries()].filter(([outpoint]) => !spentBy.has(outpoint)).map(([, v]) => ({ ...v.output, createdBy: v.tx.txId }));
    const contract = ordered.flatMap((t) => t.outputs).find((o) => o.contract)?.contract ?? geneses[0]?.outputs[0]?.contract;
    const dates = all.map((t) => t.createdAt).filter((d): d is string => !!d).sort();
    chains.push({ covenantId, contract, transactions: ordered, rejected, unsent, tip, findings, createdAt: dates[0], lastAt: dates[dates.length - 1] });
  }
  return chains.sort((a, b) => (b.lastAt ?? "").localeCompare(a.lastAt ?? ""));
}

/** `{ value: { kind: "int", value: 8 } }` → "value=8", for a one-line preview of a declared state. */
export function declaredStatePreview(state: DeclaredState | undefined): string {
  if (!state) return "";
  return Object.entries(state)
    .map(([k, v]) => {
      const o = asObject(v);
      const val = o && "value" in o ? o.value : v;
      const text = typeof val === "string" || typeof val === "number" || typeof val === "boolean" ? String(val) : Array.isArray(val) ? `${val.length} bytes` : JSON.stringify(val);
      return `${k}=${text}`;
    })
    .join(", ");
}
