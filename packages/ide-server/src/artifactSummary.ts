/**
 * A short human reading of a HardKAS artifact, for the Lineage rows: what happened ("Deploy VaultGuard · 5 KAS"),
 * not which hash it has. Read from the artifact's own JSON; a field that is not there is left out, never guessed.
 * The IDE swaps account addresses for account names (alice, bob…) when it draws the row.
 */
export interface ArtifactSummary {
  /** What the artifact is, as an action: "Deploy", "Spend", "Payment plan", "Compile"… */
  verb: string;
  /** What it acts on: a contract, a source file, a transaction. */
  subject?: string;
  /** Sender and receiver as the artifact states them: an account name or an address. */
  from?: string;
  to?: string;
  /** Amount in KAS, decimal, exact (made from sompi without floating point). */
  kas?: string;
  /** Outcome or detail: "confirmed", "accepted by the chain · 1377 confirmations". */
  note?: string;
}

const rec = (v: unknown): Record<string, unknown> | undefined => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined);
const str = (v: unknown): string | undefined => (typeof v === "string" && v.length > 0 ? v : undefined);

/** Sompi (a number, bigint or digit string) as an exact KAS decimal: 500000000 → "5", 1 → "0.00000001". */
export function sompiToKas(v: unknown): string | undefined {
  let n: bigint;
  try {
    if (typeof v === "bigint") n = v;
    else if (typeof v === "number" && Number.isSafeInteger(v)) n = BigInt(v);
    else if (typeof v === "string" && /^\d+$/.test(v.trim())) n = BigInt(v.trim());
    else return undefined;
  } catch {
    return undefined;
  }
  if (n < 0n) return undefined;
  const whole = n / 100_000_000n;
  const frac = (n % 100_000_000n).toString().padStart(8, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : `${whole}`;
}

/** An account: the name it was given ("alice" in `from: { input: "alice" }`), else its address (or the string itself). */
function party(v: unknown): string | undefined {
  if (typeof v === "string") return str(v);
  const o = rec(v);
  return str(o?.accountName) ?? str(o?.name) ?? str(o?.input) ?? str(o?.address);
}

const base = (p: string): string => p.replace(/\\/g, "/").split("/").pop() ?? p;
/** The simulator names its transactions "synthetic-<hash>": the word says what it is, so it goes to a note. */
const isSynthetic = (id: string): boolean => id.startsWith("synthetic-");
const shortHash = (h: string): string => {
  const bare = h.replace(/^synthetic-/, "");
  return bare.length > 14 ? `${bare.slice(0, 10)}…` : bare;
};

export function summarizeArtifact(schema: string, json: unknown): ArtifactSummary | undefined {
  const j = rec(json);
  if (!j) return undefined;
  const kind = schema.replace(/^hardkas\./, "").replace(/\.v\d+$/, "");
  switch (kind) {
    case "silverCompile": {
      const names = Array.isArray(j.contracts) ? j.contracts.map((c) => str(rec(c)?.name)).filter((x): x is string => !!x) : [];
      const file = str(rec(j.source)?.path);
      return { verb: "Compile", subject: names.length ? names.join(", ") : file ? base(file) : undefined, note: file && names.length ? base(file) : undefined };
    }
    case "silverDeploy":
      return { verb: "Deploy", subject: str(j.contract), kas: sompiToKas(j.valueSompi), note: str(j.status) };
    case "silverSpend": {
      const contract = str(j.contract);
      const entry = str(j.entry);
      return { verb: "Spend", subject: contract && entry ? `${contract}.${entry}` : (contract ?? entry), to: party(j.to), kas: sompiToKas(j.outputSompi), note: str(j.status) };
    }
    case "txPlan":
    case "signedTx":
    case "txReceipt":
    case "txSubmission": {
      const verb = { txPlan: "Payment plan", signedTx: "Payment signed", txReceipt: "Payment receipt", txSubmission: "Payment sent" }[kind];
      const submit = rec(j.submitResult);
      const note = str(j.status) ?? (submit ? (submit.accepted === true ? "accepted" : submit.accepted === false ? "rejected" : undefined) : undefined);
      return { verb, from: party(j.from), to: party(j.to), kas: sompiToKas(j.amountSompi), note };
    }
    case "txObservation": {
      const txId = str(rec(j.subject)?.txId);
      const finding = rec(j.finding);
      const type = str(finding?.type)?.replace(/_/g, " ");
      const conf = str(finding?.confirmationsBlue);
      return { verb: "Node check", subject: txId ? shortHash(txId) : undefined, note: [type, conf ? `${conf} confirmations` : undefined].filter(Boolean).join(" · ") || undefined };
    }
    case "txTrace": {
      const txId = str(j.txId) ?? str(rec(j.subject)?.txId);
      return { verb: "Trace", subject: txId ? shortHash(txId) : undefined, note: txId && isSynthetic(txId) ? "simulated" : str(j.status) };
    }
    case "snapshot": {
      const accounts = Array.isArray(j.accounts) ? j.accounts.length : undefined;
      const utxos = Array.isArray(j.utxos) ? j.utxos.length : undefined;
      const parts = [accounts !== undefined ? `${accounts} accounts` : undefined, utxos !== undefined ? `${utxos} UTXOs` : undefined].filter(Boolean);
      return { verb: "State snapshot", note: parts.join(" · ") || undefined };
    }
    case "scenarioResult": {
      const name = str(j.scenarioName) ?? str(j.name) ?? str(rec(j.scenario)?.name);
      const status = str(j.status) ?? (typeof j.passed === "boolean" ? (j.passed ? "passed" : "failed") : undefined);
      const code = str(rec(j.error)?.code);
      // `hardkas task` writes these too, and says so in its metadata.
      const isTask = str(rec(j.metadata)?.kind) === "task";
      return { verb: isTask ? "Task" : "Scenario", subject: name, note: [status, code].filter(Boolean).join(" · ") || undefined };
    }
    case "replayReport":
      return { verb: "Replay check", note: str(j.status) };
    default:
      return undefined;
  }
}
