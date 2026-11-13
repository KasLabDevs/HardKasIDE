import { parseSilArtifact, type CovenantRecord, type DeployRecord, type SilContractAbi, type SpendRecord } from "@/store/silver";

/**
 * Readers for the records the HardKas CLI writes under .hardkas/artifacts/silver:
 *
 *   silverCompile-<hash>.json   schema hardkas.silverCompile.v1
 *   silverDeploy-<hash>.json    schema hardkas.silverDeploy.v1
 *   silverSpend-<hash>.json     schema hardkas.silverSpend.v1
 *   silverCovenant-<hash>.json  schema hardkas.silverCovenant.v1
 *
 * The IDE is tested against one CLI version; a newer CLI may rename or add fields. Every reader
 * checks the `schema` field and reports what it could not read as `problems`, instead of silently
 * producing a record full of empty strings. Callers show the problems once and keep going with
 * whatever did parse.
 */

/** The record schemas this IDE understands (family → major version). */
export const SUPPORTED_SCHEMAS = {
  silverCompile: 1,
  silverDeploy: 1,
  silverSpend: 1,
  silverCovenant: 1
} as const;

export type RecordFamily = keyof typeof SUPPORTED_SCHEMAS;

export interface Parsed<T> {
  /** Null when the file is not a record of the expected family or lacks the fields the IDE needs. */
  record: T | null;
  /** Human-readable reasons, empty when everything was understood. */
  problems: string[];
}

/** Parses "hardkas.silverDeploy.v1" into its family and major version. */
export function parseSchema(schema: unknown): { family: string; major: number } | null {
  if (typeof schema !== "string") return null;
  const m = /^hardkas\.([A-Za-z]+)\.v(\d+)$/.exec(schema);
  return m ? { family: m[1], major: Number(m[2]) } : null;
}

/** Schema problems of a record that should belong to `family`; empty when it matches a version the IDE knows. */
export function schemaProblems(raw: Record<string, unknown>, family: RecordFamily): string[] {
  const s = parseSchema(raw.schema);
  if (!s) return [raw.schema === undefined ? "no schema field: not a HardKas record, or an older CLI" : `unknown schema ${String(raw.schema)}`];
  if (s.family !== family) return [`schema ${String(raw.schema)} is not a ${family} record`];
  const supported = SUPPORTED_SCHEMAS[family];
  if (s.major > supported) return [`schema ${String(raw.schema)} is newer than this IDE understands (v${supported}); some fields may be missing`];
  return [];
}

const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
const asObject = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

function outpointOf(v: unknown): { transactionId: string; index: number } | null {
  const o = asObject(v);
  if (!o || typeof o.transactionId !== "string") return null;
  const index = Number(o.index);
  return Number.isInteger(index) ? { transactionId: o.transactionId, index } : null;
}

/** Reads a JSON document into an object, or returns null (and a problem) when it is not one. */
export function parseJsonRecord(text: string): { raw: Record<string, unknown> | null; problem: string | null } {
  try {
    const raw = asObject(JSON.parse(text));
    return raw ? { raw, problem: null } : { raw: null, problem: "not a JSON object" };
  } catch (e) {
    return { raw: null, problem: `invalid JSON: ${e instanceof Error ? e.message : String(e)}` };
  }
}

export interface CompileRecordView {
  recordPath: string;
  contentHash: string;
  sourcePath?: string;
  networkId?: string;
  createdAt?: string;
  hardkasVersion?: string;
  constructorArgsSha256?: string;
  contracts: SilContractAbi[];
}

/** A compile record: the ABIs of its contracts (from silverc's artifact JSON) and where the source was. */
export function parseCompileRecord(recordPath: string, raw: Record<string, unknown>): Parsed<CompileRecordView> {
  const problems = schemaProblems(raw, "silverCompile");
  const source = asObject(raw.source);
  const provenance = asObject(raw.provenance);
  const contracts = parseSilArtifact(
    raw.artifactJson,
    raw.contracts as Array<{ name: string; address?: string; lockingScript?: { script?: string }; covenantPolicies?: Record<string, string> }> | undefined,
    str(source?.text)
  );
  if (contracts.length === 0) problems.push("no contracts found in artifactJson or contracts[]");
  if (typeof raw.contentHash !== "string") problems.push("missing contentHash");
  return {
    record: {
      recordPath,
      contentHash: str(raw.contentHash) ?? "",
      sourcePath: str(source?.path),
      networkId: str(raw.networkId),
      createdAt: str(raw.createdAt),
      hardkasVersion: str(raw.hardkasVersion),
      constructorArgsSha256: str(provenance?.constructorArgsSha256),
      contracts
    },
    problems
  };
}

/**
 * A deploy record. `abi` is attached by the caller once the compile record it points at is read;
 * `spent` is filled by `markSpent`.
 */
export function parseDeployRecord(recordPath: string, raw: Record<string, unknown>): Parsed<DeployRecord> {
  const problems = schemaProblems(raw, "silverDeploy");
  const missing = (["contract", "address", "txId", "contentHash"] as const).filter((k) => typeof raw[k] !== "string");
  if (missing.length > 0) problems.push(`missing ${missing.join(", ")}`);
  const outpoint = outpointOf(raw.outpoint);
  if (!outpoint) problems.push("missing outpoint {transactionId, index}");
  if (missing.length > 0 || !outpoint) return { record: null, problems };

  const compileRecord = asObject(raw.compileRecord);
  return {
    record: {
      recordPath,
      contentHash: raw.contentHash as string,
      contract: raw.contract as string,
      address: raw.address as string,
      txId: raw.txId as string,
      outpoint,
      valueSompi: str(raw.valueSompi) ?? "0",
      feeSompi: str(raw.feeSompi),
      status: str(raw.status) ?? "unknown",
      networkId: str(raw.networkId),
      createdAt: str(raw.createdAt),
      compileRecordPath: str(compileRecord?.path),
      hardkasVersion: str(raw.hardkasVersion),
      spent: false
    },
    problems
  };
}

/** A spend record: which deploy it consumed (`spentOutpoint`) and what it paid out. */
export function parseSpendRecord(recordPath: string, raw: Record<string, unknown>): Parsed<SpendRecord> {
  const problems = schemaProblems(raw, "silverSpend");
  const missing = (["txId", "contract", "entry"] as const).filter((k) => typeof raw[k] !== "string");
  if (missing.length > 0) {
    problems.push(`missing ${missing.join(", ")}`);
    return { record: null, problems };
  }
  const spentOutpoint = outpointOf(raw.spentOutpoint);
  if (!spentOutpoint) problems.push("missing spentOutpoint: the deploy it consumed cannot be marked spent");
  const deployRecord = asObject(raw.deployRecord);
  return {
    record: {
      recordPath,
      txId: raw.txId as string,
      contract: raw.contract as string,
      entry: raw.entry as string,
      to: str(raw.to) ?? "",
      outputSompi: str(raw.outputSompi) ?? "0",
      feeSompi: str(raw.feeSompi),
      status: str(raw.status) ?? "unknown",
      createdAt: str(raw.createdAt),
      deployContentHash: str(deployRecord?.contentHash),
      spentOutpoint: spentOutpoint ?? undefined,
      hardkasVersion: str(raw.hardkasVersion)
    },
    problems
  };
}

/** A Toccata Covenant v1 record (`genesis` or `transition`). */
export function parseCovenantRecord(recordPath: string, raw: Record<string, unknown>): Parsed<CovenantRecord> {
  const problems = schemaProblems(raw, "silverCovenant");
  const missing = (["contract", "covenantId", "address", "txId", "contentHash"] as const).filter((k) => typeof raw[k] !== "string");
  if (missing.length > 0) problems.push(`missing ${missing.join(", ")}`);
  const outpoint = outpointOf(raw.outpoint);
  if (!outpoint) problems.push("missing outpoint {transactionId, index}");
  if (missing.length > 0 || !outpoint) return { record: null, problems };

  const compileRecord = asObject(raw.compileRecord);
  const previous = asObject(raw.previous);
  const locking = asObject(raw.lockingScript);
  const kind = raw.kind === "transition" ? "transition" : "genesis";
  return {
    record: {
      recordPath,
      contentHash: raw.contentHash as string,
      kind,
      contract: raw.contract as string,
      policy: str(raw.policy),
      entry: str(raw.entry),
      covenantId: raw.covenantId as string,
      covenantIdFromNode: str(raw.covenantIdFromNode),
      address: raw.address as string,
      lockingScript: str(locking?.script),
      txId: raw.txId as string,
      outpoint,
      valueSompi: str(raw.valueSompi) ?? "0",
      feeSompi: str(raw.feeSompi),
      computeBudget: typeof raw.computeBudget === "number" ? raw.computeBudget : undefined,
      status: str(raw.status) ?? "unknown",
      confirmedAtBlockDaaScore: str(raw.confirmedAtBlockDaaScore),
      networkId: str(raw.networkId),
      createdAt: str(raw.createdAt),
      compileRecordPath: str(compileRecord?.path),
      compileContentHash: str(compileRecord?.contentHash),
      previousPath: str(previous?.path),
      previousContentHash: str(previous?.contentHash),
      previousOutpoint: outpointOf(previous?.outpoint) ?? undefined,
      hardkasVersion: str(raw.hardkasVersion),
      superseded: false
    },
    problems
  };
}

/** Marks covenant records whose outpoint or contentHash was consumed by a later transition. */
export function markSupersededCovenants(records: CovenantRecord[]): CovenantRecord[] {
  const consumedOutpoints = new Set(
    records.filter((r) => r.previousOutpoint).map((r) => `${r.previousOutpoint!.transactionId}:${r.previousOutpoint!.index}`)
  );
  const consumedHashes = new Set(records.map((r) => r.previousContentHash).filter((h): h is string => Boolean(h)));
  return records.map((r) => ({
    ...r,
    superseded:
      consumedOutpoints.has(`${r.outpoint.transactionId}:${r.outpoint.index}`) || consumedHashes.has(r.contentHash)
  }));
}

export interface CovenantChainGroup {
  covenantId: string;
  head: CovenantRecord;
  history: CovenantRecord[]; // chronological genesis -> transitions
}

/** Groups covenant records by covenantId with active head first and chronological history. */
export function groupCovenantChains(records: CovenantRecord[]): CovenantChainGroup[] {
  const byId = new Map<string, CovenantRecord[]>();
  for (const r of records) {
    const list = byId.get(r.covenantId) ?? [];
    list.push(r);
    byId.set(r.covenantId, list);
  }
  const groups: CovenantChainGroup[] = [];
  for (const [covenantId, items] of byId.entries()) {
    const chrono = [...items].sort((a, b) => (a.createdAt ?? "").localeCompare(b.createdAt ?? ""));
    const active = items.find((x) => !x.superseded);
    const head = active ?? chrono[chrono.length - 1];
    groups.push({ covenantId, head, history: chrono });
  }
  return groups.sort((a, b) => (b.head.createdAt ?? "").localeCompare(a.head.createdAt ?? ""));
}

/** Marks every deploy whose outpoint a spend record consumed. */
export function markSpent(deploys: DeployRecord[], spends: SpendRecord[]): DeployRecord[] {
  const spent = new Set(spends.filter((s) => s.spentOutpoint).map((s) => `${s.spentOutpoint!.transactionId}:${s.spentOutpoint!.index}`));
  return deploys.map((d) => ({ ...d, spent: spent.has(`${d.outpoint.transactionId}:${d.outpoint.index}`) }));
}

/** Newest first by createdAt; records without a date go last. */
export function newestFirst<T extends { createdAt?: string }>(list: T[]): T[] {
  return [...list].sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
}
