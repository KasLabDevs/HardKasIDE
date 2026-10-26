import clsx from "clsx";
import { ArrowDownToLine, ArrowUpFromLine, Bug, CheckCircle2, ChevronDown, ChevronRight, CircleDashed, FileCode2, Play, RotateCw, Square, StepForward, XCircle } from "lucide-react";
import { useState } from "react";
import { useEngine } from "@/engine/context";
import type { DebugPlugin } from "@/plugins/debug";
import type { TestsPlugin } from "@/plugins/tests";
import { useDebug } from "@/store/debug";
import { useTests, type TestCase, type TestFile, type TestStatus } from "@/store/tests";
import { Breakpoints, CallStack, Output, Tool, Variables, Watches } from "./DebugSections";

/**
 * Tests view (Eclipse JUnit style) with the debugger built in: run or debug everything, a file or one test; the green or
 * red bar and the tree of results; and while a debug session is open, the controls, call stack, variables and watches
 * right here, with the editor staying visible beside the view so you can follow the line the test is stopped on.
 */
export function TestsPanel() {
  const engine = useEngine();
  const tests = engine.get<TestsPlugin>("tests");
  const debug = engine.get<DebugPlugin>("debug");
  const run = useTests((s) => s.run);
  const running = useTests((s) => s.running);
  const error = useTests((s) => s.error);
  const selected = useTests((s) => s.selected);
  const select = useTests((s) => s.select);
  const debugState = useDebug((s) => s.state);
  const debugMessage = useDebug((s) => s.message);
  const reason = useDebug((s) => s.reason);
  const detail = useDebug((s) => s.detail);
  const pauseOnExceptions = useDebug((s) => s.pauseOnExceptions);
  const [localError, setLocalError] = useState<string | null>(null);

  const live = debugState === "starting" || debugState === "running" || debugState === "paused";
  const paused = debugState === "paused";
  const session = debugState !== "idle";
  const selectedTest = run?.files.flatMap((f) => f.tests).find((t) => t.id === selected) ?? null;
  const ok = run ? run.failed === 0 && run.success : false;

  const guard = (fn: () => Promise<unknown>) => () => {
    setLocalError(null);
    void fn().catch((e: unknown) => setLocalError(e instanceof Error ? e.message : String(e)));
  };
  const debugSelected = selectedTest?.location ? () => debug.debugTest(selectedTest.location!.file, selectedTest.title) : () => debug.debugAll();

  const results = (
    <div className="py-1">
      {!run && !running && !error && (
        <div className="px-3 py-2 text-fg-muted">
          No test run yet. HardKas projects ship a vitest suite (for example <code>test/payment.test.ts</code>). Run it to see each test light up, or debug it with breakpoints.
        </div>
      )}
      {run?.files.map((f) => (
        <FileNode
          key={f.file}
          file={f}
          selected={selected}
          onSelect={(t) => select(t.id)}
          onOpen={(file, line) => void tests.openTest(file, line)}
          onRun={(file) => void tests.runFile(file)}
          onDebugFile={guard(() => debug.debugFile(f.file))}
          onDebugTest={(t) => guard(() => debug.debugTest(t.location?.file ?? f.file, t.title))()}
          busy={running || live}
        />
      ))}
    </div>
  );

  const details = selectedTest && (
    <div className="px-3 py-2 border-t border-border space-y-2">
      <div className="label mb-0">Selected test</div>
      <div className="flex items-center gap-2 min-w-0">
        <StatusIcon status={selectedTest.status} />
        <span className="font-semibold text-fg break-words min-w-0">{selectedTest.fullName}</span>
      </div>
      {selectedTest.durationMs !== null && <div className="text-fg-muted tabular-nums">{selectedTest.durationMs} ms</div>}
      <div className="flex flex-wrap gap-2">
        {selectedTest.location && (
          <button type="button" className="btn-ghost" onClick={() => void tests.openTest(selectedTest.location!.file, selectedTest.location!.line)}>
            <FileCode2 size={12} /> {selectedTest.location.file}:{selectedTest.location.line}
          </button>
        )}
        <button type="button" className="btn-ghost" disabled={live} onClick={guard(debugSelected)} title="Run only this test under the debugger">
          <Bug size={12} /> Debug this test
        </button>
      </div>
      {selectedTest.failureMessages.length === 0 ? (
        <div className={selectedTest.status === "passed" ? "text-ok" : "text-fg-muted"}>{selectedTest.status === "passed" ? "Passed." : "No failure message."}</div>
      ) : (
        selectedTest.failureMessages.map((m, i) => (
          <pre key={i} className="rounded border border-error/40 bg-bg p-2 text-[11px] text-error whitespace-pre-wrap break-words">
            {m}
          </pre>
        ))
      )}
    </div>
  );

  return (
    <div className="text-xs">
      {/* ------------------------------------------------------------ toolbar */}
      <div className="px-3 py-2 border-b border-border space-y-2">
        {!live ? (
          <div className="flex gap-1">
            <button type="button" className="btn-primary flex-1 justify-center" disabled={running} onClick={() => void tests.run()} title="npx vitest run --reporter=json">
              {running ? <RotateCw size={13} className="animate-spin" /> : <Play size={13} />} {running ? "Running…" : "Run all"}
            </button>
            <button type="button" className="btn-ghost flex-1 justify-center" disabled={running} onClick={guard(debugSelected)} title={selectedTest ? "Debug the selected test" : "Run all tests under the debugger (breakpoints, stepping)"}>
              <Bug size={13} /> {selectedTest ? "Debug test" : "Debug all"}
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-1">
            <Tool icon={<Play size={14} />} label="Continue (F5)" disabled={!paused} onClick={guard(() => debug.resume())} accent />
            <Tool icon={<StepForward size={14} />} label="Step over (F10)" disabled={!paused} onClick={guard(() => debug.stepOver())} />
            <Tool icon={<ArrowDownToLine size={14} />} label="Step into (F11)" disabled={!paused} onClick={guard(() => debug.stepInto())} />
            <Tool icon={<ArrowUpFromLine size={14} />} label="Step out (Shift+F11)" disabled={!paused} onClick={guard(() => debug.stepOut())} />
            <Tool icon={<RotateCw size={14} />} label="Restart" onClick={guard(() => debug.restart())} />
            <Tool icon={<Square size={13} />} label="Stop (Shift+F5)" onClick={guard(() => debug.stop())} danger />
          </div>
        )}

        {session && (
          <div className="flex items-center gap-2 min-w-0">
            <span className={clsx("w-2 h-2 rounded-full shrink-0", paused ? "bg-warn" : live ? "bg-ok animate-pulse" : debugState === "error" ? "bg-error" : "bg-fg-muted")} />
            <span className="text-fg-muted truncate" title={paused && detail ? detail : debugMessage}>
              {paused ? `Debugging · paused (${pauseLabel(reason)})${detail ? `: ${detail}` : ""}` : debugState === "starting" ? "Debugging · starting…" : debugState === "running" ? "Debugging · running…" : debugState === "finished" ? `Debug ended · ${debugMessage || "finished"}` : `Debug error · ${debugMessage}`}
            </span>
          </div>
        )}
        {(localError || (debugState === "error" && debugMessage)) && (
          <div role="alert" className="text-error break-words">
            {localError ?? debugMessage}
          </div>
        )}
        {error && <div role="alert" className="text-error whitespace-pre-wrap break-words">{error}</div>}

        {run && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 tabular-nums">
            <Stat label="Runs" value={`${run.passed + run.failed + run.skipped}/${run.total}`} />
            <Stat label="Failures" value={String(run.failed)} tone={run.failed ? "error" : undefined} />
            <Stat label="Skipped" value={String(run.skipped)} />
            <span className="ml-auto text-fg-muted">{new Date(run.finishedAt ?? run.startedAt).toLocaleTimeString(undefined, { hour12: false })}</span>
          </div>
        )}
        <div role="progressbar" aria-valuemin={0} aria-valuemax={run?.total ?? 100} aria-valuenow={run ? run.passed + run.failed : 0} className="h-2.5 rounded bg-bg-hover overflow-hidden">
          {run && <div className={clsx("h-full transition-all", ok ? "bg-ok" : "bg-error")} style={{ width: run.total ? `${((run.passed + run.failed) / run.total) * 100}%` : "100%" }} />}
          {running && !run && <div className="h-full w-1/3 bg-info animate-pulse" />}
        </div>
      </div>

      {/* while debugging, what the debugger shows comes first */}
      {paused && <CallStack />}
      {paused && <Variables plugin={debug} />}
      {live && <Watches plugin={debug} />}

      {results}
      {details}

      <label className="flex items-center gap-2 px-3 py-1.5 border-t border-border text-fg-muted cursor-pointer">
        <input type="checkbox" checked={pauseOnExceptions !== "none"} onChange={(e) => void debug.setPauseOnExceptions(e.target.checked ? "all" : "none")} />
        Pause when an exception is thrown
      </label>
      {!live && <Watches plugin={debug} />}
      <Breakpoints plugin={debug} />
      {session && <Output />}
    </div>
  );
}

/** V8's pause reasons in plain words: "other" and "ambiguous" are how it reports a breakpoint. */
function pauseLabel(reason: string): string {
  switch (reason) {
    case "step":
      return "step";
    case "exception":
      return "exception";
    case "promiseRejection":
      return "rejected promise";
    case "debugCommand":
      return "debugger statement";
    case "assert":
      return "assertion";
    default:
      return "breakpoint";
  }
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "error" }) {
  return (
    <span className="text-fg-muted tabular-nums">
      {label}: <span className={clsx("font-semibold", tone === "error" ? "text-error" : "text-fg")}>{value}</span>
    </span>
  );
}

function StatusIcon({ status }: { status: TestStatus }) {
  if (status === "passed") return <CheckCircle2 size={14} className="text-ok shrink-0" />;
  if (status === "failed") return <XCircle size={14} className="text-error shrink-0" />;
  return <CircleDashed size={14} className="text-fg-muted shrink-0" />;
}

function RowButton({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className="p-0.5 rounded text-fg-muted hover:text-accent hover:bg-bg-hover cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed opacity-0 group-hover:opacity-100 focus:opacity-100"
    >
      {children}
    </button>
  );
}

function FileNode({
  file,
  selected,
  onSelect,
  onOpen,
  onRun,
  onDebugFile,
  onDebugTest,
  busy
}: {
  file: TestFile;
  selected: string | null;
  onSelect: (t: TestCase) => void;
  onOpen: (file: string, line?: number) => void;
  onRun: (file: string) => void;
  onDebugFile: () => void;
  onDebugTest: (t: TestCase) => void;
  busy: boolean;
}) {
  const [open, setOpen] = useState(true);
  const passed = file.tests.filter((t) => t.status === "passed").length;
  return (
    <div>
      <div
        role="button"
        tabIndex={0}
        aria-expanded={open}
        className="group flex items-center gap-1.5 px-2 py-1 hover:bg-bg-hover cursor-pointer outline-none"
        onClick={() => setOpen((o) => !o)}
        onDoubleClick={() => onOpen(file.file)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setOpen((o) => !o);
          }
        }}
      >
        <span className="text-fg-muted shrink-0">{open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}</span>
        <StatusIcon status={file.status} />
        <span className="font-mono text-fg truncate" title={file.file}>
          {file.file}
        </span>
        <span className="ml-auto flex items-center gap-0.5 shrink-0">
          <RowButton label={`Run ${file.file}`} onClick={() => onRun(file.file)} disabled={busy}>
            <Play size={12} />
          </RowButton>
          <RowButton label={`Debug ${file.file}`} onClick={onDebugFile} disabled={busy}>
            <Bug size={12} />
          </RowButton>
          <span className="text-[10px] text-fg-muted whitespace-nowrap tabular-nums pl-1">
            {passed}/{file.tests.length}
          </span>
        </span>
      </div>
      {file.message && file.tests.length === 0 && <pre className="mx-3 my-1 rounded border border-error/40 bg-bg p-2 text-[11px] text-error whitespace-pre-wrap">{file.message}</pre>}
      {open &&
        file.tests.map((t) => (
          <div
            key={t.id}
            role="button"
            tabIndex={0}
            className={clsx("group flex items-center gap-1.5 pl-7 pr-2 py-0.5 cursor-pointer outline-none", selected === t.id ? "bg-bg-hover text-fg font-medium" : "hover:bg-bg-hover")}
            onClick={() => onSelect(t)}
            onDoubleClick={() => onOpen(t.location?.file ?? file.file, t.location?.line)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onSelect(t);
              }
            }}
            title={t.fullName}
          >
            <StatusIcon status={t.status} />
            <span className="truncate">
              {t.ancestors.length > 0 && <span className="text-fg-muted">{t.ancestors.join(" › ")} › </span>}
              {t.title}
            </span>
            <span className="ml-auto flex items-center gap-0.5 shrink-0">
              <RowButton label={`Debug test ${t.title}`} onClick={() => onDebugTest(t)} disabled={busy}>
                <Bug size={12} />
              </RowButton>
              {t.durationMs !== null && <span className="text-[10px] text-fg-muted tabular-nums pl-1">{t.durationMs} ms</span>}
            </span>
          </div>
        ))}
    </div>
  );
}
