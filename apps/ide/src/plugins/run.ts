import { Play } from "lucide-react";
import { api } from "@/api/client";
import { Plugin } from "@/engine/engine";
import { RunPanel } from "@/panels/RunPanel";
import type { ExecutionTarget } from "@/store/ide";
import type { TerminalPlugin } from "./terminal";

/**
 * Deploy & Run: the HardKas transaction lifecycle driven through the CLI.
 *
 *   tx plan  --from --to --amount --target   → plan artifact (saved by the CLI as
 *                                              .hardkas/artifacts/<ts>-plan-<planId>.plan.json)
 *   tx sign  <planPath> --account --target   → signed artifact
 *                                              (.hardkas/artifacts/signed/signedTx-<contentHash>.json)
 *   tx send  <signedPath> --target           → { ok, outcome, data: { receipt, signed, artifacts } }
 *
 * `tx sign` and `tx send` only accept file paths, so this plugin resolves them.
 */

export interface Account {
  name: string;
  kind: string;
  address: string;
}

export interface PlanOutcome {
  planId: string;
  planPath: string;
  artifactId: string;
  amountSompi: string;
  estimatedFeeSompi: string;
  raw: unknown;
}

export interface SignOutcome {
  signedId: string;
  signedPath: string;
  txId: string;
  raw: unknown;
}

/**
 * Normalised view of what `tx send` returns as `data.receipt`:
 * a `hardkas.txReceipt` in the simulator, a `hardkas.txSubmission.v1` on a real node.
 */
export interface Receipt {
  schema: string;
  txId: string;
  /** receipt.status, or "accepted"/"rejected" from a submission's submitResult */
  status: string;
  feeSompi?: string;
  mass?: string;
  networkId?: string;
  mode?: string;
  contentHash?: string;
  createdAt?: string;
  /** Node acceptance point (submissions only). */
  submitPoint?: { virtualDaaScore?: string; sinkBlueScore?: string };
}

export interface SendOutcome {
  ok: boolean;
  outcome: string;
  receipt: Receipt | null;
  receiptPath: string | null;
  raw: unknown;
}

export interface TxStatus {
  txId: string;
  network: string;
  state: string;
  confirmations?: { blue?: string; daa?: string; unit?: string };
  isFinal?: boolean;
  raw: unknown;
}

function normaliseReceipt(input: unknown): Receipt | null {
  if (!input || typeof input !== "object") return null;
  const r = input as Record<string, unknown>;
  const submit = r.submitResult as { accepted?: boolean; error?: string } | undefined;
  const fee = r.fee as { feeSompi?: string } | undefined;
  const status =
    typeof r.status === "string" ? r.status : submit ? (submit.accepted ? "accepted" : `rejected${submit.error ? ": " + submit.error : ""}`) : "unknown";
  return {
    schema: String(r.schema ?? ""),
    txId: String(r.txId ?? (submit as { transactionId?: string } | undefined)?.transactionId ?? ""),
    status,
    feeSompi: typeof r.feeSompi === "string" ? r.feeSompi : fee?.feeSompi,
    mass: typeof r.mass === "string" ? r.mass : undefined,
    networkId: typeof r.networkId === "string" ? r.networkId : undefined,
    mode: typeof r.mode === "string" ? r.mode : undefined,
    contentHash: typeof r.contentHash === "string" ? r.contentHash : undefined,
    createdAt: typeof r.createdAt === "string" ? r.createdAt : undefined,
    submitPoint: r.submitPoint as Receipt["submitPoint"]
  };
}

export class RunPlugin extends Plugin {
  view = RunPanel;

  constructor() {
    super({
      name: "deployRun",
      displayName: "Deploy & Run",
      location: "sidePanel",
      icon: Play,
      order: 30,
      methods: ["accounts", "plan", "sign", "send", "txStatus", "localnetStatus", "localnetFund"],
      events: ["transactionExecuted", "planned", "signed"]
    });
  }

  private terminal(): TerminalPlugin {
    return this.engine.get<TerminalPlugin>("terminal");
  }

  /** `--target` for config targets; the rpc option maps to a public test network. */
  private targetArgs(target: ExecutionTarget): string[] {
    return target === "rpc" ? ["--network", "testnet-10"] : ["--target", target];
  }

  async accounts(): Promise<Account[]> {
    const run = await this.terminal().runHardkas(["accounts", "list", "--json"], { quiet: true });
    return Array.isArray(run.result) ? (run.result as Account[]) : [];
  }

  async plan(input: { from: string; to: string; amount: string; target: ExecutionTarget }): Promise<PlanOutcome> {
    const run = await this.terminal().runHardkas(["tx", "plan", "--from", input.from, "--to", input.to, "--amount", input.amount, ...this.targetArgs(input.target), "--json"]);
    const raw = run.result as Record<string, unknown> | null;
    if (run.status !== "succeeded" || !raw || typeof raw.planId !== "string") {
      throw new Error(errorMessage(raw, "tx plan failed"));
    }
    const planId = raw.planId;
    // The CLI prints the plan before the artifact file is flushed; poll briefly for it.
    let matches: string[] = [];
    for (let attempt = 0; attempt < 10 && matches.length === 0; attempt++) {
      // planId already carries the "plan-" prefix: file is <ts>-plan-<hash>.plan.json
      matches = await api.fs.find(".hardkas/artifacts", `-${planId}.plan.json`);
      if (matches.length === 0) await new Promise((r) => setTimeout(r, 300));
    }
    if (matches.length === 0) throw new Error(`Plan ${planId} was created but its file was not found under .hardkas/artifacts`);
    const outcome: PlanOutcome = {
      planId,
      planPath: matches[0],
      artifactId: String((raw.lineage as { artifactId?: string } | undefined)?.artifactId ?? raw.contentHash ?? ""),
      amountSompi: String(raw.amountSompi ?? ""),
      estimatedFeeSompi: String(raw.estimatedFeeSompi ?? ""),
      raw
    };
    await this.call("fileManager", "refresh");
    this.emit("planned", outcome);
    return outcome;
  }

  async sign(planPath: string, account: string, target: ExecutionTarget): Promise<SignOutcome> {
    const run = await this.terminal().runHardkas(["tx", "sign", planPath, "--account", account, ...this.targetArgs(target), "--json"]);
    const raw = run.result as Record<string, unknown> | null;
    if (run.status !== "succeeded" || !raw || typeof raw.contentHash !== "string") {
      throw new Error(errorMessage(raw, "tx sign failed"));
    }
    const outcome: SignOutcome = {
      signedId: String(raw.signedId ?? ""),
      signedPath: `.hardkas/artifacts/signed/signedTx-${raw.contentHash}.json`,
      txId: String(raw.txId ?? ""),
      raw
    };
    await this.call("fileManager", "refresh");
    this.emit("signed", outcome);
    return outcome;
  }

  async send(signedPath: string, target: ExecutionTarget): Promise<SendOutcome> {
    const run = await this.terminal().runHardkas(["tx", "send", signedPath, ...this.targetArgs(target), "--json"]);
    const raw = run.result as Record<string, unknown> | null;
    if (run.status !== "succeeded" || !raw || raw.ok === false) {
      throw new Error(errorMessage(raw, "tx send failed"));
    }
    const data = (raw.data ?? {}) as { receipt?: unknown };
    const receipt = normaliseReceipt(data.receipt);
    // Artifact files are named <kind>-<contentHash>.json (receipts/, submissions/, …); find by hash.
    let receiptPath: string | null = null;
    if (receipt?.contentHash) {
      const found = await api.fs.find(".hardkas/artifacts", `-${receipt.contentHash}.json`);
      receiptPath = found[0] ?? null;
    }
    const outcome: SendOutcome = { ok: true, outcome: String(raw.outcome ?? ""), receipt, receiptPath, raw };
    await this.call("fileManager", "refresh");
    this.emit("transactionExecuted", outcome);
    return outcome;
  }

  /** `tx status <txId> --network <net>`: asks the node (or simulator) how the tx is doing. */
  async txStatus(txId: string, network: string): Promise<TxStatus> {
    const run = await this.terminal().runHardkas(["tx", "status", txId, "--network", network, "--json"]);
    const raw = run.result as Record<string, unknown> | null;
    if (run.status !== "succeeded" || !raw || raw.ok === false) throw new Error(errorMessage(raw, "tx status failed"));
    return {
      txId,
      network,
      state: String(raw.state ?? (raw.derived as { status?: string } | undefined)?.status ?? "unknown"),
      confirmations: raw.confirmations as TxStatus["confirmations"],
      isFinal: Boolean(raw.isFinal),
      raw
    };
  }

  async localnetStatus() {
    return this.terminal().runHardkas(["localnet", "status", "--json"], { quiet: true });
  }

  async localnetFund(account: string, amount: string) {
    return this.terminal().runHardkas(["localnet", "fund", account, "--amount", amount, "--json"]);
  }
}

function errorMessage(raw: Record<string, unknown> | null, fallback: string): string {
  if (raw && typeof raw.message === "string") return `${raw.code ? raw.code + ": " : ""}${raw.message}`;
  if (raw && typeof raw.code === "string") return raw.code;
  return fallback;
}
