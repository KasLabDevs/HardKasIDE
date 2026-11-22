import clsx from "clsx";
import { ArrowRight, Check, ChevronDown, ChevronRight, Copy, FileJson, GitBranch, Minus, Play, Plus, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { api } from "@/api/client";
import { useEngine } from "@/engine/context";
import type { ConsolePlugin } from "@/plugins/console";
import type { SilverPlugin } from "@/plugins/silver";
import { flattenTreePaths } from "@/shell/commandPaletteModel";
import { formatKas, useEnv } from "@/store/env";
import { useIde } from "@/store/ide";
import { useSilver, type SilContractAbi } from "@/store/silver";
import { copyText } from "@/utils/clipboard";
import { declaredStatePreview, type DeclaredState, type EngineCovenantChain, type EngineCovenantOutput } from "@/utils/engineCovenants";
import { parseCompileRecord, parseJsonRecord } from "@/utils/silverRecords";
import { Answer, ExperimentalBadge, outcomeOf, type Outcome } from "./run/CommandCard";

/**
 * The HardKAS 0.13 covenant commands on the SDK's v1 engine: `silver covenant start` (several outputs, each in its own
 * state) and `silver covenant advance` (1:N, N:M with a leader and delegates, termination). They write no silverCovenant
 * record: the chains they make are read from the engine's plan, signed and submission records (`engineCovenants`).
 *
 * What is shown is what a record or the CLI's answer says. The tip of a chain is "what this workspace recorded and
 * nothing recorded spends"; the node is asked only by "Check at the node" (`silver covenant inspect`).
 */

/** HardKAS's own words (docs/status/limitations.md, "SilverScript: what is real, and what is not proven"). */
export const TOPOLOGY_CAVEAT =
  "Only 1:1 auth-bound covenant transitions are a corpus capability with real-node evidence; 1:N, N:M (with a delegate) and termination are accepted by a real rusty-kaspad on simnet, are not a corpus capability and have no testnet-10 evidence.";

/** "1:2", "2:1", "1:0" (a termination): the shape of a transition; only "1:1" is a corpus capability. */
export function topologyOf(inputs: number, continuations: number, terminate: boolean): { label: string; experimental: boolean } {
  const outs = terminate ? 0 : continuations;
  return { label: `${inputs}:${outs}`, experimental: !(inputs === 1 && outs === 1) };
}

/** `{ value: { kind: "int", value: 8 } }` from an ABI's state fields and the values decoded from the compile record. */
export function stateJsonFromAbi(abi: SilContractAbi | undefined, overrides?: Record<string, string>): string {
  const fields = abi?.stateFields ?? [];
  if (fields.length === 0) return "";
  const cur = abi?.stateValues ?? {};
  const out: DeclaredState = {};
  for (const f of fields) {
    const raw = overrides?.[f.name] ?? cur[f.name] ?? "";
    const kind = f.kind.toLowerCase();
    if (kind === "int") out[f.name] = { kind: "int", value: /^-?\d+$/.test(raw) && Number.isSafeInteger(Number(raw)) ? Number(raw) : raw };
    else if (kind === "bool") out[f.name] = { kind: "bool", value: raw === "true" };
    else if (kind === "byte") out[f.name] = { kind: "byte", value: /^\d+$/.test(raw) ? Number(raw) : raw };
    else out[f.name] = { kind: "bytes", value: raw };
  }
  return JSON.stringify(out, null, 2);
}

/** The ABIs of a compile record by its path: the last compile when it is that one, else the record read from the workspace. */
function useCompileAbis(recordPath: string): { abis: SilContractAbi[]; problem: string | null } {
  const compiled = useSilver((s) => s.compiled);
  const [state, setState] = useState<{ path: string; abis: SilContractAbi[]; problem: string | null }>({ path: "", abis: [], problem: null });
  useEffect(() => {
    const p = recordPath.trim();
    if (!p) return;
    if (compiled && compiled.recordPath === p) {
      setState({ path: p, abis: compiled.contracts, problem: null });
      return;
    }
    let cancelled = false;
    api.fs
      .read(p)
      .then((text) => {
        const { raw, problem } = parseJsonRecord(text);
        if (!raw) return { abis: [] as SilContractAbi[], problem };
        const parsed = parseCompileRecord(p, raw);
        return { abis: parsed.record?.contracts ?? [], problem: parsed.problems[0] ?? null };
      })
      .catch((e: unknown) => ({ abis: [] as SilContractAbi[], problem: e instanceof Error ? e.message : String(e) }))
      .then((r) => {
        if (!cancelled) setState({ path: p, ...r });
      });
    return () => {
      cancelled = true;
    };
  }, [recordPath, compiled]);
  return state.path === recordPath.trim() ? { abis: state.abis, problem: state.problem } : { abis: [], problem: null };
}

/** The compile records the workspace knows: the last compile, the ones the chains point at, the silverCompile files. */
function useCompileRecordPaths(): string[] {
  const tree = useIde((s) => s.tree);
  const compiled = useSilver((s) => s.compiled);
  const covenants = useSilver((s) => s.covenants);
  const engine = useSilver((s) => s.engineCovenants);
  return useMemo(() => {
    const fromTree = flattenTreePaths(tree, true).filter((p) => /silverCompile-[0-9a-f]+\.json$/i.test(p));
    return [...new Set([compiled?.recordPath, ...covenants.map((c) => c.compileRecordPath), ...engine.map((c) => c.contract?.compileRecordPath), ...fromTree].filter((p): p is string => !!p))];
  }, [tree, compiled, covenants, engine]);
}

function AccountSelect({ value, onChange, label, allowNone }: { value: string; onChange: (v: string) => void; label: string; allowNone?: boolean }) {
  const accounts = useEnv((s) => s.accounts);
  return accounts.length > 0 ? (
    <select aria-label={label} className="input text-xs" value={value} onChange={(e) => onChange(e.target.value)}>
      {allowNone && <option value="">(none)</option>}
      {accounts.map((a) => (
        <option key={a.name} value={a.name}>
          {a.name}
        </option>
      ))}
    </select>
  ) : (
    <input aria-label={label} className="input text-xs" value={value} placeholder="account name" onChange={(e) => onChange(e.target.value)} />
  );
}

function Labelled({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[12px] text-fg-muted mb-0.5">{label}</div>
      {children}
      {hint && <div className="text-[12px] text-fg-muted mt-0.5">{hint}</div>}
    </div>
  );
}

function TopologyBadge({ inputs, continuations, terminate }: { inputs: number; continuations: number; terminate: boolean }) {
  const t = topologyOf(inputs, continuations, terminate);
  return (
    <span className="flex items-center gap-1.5 text-[12px]">
      <span className="font-mono text-fg-muted" title="covenant inputs : continuations">
        {t.label}
      </span>
      {t.experimental && <ExperimentalBadge title={TOPOLOGY_CAVEAT} />}
    </span>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Start

/** `hardkas silver covenant start`: a covenant with one or more outputs, each holding its own state. */
export function CovenantStartForm() {
  const engine = useEngine();
  const silver = engine.get<SilverPlugin>("silverContracts");
  const busy = useSilver((s) => s.busy);
  const accounts = useEnv((s) => s.accounts);
  const compiled = useSilver((s) => s.compiled);
  const recordPaths = useCompileRecordPaths();

  const [open, setOpen] = useState(false);
  const [recordPath, setRecordPath] = useState(compiled?.recordPath ?? "");
  const { abis, problem: abiProblem } = useCompileAbis(recordPath);
  const covenantAbis = abis.filter((c) => c.covenantPolicies && Object.keys(c.covenantPolicies).length > 0);
  const [contract, setContract] = useState("");
  const abi = (abis.length === 1 ? abis[0] : abis.find((c) => c.name === contract)) ?? covenantAbis[0];
  const [from, setFrom] = useState(accounts[0]?.name ?? "alice");
  const [outputs, setOutputs] = useState<Array<{ kas: string; stateJson: string }>>([{ kas: "1", stateJson: "" }]);
  const [ctorJson, setCtorJson] = useState("");
  const [fee, setFee] = useState("");
  const [budget, setBudget] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [running, setRunning] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!recordPath && compiled?.recordPath) setRecordPath(compiled.recordPath);
  }, [compiled?.recordPath]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (accounts.length > 0 && !accounts.some((a) => a.name === from)) setFrom(accounts[0].name);
  }, [accounts]); // eslint-disable-line react-hooks/exhaustive-deps
  // When the contract is known, each output starts with the record's own state, so the person edits values, not shapes.
  useEffect(() => {
    const json = stateJsonFromAbi(abi);
    setOutputs((cur) => cur.map((o) => (o.stateJson.trim() ? o : { ...o, stateJson: json })));
  }, [abi?.name, abi?.stateValues]); // eslint-disable-line react-hooks/exhaustive-deps

  const run = async () => {
    setErr(null);
    setOutcome(null);
    setRunning(true);
    try {
      const { args, run } = await silver.covenantStart({
        compileRecordPath: recordPath.trim(),
        from,
        outputs: outputs.map((o) => ({ kas: o.kas, stateJson: o.stateJson })),
        constructorArgsJson: ctorJson,
        contract: abis.length > 1 ? abi?.name : undefined,
        computeBudget: budget,
        feeSompi: fee
      });
      setOutcome(outcomeOf(args, run));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  };

  return (
    <section className="rounded border border-border bg-bg-elev/60" data-testid="covenant-start">
      <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="w-full flex items-center gap-1.5 px-2.5 py-2 text-left cursor-pointer hover:bg-bg-hover/60 rounded min-w-0">
        {open ? <ChevronDown size={12} className="shrink-0 text-fg-muted" /> : <ChevronRight size={12} className="shrink-0 text-fg-muted" />}
        <span className="font-semibold text-fg truncate">Start a covenant (several outputs)</span>
        {outputs.length > 1 && <ExperimentalBadge title={TOPOLOGY_CAVEAT} />}
        <span className="ml-auto font-mono text-[12px] text-fg-muted shrink-0">silver covenant start</span>
      </button>
      {open && (
        <div className="px-2.5 pb-2.5 space-y-2 border-t border-border/70 pt-2 text-xs">
          <p className="text-fg-muted leading-snug">
            One or more covenant outputs, each holding its own state, all bound to the one covenant id the SDK derives (what an N:M transition spends). Planned, checked, signed and sent by the SDK's v1 engine; <span className="text-fg">Genesis</span> in SilverScript contracts keeps the one-output form and its record.
          </p>
          {outputs.length > 1 && <p className="text-[12px] text-warn leading-snug">{TOPOLOGY_CAVEAT}</p>}

          <Labelled label="Compile record">
            <input aria-label="Start compile record" className="input font-mono text-xs" list="covenant-start-records" value={recordPath} placeholder=".hardkas/artifacts/silver/silverCompile-….json" onChange={(e) => setRecordPath(e.target.value)} />
            <datalist id="covenant-start-records">
              {recordPaths.map((p) => (
                <option key={p} value={p} />
              ))}
            </datalist>
            {abiProblem && <div className="text-[12px] text-warn mt-0.5">{abiProblem}</div>}
            {recordPath && abis.length > 0 && covenantAbis.length === 0 && <div className="text-[12px] text-warn mt-0.5">This record declares no covenant policy: the node will refuse a covenant of it.</div>}
          </Labelled>
          {abis.length > 1 && (
            <Labelled label="Contract">
              <select aria-label="Start contract" className="input text-xs" value={abi?.name ?? ""} onChange={(e) => setContract(e.target.value)}>
                {abis.map((c) => (
                  <option key={c.name} value={c.name}>
                    {c.name}
                  </option>
                ))}
              </select>
            </Labelled>
          )}
          <Labelled label="Funding account" hint="Pays the outputs and the fee, gets the change. A development account: no password.">
            <AccountSelect label="Start funding account" value={from} onChange={setFrom} />
          </Labelled>

          <div className="space-y-1.5">
            <div className="text-[12px] text-fg-muted flex items-center justify-between">
              <span>
                Outputs, in order ({outputs.length}) {abi?.stateFields?.length ? `· state: ${abi.stateFields.map((f) => `${f.kind} ${f.name}`).join(", ")}` : ""}
              </span>
              <button type="button" className="btn-ghost p-0.5 flex items-center gap-1 cursor-pointer" onClick={() => setOutputs((o) => [...o, { kas: "1", stateJson: stateJsonFromAbi(abi) }])}>
                <Plus size={11} /> output
              </button>
            </div>
            {outputs.map((o, k) => (
              <div key={k} className="rounded border border-border/70 p-1.5 space-y-1 bg-bg/50">
                <div className="flex items-center gap-2">
                  <span className="text-fg-muted shrink-0 w-14">output {k}</span>
                  <input aria-label={`Output ${k} KAS`} className="input font-mono text-xs w-24" value={o.kas} onChange={(e) => setOutputs((cur) => cur.map((x, j) => (j === k ? { ...x, kas: e.target.value } : x)))} />
                  <span className="text-fg-muted">KAS</span>
                  {outputs.length > 1 && (
                    <button type="button" className="btn-ghost p-0.5 ml-auto cursor-pointer" aria-label={`Remove output ${k}`} onClick={() => setOutputs((cur) => cur.filter((_, j) => j !== k))}>
                      <Minus size={11} />
                    </button>
                  )}
                </div>
                <textarea
                  aria-label={`Output ${k} state JSON`}
                  className="input font-mono text-[12px] min-h-14 resize-y"
                  rows={3}
                  spellCheck={false}
                  placeholder={'{"value": {"kind": "int", "value": 8}} — empty: the record\'s own state (then every output empty)'}
                  value={o.stateJson}
                  onChange={(e) => setOutputs((cur) => cur.map((x, j) => (j === k ? { ...x, stateJson: e.target.value } : x)))}
                />
              </div>
            ))}
          </div>

          <div>
            <button type="button" onClick={() => setShowAdvanced((v) => !v)} className="text-[12px] text-fg-muted hover:text-fg flex items-center gap-1 cursor-pointer">
              {showAdvanced ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
              Advanced (constructor args, fee, budget)
            </button>
            {showAdvanced && (
              <div className="mt-1.5 space-y-1.5 rounded bg-bg p-2 border border-border/60">
                <Labelled label="--constructor-args JSON" hint="What the contract was compiled with. Empty: proven from its initial State.">
                  <input aria-label="Start constructor args" className="input font-mono text-[12px]" placeholder='[{"kind":"int","value":8}]' value={ctorJson} onChange={(e) => setCtorJson(e.target.value)} />
                </Labelled>
                <div className="grid grid-cols-2 gap-1.5">
                  <Labelled label="--fee (sompi)">
                    <input aria-label="Start fee" className="input font-mono text-[12px]" placeholder="the node's floor" value={fee} onChange={(e) => setFee(e.target.value)} />
                  </Labelled>
                  <Labelled label="--compute-budget (funding inputs)">
                    <input aria-label="Start compute budget" className="input font-mono text-[12px]" placeholder="certified P2PK budget" value={budget} onChange={(e) => setBudget(e.target.value)} />
                  </Labelled>
                </div>
              </div>
            )}
          </div>

          <button type="button" data-testid="covenant-start-btn" className="btn-primary w-full justify-center" disabled={running || busy !== null || !recordPath.trim()} onClick={() => void run()}>
            <Play size={12} /> {running ? "Starting… (waits for confirmation)" : `Start · ${outputs.length} output${outputs.length === 1 ? "" : "s"}`}
          </button>
          {err && (
            <div role="alert" className="text-error text-[12px] whitespace-pre-wrap break-words rounded bg-error/10 border border-error/30 p-1.5">
              {err}
            </div>
          )}
          {outcome && <Answer outcome={outcome} />}
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Advance

export interface AdvanceTarget {
  covenantId: string;
  compileRecordPath?: string;
  contract?: string;
  abi?: SilContractAbi;
  /** The outputs the chain lives in, by this workspace's records. */
  tip: Array<{ outpoint: string; amountSompi: string; declaredState?: DeclaredState }>;
}

/** `hardkas silver covenant advance`: 1:N, N:M (leader and delegates) or a termination, from the compile record and the covenant id. */
export function CovenantAdvanceForm({ target }: { target: AdvanceTarget }) {
  const engine = useEngine();
  const silver = engine.get<SilverPlugin>("silverContracts");
  const busy = useSilver((s) => s.busy);
  const accounts = useEnv((s) => s.accounts);
  const recordPaths = useCompileRecordPaths();

  const [recordPath, setRecordPath] = useState(target.compileRecordPath ?? "");
  const read = useCompileAbis(recordPath);
  const abi = target.abi ?? read.abis.find((c) => c.name === target.contract) ?? (read.abis.length === 1 ? read.abis[0] : undefined);
  const policies = useMemo(() => Object.keys(abi?.covenantPolicies ?? {}), [abi]);
  const [policy, setPolicy] = useState(policies[0] ?? "");
  useEffect(() => {
    if (policies.length > 0 && !policies.includes(policy)) setPolicy(policies[0]);
  }, [policies]); // eslint-disable-line react-hooks/exhaustive-deps

  // the leader entry's parameters other than its states: filled from the ABI when it is known
  const entryName = abi?.covenantPolicies?.[policy];
  const entry = abi?.entries.find((e) => e.name === entryName);
  const leaderParams = (entry?.params ?? []).filter((p) => !/^state(\[\])?$/i.test(p.kind));
  const [leaderValues, setLeaderValues] = useState<string[]>([]);
  useEffect(() => {
    setLeaderValues(leaderParams.map((p) => (p.kind === "sig" ? accounts[0]?.name ?? "alice" : p.kind === "int" ? "1" : p.kind === "bool" ? "true" : "")));
  }, [entryName, leaderParams.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const [argsJson, setArgsJson] = useState("[]");

  const [selected, setSelected] = useState<string[]>(target.tip.length > 0 ? [target.tip[0].outpoint] : []);
  const [extraInput, setExtraInput] = useState("");
  const [continuations, setContinuations] = useState<Array<{ stateJson: string; kas: string }>>([{ stateJson: "", kas: "" }]);
  const [terminate, setTerminate] = useState(false);
  const [payments, setPayments] = useState<Array<{ to: string; kas: string }>>([]);
  const [delegateArgs, setDelegateArgs] = useState<string[]>([]);
  const [funder, setFunder] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [ctorJson, setCtorJson] = useState("");
  const [fee, setFee] = useState("");
  const [maxFee, setMaxFee] = useState("");
  const [budget, setBudget] = useState("");
  const [running, setRunning] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // the first continuation starts as the leader input's declared state (its values, to edit), when the records give one
  useEffect(() => {
    const lead = target.tip.find((t) => t.outpoint === selected[0]);
    const seed = lead?.declaredState ? JSON.stringify(lead.declaredState, null, 2) : stateJsonFromAbi(abi);
    setContinuations((cur) => (cur.length === 1 && !cur[0].stateJson.trim() ? [{ ...cur[0], stateJson: seed }] : cur));
  }, [selected[0], abi?.name]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    setDelegateArgs((cur) => Array.from({ length: Math.max(0, selected.length - 1) }, (_, i) => cur[i] ?? "[]"));
  }, [selected.length]);

  const toggle = (outpoint: string) => setSelected((cur) => (cur.includes(outpoint) ? cur.filter((x) => x !== outpoint) : [...cur, outpoint]));
  const topology = topologyOf(selected.length, continuations.length, terminate);

  const run = async () => {
    setErr(null);
    setOutcome(null);
    let leaderArgs = argsJson;
    try {
      if (leaderParams.length > 0) {
        leaderArgs = JSON.stringify(
          leaderParams.map((p, i) => {
            const v = (leaderValues[i] ?? "").trim();
            if (p.kind === "sig") return { kind: "signature", account: v };
            if (p.kind === "int") return { kind: "int", value: /^-?\d+$/.test(v) && Number.isSafeInteger(Number(v)) ? Number(v) : v };
            if (p.kind === "bool") return { kind: "bool", value: v === "true" };
            if (p.kind === "byte") return { kind: "byte", value: Number(v) };
            return { kind: "bytes", value: v };
          })
        );
      } else JSON.parse(argsJson || "[]");
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      return;
    }
    setRunning(true);
    try {
      const { args, run } = await silver.covenantAdvance({
        compileRecordPath: recordPath.trim(),
        covenantId: target.covenantId,
        policy,
        inputs: selected.map((outpoint) => ({ outpoint })),
        continuations: terminate ? [] : continuations.map((c) => ({ stateJson: c.stateJson, kas: c.kas })),
        payments,
        terminate,
        argsJson: leaderArgs,
        delegateArgsJson: delegateArgs,
        funder,
        constructorArgsJson: ctorJson,
        contract: read.abis.length > 1 ? abi?.name : undefined,
        computeBudget: budget,
        feeSompi: fee,
        maxFeeSompi: maxFee
      });
      setOutcome(outcomeOf(args, run));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="rounded border border-border p-2 space-y-2 bg-bg/50 text-xs" data-testid={`covenant-advance-${target.covenantId.slice(0, 12)}`}>
      <div className="flex items-center justify-between gap-2 min-w-0">
        <span className="font-mono text-[12px] text-fg font-semibold truncate">silver covenant advance</span>
        <TopologyBadge inputs={selected.length} continuations={continuations.length} terminate={terminate} />
      </div>
      <p className="text-[12px] text-fg-muted leading-snug">
        Any transition the declaration allows: one input to several continuations (1:N), several inputs with a leader and delegates (N:M), or none (a termination). Planned and checked against the node and the compiler before any key is read.
      </p>
      {topology.experimental && <p className="text-[12px] text-warn leading-snug">{TOPOLOGY_CAVEAT}</p>}

      {!target.compileRecordPath && (
        <Labelled label="Compile record (the covenant's template)">
          <input aria-label="Advance compile record" className="input font-mono text-xs" list="covenant-advance-records" value={recordPath} onChange={(e) => setRecordPath(e.target.value)} />
          <datalist id="covenant-advance-records">
            {recordPaths.map((p) => (
              <option key={p} value={p} />
            ))}
          </datalist>
        </Labelled>
      )}
      {read.problem && <div className="text-[12px] text-warn">{read.problem}</div>}

      <Labelled label="Policy" hint={entry ? `${entryName}(${entry.params.map((p) => `${p.kind} ${p.name}`).join(", ")})` : undefined}>
        {policies.length > 0 ? (
          <select aria-label="Advance policy" className="input text-xs" value={policy} onChange={(e) => setPolicy(e.target.value)}>
            {policies.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        ) : (
          <input aria-label="Advance policy" className="input font-mono text-xs" placeholder="the covenant declaration's name" value={policy} onChange={(e) => setPolicy(e.target.value)} />
        )}
      </Labelled>

      <div className="space-y-1">
        <div className="text-[12px] text-fg-muted">Inputs: the covenant outputs to spend, the leader first (the order you tick them)</div>
        {target.tip.map((t) => {
          const i = selected.indexOf(t.outpoint);
          return (
            <label key={t.outpoint} className="flex items-center gap-2 cursor-pointer font-mono text-[12px] min-w-0">
              <input type="checkbox" checked={i >= 0} onChange={() => toggle(t.outpoint)} aria-label={`Spend ${t.outpoint}`} />
              <span className={clsx("w-4 shrink-0", i === 0 ? "text-accent" : "text-fg-muted")}>{i >= 0 ? (i === 0 ? "L" : `d${i}`) : ""}</span>
              <span className="truncate" title={t.outpoint}>
                {t.outpoint.slice(0, 12)}…:{t.outpoint.split(":")[1]}
              </span>
              <span className="text-fg-muted shrink-0">{formatKas(t.amountSompi)}</span>
              {t.declaredState && <span className="text-fg-muted truncate">{declaredStatePreview(t.declaredState)}</span>}
            </label>
          );
        })}
        <div className="flex items-center gap-1">
          <input aria-label="Another input outpoint" className="input font-mono text-[12px]" placeholder="txid:index not listed here" value={extraInput} onChange={(e) => setExtraInput(e.target.value)} />
          <button
            type="button"
            className="btn-ghost p-1 cursor-pointer"
            aria-label="Add input"
            onClick={() => {
              if (/^[0-9a-fA-F]{64}:\d+$/.test(extraInput.trim())) {
                setSelected((cur) => [...cur, extraInput.trim().toLowerCase()]);
                setExtraInput("");
              }
            }}
          >
            <Plus size={11} />
          </button>
        </div>
        {selected.filter((s) => !target.tip.some((t) => t.outpoint === s)).map((s) => (
          <div key={s} className="flex items-center gap-2 font-mono text-[12px]">
            <span className="text-fg-muted">added</span>
            <span className="truncate">{s}</span>
            <button type="button" className="btn-ghost p-0.5 cursor-pointer" aria-label={`Remove ${s}`} onClick={() => toggle(s)}>
              <Minus size={11} />
            </button>
          </div>
        ))}
      </div>

      {leaderParams.length > 0 && (
        <div className="space-y-1 pt-1 border-t border-border/50">
          <div className="text-[12px] text-fg-muted">Leader arguments (the next states are filled from the continuations)</div>
          {leaderParams.map((p, i) => (
            <div key={p.name} className="flex items-center gap-2">
              <span className="w-24 shrink-0 text-fg-muted truncate text-[12px]" title={`${p.kind} ${p.name}`}>
                {p.name} <span>({p.kind})</span>
              </span>
              {p.kind === "sig" ? (
                <AccountSelect label={`Leader signer ${p.name}`} value={leaderValues[i] ?? ""} onChange={(v) => setLeaderValues((cur) => cur.map((x, j) => (j === i ? v : x)))} />
              ) : (
                <input aria-label={`Leader argument ${p.name}`} className="input font-mono text-xs" value={leaderValues[i] ?? ""} onChange={(e) => setLeaderValues((cur) => cur.map((x, j) => (j === i ? e.target.value : x)))} />
              )}
            </div>
          ))}
        </div>
      )}
      {leaderParams.length === 0 && !abi && (
        <Labelled label="--args JSON (the leader entry's arguments other than its next states)" hint='[{"kind":"int","value":1}, {"kind":"signature","account":"alice"}]'>
          <input aria-label="Leader args JSON" className="input font-mono text-[12px]" value={argsJson} onChange={(e) => setArgsJson(e.target.value)} />
        </Labelled>
      )}
      {delegateArgs.map((d, i) => (
        <Labelled key={i} label={`--delegate-args for input d${i + 1} (JSON list)`} hint={'The delegate entry\'s arguments, e.g. [{"kind":"signature","account":"bob"}]'}>
          <input aria-label={`Delegate ${i + 1} args JSON`} className="input font-mono text-[12px]" value={d} onChange={(e) => setDelegateArgs((cur) => cur.map((x, j) => (j === i ? e.target.value : x)))} />
        </Labelled>
      ))}

      <label className="flex items-center gap-2 cursor-pointer">
        <input type="checkbox" checked={terminate} onChange={(e) => setTerminate(e.target.checked)} aria-label="Terminate the covenant" />
        <span>
          End the covenant (<span className="font-mono">--terminate</span>): no continuation; its value goes to the payments and the fee
        </span>
      </label>

      {!terminate && (
        <div className="space-y-1.5 pt-1 border-t border-border/50">
          <div className="text-[12px] text-fg-muted flex items-center justify-between">
            <span>Continuations, in output order ({continuations.length})</span>
            <button type="button" className="btn-ghost p-0.5 flex items-center gap-1 cursor-pointer" onClick={() => setContinuations((c) => [...c, { stateJson: stateJsonFromAbi(abi), kas: "1" }])}>
              <Plus size={11} /> continuation
            </button>
          </div>
          {continuations.map((c, k) => (
            <div key={k} className="rounded border border-border/70 p-1.5 space-y-1">
              <div className="flex items-center gap-2">
                <span className="text-fg-muted shrink-0">next {k}</span>
                <input aria-label={`Continuation ${k} KAS`} className="input font-mono text-xs w-24" placeholder="the rest" value={c.kas} onChange={(e) => setContinuations((cur) => cur.map((x, j) => (j === k ? { ...x, kas: e.target.value } : x)))} />
                <span className="text-fg-muted">KAS (empty: keeps what the others and the fee leave; one at most)</span>
                {continuations.length > 1 && (
                  <button type="button" className="btn-ghost p-0.5 ml-auto cursor-pointer" aria-label={`Remove continuation ${k}`} onClick={() => setContinuations((cur) => cur.filter((_, j) => j !== k))}>
                    <Minus size={11} />
                  </button>
                )}
              </div>
              <textarea
                aria-label={`Continuation ${k} state JSON`}
                className="input font-mono text-[12px] min-h-14 resize-y"
                rows={3}
                spellCheck={false}
                value={c.stateJson}
                placeholder='{"value": {"kind": "int", "value": 9}}'
                onChange={(e) => setContinuations((cur) => cur.map((x, j) => (j === k ? { ...x, stateJson: e.target.value } : x)))}
              />
            </div>
          ))}
        </div>
      )}

      <div className="space-y-1">
        <div className="text-[12px] text-fg-muted flex items-center justify-between">
          <span>Payments out of the covenant ({payments.length})</span>
          <button type="button" className="btn-ghost p-0.5 flex items-center gap-1 cursor-pointer" onClick={() => setPayments((p) => [...p, { to: accounts[1]?.name ?? "", kas: "1" }])}>
            <Plus size={11} /> payment
          </button>
        </div>
        {payments.map((p, k) => (
          <div key={k} className="flex items-center gap-1.5">
            <input aria-label={`Payment ${k} recipient`} className="input font-mono text-xs" placeholder="address or account" value={p.to} onChange={(e) => setPayments((cur) => cur.map((x, j) => (j === k ? { ...x, to: e.target.value } : x)))} />
            <input aria-label={`Payment ${k} KAS`} className="input font-mono text-xs w-20" value={p.kas} onChange={(e) => setPayments((cur) => cur.map((x, j) => (j === k ? { ...x, kas: e.target.value } : x)))} />
            <span className="text-fg-muted">KAS</span>
            <button type="button" className="btn-ghost p-0.5 cursor-pointer" aria-label={`Remove payment ${k}`} onClick={() => setPayments((cur) => cur.filter((_, j) => j !== k))}>
              <Minus size={11} />
            </button>
          </div>
        ))}
      </div>

      <div>
        <button type="button" onClick={() => setShowAdvanced((v) => !v)} className="text-[12px] text-fg-muted hover:text-fg flex items-center gap-1 cursor-pointer">
          {showAdvanced ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
          Advanced (funder, fee, budget, constructor args)
        </button>
        {showAdvanced && (
          <div className="mt-1.5 space-y-1.5 rounded bg-bg p-2 border border-border/60">
            <Labelled label="--funder: pay the fee from this account's coins (the covenant keeps its value)">
              <AccountSelect label="Advance funder" value={funder} onChange={setFunder} allowNone />
            </Labelled>
            <div className="grid grid-cols-3 gap-1.5">
              <Labelled label="--fee (sompi)">
                <input aria-label="Advance fee" className="input font-mono text-[12px]" placeholder="the node's floor" value={fee} onChange={(e) => setFee(e.target.value)} />
              </Labelled>
              <Labelled label="--max-fee (sompi)">
                <input aria-label="Advance max fee" className="input font-mono text-[12px]" value={maxFee} onChange={(e) => setMaxFee(e.target.value)} />
              </Labelled>
              <Labelled label="--compute-budget">
                <input aria-label="Advance compute budget" className="input font-mono text-[12px]" placeholder="certified / estimate" value={budget} onChange={(e) => setBudget(e.target.value)} />
              </Labelled>
            </div>
            <Labelled label="--constructor-args JSON" hint="Empty: proven from the contract's initial State.">
              <input aria-label="Advance constructor args" className="input font-mono text-[12px]" value={ctorJson} onChange={(e) => setCtorJson(e.target.value)} />
            </Labelled>
          </div>
        )}
      </div>

      <button type="button" data-testid="covenant-advance-btn" className="btn-primary w-full justify-center" disabled={running || busy !== null || !recordPath.trim() || !policy.trim() || selected.length === 0} onClick={() => void run()}>
        <ArrowRight size={12} /> {running ? "Advancing… (waits for confirmation)" : `Advance · ${policy || "?"} · ${topology.label}`}
      </button>
      {err && (
        <div role="alert" className="text-error text-[12px] whitespace-pre-wrap break-words rounded bg-error/10 border border-error/30 p-1.5">
          {err}
        </div>
      )}
      {outcome && <Answer outcome={outcome} />}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// A chain from the engine's records

/** `silver covenant inspect <id>`: the lineage and the tip checked at the node, as the CLI reports it. */
function InspectButton({ covenantId }: { covenantId: string }) {
  const engine = useEngine();
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const run = async () => {
    setBusy(true);
    try {
      const args = ["silver", "covenant", "inspect", covenantId, "--json"];
      const res = await engine.get<ConsolePlugin>("console").runHardkas(args);
      setOutcome(outcomeOf(args, res));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-1.5">
      <button type="button" className="btn-ghost justify-center w-full" disabled={busy} onClick={() => void run()} title={`hardkas silver covenant inspect ${covenantId}`}>
        <Search size={11} /> {busy ? "Asking the node…" : "Check at the node (silver covenant inspect)"}
      </button>
      {outcome && <Answer outcome={outcome} />}
    </div>
  );
}

export function EngineCovenantCard({ chain, defaultOpen }: { chain: EngineCovenantChain; defaultOpen: boolean }) {
  const engine = useEngine();
  const [open, setOpen] = useState(defaultOpen);
  const [copied, setCopied] = useState(false);
  const [advancing, setAdvancing] = useState(false);
  const { abis } = useCompileAbis(chain.contract?.compileRecordPath ?? "");
  const abi = abis.find((c) => c.name === chain.contract?.contract) ?? (abis.length === 1 ? abis[0] : undefined);
  const total = chain.tip.reduce((n, t) => n + BigInt(t.amountSompi || "0"), 0n).toString();
  const last = chain.transactions[chain.transactions.length - 1];

  const copyId = async (e: React.MouseEvent) => {
    e.stopPropagation();
    await copyText(chain.covenantId).catch(() => undefined);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };
  const outputLine = (o: EngineCovenantOutput) => `${o.outpoint.slice(0, 8)}…:${o.index} ${formatKas(o.amountSompi)}${o.declaredState ? ` · ${declaredStatePreview(o.declaredState)}` : ""}`;

  return (
    <div className="rounded border border-accent/45 bg-bg-elev" data-testid={`engine-covenant-${chain.covenantId.slice(0, 12)}`}>
      <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="w-full flex items-center gap-2 px-2 py-1.5 text-left cursor-pointer min-w-0">
        {open ? <ChevronDown size={12} className="shrink-0" /> : <ChevronRight size={12} className="shrink-0" />}
        <GitBranch size={13} className="text-accent shrink-0" />
        <span className="font-semibold text-fg truncate">{chain.contract?.contract ?? "covenant"}</span>
        <span className="text-[12px] text-fg-muted shrink-0">v1 engine</span>
        <span className="text-[12px] font-mono px-1.5 py-0.5 rounded bg-ok/15 text-ok border border-ok/30 truncate" title="Outputs of the chain no recorded transaction spends (by this workspace's records; the node was not asked)">
          {chain.tip.length} output{chain.tip.length === 1 ? "" : "s"}
        </span>
        <span className="ml-auto font-mono text-fg tabular-nums shrink-0">{formatKas(total)}</span>
      </button>
      {open && (
        <div className="px-2 pb-2.5 space-y-2 border-t border-border/50 pt-2 text-xs">
          <div className="flex items-center justify-between gap-2 text-[12px]">
            <div className="flex items-center gap-1 min-w-0 font-mono text-fg-muted" title={`Covenant ID: ${chain.covenantId}`}>
              <span className="shrink-0">covId:</span>
              <span className="truncate text-fg">{chain.covenantId.slice(0, 16)}…</span>
              <button type="button" onClick={(e) => void copyId(e)} className="p-0.5 hover:text-fg shrink-0 cursor-pointer" title="Copy full covenantId">
                {copied ? <Check size={10} className="text-ok" /> : <Copy size={10} />}
              </button>
            </div>
            {last && (
              <button type="button" className="flex items-center gap-1 hover:text-accent shrink-0 cursor-pointer text-fg-muted" onClick={() => void engine.call("fileManager", "open", last.planPath || last.signedPath)} title={`Open ${last.planPath || last.signedPath}`}>
                <FileJson size={11} /> last plan
              </button>
            )}
          </div>

          <div className="rounded bg-bg/70 border border-border/70 p-1.5 space-y-1">
            <div className="text-[12px] text-fg-muted font-semibold flex items-center justify-between">
              <span>
                Lineage ({chain.transactions.length} step{chain.transactions.length === 1 ? "" : "s"})
              </span>
              <span className="font-mono">{last?.recorded ?? ""}</span>
            </div>
            <div className="space-y-1 max-h-36 overflow-y-auto">
              {chain.transactions.map((t, i) => (
                <div key={t.txId} className="text-[12px] font-mono text-fg-muted rounded px-1.5 py-0.5">
                  <div className="flex items-center justify-between gap-1.5">
                    <span className="truncate">
                      {i + 1}. {t.kind === "genesis" ? "genesis" : `transition${t.entries.length ? `(${[...new Set(t.entries)].join(", ")})` : ""}`} · {t.spends.length}:{t.outputs.length}
                      {t.payments.length ? ` +${t.payments.length} payment${t.payments.length === 1 ? "" : "s"}` : ""}
                    </span>
                    <button type="button" className="hover:text-accent shrink-0 cursor-pointer" onClick={() => void engine.call("fileManager", "open", t.signedPath)} title={`Open ${t.signedPath} (tx ${t.txId})`}>
                      {t.txId.slice(0, 8)}…
                    </button>
                  </div>
                  {t.outputs.map((o) => (
                    <div key={o.outpoint} className="pl-3 truncate text-fg/80" title={o.outpoint}>
                      {outputLine(o)}
                    </div>
                  ))}
                </div>
              ))}
            </div>
            {(chain.rejected.length > 0 || chain.unsent.length > 0) && (
              <div className="text-[12px] text-warn">
                {chain.rejected.length > 0 && `${chain.rejected.length} rejected by the node. `}
                {chain.unsent.length > 0 && `${chain.unsent.length} signed, never sent.`}
              </div>
            )}
          </div>

          <div className="text-[12px] text-fg-muted">
            Tip by this workspace's records (the node was not asked): {chain.tip.length === 0 ? "none: the covenant ended, or its last output was spent" : chain.tip.map((t) => outputLine(t)).join(" · ")}
          </div>
          {chain.findings.map((f) => (
            <div key={f} className="text-[12px] text-warn leading-snug">
              {f}
            </div>
          ))}

          <InspectButton covenantId={chain.covenantId} />

          {chain.tip.length > 0 && (
            <button type="button" className="btn-ghost justify-center w-full" onClick={() => setAdvancing((v) => !v)}>
              {advancing ? <ChevronDown size={11} /> : <ChevronRight size={11} />} Advance (silver covenant advance)
            </button>
          )}
          {advancing && chain.tip.length > 0 && (
            <CovenantAdvanceForm
              target={{
                covenantId: chain.covenantId,
                compileRecordPath: chain.contract?.compileRecordPath,
                contract: chain.contract?.contract,
                abi,
                tip: chain.tip.map((t) => ({ outpoint: t.outpoint, amountSompi: t.amountSompi, declaredState: t.declaredState }))
              }}
            />
          )}
        </div>
      )}
    </div>
  );
}
