import { api } from "@/api/client";
import { Plugin } from "@/engine/engine";
import { parseSilArtifact, useSilver, type CompiledRecord, type DeployRecord, type SpendRecord } from "@/store/silver";
import { useIde } from "@/store/ide";
import { pubkeyFromAddress } from "@/utils/kaspaAddress";
import type { CompilationResult } from "./compiler";
import type { ConsolePlugin } from "./console";

/**
 * SilverScript contracts on the canonical localnet (Remix's "Deploy & Run" for
 * contracts): deploy a compiled contract's P2SH output, list deployed instances,
 * call an entry (spend) with typed arguments and account signatures.
 *
 *   hardkas silver deploy <compileRecord> --from <acct> --amount <kas> [--contract] --wait --json
 *   hardkas silver spend  <deployRecord>  --entry <name> --to <addr> --args <file> --wait --json
 *
 * Entry args file: JSON list of {kind, value} and {"kind":"signature","account":"<name>"}.
 * Constructor `pubkey` args come from an account's address (x-only key), see utils/kaspaAddress.
 */
export class SilverPlugin extends Plugin {
  private offs: Array<() => void> = [];

  constructor() {
    super({
      name: "silverContracts",
      displayName: "Silver contracts",
      location: "none",
      methods: ["loadCompiled", "refreshDeployments", "deploy", "spend", "pubkeyArg", "loadDeployRecord"],
      events: ["deployed", "spent", "deploymentsChanged"]
    });
  }

  onActivation(): void {
    this.offs.push(
      this.on("silverCompiler", "compilationFinished", (r) => void this.loadCompiled(r as CompilationResult)),
      this.on("fileManager", "treeChanged", () => void this.refreshDeployments())
    );
    void this.refreshDeployments();
  }

  onDeactivation(): void {
    for (const off of this.offs) off();
    this.offs = [];
  }

  private console(): ConsolePlugin {
    return this.engine.get<ConsolePlugin>("console");
  }

  /** Turns a compilation result (with the CLI record path) into ABIs for the GUI. */
  async loadCompiled(result: CompilationResult): Promise<CompiledRecord | null> {
    const raw = result.raw as Record<string, unknown> | null;
    const absPath = typeof raw?.recordPath === "string" ? raw.recordPath : null;
    const recordPath = absPath ? this.toRelative(absPath) : null;
    if (!recordPath) return null;
    const contracts = parseSilArtifact(raw?.artifactJson, raw?.contracts as Array<{ name: string; address?: string }> | undefined);
    const compiled: CompiledRecord = {
      recordPath,
      contentHash: String(raw?.contentHash ?? ""),
      sourcePath: result.file,
      networkId: typeof raw?.networkId === "string" ? raw.networkId : undefined,
      contracts
    };
    useSilver.getState().setCompiled(compiled);
    return compiled;
  }

  /** Reads every silverDeploy record in the workspace (newest first) and attaches the ABI from its compile record. */
  async refreshDeployments(): Promise<DeployRecord[]> {
    const store = useSilver.getState();
    try {
      const files = await api.fs.find(".hardkas/artifacts/silver", ".json");
      const deploys = files.filter((f) => /silverDeploy-/.test(f));
      const spendsFiles = files.filter((f) => /silverSpend-/.test(f));
      const spentOutpoints = new Set<string>();
      const spends: SpendRecord[] = [];
      for (const f of spendsFiles) {
        try {
          const r = JSON.parse(await api.fs.read(f)) as Record<string, unknown>;
          const so = r.spentOutpoint as { transactionId: string; index: number } | undefined;
          if (so) spentOutpoints.add(`${so.transactionId}:${so.index}`);
          spends.push({
            recordPath: f,
            txId: String(r.txId ?? ""),
            contract: String(r.contract ?? ""),
            entry: String(r.entry ?? ""),
            to: String(r.to ?? ""),
            outputSompi: String(r.outputSompi ?? ""),
            feeSompi: typeof r.feeSompi === "string" ? r.feeSompi : undefined,
            status: String(r.status ?? ""),
            createdAt: typeof r.createdAt === "string" ? r.createdAt : undefined,
            deployContentHash: (r.deployRecord as { contentHash?: string } | undefined)?.contentHash
          });
        } catch {
          // skip unreadable
        }
      }
      const list: DeployRecord[] = [];
      for (const f of deploys) {
        try {
          const r = JSON.parse(await api.fs.read(f)) as Record<string, unknown>;
          const outpoint = r.outpoint as { transactionId: string; index: number };
          const compileRel = (r.compileRecord as { path?: string } | undefined)?.path;
          let abi: DeployRecord["abi"];
          if (compileRel) {
            try {
              const c = JSON.parse(await api.fs.read(compileRel)) as Record<string, unknown>;
              abi = parseSilArtifact(c.artifactJson, c.contracts as Array<{ name: string; address?: string }> | undefined).find((x) => x.name === r.contract);
            } catch {
              abi = undefined;
            }
          }
          list.push({
            recordPath: f,
            contentHash: String(r.contentHash ?? ""),
            contract: String(r.contract ?? ""),
            address: String(r.address ?? ""),
            txId: String(r.txId ?? ""),
            outpoint,
            valueSompi: String(r.valueSompi ?? ""),
            feeSompi: typeof r.feeSompi === "string" ? r.feeSompi : undefined,
            status: String(r.status ?? ""),
            networkId: typeof r.networkId === "string" ? r.networkId : undefined,
            createdAt: typeof r.createdAt === "string" ? r.createdAt : undefined,
            compileRecordPath: compileRel,
            abi,
            spent: outpoint ? spentOutpoints.has(`${outpoint.transactionId}:${outpoint.index}`) : false
          });
        } catch {
          // skip unreadable
        }
      }
      list.sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
      spends.sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
      useSilver.setState({ deployments: list, spends });
      this.emit("deploymentsChanged", list);
      return list;
    } catch (e) {
      store.setError(e instanceof Error ? e.message : String(e));
      return [];
    }
  }

  async deploy(input: { compileRecordPath: string; from: string; amountKas: string; contract?: string }): Promise<DeployRecord> {
    const store = useSilver.getState();
    store.setBusy("deploy");
    store.setError(null);
    try {
      const args = ["silver", "deploy", input.compileRecordPath, "--from", input.from, "--amount", input.amountKas, "--wait", "--json"];
      if (input.contract) args.push("--contract", input.contract);
      const run = await this.console().runHardkas(args);
      const raw = run.result as Record<string, unknown> | null;
      if (run.status !== "succeeded" || !raw || raw.ok === false || typeof raw.address !== "string") {
        throw new Error(messageOf(raw, "silver deploy failed"));
      }
      await this.refreshDeployments();
      const rec = useSilver.getState().deployments.find((d) => d.contentHash === raw.contentHash);
      if (!rec) throw new Error("Deployed, but the deploy record was not found in .hardkas/artifacts/silver");
      this.emit("deployed", rec);
      return rec;
    } catch (e) {
      store.setError(e instanceof Error ? e.message : String(e));
      throw e;
    } finally {
      useSilver.getState().setBusy(null);
    }
  }

  async spend(input: { deploy: DeployRecord; entry: string; to: string; args: unknown[]; sequence?: string }): Promise<SpendRecord> {
    const store = useSilver.getState();
    store.setBusy(`spend:${input.deploy.contentHash}`);
    store.setError(null);
    try {
      const argsFile = `.hardkas/ide/spend-args/${input.deploy.contentHash.slice(0, 16)}-${input.entry}.json`;
      await api.fs.write(argsFile, JSON.stringify(input.args, null, 2));
      const args = ["silver", "spend", input.deploy.recordPath, "--entry", input.entry, "--to", input.to, "--args", argsFile, "--wait", "--json"];
      if (input.sequence) args.push("--sequence", input.sequence);
      const run = await this.console().runHardkas(args);
      const raw = run.result as Record<string, unknown> | null;
      if (run.status !== "succeeded" || !raw || raw.ok === false || typeof raw.txId !== "string") {
        throw new Error(messageOf(raw, "silver spend failed"));
      }
      await this.refreshDeployments();
      const rec = useSilver.getState().spends.find((s) => s.txId === raw.txId) ?? {
        recordPath: this.toRelative(String(raw.recordPath ?? "")),
        txId: String(raw.txId),
        contract: input.deploy.contract,
        entry: input.entry,
        to: input.to,
        outputSompi: String(raw.outputSompi ?? ""),
        feeSompi: typeof raw.feeSompi === "string" ? raw.feeSompi : undefined,
        status: String(raw.status ?? "")
      };
      this.emit("spent", rec);
      await this.call("fileManager", "refresh");
      return rec;
    } catch (e) {
      store.setError(e instanceof Error ? e.message : String(e));
      throw e;
    } finally {
      useSilver.getState().setBusy(null);
    }
  }

  /** Loads an existing deploy record by path ("At address" in Remix terms). */
  async loadDeployRecord(recordPath: string): Promise<void> {
    await this.refreshDeployments();
    if (!useSilver.getState().deployments.some((d) => d.recordPath === recordPath)) {
      throw new Error(`${recordPath} is not a silverDeploy record under .hardkas/artifacts/silver`);
    }
  }

  /** A `{kind:"bytes", value:[…32 bytes]}` constructor argument from an account's P2PK address. */
  pubkeyArg(address: string): { kind: "bytes"; value: number[] } | null {
    const pk = pubkeyFromAddress(address);
    return pk ? { kind: "bytes", value: pk } : null;
  }

  private toRelative(abs: string): string {
    const root = (useIde.getState().workspace?.root ?? "").replace(/\\/g, "/");
    let p = abs.replace(/\\/g, "/");
    if (root && p.toLowerCase().startsWith(root.toLowerCase())) p = p.slice(root.length).replace(/^\/+/, "");
    return p;
  }
}

function messageOf(raw: Record<string, unknown> | null, fallback: string): string {
  if (raw && typeof raw.message === "string") return `${raw.code ? raw.code + ": " : ""}${raw.message}`;
  if (raw && typeof raw.code === "string") return raw.code;
  return fallback;
}
