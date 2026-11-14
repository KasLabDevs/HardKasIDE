import clsx from "clsx";
import { ArrowRight, Check, ChevronDown, ChevronRight, Copy, FileJson, GitBranch, RefreshCw, ShieldCheck } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useEngine } from "@/engine/context";
import type { SilverPlugin } from "@/plugins/silver";
import { formatKas, useEnv } from "@/store/env";
import { useSilver, type CovenantRecord, type SilParam } from "@/store/silver";
import { copyText } from "@/utils/clipboard";
import { hexToBytes } from "@/utils/kaspaAddress";
import { groupCovenantChains } from "@/utils/silverRecords";

export function toSilverArg(p: SilParam, raw: string): { kind: string; value: unknown } | { kind: "signature"; account: string } {
  const v = raw.trim();
  switch (p.kind) {
    case "sig":
      if (!v) throw new Error(`${p.name}: choose the signing account`);
      return { kind: "signature", account: v };
    case "int":
      if (!/^-?\d+$/.test(v)) throw new Error(`${p.name}: expected an integer`);
      return { kind: "int", value: Number.isSafeInteger(Number(v)) ? Number(v) : v };
    case "bool":
      if (v !== "true" && v !== "false") throw new Error(`${p.name}: expected true or false`);
      return { kind: "bool", value: v === "true" };
    default:
      if (!v) throw new Error(`${p.name}: expected hex bytes`);
      return { kind: "bytes", value: hexToBytes(v) };
  }
}

export function silverPlaceholderFor(p: SilParam): string {
  switch (p.kind) {
    case "int":
      return "integer, e.g. 1";
    case "pubkey":
    case "bytes":
      return "hex bytes, e.g. 3e1b14…";
    default:
      return p.kind;
  }
}

function defaultConstructorArgsJson(covenant: CovenantRecord): string {
  const abi = covenant.abi;
  if (!abi?.stateValues || !abi.constructorParams?.length) return "";
  const map = abi.stateMapDefault ?? {};
  const inv = new Map<number, string>();
  for (const [k, idx] of Object.entries(map)) {
    if (typeof idx === "number") inv.set(idx, k);
  }
  const vals: Array<{ kind: string; value: unknown }> = [];
  for (let i = 0; i < abi.constructorParams.length; i++) {
    const fieldName = inv.get(i);
    const cur = fieldName ? abi.stateValues[fieldName] : undefined;
    if (cur === undefined) return "";
    const kind = abi.constructorParams[i].kind.toLowerCase();
    if (kind === "int") {
      const n = Number(cur);
      vals.push({ kind: "int", value: Number.isSafeInteger(n) ? n : cur });
    } else if (kind === "bool") {
      vals.push({ kind: "bool", value: cur === "true" });
    } else {
      vals.push({ kind: "bytes", value: cur });
    }
  }
  return JSON.stringify(vals);
}

function buildInitialNextState(covenant: CovenantRecord, defaultDelta = "1"): Record<string, string> {
  const fields = covenant.abi?.stateFields ?? [];
  const cur = covenant.abi?.stateValues ?? {};
  const next: Record<string, string> = {};
  for (const f of fields) {
    const val = cur[f.name];
    if (f.kind === "int" && val !== undefined && /^-?\d+$/.test(val) && /^-?\d+$/.test(defaultDelta)) {
      try {
        next[f.name] = (BigInt(val) + BigInt(defaultDelta)).toString();
        continue;
      } catch {
        // fall through
      }
    }
    next[f.name] = val ?? "";
  }
  return next;
}

export function CovenantChainSection({ alwaysShowHeader = false }: { alwaysShowHeader?: boolean }) {
  const engine = useEngine();
  const silver = engine.get<SilverPlugin>("silverContracts");
  const covenants = useSilver((s) => s.covenants);
  const compiled = useSilver((s) => s.compiled);
  const busy = useSilver((s) => s.busy);
  const [refreshing, setRefreshing] = useState(false);

  const chains = useMemo(() => groupCovenantChains(covenants), [covenants]);
  const hasCompiledCovenant = Boolean(
    compiled?.contracts.some((c) => c.covenantPolicies && Object.keys(c.covenantPolicies).length > 0)
  );

  if (!alwaysShowHeader && chains.length === 0 && !hasCompiledCovenant) return null;

  const refresh = async () => {
    setRefreshing(true);
    try {
      await silver.refreshDeployments();
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <div className="space-y-2" data-testid="covenants-v1-section">
      <div className="label flex items-center justify-between">
        <span className="tabular-nums flex items-center gap-1.5">
          <ShieldCheck size={12} className="text-accent" />
          Toccata Covenants (v1) · {chains.length}
        </span>
        <button
          type="button"
          className="btn-ghost p-0.5 text-[12px]"
          onClick={() => void refresh()}
          disabled={refreshing || busy !== null}
          title="Refresh covenant chains from .hardkas/artifacts/silver"
        >
          <RefreshCw size={11} className={refreshing ? "animate-spin" : ""} />
        </button>
      </div>
      {chains.length === 0 ? (
        <div className="rounded border border-border bg-bg-elev p-2 text-fg-muted text-[12px] leading-snug">
          No active v1 chains yet. Compile a <code className="font-mono text-fg">#[covenant]</code> <code className="font-mono text-fg">.sil</code> contract and click <span className="text-fg font-medium">Genesis</span> in SilverScript contracts to create an anchor UTXO and execute state transitions.
        </div>
      ) : (
        chains.map((g, idx) => (
          <CovenantChainCard
            key={g.covenantId}
            covenantId={g.covenantId}
            head={g.head}
            history={g.history}
            defaultOpen={idx === 0}
          />
        ))
      )}
    </div>
  );
}

function CovenantChainCard({
  covenantId,
  head,
  history,
  defaultOpen
}: {
  covenantId: string;
  head: CovenantRecord;
  history: CovenantRecord[];
  defaultOpen: boolean;
}) {
  const engine = useEngine();
  const busy = useSilver((s) => s.busy);
  const [open, setOpen] = useState(defaultOpen);
  const [copiedId, setCopiedId] = useState(false);

  const policyNames = useMemo(() => {
    const map = head.abi?.covenantPolicies;
    return map ? Object.keys(map) : [];
  }, [head.abi]);

  const currentStateEntries = useMemo(() => {
    const fields = head.abi?.stateFields ?? [];
    const values = head.abi?.stateValues ?? {};
    return fields.map((f) => ({ name: f.name, kind: f.kind, value: values[f.name] }));
  }, [head.abi]);

  const copyId = async (e: React.MouseEvent) => {
    e.stopPropagation();
    await copyText(covenantId).catch(() => undefined);
    setCopiedId(true);
    setTimeout(() => setCopiedId(false), 1200);
  };

  return (
    <div className="rounded border border-accent/45 bg-bg-elev" data-testid={`covenant-card-${head.contract}`}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-2 px-2 py-1.5 text-left cursor-pointer min-w-0"
      >
        {open ? <ChevronDown size={12} className="shrink-0" /> : <ChevronRight size={12} className="shrink-0" />}
        <GitBranch size={13} className="text-accent shrink-0" />
        <span className="font-semibold text-fg truncate">{head.contract}</span>
        {currentStateEntries.length > 0 && (
          <span
            className="text-[12px] font-mono px-1.5 py-0.5 rounded bg-ok/15 text-ok border border-ok/30 truncate"
            title="Current decoded on-chain covenant state"
          >
            {currentStateEntries.map((s) => `${s.name}=${s.value ?? "?"}`).join(", ")}
          </span>
        )}
        <span className="ml-auto font-mono text-fg tabular-nums shrink-0">{formatKas(head.valueSompi)}</span>
      </button>

      {open && (
        <div className="px-2 pb-2.5 space-y-2 border-t border-border/50 pt-2">
          <div className="flex items-center justify-between gap-2 text-[12px]">
            <div className="flex items-center gap-1 min-w-0 font-mono text-fg-muted" title={`Covenant ID: ${covenantId}`}>
              <span className="text-fg-muted shrink-0">covId:</span>
              <span className="truncate text-fg">{covenantId.slice(0, 16)}…</span>
              <button
                type="button"
                onClick={(e) => void copyId(e)}
                className="p-0.5 hover:text-fg shrink-0 cursor-pointer"
                title="Copy full covenantId"
              >
                {copiedId ? <Check size={10} className="text-ok" /> : <Copy size={10} />}
              </button>
            </div>
            <button
              type="button"
              className="flex items-center gap-1 hover:text-accent shrink-0 cursor-pointer text-fg-muted"
              onClick={() => void engine.call("fileManager", "open", head.recordPath)}
              title="Open head silverCovenant record JSON"
            >
              <FileJson size={11} /> head record
            </button>
          </div>

          <div className="font-mono text-[12px] text-fg-muted break-all" title="Current head P2SH address">
            {head.address}
          </div>

          {/* Lineage chain: genesis -> transitions */}
          <div className="rounded bg-bg/70 border border-border/70 p-1.5 space-y-1">
            <div className="text-[12px] text-fg-muted font-semibold flex items-center justify-between">
              <span>Lineage ({history.length} step{history.length === 1 ? "" : "s"})</span>
              <span className="font-mono">{head.status}</span>
            </div>
            <div className="space-y-1 max-h-28 overflow-y-auto">
              {history.map((step, i) => {
                const statePreview =
                  step.abi?.stateValues && Object.keys(step.abi.stateValues).length > 0
                    ? Object.entries(step.abi.stateValues)
                        .map(([k, v]) => `${k}=${v}`)
                        .join(",")
                    : null;
                const isHead = step.contentHash === head.contentHash;
                return (
                  <div
                    key={step.contentHash}
                    className={clsx(
                      "flex items-center justify-between gap-1.5 text-[12px] font-mono rounded px-1.5 py-0.5",
                      isHead ? "bg-accent/10 text-fg border border-accent/30" : "text-fg-muted"
                    )}
                  >
                    <span className="truncate">
                      {i + 1}. {step.kind === "genesis" ? "genesis" : `transition(${step.policy ?? "?"})`}
                      {statePreview ? ` · ${statePreview}` : ""}
                    </span>
                    <button
                      type="button"
                      className="hover:text-accent shrink-0 cursor-pointer"
                      onClick={() => void engine.call("fileManager", "open", step.recordPath)}
                      title={`Open ${step.recordPath} (tx ${step.txId})`}
                    >
                      {step.txId.slice(0, 8)}…
                    </button>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Transition Policies */}
          {policyNames.length === 0 ? (
            <div className="text-[12px] text-warn">
              No covenant transition policy metadata found in compile record ({head.compileRecordPath ?? "unknown"}).
            </div>
          ) : (
            policyNames.map((policyName) => (
              <PolicyTransitionForm
                key={`${head.contentHash}:${policyName}`}
                head={head}
                policy={policyName}
                disabled={busy !== null}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}

function PolicyTransitionForm({
  head,
  policy,
  disabled
}: {
  head: CovenantRecord;
  policy: string;
  disabled: boolean;
}) {
  const engine = useEngine();
  const silver = engine.get<SilverPlugin>("silverContracts");
  const accounts = useEnv((s) => s.accounts);

  const entryName = head.abi?.covenantPolicies?.[policy];
  const entry = head.abi?.entries.find((e) => e.name === entryName);
  const policyParams = entry?.params ?? [];
  const stateFields = head.abi?.stateFields ?? [];

  const [paramValues, setParamValues] = useState<string[]>(() =>
    policyParams.map((p) => (p.kind === "sig" ? accounts[0]?.name ?? "alice" : p.kind === "int" ? "1" : ""))
  );
  const [nextStateValues, setNextStateValues] = useState<Record<string, string>>(() => buildInitialNextState(head, "1"));
  const [nextStateTouched, setNextStateTouched] = useState(false);

  const defaultStateMap = useMemo(() => {
    if (head.abi?.stateMapDefault) return JSON.stringify(head.abi.stateMapDefault);
    const fallback: Record<string, number> = {};
    stateFields.forEach((f, idx) => {
      fallback[f.name] = idx;
    });
    return JSON.stringify(fallback);
  }, [head.abi, stateFields]);

  const [showAdvanced, setShowAdvanced] = useState(false);
  const [stateMapJson, setStateMapJson] = useState<string>(defaultStateMap);
  const [ctorArgsJson, setCtorArgsJson] = useState<string>(() => defaultConstructorArgsJson(head));
  const [computeBudget, setComputeBudget] = useState("");
  const [feeSompi, setFeeSompi] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [okNotice, setOkNotice] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  // Sync defaults whenever the head UTXO advances cleanly (e.g. 8 -> 9)
  useEffect(() => {
    setParamValues(policyParams.map((p) => (p.kind === "sig" ? accounts[0]?.name ?? "alice" : p.kind === "int" ? "1" : "")));
    setNextStateValues(buildInitialNextState(head, "1"));
    setNextStateTouched(false);
    setStateMapJson(defaultStateMap);
    const synthesized = defaultConstructorArgsJson(head);
    if (head.compileContentHash) {
      void silver.readCachedConstructorArgs(head.compileContentHash).then((cached) => {
        setCtorArgsJson(cached?.trim() || synthesized);
      });
    } else {
      setCtorArgsJson(synthesized);
    }
    setErr(null);
  }, [head.contentHash]); // eslint-disable-line react-hooks/exhaustive-deps

  const updateParamValue = (idx: number, val: string) => {
    setParamValues((prev) => prev.map((x, j) => (j === idx ? val : x)));
    // Keep Counter next-state convenience sync until the user explicitly edits Next State directly
    if (!nextStateTouched && stateFields.length === 1 && stateFields[0].kind === "int" && policyParams[idx]?.kind === "int") {
      const curRaw = head.abi?.stateValues?.[stateFields[0].name];
      if (curRaw && /^-?\d+$/.test(curRaw) && /^-?\d+$/.test(val.trim())) {
        setNextStateValues({ [stateFields[0].name]: (BigInt(curRaw) + BigInt(val.trim())).toString() });
      }
    }
  };

  const runTransition = async () => {
    setErr(null);
    setOkNotice(null);
    let args: unknown[];
    let nextStateObj: Record<string, ReturnType<typeof toSilverArg>>;
    try {
      args = policyParams.map((p, i) => toSilverArg(p, paramValues[i] ?? ""));
      nextStateObj = {};
      for (const f of stateFields) {
        nextStateObj[f.name] = toSilverArg(f, nextStateValues[f.name] ?? "");
      }
      JSON.parse(stateMapJson);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      return;
    }

    setRunning(true);
    try {
      const nextRec = await silver.covenantTransition({
        covenant: head,
        policy,
        constructorArgsJson: ctorArgsJson,
        stateMapJson,
        nextStateJson: JSON.stringify(nextStateObj),
        args,
        computeBudget: computeBudget || undefined,
        feeSompi: feeSompi || undefined
      });
      const newValPreview = nextRec.abi?.stateValues
        ? Object.entries(nextRec.abi.stateValues)
            .map(([k, v]) => `${k}=${v}`)
            .join(", ")
        : "";
      setOkNotice(`Transition confirmed (${nextRec.txId.slice(0, 12)}…)${newValPreview ? ` · ${newValPreview}` : ""}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  };

  const sigTitle = `${policy}(${policyParams.map((p) => `${p.kind} ${p.name}`).join(", ")})`;

  return (
    <div className="rounded border border-border p-2 space-y-2 bg-bg/50">
      <div className="flex items-center justify-between gap-2 min-w-0">
        <span className="font-mono text-[12px] text-fg font-semibold truncate" title={sigTitle}>
          #[covenant] {sigTitle}
        </span>
        {entry?.dispatchTag && <span className="text-[12px] text-fg-muted shrink-0 tabular-nums">#{entry.dispatchTag}</span>}
      </div>

      {/* Policy entrypoint parameters (e.g. delta) */}
      {policyParams.map((p, i) => (
        <div key={p.name} className="flex items-center gap-2">
          <span className="w-24 shrink-0 text-fg-muted truncate text-[12px]" title={`${p.kind} ${p.name}`}>
            {p.name} <span className="text-[12px]">({p.kind})</span>
          </span>
          {p.kind === "sig" ? (
            <select
              aria-label={`Policy ${policy} signer ${p.name}`}
              className="input text-xs"
              value={paramValues[i] ?? ""}
              onChange={(e) => updateParamValue(i, e.target.value)}
            >
              {(accounts.length ? accounts : [{ name: "alice" }]).map((a) => (
                <option key={a.name} value={a.name}>
                  sign with {a.name}
                </option>
              ))}
            </select>
          ) : p.kind === "bool" ? (
            <select
              aria-label={`Policy ${policy} param ${p.name}`}
              className="input text-xs"
              value={paramValues[i] ?? ""}
              onChange={(e) => updateParamValue(i, e.target.value)}
            >
              <option value="true">true</option>
              <option value="false">false</option>
            </select>
          ) : (
            <input
              aria-label={`Policy ${policy} param ${p.name}`}
              className="input font-mono text-xs"
              placeholder={silverPlaceholderFor(p)}
              value={paramValues[i] ?? ""}
              onChange={(e) => updateParamValue(i, e.target.value)}
            />
          )}
        </div>
      ))}

      {/* Next State declaration inputs */}
      {stateFields.length > 0 && (
        <div className="space-y-1 pt-1 border-t border-border/50">
          <div className="text-[12px] text-fg-muted font-semibold flex items-center justify-between">
            <span>Next State (State)</span>
            {nextStateTouched && (
              <button
                type="button"
                className="text-accent hover:underline cursor-pointer"
                onClick={() => {
                  setNextStateTouched(false);
                  setNextStateValues(buildInitialNextState(head, paramValues[0] ?? "1"));
                }}
              >
                auto-sync
              </button>
            )}
          </div>
          {stateFields.map((f) => (
            <div key={f.name} className="flex items-center gap-2">
              <span className="w-24 shrink-0 text-fg-muted truncate text-[12px]" title={`Next ${f.kind} ${f.name}`}>
                next.{f.name}
              </span>
              <input
                aria-label={`Next state ${f.name}`}
                className="input font-mono text-xs"
                value={nextStateValues[f.name] ?? ""}
                onChange={(e) => {
                  setNextStateTouched(true);
                  setNextStateValues((prev) => ({ ...prev, [f.name]: e.target.value }));
                }}
              />
            </div>
          ))}
        </div>
      )}

      {/* Advanced options (State map, Constructor args, explicit budget/fee) */}
      <div>
        <button
          type="button"
          onClick={() => setShowAdvanced((v) => !v)}
          className="text-[12px] text-fg-muted hover:text-fg flex items-center gap-1 cursor-pointer"
        >
          {showAdvanced ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
          Advanced (state map, constructor args, budget)
        </button>
        {showAdvanced && (
          <div className="mt-1.5 space-y-1.5 rounded bg-bg p-2 border border-border/60 text-[12px]">
            <div>
              <div className="text-fg-muted mb-0.5">--state-map JSON</div>
              <input
                aria-label="Covenant state map JSON"
                className="input font-mono text-[12px]"
                value={stateMapJson}
                onChange={(e) => setStateMapJson(e.target.value)}
              />
            </div>
            <div>
              <div className="text-fg-muted mb-0.5">--constructor-args JSON</div>
              <input
                aria-label="Current constructor args JSON"
                className="input font-mono text-[12px]"
                placeholder='[{"kind":"int","value":8}]'
                value={ctorArgsJson}
                onChange={(e) => setCtorArgsJson(e.target.value)}
              />
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              <div>
                <div className="text-fg-muted mb-0.5">--compute-budget</div>
                <input
                  aria-label="Transition compute budget"
                  className="input font-mono text-[12px]"
                  placeholder="auto/estimate"
                  value={computeBudget}
                  onChange={(e) => setComputeBudget(e.target.value)}
                />
              </div>
              <div>
                <div className="text-fg-muted mb-0.5">--fee (sompi)</div>
                <input
                  aria-label="Transition fee sompi"
                  className="input font-mono text-[12px]"
                  placeholder="auto floor"
                  value={feeSompi}
                  onChange={(e) => setFeeSompi(e.target.value)}
                />
              </div>
            </div>
          </div>
        )}
      </div>

      <button
        type="button"
        data-testid={`covenant-transition-btn-${policy}`}
        className="btn-primary w-full justify-center truncate"
        disabled={disabled || running}
        onClick={() => void runTransition()}
        title={`hardkas silver covenant transition ${head.recordPath} --policy ${policy}`}
      >
        <ArrowRight size={12} className="shrink-0" />
        <span className="truncate">
          {running
            ? `Transitioning ${policy}…`
            : `Transition · ${policy}${
                stateFields.length === 1 && head.abi?.stateValues?.[stateFields[0].name] !== undefined
                  ? ` (${head.abi.stateValues[stateFields[0].name]} → ${nextStateValues[stateFields[0].name] ?? "?"})`
                  : ""
              }`}
        </span>
      </button>

      {okNotice && (
        <div role="status" className="text-ok text-[12px] flex items-center gap-1 break-words">
          <Check size={11} className="shrink-0" /> {okNotice}
        </div>
      )}
      {err && (
        <div role="alert" className="text-error text-[12px] whitespace-pre-wrap break-words rounded bg-error/10 border border-error/30 p-1.5">
          {err}
        </div>
      )}
    </div>
  );
}
