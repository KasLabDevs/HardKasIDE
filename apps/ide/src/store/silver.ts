import { create } from "zustand";
import { parseSilOutline } from "@/utils/silParser";

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
  constructorParams?: SilParam[];
  stateFields?: SilParam[];
  covenantPolicies?: Record<string, string>;
  stateValues?: Record<string, string>;
  stateMapDefault?: Record<string, number>;
}

export interface CompiledRecord {
  recordPath: string; // workspace-relative
  contentHash: string;
  sourcePath?: string;
  networkId?: string;
  createdAt?: string;
  hardkasVersion?: string;
  constructorArgsSha256?: string;
  contracts: SilContractAbi[];
}

export interface CovenantRecord {
  recordPath: string;
  contentHash: string;
  kind: "genesis" | "transition";
  contract: string;
  policy?: string;
  entry?: string;
  covenantId: string;
  covenantIdFromNode?: string;
  address: string;
  lockingScript?: string;
  txId: string;
  outpoint: { transactionId: string; index: number };
  valueSompi: string;
  feeSompi?: string;
  computeBudget?: number;
  status: string;
  confirmedAtBlockDaaScore?: string;
  networkId?: string;
  createdAt?: string;
  compileRecordPath?: string;
  compileContentHash?: string;
  previousPath?: string;
  previousContentHash?: string;
  previousOutpoint?: { transactionId: string; index: number };
  hardkasVersion?: string;
  /** Resolved ABI + decoded state from the referenced compileRecord. */
  abi?: SilContractAbi;
  /** True when a successor transition record consumed this record's outpoint. */
  superseded?: boolean;
}

export interface SilCheckState {
  file: string;
  ok: boolean;
  errorText?: string;
  checkedAt: number;
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
  /** CLI that wrote the record (`hardkasVersion`). */
  hardkasVersion?: string;
  /** Filled when the compile record could be read: entries to call. */
  abi?: SilContractAbi;
  /** Set once a spend record consumed its outpoint. */
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
  /** The deploy output this spend consumed. */
  spentOutpoint?: { transactionId: string; index: number };
  hardkasVersion?: string;
}

/** A record file the IDE could not read as expected: shown once in the Console, never silently dropped. */
export interface RecordProblem {
  recordPath: string;
  problems: string[];
}

interface SilverState {
  compiled: CompiledRecord | null;
  deployments: DeployRecord[];
  spends: SpendRecord[];
  covenants: CovenantRecord[];
  checksByFile: Record<string, SilCheckState>;
  /** Record files under .hardkas/artifacts/silver that did not parse cleanly (unknown schema, missing fields). */
  recordProblems: RecordProblem[];
  busy: string | null;
  error: string | null;
  setCompiled(c: CompiledRecord | null): void;
  setDeployments(d: DeployRecord[]): void;
  upsertDeployment(d: DeployRecord): void;
  addSpend(s: SpendRecord): void;
  setCovenants(c: CovenantRecord[]): void;
  upsertCovenant(c: CovenantRecord): void;
  setCheckResult(c: SilCheckState): void;
  setBusy(b: string | null): void;
  setError(e: string | null): void;
}

export const useSilver = create<SilverState>((set) => ({
  compiled: null,
  deployments: [],
  spends: [],
  covenants: [],
  checksByFile: {},
  recordProblems: [],
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
  setCovenants: (covenants) => set({ covenants }),
  upsertCovenant: (c) =>
    set((s) => {
      const prevTx = c.previousOutpoint?.transactionId;
      const prevIdx = c.previousOutpoint?.index;
      const marked =
        prevTx !== undefined && prevIdx !== undefined
          ? s.covenants.map((x) =>
              x.outpoint.transactionId === prevTx && x.outpoint.index === prevIdx ? { ...x, superseded: true } : x
            )
          : s.covenants;
      const next = marked.some((x) => x.contentHash === c.contentHash)
        ? marked.map((x) => (x.contentHash === c.contentHash ? { ...x, ...c } : x))
        : [c, ...marked];
      return { covenants: next };
    }),
  setCheckResult: (c) =>
    set((s) => ({
      checksByFile: { ...s.checksByFile, [c.file]: c }
    })),
  setBusy: (busy) => set({ busy }),
  setError: (error) => set({ error })
}));

function decodeSignedLeInt(bytes: number[]): string {
  if (bytes.length === 0) return "0";
  if (bytes.length === 8) {
    let val = 0n;
    for (let i = 7; i >= 0; i--) {
      val = (val << 8n) | BigInt(bytes[i] & 0xff);
    }
    return BigInt.asIntN(64, val).toString();
  }
  const last = bytes[bytes.length - 1];
  const negative = (last & 0x80) !== 0;
  let mag = BigInt(last & 0x7f);
  for (let i = bytes.length - 2; i >= 0; i--) {
    mag = (mag << 8n) | BigInt(bytes[i] & 0xff);
  }
  return (negative ? -mag : mag).toString();
}

function decodeStateSpanValues(
  bytecode: number[] | undefined,
  span: { offset?: number; len?: number } | undefined,
  stateFields: SilParam[]
): Record<string, string> | undefined {
  if (!bytecode || !span || typeof span.offset !== "number" || typeof span.len !== "number" || stateFields.length === 0) {
    return undefined;
  }
  const start = span.offset;
  const end = Math.min(bytecode.length, start + span.len);
  if (start < 0 || start >= end) return undefined;

  let pos = start;
  const out: Record<string, string> = {};
  for (const field of stateFields) {
    if (pos >= end) break;
    const op = bytecode[pos++] & 0xff;
    let data: number[] = [];
    let smallNum: number | null = null;
    if (op === 0) {
      smallNum = 0;
    } else if (op >= 1 && op <= 75) {
      data = bytecode.slice(pos, Math.min(end, pos + op));
      pos += op;
    } else if (op === 76 && pos < end) {
      const len = bytecode[pos++] & 0xff;
      data = bytecode.slice(pos, Math.min(end, pos + len));
      pos += len;
    } else if (op === 77 && pos + 1 < end) {
      const len = (bytecode[pos] & 0xff) | ((bytecode[pos + 1] & 0xff) << 8);
      pos += 2;
      data = bytecode.slice(pos, Math.min(end, pos + len));
      pos += len;
    } else if (op === 79) {
      smallNum = -1;
    } else if (op >= 81 && op <= 96) {
      smallNum = op - 80;
    }

    const kind = field.kind.toLowerCase();
    if (kind === "int") {
      out[field.name] = smallNum !== null ? String(smallNum) : decodeSignedLeInt(data);
    } else if (kind === "bool") {
      out[field.name] = smallNum !== null ? String(smallNum !== 0) : String(data.some((b) => b !== 0));
    } else if (kind === "byte") {
      out[field.name] = smallNum !== null ? String(smallNum) : String(data[0] ?? 0);
    } else {
      out[field.name] = data.map((b) => b.toString(16).padStart(2, "0")).join("");
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function inferStateMap(
  stateFieldsDecl: Array<{ name: string; initialExpr?: string }> | undefined,
  constructorParams: SilParam[] | undefined
): Record<string, number> | undefined {
  if (!stateFieldsDecl?.length || !constructorParams?.length) return undefined;
  const map: Record<string, number> = {};
  for (const field of stateFieldsDecl) {
    if (!field.initialExpr) continue;
    const idx = constructorParams.findIndex((p) => p.name === field.initialExpr);
    if (idx >= 0) map[field.name] = idx;
  }
  return Object.keys(map).length > 0 ? map : undefined;
}

/** Parses the silverc artifact JSON (string or object) stored in a compile record into ABIs. */
export function parseSilArtifact(
  artifactJson: unknown,
  contracts?: Array<{ name: string; address?: string; lockingScript?: { script?: string }; covenantPolicies?: Record<string, string> }>,
  sourceText?: string
): SilContractAbi[] {
  let obj: Record<string, unknown> | null = null;
  try {
    obj = typeof artifactJson === "string" ? (JSON.parse(artifactJson) as Record<string, unknown>) : (artifactJson as Record<string, unknown>);
  } catch {
    obj = null;
  }
  const outline = sourceText ? parseSilOutline(sourceText) : null;
  const out: SilContractAbi[] = [];
  const cs = (obj?.contracts ?? {}) as Record<
    string,
    {
      runtime_state?: { fields?: Array<{ name: string; type?: { kind?: string } }> };
      cov_decl_to_abi?: Record<string, string>;
      compiled?: { bytecode?: number[]; state_span?: { offset?: number; len?: number } };
      entries?: Record<string, { dispatch_tag?: string; params?: Array<{ name: string; type?: { kind?: string } }> }>;
    }
  >;
  for (const [name, c] of Object.entries(cs)) {
    const entries: SilEntry[] = Object.entries(c.entries ?? {}).map(([en, e]) => ({
      name: en,
      dispatchTag: e.dispatch_tag,
      params: (e.params ?? []).map((p) => ({ name: p.name, kind: p.type?.kind ?? "bytes" }))
    }));
    const meta = contracts?.find((x) => x.name === name);
    const cDecl = outline?.contracts.find((x) => x.name === name);
    const constructorParams: SilParam[] | undefined = cDecl?.params.map((p) => ({ name: p.name, kind: p.type }));
    const stateFieldsList: SilParam[] | undefined = c.runtime_state?.fields?.map((f) => ({
      name: f.name,
      kind: f.type?.kind ?? "int"
    }));
    const covenantPolicies =
      c.cov_decl_to_abi && Object.keys(c.cov_decl_to_abi).length > 0
        ? c.cov_decl_to_abi
        : meta?.covenantPolicies && Object.keys(meta.covenantPolicies).length > 0
          ? meta.covenantPolicies
          : undefined;
    const stateValues = stateFieldsList ? decodeStateSpanValues(c.compiled?.bytecode, c.compiled?.state_span, stateFieldsList) : undefined;
    const stateMapDefault = inferStateMap(cDecl?.stateFields, constructorParams);

    out.push({
      name,
      entries,
      address: meta?.address,
      lockingScript: meta?.lockingScript?.script,
      constructorParams,
      ...(stateFieldsList?.length ? { stateFields: stateFieldsList } : {}),
      ...(covenantPolicies ? { covenantPolicies } : {}),
      ...(stateValues ? { stateValues } : {}),
      ...(stateMapDefault ? { stateMapDefault } : {})
    });
  }
  // Fallback: compile record "contracts" list with entries as a name → tag map, no params.
  if (out.length === 0 && contracts) {
    for (const c of contracts) {
      const raw = (c as { entries?: Record<string, string> | unknown[] }).entries;
      const entries: SilEntry[] = Array.isArray(raw)
        ? raw.map((e) => ({ name: typeof e === "string" ? e : String((e as { name?: string }).name ?? ""), params: [] }))
        : Object.keys(raw ?? {}).map((n) => ({ name: n, dispatchTag: (raw as Record<string, string>)[n], params: [] }));
      const cDecl = outline?.contracts.find((x) => x.name === c.name);
      const constructorParams: SilParam[] | undefined = cDecl?.params.map((p) => ({ name: p.name, kind: p.type }));
      const covenantPolicies = c.covenantPolicies && Object.keys(c.covenantPolicies).length > 0 ? c.covenantPolicies : undefined;
      out.push({
        name: c.name,
        entries,
        address: c.address,
        lockingScript: c.lockingScript?.script,
        constructorParams,
        ...(covenantPolicies ? { covenantPolicies } : {})
      });
    }
  }
  return out;
}
