import clsx from "clsx";
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  ExternalLink,
  FileCode2,
  Hammer,
  Layers,
  Play,
  ShieldAlert,
  Sparkles,
  Stethoscope,
  XCircle
} from "lucide-react";
import type { ConsolePlugin } from "@/plugins/console";
import { SilverDebugger } from "./SilverDebugger";
import { useEffect, useMemo, useState } from "react";
import { useEngine } from "@/engine/context";
import type { CompilationResult, CompilerPlugin } from "@/plugins/compiler";
import { copyText } from "@/utils/clipboard";
import { parseCompileRecord } from "@/utils/silverRecords";
import {
  analyzeSilverVersion,
  isSilvercMissing,
  parseSilverDiagnostics,
  summarizeSilverSource,
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

  // What the source says, plus the script silverc really produced (if compiled).
  const summary = useMemo(() => summarizeSilverSource(activeFileContent, compileSummary), [activeFileContent, compileSummary]);
  const silvercMissing = isSilvercMissing(compileSummary?.errorText) || isSilvercMissing(liveCheck?.errorText);

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

  const jumpToLine = async (file: string, line: number, column = 1) => {
    await engine.call("fileManager", "open", file).catch(() => undefined);
    await engine.call("editor", "gotoLine", line, column).catch(() => undefined);
  };

  const installSilverc = async () => {
    setToolBusy("install");
    useIde.getState().setStatus("Installing silverc…");
    try {
      const run = await engine.get<ConsolePlugin>("console").runHardkas(["toolchain", "install", "silverc", "--json"]);
      setToolOutput({ title: "Install silverc", ok: run.status === "succeeded", data: run.result ?? run.stderr });
      useIde.getState().setStatus(run.status === "succeeded" ? "silverc installed" : "silverc install failed");
      if (run.status === "succeeded" && currentSil) await compiler.checkDiagnostics(currentSil);
    } catch (e) {
      setToolOutput({ title: "Install silverc failed", ok: false, data: String(e) });
    } finally {
      setToolBusy(null);
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
      {/* The side panel already titles this view ("SilverScript compiler"); only the pinned version is shown here. */}
      <div className="panel-header justify-end">
        <span className="font-mono normal-case tracking-normal text-accent" title="The silverc version HardKas pins">
          silverc v{SILVER_TOOLCHAIN.silvercVersion}
        </span>
      </div>

      <div className="p-3 space-y-3 overflow-auto flex-1">
        {/* Only when something is wrong: a pragma that is missing or does not match the pinned silverc. Otherwise the version is in the header above. */}
        {currentSil && activeFileContent.trim().length > 0 && versionCheck.status !== "ok" && (
          <div role="alert" className="rounded border border-warn/50 bg-warn/10 p-2.5 space-y-1">
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold text-fg flex items-center gap-1.5 text-[12px]">
                <AlertTriangle size={13} className="text-warn shrink-0" />
                SilverScript version
              </span>
              <button
                type="button"
                onClick={() => void jumpToLine(currentSil, versionCheck.pragmaLine, 1)}
                className="font-mono text-[12px] px-1.5 py-0.5 rounded bg-bg border border-border text-accent hover:bg-bg-hover cursor-pointer"
                title="Jump to the pragma in the editor"
              >
                pragma {versionCheck.pragmaRaw ?? "missing"} · :{versionCheck.pragmaLine}
              </button>
            </div>
            <div className="text-[12px] text-warn leading-snug">{versionCheck.message}</div>
          </div>
        )}

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
            className="input font-mono text-[12px] h-14 resize-y"
            placeholder='[{"kind":"int","value":7}] — leave empty if no constructor params'
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
              className="btn-ghost border border-border justify-start text-[12px] py-1 px-2"
              disabled={!currentSil || toolBusy !== null}
              onClick={() => void runTool("audit")}
              title="Run static security & covenant safety checks (hardkas silver audit)"
            >
              <ShieldAlert size={12} className="text-accent shrink-0" />
              <span>{toolBusy === "audit" ? "Auditing…" : "Audit Contract"}</span>
            </button>
            <button
              type="button"
              className="btn-ghost border border-border justify-start text-[12px] py-1 px-2"
              disabled={!currentSil || toolBusy !== null}
              onClick={() => void runTool("preflight")}
              title="Verify readiness before deployment (hardkas silver preflight)"
            >
              <Play size={12} className="text-ok shrink-0" />
              <span>{toolBusy === "preflight" ? "Checking…" : "Preflight"}</span>
            </button>
            <button
              type="button"
              className="btn-ghost border border-border justify-start text-[12px] py-1 px-2"
              disabled={!currentSil || toolBusy !== null}
              onClick={() => void runTool("fuzz")}
              title="Property-based fuzzing on contract inputs (hardkas silver fuzz)"
            >
              <Sparkles size={12} className="text-warn shrink-0" />
              <span>{toolBusy === "fuzz" ? "Fuzzing…" : "Fuzz Inputs"}</span>
            </button>
            <button
              type="button"
              className="btn-ghost border border-border justify-start text-[12px] py-1 px-2"
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
              <span className="font-semibold text-fg flex items-center gap-1.5 text-[12px]">
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
                <span className="font-mono text-[12px] text-fg-muted truncate max-w-[140px]">
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
                          "font-mono text-[12px] font-bold px-1.5 py-0.5 rounded",
                          d.severity === "error" ? "bg-error/20 text-error" : "bg-warn/20 text-warn"
                        )}
                      >
                        {d.code}
                      </span>
                      <span className="font-mono text-[12px] text-accent group-hover:underline flex items-center gap-1">
                        <FileCode2 size={11} />
                        {d.file.split("/").pop()}:{d.line}:{d.column}
                        <ExternalLink size={10} />
                      </span>
                    </div>
                    <div className="text-[12px] text-fg mt-1 leading-snug break-words">{d.message}</div>
                    {d.hint && <div className="text-[12px] text-fg-muted mt-0.5">{d.hint}</div>}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {silvercMissing && (
          <div role="alert" className="rounded border border-warn/50 bg-warn/10 p-2.5 space-y-1.5">
            <div className="font-semibold text-warn text-[12px]">The SilverScript compiler (silverc) is not installed</div>
            <div className="text-fg-muted text-[12px]">HardKas downloads the pinned silverc and checks its digest before using it.</div>
            <button type="button" className="btn-primary w-full" disabled={toolBusy !== null} onClick={() => void installSilverc()} title="hardkas toolchain install silverc">
              <Download size={13} /> {toolBusy === "install" ? "Installing silverc…" : "Install silverc"}
            </button>
          </div>
        )}

        {/* What the source says. Read from the text, never executed: no IDs, scripts or costs are made up here. */}
        {currentSil && activeFileContent.trim().length > 0 && (
          <div className="rounded border border-border bg-bg-panel p-2.5 space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-fg flex items-center gap-1.5 text-[12px]">
                <Layers size={13} className="text-accent shrink-0" />
                Contract summary
              </span>
              <span className="text-[12px] text-fg-muted">read from the source</span>
            </div>

            <div className="grid grid-cols-3 gap-1.5 text-[12px] font-mono">
              <div className="rounded bg-bg px-1.5 py-1 border border-border">
                <div className="text-fg-muted text-[12px]">Entrypoints</div>
                <div className="text-fg font-semibold">{summary.entrypoints.length}</div>
              </div>
              <div className="rounded bg-bg px-1.5 py-1 border border-border">
                <div className="text-fg-muted text-[12px]">require(…)</div>
                <div className="text-fg font-semibold">{summary.requireCount}</div>
              </div>
              <div className="rounded bg-bg px-1.5 py-1 border border-border">
                <div className="text-fg-muted text-[12px]">Signature checks</div>
                <div className="text-fg font-semibold">{summary.sigChecks}</div>
              </div>
            </div>

            <div className="rounded border border-border bg-bg p-2 space-y-1 text-[12px]">
              <div className="flex items-center justify-between">
                <span className="text-fg-muted uppercase font-semibold">Compiled locking script</span>
                {summary.compiledScriptHex && (
                  <button type="button" onClick={() => void copyText(summary.compiledScriptHex ?? "")} className="text-accent hover:underline font-mono cursor-pointer">
                    Copy
                  </button>
                )}
              </div>
              {summary.compiledScriptHex ? (
                <>
                  <div className="font-mono text-fg">{summary.compiledScriptBytes} bytes · from silverc</div>
                  <div className="font-mono text-fg-muted break-all select-all max-h-16 overflow-auto">{summary.compiledScriptHex}</div>
                </>
              ) : (
                <div className="text-fg-muted">Compile the contract to see the script silverc produces.</div>
              )}
            </div>

            <div className="space-y-1">
              <div className="text-[12px] font-semibold uppercase text-fg-muted">Output constraints ({summary.outputRefs.length})</div>
              {summary.outputRefs.length === 0 ? (
                <div className="text-[12px] text-fg-muted bg-bg border border-border rounded p-2">
                  The source puts no condition on <code>tx.outputs[i]</code>.
                </div>
              ) : (
                summary.outputRefs.map((o, i) => (
                  <button
                    key={`${o.line}-${o.outputIndex}-${o.field}-${i}`}
                    type="button"
                    onClick={() => void jumpToLine(currentSil, o.line, 1)}
                    className="w-full text-left rounded border border-border bg-bg p-1.5 text-[12px] font-mono hover:bg-bg-hover cursor-pointer"
                    title="Jump to this line"
                  >
                    <span className="text-accent">{o.entrypoint}()</span> · tx.outputs[{o.outputIndex}].{o.field} <span className="text-fg">{o.constraint}</span>
                    <span className="text-fg-muted"> · :{o.line}</span>
                  </button>
                ))
              )}
            </div>
          </div>
        )}

        {currentSil && activeFileContent.trim().length > 0 && (
          <SilverDebugger file={currentSil} source={activeFileContent} argsJson={argsJson} jumpToLine={jumpToLine} />
        )}

        {toolOutput && (
          <div className="rounded border border-border bg-bg-panel p-2.5 space-y-1.5">
            <div className="flex items-center justify-between">
              <span className={clsx("font-semibold text-[12px]", toolOutput.ok ? "text-ok" : "text-warn")}>
                {toolOutput.title}
              </span>
              <button
                type="button"
                onClick={() => setToolOutput(null)}
                className="text-[12px] text-fg-muted hover:text-fg cursor-pointer"
              >
                Clear
              </button>
            </div>
            <pre className="text-[12px] font-mono bg-bg p-2 rounded border border-border max-h-48 overflow-auto whitespace-pre-wrap">
              {typeof toolOutput.data === "string" ? toolOutput.data : JSON.stringify(toolOutput.data, null, 2)}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}
