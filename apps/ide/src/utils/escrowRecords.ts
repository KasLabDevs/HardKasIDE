import { parseJsonRecord, type Parsed } from "./silverRecords";

/**
 * Reader for the escrow records `hardkas escrow` writes under .hardkas/escrows/<id>.json (schema
 * hardkas.escrow.record.v1) and for the `escrow` object its commands print with --json (the same record
 * without the compiled artifact).
 *
 * Same contract as silverRecords: the schema is checked, what could not be read is reported as `problems`,
 * and a field the record does not have stays undefined; nothing is invented. Every number shown in the IDE
 * comes from here or from a command's answer.
 */

export const ESCROW_RECORD_SCHEMA = "hardkas.escrow.record.v1";
const ESCROW_SCHEMA_RE = /^hardkas\.escrow\.record\.v(\d+)$/;
const ESCROW_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The states `sdk.escrow` records, in the order of the lifecycle. */
export const ESCROW_STATES = ["CREATED", "FUNDED", "PARTIALLY_SIGNED", "READY_TO_RELEASE", "RELEASED"] as const;
export type EscrowState = (typeof ESCROW_STATES)[number];

export type EscrowRole = "buyer" | "seller" | "arbiter";
export const ESCROW_ROLES: ReadonlyArray<EscrowRole> = ["buyer", "seller", "arbiter"];

export interface EscrowRecordView {
  /** Workspace-relative path of the record file; absent for a record read from a command's answer. */
  recordPath?: string;
  id: string;
  /** The record's own state word: one of ESCROW_STATES, or whatever a newer CLI wrote. */
  state: string;
  /** EscrowFull or EscrowSplit (provenance.contractName). */
  contract?: string;
  mode?: "full" | "split";
  address: string;
  lockingScriptHex?: string;
  networkId?: string;
  createdAt?: string;
  updatedAt?: string;
  hardkasVersion?: string;
  /** EscrowFull: the principal every branch pays (sompi, decimal text). */
  principalSompi?: string;
  /** EscrowSplit: the two allocations (sompi). */
  buyerAmountSompi?: string;
  sellerAmountSompi?: string;
  feeBudgetSompi?: string;
  /** 32-byte x-only keys (hex) by role, as the record has them. */
  parties: Partial<Record<EscrowRole, string>>;
  funding: {
    status: string;
    transactionId?: string;
    outputIndex?: number;
    amountSompi?: string;
    feeSompi?: string;
  };
  preparedRelease?: {
    branch: string;
    mutualSplit?: { buyerSompi: string; sellerSompi: string };
  };
  /** The roles whose signature the record holds. */
  signatures: EscrowRole[];
  release?: {
    transactionId: string;
    status: string;
    feeSompi?: string;
  };
}

const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
const asObject = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
/** sompi as the records write them: a decimal string; a number is accepted and written back as text. */
const sompi = (v: unknown): string | undefined => (typeof v === "string" && /^\d+$/.test(v) ? v : typeof v === "number" && Number.isInteger(v) ? String(v) : undefined);

/** Schema problems of a raw escrow record; empty when it is a version this IDE understands. */
export function escrowSchemaProblems(raw: Record<string, unknown>): string[] {
  if (raw.schema === undefined) return ["no schema field: not a HardKas escrow record, or one the dev server's journal wrote"];
  const m = typeof raw.schema === "string" ? ESCROW_SCHEMA_RE.exec(raw.schema) : null;
  if (!m) return [`schema ${String(raw.schema)} is not an escrow record`];
  if (Number(m[1]) > 1) return [`schema ${String(raw.schema)} is newer than this IDE understands (v1); some fields may be missing`];
  return [];
}

/**
 * An escrow record, from its file or from the `escrow` object of a command's answer. The record is null when
 * the fields every step needs (id, state, address, config, funding) are not there.
 */
export function parseEscrowRecord(recordPath: string | undefined, raw: Record<string, unknown>): Parsed<EscrowRecordView> {
  const problems = escrowSchemaProblems(raw);
  const config = asObject(raw.config);
  const p2sh = asObject(raw.p2shState);
  const funding = asObject(raw.funding);
  const provenance = asObject(raw.provenance);

  const missing: string[] = [];
  if (typeof raw.id !== "string" || !ESCROW_ID_RE.test(raw.id)) missing.push("id");
  if (typeof raw.state !== "string") missing.push("state");
  if (typeof p2sh?.address !== "string") missing.push("p2shState.address");
  if (!config) missing.push("config");
  if (typeof funding?.status !== "string") missing.push("funding.status");
  if (missing.length > 0) {
    problems.push(`missing ${missing.join(", ")}`);
    return { record: null, problems };
  }
  const state = raw.state as string;
  if (!(ESCROW_STATES as ReadonlyArray<string>).includes(state)) problems.push(`state ${state} is not one this IDE knows`);

  const party = (role: EscrowRole) => str(asObject(config![role])?.publicKeyHex);
  const parties: Partial<Record<EscrowRole, string>> = {};
  for (const role of ESCROW_ROLES) {
    const key = party(role);
    if (key) parties[role] = key;
    else problems.push(`missing config.${role}.publicKeyHex`);
  }

  const modeField = config!.mode;
  const mode = modeField === "full" || modeField === "split" ? modeField : modeField === undefined ? (config!.principal !== undefined ? "full" : config!.buyerAmount !== undefined ? "split" : undefined) : undefined;
  if (modeField !== undefined && mode === undefined) problems.push(`config.mode ${String(modeField)} is neither full nor split`);

  const signatures = asObject(raw.signatures) ?? {};
  const prepared = asObject(raw.preparedRelease);
  const split = asObject(prepared?.mutualSplit);
  const release = asObject(raw.release);
  const releaseView =
    release && typeof release.transactionId === "string" && typeof release.status === "string"
      ? { transactionId: release.transactionId, status: release.status, feeSompi: sompi(release.feeSompi) }
      : undefined;
  if (release && !releaseView) problems.push("release lacks transactionId or status");

  return {
    record: {
      recordPath,
      id: raw.id as string,
      state,
      contract: str(provenance?.contractName),
      mode,
      address: p2sh!.address as string,
      lockingScriptHex: str(p2sh!.lockingScriptHex),
      networkId: str(raw.networkId),
      createdAt: str(raw.createdAt),
      updatedAt: str(raw.updatedAt),
      hardkasVersion: str(provenance?.hardkasVersion),
      principalSompi: sompi(config!.principal),
      buyerAmountSompi: sompi(config!.buyerAmount),
      sellerAmountSompi: sompi(config!.sellerAmount),
      feeBudgetSompi: sompi(config!.feeBudgetSompi),
      parties,
      funding: {
        status: funding!.status as string,
        transactionId: str(funding!.transactionId),
        outputIndex: typeof funding!.outputIndex === "number" ? funding!.outputIndex : undefined,
        amountSompi: sompi(funding!.amountSompi),
        feeSompi: sompi(funding!.feeSompi)
      },
      preparedRelease:
        prepared && typeof prepared.branch === "string"
          ? {
              branch: prepared.branch,
              mutualSplit: split && sompi(split.buyerSompi) && sompi(split.sellerSompi) ? { buyerSompi: sompi(split.buyerSompi)!, sellerSompi: sompi(split.sellerSompi)! } : undefined
            }
          : undefined,
      signatures: ESCROW_ROLES.filter((r) => typeof signatures[r] === "string"),
      release: releaseView
    },
    problems
  };
}

/** The `escrow` object of a command's JSON answer (`{ ok: true, escrow }`), read as a record; null when there is none. */
export function escrowFromAnswer(result: unknown): Parsed<EscrowRecordView> | null {
  const r = asObject(result);
  const escrow = asObject(r?.escrow);
  if (!escrow) return null;
  return parseEscrowRecord(undefined, escrow);
}

/** Reads one record file's text into a view, with the problems of the JSON and of the record. */
export function readEscrowRecordText(recordPath: string, text: string): Parsed<EscrowRecordView> {
  const { raw, problem } = parseJsonRecord(text);
  if (!raw) return { record: null, problems: [problem ?? "not a JSON object"] };
  return parseEscrowRecord(recordPath, raw);
}

/**
 * The next step of the lifecycle for a record, in the words the CLI itself uses in its "Next:" hints. Derived from
 * the record's state and the status of its funding and release; nothing else.
 */
export function escrowNextStep(r: EscrowRecordView): string {
  if (r.state === "CREATED") {
    if (r.funding.status === "verification_timeout") return "The funding was sent and its outcome is not known: reconcile before funding again.";
    if (r.funding.status === "broadcast") return "The funding is in the mempool: mine a burst, then reconcile to record it as FUNDED.";
    return "Fund it from the buyer's account (principal + fee budget).";
  }
  if (r.state === "FUNDED") {
    // sdk.escrow records FUNDED as soon as the node took the funding; a release is sent only once a chain block has it.
    if (r.funding.status === "verification_timeout") return "The funding was sent and its outcome is not known: reconcile before anything else.";
    if (r.funding.status === "broadcast") return "The funding is in the mempool: mine a burst, then reconcile (a release is sent only once a chain block accepted the funding). You can prepare and sign meanwhile.";
    return "Prepare the release of one branch.";
  }
  if (r.state === "PARTIALLY_SIGNED") {
    if (r.signatures.length === 0) return `${r.preparedRelease?.branch ?? "The release"} is prepared: each required role signs it.`;
    return `Signed by ${r.signatures.join(", ")}: the remaining required role signs next.`;
  }
  if (r.state === "READY_TO_RELEASE") {
    if (r.release?.status === "broadcast") return "The release is in the mempool: mine a burst, then reconcile to record it as RELEASED.";
    if (r.release?.status === "verification_timeout") return "The release was sent and its outcome is not known: reconcile before anything else.";
    return "Every required role signed: release it.";
  }
  if (r.state === "RELEASED") return r.release?.status === "confirmed" ? "Released: a chain block accepted the release." : "Released.";
  return "";
}

/** Newest first by createdAt; records without a date go last. */
export function newestEscrowsFirst(list: EscrowRecordView[]): EscrowRecordView[] {
  return [...list].sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
}
