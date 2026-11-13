import clsx from "clsx";
import {
  Activity,
  AlertTriangle,
  Bug,
  CheckCircle2,
  Cpu,
  ExternalLink,
  FileCode2,
  Hammer,
  Layers,
  Play,
  RotateCcw,
  ShieldAlert,
  ShieldCheck,
  SkipForward,
  Sparkles,
  Stethoscope,
  XCircle
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useEngine } from "@/engine/context";
import type { CompilationResult, CompilerPlugin } from "@/plugins/compiler";
import { copyText } from "@/utils/clipboard";
import { parseCompileRecord } from "@/utils/silverRecords";
import {
  analyzeSilverVersion,
  buildSilverDebugTrace,
  inspectTxV1AndCovenant,
  parseSilverDiagnostics,
  SILVER_TOOLCHAIN,
  type SilverCompileSummary
} from "@/utils/silverInspector";
import { useIde } from "@/store/ide";
import { useSilver } from "@/store/silver";

export function CompilePanel() {
  const engine = useEngine();
  const compiler = engine.get<CompilerPlugin>("silverCompiler");
  const tree = useIde((s) => s.tree);
  const activeFile = useIde((s) => s.activeFile);
  const openFiles = useIde((s) => s.openFiles);
  const target = useIde((s) => s.target);

  const silFiles = useMemo(() => {
    const out: string[] = [];
    const walk = (nodes: typeof tree) => {
      for (const n of nodes) {
        if (n.type === "file" && n.path.endsWith(".sil")) out.push(n.path);
        if (n.children) walk(n.children);
      }
    };
    walk(tree);
    return out;
  }, [tree]);

  const [selected, setSelected] = useState<string>("");
  const [argsJson, setArgsJson] = useState<string>("");
  const [argsLoadedFor, setArgsLoadedFor] = useState<string>("");
  const [autoCompile, setAutoCompile] = useState(compiler.autoCompile);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<CompilationResult | null>(() => compiler.getLastResult());
  const [toolBusy, setToolBusy] = useState<string | null>(null);
  const [toolOutput, setToolOutput] = useState<{ title: string; ok: boolean; data: unknown } | null>(null);
  const [activeFileContent, setActiveFileContent] = useState<string>("");

  // Debugger (cli-debugger) state
  const [debugOpen, setDebugOpen] = useState<boolean>(true);
  const [debugEntrypoint, setDebugEntrypoint] = useState<string>("");
  const [debugStepIdx, setDebugStepIdx] = useState<number>(0);
  const [simInputKas, setSimInputKas] = useState<string>("100");
  const [simOutputKas, setSimOutputKas] = useState<string>("100");
  const [simSigValid, setSimSigValid] = useState<boolean>(true);

  const compiledRecord = useSilver((s) => s.compiled);
  const setCompiled = useSilver((s) => s.setCompiled);
  const checksByFile = useSilver((s) => s.checksByFile);

  const currentSil = activeFile?.endsWith(".sil") ? activeFile : selected || silFiles[0] || "";
  const liveCheck = currentSil ? checksByFile[currentSil] : undefined;

  // Keep current `.sil` source in sync from open editor tab or disk
  useEffect(() => {
    if (!currentSil) {
      setActiveFileContent("");
      return;
    }
    const openTab = openFiles.find((t) => t.path === currentSil);
    if (openTab) {
      setActiveFileContent(openTab.content);
      return;
    }
    let cancelled = false;
    engine
      .call<string>("fileManager", "readFile", currentSil)
      .then((content) => {
        if (!cancelled) setActiveFileContent(content);
      })
      .catch(() => {
        if (!cancelled) setActiveFileContent("");
      });
    return () => {
      cancelled = true;
    };
  }, [currentSil, openFiles, engine]);

  // Load `<contract>.constructor-args.json` when the target `.sil` changes.
  if (currentSil && currentSil !== argsLoadedFor) {
    setArgsLoadedFor(currentSil);
    void compiler.readArgs(currentSil).then((text) => setArgsJson(text ?? ""));
  }

  const compileSummary: SilverCompileSummary | null = useMemo(() => {
    if (!result || result.file !== currentSil) {
      if (liveCheck && !liveCheck.ok) {
        return {
          file: currentSil,
          ok: false,
          contracts: [],
          errorText: liveCheck.errorText
        };
      }
      if (compiledRecord && compiledRecord.sourcePath === currentSil) {
        const first = compiledRecord.contracts[0];
        return {
          file: currentSil,
          ok: true,
          contracts: compiledRecord.contracts,
          scriptPublicKey: first?.lockingScript,
          bytecode: first?.lockingScript
        };
      }
      if (liveCheck && liveCheck.ok) {
        return { file: currentSil, ok: true, contracts: [] };
      }
      return null;
    }
    const first = compiledRecord?.contracts[0] ?? result.contracts[0];
    return {
      file: result.file,
      ok: result.ok,
      contracts: result.contracts,
      scriptPublicKey: first?.lockingScript,
      bytecode: first?.lockingScript,
      raw: result.raw,
      errorText: result.errorText
    };
  }, [result, compiledRecord, currentSil, liveCheck]);

  // Requirement 5: Version & Pragma check
  const versionCheck = useMemo(() => analyzeSilverVersion(activeFileContent), [activeFileContent]);

  // Requirement 1: TX v1 & Covenant State Inspection
  const txV1 = useMemo(() => inspectTxV1AndCovenant(activeFileContent, compileSummary), [activeFileContent, compileSummary]);

  // Requirement 2: Line-linked diagnostics (silverc + static source analysis + audit findings)
  const auditFindings = useMemo(() => {
    if (toolOutput?.title.startsWith("Audit") && toolOutput.data && typeof toolOutput.data === "object") {
      const f = (toolOutput.data as Record<string, unknown>).findings;
      if (Array.isArray(f)) {
        return f as Array<{ severity: string; rule: string; message: string; line?: number }>;
      }
    }
    return undefined;
  }, [toolOutput]);

  const diagnostics = useMemo(
    () => (currentSil ? parseSilverDiagnostics(currentSil, activeFileContent, compileSummary, auditFindings) : []),
    [currentSil, activeFileContent, compileSummary, auditFindings]
  );

  // Requirement 3: Source-level debugger (cli-debugger) trace
  const debugTrace = useMemo(() => {
    const inSompi = Math.max(0, Math.round((Number(simInputKas) || 0) * 100_000_000));
    const outSompi = Math.max(0, Math.round((Number(simOutputKas) || 0) * 100_000_000));
    return buildSilverDebugTrace(activeFileContent, debugEntrypoint || undefined, {
      inputSompi: inSompi,
      outputSompi: outSompi,
      signatureValid: simSigValid
    });
  }, [activeFileContent, debugEntrypoint, simInputKas, simOutputKas, simSigValid]);

  const currentDebugStep = debugTrace.steps[Math.min(debugStepIdx, Math.max(0, debugTrace.steps.length - 1))] ?? null;

  const jumpToLine = async (file: string, line: number, column = 1) => {
    await engine.call("fileManager", "open", file).catch(() => undefined);
    await engine.call("editor", "gotoLine", line, column).catch(() => undefined);
  };

  const stepDebuggerTo = async (nextIdx: number) => {
    const clamped = Math.max(0, Math.min(debugTrace.steps.length - 1, nextIdx));
    setDebugStepIdx(clamped);
    const step = debugTrace.steps[clamped];
    if (step && currentSil) {
      await jumpToLine(currentSil, step.line, 1);
    }
  };

  const compile = async () => {
    if (!currentSil) return;
    setBusy(true);
    useIde.getState().setStatus(`Compiling ${currentSil}…`);
    try {
      if (activeFile === currentSil) await engine.call("fileManager", "saveFile", currentSil);
      const r = await compiler.compile(currentSil, { args: argsJson });
      setResult(r);
      if (r.ok && r.recordPath) {
        const workspace = useIde.getState().workspace?.root ?? "";
        const rel =
          workspace && r.recordPath.startsWith(workspace)
            ? r.recordPath.slice(workspace.length).replace(/^[/\\]+/, "").replace(/\\/g, "/")
            : r.recordPath;
        try {
          const rawJson = await engine.call<string>("fileManager", "readFile", rel);
          const parsed = parseCompileRecord(rel, JSON.parse(rawJson) as Record<string, unknown>);
          if (parsed.record) setCompiled(parsed.record);
        } catch {
          // Record unreadable — keep CLI stdout fields only.
        }
      }
      useIde.getState().setStatus(r.ok ? `Compiled ${currentSil}` : `Compilation failed: ${currentSil}`);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setResult({ file: currentSil, ok: false, contracts: [], raw: null, errorText: message });
      useIde.getState().setStatus(`Compile error: ${message}`);
    } finally {
      setBusy(false);
    }
  };

  const toggleAuto = (v: boolean) => {
    setAutoCompile(v);
    compiler.setAutoCompile(v);
  };

  const runTool = async (name: "audit" | "preflight" | "doctor" | "fuzz") => {
    if (name !== "doctor" && !currentSil) return;
    setToolBusy(name);
    useIde.getState().setStatus(`Running silver ${name}…`);
    try {
      if (name === "audit") {
        const r = await compiler.audit(currentSil);
        setToolOutput({ title: `Audit: ${currentSil}`, ok: r.ok, data: r.result });
      } else if (name === "preflight") {
        const r = await compiler.preflight(currentSil);
        setToolOutput({ title: `Preflight: ${currentSil}`, ok: r.ok, data: r.result });
      } else if (name === "doctor") {
        const r = await compiler.doctor();
        setToolOutput({ title: "Silver Doctor", ok: r.ok, data: r.result });
      } else if (name === "fuzz") {
        const r = await compiler.fuzz(currentSil);
        setToolOutput({ title: `Fuzz: ${currentSil}`, ok: r.ok, data: r.result });
      }
      useIde.getState().setStatus(`Finished silver ${name}`);
    } catch (e) {
      setToolOutput({ title: `silver ${name} failed`, ok: false, data: String(e) });
    } finally {
      setToolBusy(null);
    }
  };

  return (
    <div className="flex flex-col h-full text-xs">
      <div className="panel-header">
        <span>SilverScript Compiler &amp; TX v1 Inspector</span>
        <span className="font-mono text-[10px] text-accent">silverc v{SILVER_TOOLCHAIN.silvercVersion}</span>
      </div>

      <div className="p-3 space-y-3 overflow-auto flex-1">
        {/* Requirement 5: silverc & SilverScript Pragma Version Guard */}
        <div
          className={clsx(
            "rounded border p-2.5 space-y-1",
            versionCheck.status === "ok"
              ? "border-border bg-bg-panel"
              : "border-warn/50 bg-warn/10"
          )}
        >
          <div className="flex items-center justify-between gap-2">
            <span className="font-semibold text-fg flex items-center gap-1.5 text-[11px]">
              {versionCheck.status === "ok" ? (
                <ShieldCheck size={13} className="text-ok shrink-0" />
              ) : (
                <AlertTriangle size={13} className="text-warn shrink-0" />
              )}
              Toolchain &amp; API Version Guard
            </span>
            {currentSil && (
              <button
                type="button"
                onClick={() => void jumpToLine(currentSil, versionCheck.pragmaLine, 1)}
                className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-bg border border-border text-accent hover:bg-bg-hover cursor-pointer"
                title="Jump to pragma declaration in editor"
              >
                pragma {versionCheck.pragmaRaw ?? "missing"} · :{versionCheck.pragmaLine}
              </button>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-1.5 text-[10px] font-mono text-fg-muted">
            <span className="px-1.5 py-0.5 rounded bg-bg border border-border">silverc v{SILVER_TOOLCHAIN.silvercVersion}</span>
            <span className="px-1.5 py-0.5 rounded bg-bg border border-border">SilverScript {SILVER_TOOLCHAIN.languageVersion}</span>
            <span className="px-1.5 py-0.5 rounded bg-bg border border-border">TX v{SILVER_TOOLCHAIN.txVersion} (Blake2b)</span>
          </div>
          {versionCheck.status !== "ok" && (
            <div className="text-[11px] text-warn leading-snug pt-0.5">{versionCheck.message}</div>
          )}
        </div>

        {/* Contract selector & Compile action */}
        <div>
          <label htmlFor="compile-contract-select" className="label">
            Contract (.sil)
          </label>
          <select
            id="compile-contract-select"
            className="select"
            value={currentSil}
            onChange={(e) => setSelected(e.target.value)}
          >
            {silFiles.length === 0 && <option value="">No .sil files in workspace</option>}
            {silFiles.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="compile-constructor-args" className="label">
            Constructor arguments (JSON array)
          </label>
          <textarea
            id="compile-constructor-args"
            className="input font-mono text-[11px] h-14 resize-y"
            placeholder='[{"type":"int","value":7}] — leave empty if no constructor params'
            value={argsJson}
            onChange={(e) => setArgsJson(e.target.value)}
          />
        </div>

        <label className="flex items-center gap-2 text-fg-muted cursor-pointer">
          <input type="checkbox" checked={autoCompile} onChange={(e) => toggleAuto(e.target.checked)} />
          Auto-compile on save
        </label>

        <button type="button" className="btn-primary w-full" disabled={!currentSil || busy} onClick={() => void compile()}>
          <Hammer size={14} /> {busy ? "Compiling…" : `Compile ${currentSil.split("/").pop() || "contract"}`}
        </button>

        {/* SilverScript QA & Verification Suite */}
        <div className="pt-2 border-t border-border space-y-1.5">
          <div className="label">SilverScript QA &amp; Verification</div>
          <div className="grid grid-cols-2 gap-1.5">
            <button
              type="button"
              className="btn-ghost border border-border justify-start text-[11px] py-1 px-2"
              disabled={!currentSil || toolBusy !== null}
              onClick={() => void runTool("audit")}
              title="Run static security & covenant safety checks (hardkas silver audit)"
            >
              <ShieldAlert size={12} className="text-accent shrink-0" />
              <span>{toolBusy === "audit" ? "Auditing…" : "Audit Contract"}</span>
            </button>
            <button
              type="button"
              className="btn-ghost border border-border justify-start text-[11px] py-1 px-2"
              disabled={!currentSil || toolBusy !== null}
              onClick={() => void runTool("preflight")}
              title="Verify readiness before deployment (hardkas silver preflight)"
            >
              <Play size={12} className="text-ok shrink-0" />
              <span>{toolBusy === "preflight" ? "Checking…" : "Preflight"}</span>
            </button>
            <button
              type="button"
              className="btn-ghost border border-border justify-start text-[11px] py-1 px-2"
              disabled={!currentSil || toolBusy !== null}
              onClick={() => void runTool("fuzz")}
              title="Property-based fuzzing on contract inputs (hardkas silver fuzz)"
            >
              <Sparkles size={12} className="text-warn shrink-0" />
              <span>{toolBusy === "fuzz" ? "Fuzzing…" : "Fuzz Inputs"}</span>
            </button>
            <button
              type="button"
              className="btn-ghost border border-border justify-start text-[11px] py-1 px-2"
              disabled={toolBusy !== null}
              onClick={() => void runTool("doctor")}
              title="Diagnose silverc compiler & toolchain environment (hardkas silver doctor)"
            >
              <Stethoscope size={12} className="text-fg-muted shrink-0" />
              <span>{toolBusy === "doctor" ? "Checking…" : "Silver Doctor"}</span>
            </button>
          </div>
        </div>

        {/* Requirement 2: Line-Linked silverc Diagnostics (Clickable -> jumps to exact line in .sil) */}
        {(diagnostics.length > 0 || compileSummary) && (
          <div className="rounded border border-border bg-bg-panel p-2.5 space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-fg flex items-center gap-1.5 text-[11px]">
                {diagnostics.some((d) => d.severity === "error") || (compileSummary && !compileSummary.ok) ? (
                  <>
                    <XCircle size={13} className="text-error shrink-0" />
                    <span className="text-error">silverc Diagnostics ({diagnostics.length})</span>
                  </>
                ) : (
                  <>
                    <CheckCircle2 size={13} className="text-ok shrink-0" />
                    <span className="text-ok">Compiled cleanly ({diagnostics.length} warnings)</span>
                  </>
                )}
              </span>
              {currentSil && (
                <span className="font-mono text-[10px] text-fg-muted truncate max-w-[140px]">
                  {currentSil.split("/").pop()}
                </span>
              )}
            </div>

            {diagnostics.length > 0 && (
              <div className="space-y-1.5">
                {diagnostics.map((d, idx) => (
                  <button
                    key={`${d.code}-${d.line}-${idx}`}
                    type="button"
                    onClick={() => void jumpToLine(d.file, d.line, d.column)}
                    className={clsx(
                      "w-full text-left rounded border p-2 transition-colors cursor-pointer group",
                      d.severity === "error"
                        ? "border-error/40 bg-error/10 hover:bg-error/15"
                        : "border-warn/40 bg-warn/10 hover:bg-warn/15"
                    )}
                    title={`Click to jump to ${d.file} line ${d.line}, column ${d.column}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span
                        className={clsx(
                          "font-mono text-[10px] font-bold px-1.5 py-0.5 rounded",
                          d.severity === "error" ? "bg-error/20 text-error" : "bg-warn/20 text-warn"
                        )}
                      >
                        {d.code}
                      </span>
                      <span className="font-mono text-[10px] text-accent group-hover:underline flex items-center gap-1">
                        <FileCode2 size={11} />
                        {d.file.split("/").pop()}:{d.line}:{d.column}
                        <ExternalLink size={10} />
                      </span>
                    </div>
                    <div className="text-[11px] text-fg mt-1 leading-snug break-words">{d.message}</div>
                    {d.hint && <div className="text-[10px] text-fg-muted mt-0.5">{d.hint}</div>}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Requirement 1: TX v1 Visibility (compute_budget, covenant_id, output bindings & resulting script) */}
        {currentSil && activeFileContent.trim().length > 0 && (
          <div className="rounded border border-accent/30 bg-bg-panel p-2.5 space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-fg flex items-center gap-1.5 text-[11px]">
                <Layers size={13} className="text-accent shrink-0" />
                TX v1 &amp; Covenant Inspector
              </span>
              <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-accent/10 border border-accent/30 text-accent">
                tx.version = 1
              </span>
            </div>

            {/* Covenant ID */}
            <div className="rounded border border-border bg-bg p-2 space-y-1">
              <div className="flex items-center justify-between text-[10px]">
                <span className="text-fg-muted uppercase font-semibold">Covenant ID (Blake2b-256)</span>
                <button
                  type="button"
                  onClick={() => void copyText(txV1.covenantId)}
                  className="text-accent hover:underline font-mono cursor-pointer"
                >
                  Copy ID
                </button>
              </div>
              <div className="font-mono text-[10px] text-fg break-all select-all">{txV1.covenantId}</div>
            </div>

            {/* Compute Budget & Mass metrics */}
            <div className="rounded border border-border bg-bg p-2 space-y-1.5">
              <div className="flex items-center justify-between text-[10px]">
                <span className="text-fg-muted uppercase font-semibold flex items-center gap-1">
                  <Activity size={11} className="text-accent" /> compute_budget
                </span>
                <span className="font-mono text-fg tabular-nums">
                  {txV1.computeBudgetUsed.toLocaleString()} / {txV1.computeBudgetLimit.toLocaleString()} ({txV1.computeBudgetPercent}%)
                </span>
              </div>
              <div className="w-full h-1.5 rounded-full bg-bg-panel border border-border overflow-hidden">
                <div
                  className={clsx(
                    "h-full transition-all",
                    txV1.computeBudgetPercent > 80 ? "bg-error" : txV1.computeBudgetPercent > 50 ? "bg-warn" : "bg-ok"
                  )}
                  style={{ width: `${Math.max(4, txV1.computeBudgetPercent)}%` }}
                />
              </div>
              <div className="grid grid-cols-3 gap-1.5 pt-0.5 text-[10px] font-mono">
                <div className="rounded bg-bg-panel px-1.5 py-1 border border-border">
                  <div className="text-fg-muted text-[9px]">SigOp Cost</div>
                  <div className="text-fg font-semibold">{txV1.sigOpCount} sigOp(s)</div>
                </div>
                <div className="rounded bg-bg-panel px-1.5 py-1 border border-border">
                  <div className="text-fg-muted text-[9px]">Script Size</div>
                  <div className="text-fg font-semibold">{txV1.scriptByteSize} B</div>
                </div>
                <div className="rounded bg-bg-panel px-1.5 py-1 border border-border">
                  <div className="text-fg-muted text-[9px]">Est. TX Mass</div>
                  <div className="text-fg font-semibold">{txV1.estimatedMassGrams} g</div>
                </div>
              </div>
            </div>

            {/* Output Covenant Bindings (tx.outputs[i]) */}
            <div className="space-y-1.5">
              <div className="text-[10px] font-semibold uppercase text-fg-muted">
                Covenant Output Bindings ({txV1.outputBindings.length})
              </div>
              {txV1.outputBindings.length === 0 ? (
                <div className="text-[11px] text-fg-muted bg-bg border border-border rounded p-2">
                  No <code>tx.outputs[i]</code> bindings enforced in source (standard P2PK/P2SH spend).
                </div>
              ) : (
                <div className="space-y-1">
                  {txV1.outputBindings.map((b) => (
                    <div
                      key={`${b.entrypoint}-out-${b.outputIndex}`}
                      className="rounded border border-border bg-bg p-2 text-[11px] space-y-1"
                    >
                      <div className="flex items-center justify-between gap-1">
                        <span className="font-mono font-semibold text-accent">
                          tx.outputs[{b.outputIndex}] · <span className="text-fg">{b.entrypoint}()</span>
                        </span>
                        <button
                          type="button"
                          onClick={() => void jumpToLine(currentSil, b.line, 1)}
                          className="font-mono text-[10px] text-accent hover:underline cursor-pointer"
                          title="Jump to output binding line in .sil"
                        >
                          line :{b.line}
                        </button>
                      </div>
                      <div className="text-[10px] font-mono text-fg-muted break-all">
                        <span className="text-fg">lock:</span> {b.lockingBinding}
                      </div>
                      <div className="flex items-center justify-between text-[10px] font-mono">
                        <span className="text-fg-muted">
                          <span className="text-fg">value:</span> {b.valueBinding}
                        </span>
                        <span
                          className={clsx(
                            "px-1.5 py-0.2 rounded text-[9px]",
                            b.isRecursive ? "bg-accent/15 text-accent border border-accent/30" : "bg-ok/15 text-ok border border-ok/30"
                          )}
                        >
                          {b.isRecursive ? "1:1 State Continuation" : "Bound Output"}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Resulting Script After State Change */}
            <div className="space-y-1.5 pt-1 border-t border-border">
              <div className="text-[10px] font-semibold uppercase text-fg-muted">
                Resulting Script After State Change
              </div>
              {txV1.stateTransitions.map((st) => (
                <div key={st.entrypoint} className="rounded border border-border bg-bg p-2 space-y-1.5 text-[10px]">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono font-semibold text-fg">{st.entrypoint}() transition</span>
                    <span className="font-mono text-[9px] px-1.5 py-0.5 rounded bg-bg-panel border border-border text-accent">
                      {st.mode}
                    </span>
                  </div>
                  <div className="text-fg-muted leading-snug">{st.summary}</div>
                  <div className="space-y-1 pt-0.5">
                    <div className="text-[9px] text-fg-muted uppercase">Input Covenant Script (Before)</div>
                    <div className="font-mono text-[10px] bg-bg-panel border border-border rounded px-1.5 py-1 truncate" title={st.beforeScriptHex}>
                      {st.beforeScriptHex}
                    </div>
                    <div className="text-[9px] text-fg-muted uppercase pt-0.5">Resulting Output Scripts (After)</div>
                    {st.afterOutputs.map((out) => (
                      <div key={out.outputIndex} className="rounded bg-bg-panel border border-border p-1.5 space-y-0.5 font-mono">
                        <div className="flex items-center justify-between">
                          <span className="text-accent">#{out.outputIndex} {out.lockingScriptType}</span>
                          <span className="text-fg-muted">{out.valueConstraint}</span>
                        </div>
                        <div className="text-fg truncate" title={out.resultingScriptHex}>
                          script: {out.resultingScriptHex}
                        </div>
                        <div className="text-fg-muted truncate" title={out.covenantId}>
                          covenantId: {out.covenantId.slice(0, 24)}…
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Requirement 3: Source-Level SilverScript Step Debugger (cli-debugger integration) */}
        {currentSil && activeFileContent.trim().length > 0 && (
          <div className="rounded border border-border bg-bg-panel p-2.5 space-y-2.5">
            <div className="flex items-center justify-between">
              <button
                type="button"
                onClick={() => setDebugOpen((v) => !v)}
                className="font-semibold text-fg flex items-center gap-1.5 text-[11px] cursor-pointer"
              >
                <Bug size={13} className="text-accent shrink-0" />
                <span>SilverScript Source Debugger (cli-debugger)</span>
              </button>
              <span className="font-mono text-[10px] text-fg-muted">
                Step {Math.min(debugStepIdx + 1, debugTrace.steps.length)}/{debugTrace.steps.length}
              </span>
            </div>

            {debugOpen && (
              <div className="space-y-2">
                {/* Entrypoint & Mock Context Controls */}
                <div className="grid grid-cols-2 gap-1.5">
                  <div>
                    <label htmlFor="sil-debug-ep" className="text-[10px] text-fg-muted block mb-0.5">
                      Entrypoint
                    </label>
                    <select
                      id="sil-debug-ep"
                      value={debugTrace.selectedEntrypoint}
                      onChange={(e) => {
                        setDebugEntrypoint(e.target.value);
                        setDebugStepIdx(0);
                      }}
                      className="select py-1 text-[11px] font-mono"
                    >
                      {debugTrace.entrypoints.map((ep) => (
                        <option key={ep} value={ep}>
                          {ep}()
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label htmlFor="sil-debug-out-kas" className="text-[10px] text-fg-muted block mb-0.5">
                      Output Value (KAS)
                    </label>
                    <input
                      id="sil-debug-out-kas"
                      className="input py-1 text-[11px] font-mono"
                      value={simOutputKas}
                      onChange={(e) => {
                        setSimOutputKas(e.target.value);
                        setSimInputKas(e.target.value);
                      }}
                    />
                  </div>
                </div>

                <label className="flex items-center gap-2 text-[11px] text-fg-muted cursor-pointer">
                  <input
                    type="checkbox"
                    checked={simSigValid}
                    onChange={(e) => setSimSigValid(e.target.checked)}
                  />
                  <span>Simulate valid Schnorr signature (checkSig = true)</span>
                </label>

                {/* Stepping controls */}
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => void stepDebuggerTo(0)}
                    className="btn-ghost border border-border px-2 py-1 text-[11px]"
                    title="Reset to entrypoint start"
                  >
                    <RotateCcw size={12} /> Reset
                  </button>
                  <button
                    type="button"
                    disabled={debugStepIdx <= 0}
                    onClick={() => void stepDebuggerTo(debugStepIdx - 1)}
                    className="btn-ghost border border-border px-2 py-1 text-[11px] disabled:opacity-40"
                  >
                    &lt; Prev
                  </button>
                  <button
                    type="button"
                    disabled={debugStepIdx >= debugTrace.steps.length - 1}
                    onClick={() => void stepDebuggerTo(debugStepIdx + 1)}
                    className="btn-primary px-2.5 py-1 text-[11px] flex-1"
                  >
                    <SkipForward size={12} /> Step Line
                  </button>
                </div>

                {/* Active line trace card */}
                {currentDebugStep && (
                  <div
                    className={clsx(
                      "rounded border p-2 space-y-1.5 text-[11px]",
                      currentDebugStep.status === "pass"
                        ? "border-ok/40 bg-ok/5"
                        : "border-error/40 bg-error/10"
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <button
                        type="button"
                        onClick={() => void jumpToLine(currentSil, currentDebugStep.line, 1)}
                        className="font-mono text-[10px] text-accent hover:underline cursor-pointer"
                      >
                        {currentSil.split("/").pop()}:{currentDebugStep.line}
                      </button>
                      <span
                        className={clsx(
                          "font-mono text-[9px] font-bold px-1.5 py-0.5 rounded uppercase",
                          currentDebugStep.status === "pass" ? "bg-ok/20 text-ok" : "bg-error/20 text-error"
                        )}
                      >
                        {currentDebugStep.status} · +{currentDebugStep.computeCost} compute
                      </span>
                    </div>
                    <pre className="font-mono text-[10px] bg-bg border border-border rounded p-1.5 overflow-x-auto text-fg">
                      {currentDebugStep.code}
                    </pre>
                    <div className="text-[10px] text-fg-muted leading-snug">{currentDebugStep.explanation}</div>

                    {/* VM Stack & Locals at current step */}
                    <div className="grid grid-cols-2 gap-1.5 pt-1 text-[10px] font-mono">
                      <div className="rounded bg-bg border border-border p-1.5">
                        <div className="text-[9px] text-fg-muted uppercase mb-0.5">VM Stack Top</div>
                        {currentDebugStep.stackTop.map((item, i) => (
                          <div key={i} className="text-accent truncate">
                            [{i}] {item}
                          </div>
                        ))}
                      </div>
                      <div className="rounded bg-bg border border-border p-1.5">
                        <div className="text-[9px] text-fg-muted uppercase mb-0.5">Compute Used</div>
                        <div className="text-fg font-semibold">{currentDebugStep.cumulativeCompute} units</div>
                        <div className="text-fg-muted text-[9px]">of {SILVER_TOOLCHAIN.computeBudgetLimit.toLocaleString()}</div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Clickable step list */}
                <div className="max-h-36 overflow-y-auto space-y-1 border-t border-border pt-1.5">
                  {debugTrace.steps.map((s) => (
                    <button
                      key={s.index}
                      type="button"
                      onClick={() => void stepDebuggerTo(s.index)}
                      className={clsx(
                        "w-full text-left px-2 py-1 rounded font-mono text-[10px] flex items-center justify-between gap-2 cursor-pointer",
                        s.index === debugStepIdx
                          ? "bg-accent/15 border border-accent text-fg"
                          : "bg-bg hover:bg-bg-hover text-fg-muted"
                      )}
                    >
                      <span className="truncate">
                        <span className="text-accent">:{s.line}</span> {s.code}
                      </span>
                      <span className={s.status === "pass" ? "text-ok shrink-0" : "text-error shrink-0"}>
                        {s.status === "pass" ? "✓" : "✗"}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Requirement 4: Simulator vs. Real Node (rusty-kaspad) Differences Matrix */}
        <div className="rounded border border-border bg-bg-panel p-2.5 space-y-1.5 text-[10px]">
          <div className="flex items-center justify-between">
            <span className="font-semibold text-fg flex items-center gap-1.5 text-[11px]">
              <Cpu size={13} className="text-accent shrink-0" />
              Simulator vs. Real Node Differences
            </span>
            <span className="font-mono px-1.5 py-0.5 rounded bg-bg border border-border text-accent">
              active: {target}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-1.5 pt-0.5">
            <div className={clsx("rounded border p-2 space-y-1", target === "simulator" ? "border-accent bg-accent/5" : "border-border bg-bg")}>
              <div className="font-semibold text-fg">Simulator (In-Memory)</div>
              <div className="text-fg-muted leading-snug">
                • <b>No VM script check:</b> Skips consensus opcode verification.
                <br />• <b>0-block maturity:</b> Instant coinbase spend.
                <br />• <b>Addresses:</b> Allows <code>kaspa:sim_*</code>.
              </div>
            </div>
            <div className={clsx("rounded border p-2 space-y-1", target === "localnet" ? "border-accent bg-accent/5" : "border-border bg-bg")}>
              <div className="font-semibold text-fg">Local Node (rusty-kaspad)</div>
              <div className="text-fg-muted leading-snug">
                • <b>Full Covenant v1 VM:</b> Enforces <code>compute_budget</code> &amp; output bindings.
                <br />• <b>100-DAA maturity:</b> Real coinbase lock.
                <br />• <b>Addresses:</b> Requires <code>kaspasim:</code> &amp; Schnorr sigs.
              </div>
            </div>
          </div>
        </div>

        {toolOutput && (
          <div className="rounded border border-border bg-bg-panel p-2.5 space-y-1.5">
            <div className="flex items-center justify-between">
              <span className={clsx("font-semibold text-[11px]", toolOutput.ok ? "text-ok" : "text-warn")}>
                {toolOutput.title}
              </span>
              <button
                type="button"
                onClick={() => setToolOutput(null)}
                className="text-[10px] text-fg-muted hover:text-fg cursor-pointer"
              >
                Clear
              </button>
            </div>
            <pre className="text-[10px] font-mono bg-bg p-2 rounded border border-border max-h-48 overflow-auto whitespace-pre-wrap">
              {typeof toolOutput.data === "string" ? toolOutput.data : JSON.stringify(toolOutput.data, null, 2)}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}
