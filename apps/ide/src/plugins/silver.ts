import { api } from "@/api/client";
import { Plugin } from "@/engine/engine";
import { parseSilArtifact, useSilver, type CompiledRecord, type CovenantRecord, type DeployRecord, type RecordProblem, type SpendRecord } from "@/store/silver";
import { useIde } from "@/store/ide";
import { pubkeyFromAddress } from "@/utils/kaspaAddress";
import { markSpent, markSupersededCovenants, newestFirst, parseCompileRecord, parseCovenantRecord, parseDeployRecord, parseJsonRecord, parseSpendRecord } from "@/utils/silverRecords";
import type { CompilationResult } from "./compiler";
import type { ConsolePlugin } from "./console";

/**
 * SilverScript contracts on the canonical localnet (the "Deploy & Run" flow for
 * contracts): deploy a compiled contract's P2SH output, list deployed instances,
 * call an entry (spend), and create / transition Toccata v1 covenants.
 *
 *   hardkas silver deploy <compileRecord> --from <acct> --amount <kas> [--contract] --wait --timeout 600 --json
 *   hardkas silver spend  <deployRecord>  --entry <name> --to <addr> --args <file> --wait --timeout 600 --json
 *   hardkas silver covenant genesis <compileRecord> --from <acct> --amount <kas> [--contract] --wait --timeout 600 --json
 *   hardkas silver covenant transition <covenantRecord> --policy <name> --constructor-args <file> --state-map <file> --next-state <file> [--args <file>] --emit-args <file> --wait --timeout 600 --json
 */
/** Seconds `--wait` may take before the CLI gives up (and leaves no record). */
const CONFIRM_TIMEOUT_S = "600";

export class SilverPlugin extends Plugin {
  private offs: Array<() => void> = [];

  constructor() {
    super({
      name: "silverContracts",
      displayName: "Silver contracts",
      location: "none",
      methods: [
        "loadCompiled",
        "refreshDeployments",
        "deploy",
        "spend",
        "pubkeyArg",
        "loadDeployRecord",
        "covenantGenesis",
        "covenantTransition",
        "loadCovenantRecord",
        "readCachedConstructorArgs"
      ],
      events: ["deployed", "spent", "covenantCreated", "covenantTransitioned", "deploymentsChanged"]
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

  console(): ConsolePlugin {
    return this.engine.get<ConsolePlugin>("console");
  }

  /** Turns a compilation result (with the CLI record path) into ABIs for the GUI. */
  async loadCompiled(result: CompilationResult): Promise<CompiledRecord | null> {
    const raw = result.raw as Record<string, unknown> | null;
    const absPath = typeof raw?.recordPath === "string" ? raw.recordPath : null;
    const recordPath = absPath ? this.toRelative(absPath) : null;
    if (!recordPath) return null;
    const sourceText = (raw?.source as { text?: string } | undefined)?.text;
    const contracts = parseSilArtifact(raw?.artifactJson, raw?.contracts as Array<{ name: string; address?: string }> | undefined, sourceText);
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

  /**
   * Reads every silverDeploy and silverSpend record in the workspace (newest first), attaches each deploy's
   * ABI from the compile record it points at and marks the deploys a spend consumed. Records the IDE could
   * not read as expected are kept in `recordProblems` and reported once in the Console.
   */
  async refreshDeployments(): Promise<DeployRecord[]> {
    const store = useSilver.getState();
    try {
      const files = await api.fs.find(".hardkas/artifacts/silver", ".json");
      const problems: RecordProblem[] = [];
      const note = (recordPath: string, list: string[]) => {
        if (list.length > 0) problems.push({ recordPath, problems: list });
      };

      const readRaw = async (f: string): Promise<Record<string, unknown> | null> => {
        const { raw, problem } = parseJsonRecord(await api.fs.read(f));
        if (problem) note(f, [problem]);
        return raw;
      };

      const spends = (
        await Promise.all(
          files.filter((f) => /silverSpend-/.test(f)).map(async (f) => {
            const raw = await readRaw(f).catch(() => null);
            if (!raw) return null;
            const parsed = parseSpendRecord(f, raw);
            note(f, parsed.problems);
            return parsed.record;
          })
        )
      ).filter((s): s is SpendRecord => s !== null);

      // One read per compile record, shared by every deploy that points at it.
      const compileAbis = new Map<string, Promise<ReturnType<typeof parseSilArtifact>>>();
      const loadCompileAbis = (compileRel: string) => {
        let p = compileAbis.get(compileRel);
        if (!p) {
          p = readRaw(compileRel)
            .then((raw) => {
              if (!raw) return [];
              const parsed = parseCompileRecord(compileRel, raw);
              note(compileRel, parsed.problems);
              return parsed.record?.contracts ?? [];
            })
            .catch(() => []);
          compileAbis.set(compileRel, p);
        }
        return p;
      };

      const deploys = (
        await Promise.all(
          files.filter((f) => /silverDeploy-/.test(f)).map(async (f): Promise<DeployRecord | null> => {
            const raw = await readRaw(f).catch(() => null);
            if (!raw) return null;
            const parsed = parseDeployRecord(f, raw);
            note(f, parsed.problems);
            if (!parsed.record) return null;
            const abis = parsed.record.compileRecordPath ? await loadCompileAbis(parsed.record.compileRecordPath) : [];
            return { ...parsed.record, abi: abis.find((x) => x.name === parsed.record!.contract) };
          })
        )
      ).filter((d): d is DeployRecord => d !== null);

      const covenantsRaw = (
        await Promise.all(
          files.filter((f) => /silverCovenant-/.test(f)).map(async (f): Promise<CovenantRecord | null> => {
            const raw = await readRaw(f).catch(() => null);
            if (!raw) return null;
            const parsed = parseCovenantRecord(f, raw);
            note(f, parsed.problems);
            if (!parsed.record) return null;
            const abis = parsed.record.compileRecordPath ? await loadCompileAbis(parsed.record.compileRecordPath) : [];
            return { ...parsed.record, abi: abis.find((x) => x.name === parsed.record!.contract) };
          })
        )
      ).filter((c): c is CovenantRecord => c !== null);

      const list = newestFirst(markSpent(deploys, spends));
      const covenantList = newestFirst(markSupersededCovenants(covenantsRaw));
      useSilver.setState({
        deployments: list,
        spends: newestFirst(spends),
        covenants: covenantList,
        recordProblems: problems
      });
      this.reportProblems(problems);
      this.emit("deploymentsChanged", list);
      return list;
    } catch (e) {
      store.setError(e instanceof Error ? e.message : String(e));
      return [];
    }
  }

  private reportedProblems = new Set<string>();

  /** Each unreadable record is mentioned once per session; the Deploy & Run view shows the count. */
  private reportProblems(problems: RecordProblem[]): void {
    for (const p of problems) {
      const key = `${p.recordPath}|${p.problems.join("|")}`;
      if (this.reportedProblems.has(key)) continue;
      this.reportedProblems.add(key);
      this.console().warn(`${p.recordPath}: ${p.problems.join("; ")}`);
    }
  }

  async deploy(input: { compileRecordPath: string; from: string; amountKas: string; contract?: string }): Promise<DeployRecord> {
    const store = useSilver.getState();
    store.setBusy("deploy");
    store.setError(null);
    try {
      const args = ["silver", "deploy", input.compileRecordPath, "--from", input.from, "--amount", input.amountKas, "--wait", "--timeout", CONFIRM_TIMEOUT_S, "--json"];
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
      const args = ["silver", "spend", input.deploy.recordPath, "--entry", input.entry, "--to", input.to, "--args", argsFile, "--wait", "--timeout", CONFIRM_TIMEOUT_S, "--json"];
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

  /** Loads an existing deploy record by path ("At address"). */
  async loadDeployRecord(recordPath: string): Promise<void> {
    await this.refreshDeployments();
    if (!useSilver.getState().deployments.some((d) => d.recordPath === recordPath)) {
      throw new Error(`${recordPath} is not a silverDeploy record under .hardkas/artifacts/silver`);
    }
  }

  /** Loads an existing Toccata covenant record by path. */
  async loadCovenantRecord(recordPath: string): Promise<void> {
    await this.refreshDeployments();
    if (!useSilver.getState().covenants.some((c) => c.recordPath === recordPath)) {
      throw new Error(`${recordPath} is not a silverCovenant record under .hardkas/artifacts/silver`);
    }
  }

  async readCachedConstructorArgs(compileContentHash: string): Promise<string | null> {
    if (!compileContentHash) return null;
    try {
      return await api.fs.read(`.hardkas/ide/covenant-args/${compileContentHash}.json`);
    } catch {
      return null;
    }
  }

  /** Creates a Toccata v1 covenant genesis UTXO bound to the derived covenantId. */
  async covenantGenesis(input: {
    compileRecordPath: string;
    from: string;
    amountKas: string;
    contract?: string;
    computeBudget?: string;
    feeSompi?: string;
  }): Promise<CovenantRecord> {
    const store = useSilver.getState();
    store.setBusy("covenant:genesis");
    store.setError(null);
    try {
      const args = [
        "silver",
        "covenant",
        "genesis",
        input.compileRecordPath,
        "--from",
        input.from,
        "--amount",
        input.amountKas
      ];
      if (input.contract) args.push("--contract", input.contract);
      if (input.computeBudget?.trim()) args.push("--compute-budget", input.computeBudget.trim());
      if (input.feeSompi?.trim()) args.push("--fee", input.feeSompi.trim());
      args.push("--wait", "--timeout", CONFIRM_TIMEOUT_S, "--json");

      const run = await this.console().runHardkas(args);
      const raw = run.result as Record<string, unknown> | null;
      if (run.status !== "succeeded" || !raw || raw.ok === false || typeof raw.covenantId !== "string") {
        throw new Error(messageOf(raw, "silver covenant genesis failed"));
      }
      await this.refreshDeployments();
      await this.call("fileManager", "refresh").catch(() => undefined);
      void this.call("environment", "refreshAccounts").catch(() => undefined);
      const rec = useSilver.getState().covenants.find((c) => c.contentHash === raw.contentHash);
      if (!rec) throw new Error("Covenant created, but record was not found in .hardkas/artifacts/silver");
      this.emit("covenantCreated", rec);
      return rec;
    } catch (e) {
      store.setError(e instanceof Error ? e.message : String(e));
      throw e;
    } finally {
      useSilver.getState().setBusy(null);
    }
  }

  /** Advances a 1:1 auth-bound Toccata covenant (`silver covenant transition`). */
  async covenantTransition(input: {
    covenant: CovenantRecord;
    policy: string;
    constructorArgsJson?: string;
    stateMapJson: string;
    nextStateJson: string;
    args?: unknown[];
    computeBudget?: string;
    feeSompi?: string;
  }): Promise<CovenantRecord> {
    const store = useSilver.getState();
    store.setBusy(`covenant:transition:${input.covenant.contentHash}`);
    store.setError(null);

    const tmpPrefix = `.hardkas/ide/tmp/${input.covenant.contentHash.slice(0, 12)}-${Date.now().toString(36)}`;
    const ctorPath = `${tmpPrefix}-ctor.json`;
    const stateMapPath = `${tmpPrefix}-statemap.json`;
    const nextStatePath = `${tmpPrefix}-nextstate.json`;
    const emitArgsPath = `${tmpPrefix}-emitargs.json`;
    const entryArgsPath = `${tmpPrefix}-args.json`;

    try {
      const ctorText = await this.resolveTransitionConstructorArgs(input.covenant, input.constructorArgsJson, input.stateMapJson);
      JSON.parse(ctorText);
      JSON.parse(input.stateMapJson);
      JSON.parse(input.nextStateJson);

      await api.fs.write(ctorPath, ctorText);
      await api.fs.write(stateMapPath, input.stateMapJson);
      await api.fs.write(nextStatePath, input.nextStateJson);

      const cliArgs = [
        "silver",
        "covenant",
        "transition",
        input.covenant.recordPath,
        "--policy",
        input.policy,
        "--constructor-args",
        ctorPath,
        "--state-map",
        stateMapPath,
        "--next-state",
        nextStatePath,
        "--emit-args",
        emitArgsPath
      ];
      if (input.args && input.args.length > 0) {
        await api.fs.write(entryArgsPath, JSON.stringify(input.args, null, 2));
        cliArgs.push("--args", entryArgsPath);
      }
      if (input.computeBudget?.trim()) cliArgs.push("--compute-budget", input.computeBudget.trim());
      if (input.feeSompi?.trim()) cliArgs.push("--fee", input.feeSompi.trim());
      cliArgs.push("--wait", "--timeout", CONFIRM_TIMEOUT_S, "--json");

      const run = await this.console().runHardkas(cliArgs);
      const raw = run.result as Record<string, unknown> | null;
      if (run.status !== "succeeded" || !raw || raw.ok === false || typeof raw.txId !== "string") {
        throw new Error(messageOf(raw, "silver covenant transition failed"));
      }

      const nextCompileHash =
        typeof (raw.compileRecord as { contentHash?: unknown } | undefined)?.contentHash === "string"
          ? ((raw.compileRecord as { contentHash: string }).contentHash)
          : undefined;
      if (nextCompileHash) {
        const emitted = await api.fs.read(emitArgsPath).catch(() => null);
        if (emitted) {
          await api.fs.write(`.hardkas/ide/covenant-args/${nextCompileHash}.json`, emitted).catch(() => undefined);
        }
      }

      await this.refreshDeployments();
      await this.call("fileManager", "refresh").catch(() => undefined);
      void this.call("environment", "refreshAccounts").catch(() => undefined);
      const rec = useSilver.getState().covenants.find((c) => c.contentHash === raw.contentHash || c.txId === raw.txId);
      if (!rec) throw new Error("Transition confirmed, but record was not found in .hardkas/artifacts/silver");
      this.emit("covenantTransitioned", rec);
      return rec;
    } catch (e) {
      store.setError(e instanceof Error ? e.message : String(e));
      throw e;
    } finally {
      await Promise.all(
        [ctorPath, stateMapPath, nextStatePath, emitArgsPath, entryArgsPath].map((p) => api.fs.remove(p).catch(() => undefined))
      );
      useSilver.getState().setBusy(null);
    }
  }

  private async resolveTransitionConstructorArgs(
    covenant: CovenantRecord,
    explicitJson: string | undefined,
    stateMapJson: string
  ): Promise<string> {
    if (explicitJson && explicitJson.trim() !== "") return explicitJson.trim();
    if (covenant.compileContentHash) {
      const cached = await this.readCachedConstructorArgs(covenant.compileContentHash);
      if (cached && cached.trim() !== "") return cached.trim();
    }
    const abi = covenant.abi;
    if (abi?.stateValues && abi.constructorParams?.length) {
      let stateMap: Record<string, number> = abi.stateMapDefault ?? {};
      try {
        const parsed = JSON.parse(stateMapJson) as Record<string, number>;
        if (parsed && typeof parsed === "object") stateMap = parsed;
      } catch {
        // use inferred map
      }
      const inverse = new Map<number, string>();
      for (const [fieldName, ctorIdx] of Object.entries(stateMap)) {
        if (typeof ctorIdx === "number") inverse.set(ctorIdx, fieldName);
      }
      const built: Array<{ kind: string; value: unknown }> = [];
      let complete = true;
      for (let i = 0; i < abi.constructorParams.length; i++) {
        const param = abi.constructorParams[i];
        const mappedField = inverse.get(i);
        const rawVal = mappedField ? abi.stateValues[mappedField] : undefined;
        if (rawVal === undefined) {
          complete = false;
          break;
        }
        const kind = param.kind.toLowerCase();
        if (kind === "int") {
          const num = Number(rawVal);
          built.push({ kind: "int", value: Number.isSafeInteger(num) ? num : rawVal });
        } else if (kind === "bool") {
          built.push({ kind: "bool", value: rawVal === "true" });
        } else {
          built.push({ kind: kind === "byte" ? "byte" : "bytes", value: rawVal });
        }
      }
      if (complete && built.length === abi.constructorParams.length) {
        return JSON.stringify(built);
      }
    }
    throw new Error("Constructor args for the current covenant state are required (expand Advanced -> Constructor Args to provide JSON).");
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
