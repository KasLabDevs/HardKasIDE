import clsx from "clsx";
import { Bug, CheckCircle2, ChevronDown, ChevronRight, CircleDashed, FileCode2, Play, RotateCw, XCircle } from "lucide-react";
import { useState } from "react";
import { useEngine } from "@/engine/context";
import type { TestsPlugin } from "@/plugins/tests";
import { useTests, type TestCase, type TestFile, type TestStatus } from "@/store/tests";

/** Eclipse JUnit-style results: a green/red bar, counts, a tree of files and tests, failure trace on the right. */
export function TestsView() {
  const engine = useEngine();
  const plugin = engine.get<TestsPlugin>("tests");
  const run = useTests((s) => s.run);
  const running = useTests((s) => s.running);
  const error = useTests((s) => s.error);
  const selected = useTests((s) => s.selected);
  const select = useTests((s) => s.select);

  const selectedTest = run?.files.flatMap((f) => f.tests).find((t) => t.id === selected) ?? null;
  const ok = run ? run.failed === 0 && run.success : false;

  return (
    <div className="h-full flex flex-col min-w-0 text-xs">
      <div className="shrink-0 border-b border-border bg-bg-panel px-3 py-2 space-y-2">
        <div className="flex items-center gap-2 tabular-nums">
          <button type="button" className="btn-primary" disabled={running} onClick={() => void plugin.run()} title="npx vitest run --reporter=json">
            {running ? <RotateCw size={13} className="animate-spin" /> : <Play size={13} />} {running ? "Running…" : "Run all tests"}
          </button>
          <button type="button" className="btn-ghost" disabled={running} onClick={() => void engine.call("debug", "debugAll").catch((e: unknown) => engine.call("console", "error", String(e)))} title="Run all tests under the debugger (breakpoints, stepping)">
            <Bug size={13} /> Debug
          </button>
          {run && (
            <>
              <Stat label="Runs" value={`${run.passed + run.failed + run.skipped}/${run.total}`} />
              <Stat label="Errors" value={String(run.failed)} tone={run.failed ? "error" : undefined} />
              <Stat label="Failures" value={String(run.failed)} tone={run.failed ? "error" : undefined} />
              <Stat label="Skipped" value={String(run.skipped)} />
              <span className="ml-auto text-fg-muted">{new Date(run.finishedAt ?? run.startedAt).toLocaleTimeString(undefined, { hour12: false })}</span>
            </>
          )}
        </div>
        {/* the JUnit bar */}
        <div role="progressbar" aria-valuemin={0} aria-valuemax={run?.total ?? 100} aria-valuenow={run ? run.passed + run.failed : 0} className="h-2.5 rounded bg-bg-hover overflow-hidden">
          {run && <div className={clsx("h-full transition-all", ok ? "bg-ok" : "bg-error")} style={{ width: run.total ? `${((run.passed + run.failed) / run.total) * 100}%` : "100%" }} />}
          {running && !run && <div className="h-full w-1/3 bg-info animate-pulse" />}
        </div>
        {error && <div role="alert" className="text-error whitespace-pre-wrap break-words">{error}</div>}
      </div>

      <div className="flex-1 min-h-0 flex">
        <div className="flex-1 min-w-0 overflow-auto py-1">
          {!run && !running && !error && (
            <div className="p-4 text-fg-muted">
              No test run yet. HardKas projects ship a vitest suite (for example <code>test/payment.test.ts</code>) that plans, signs and simulates a payment. Run it to see each test light up.
            </div>
          )}
          {run?.files.map((f) => (
            <FileNode key={f.file} file={f} selected={selected} onSelect={(t) => select(t.id)} onOpen={(file, line) => void plugin.openTest(file, line)} />
          ))}
        </div>
        <aside className="w-[40%] min-w-[260px] border-l border-border bg-bg-panel p-3 overflow-auto">
          <div className="label">Failure trace</div>
          {!selectedTest && <div className="text-fg-muted">Select a test to see its details.</div>}
          {selectedTest && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 min-w-0">
                <StatusIcon status={selectedTest.status} />
                <span className="font-semibold text-fg break-words min-w-0">{selectedTest.fullName}</span>
              </div>
              {selectedTest.durationMs !== null && <div className="text-fg-muted tabular-nums">{selectedTest.durationMs} ms</div>}
              <div className="flex flex-wrap gap-2">
                {selectedTest.location && (
                  <button type="button" className="btn-ghost" onClick={() => void plugin.openTest(selectedTest.location!.file, selectedTest.location!.line)}>
                    <FileCode2 size={12} /> {selectedTest.location.file}:{selectedTest.location.line}
                  </button>
                )}
                {selectedTest.location && (
                  <button type="button" className="btn-ghost" onClick={() => void engine.call("debug", "debugTest", selectedTest.location!.file, selectedTest.title).catch((e: unknown) => engine.call("console", "error", String(e)))} title="Run only this test under the debugger">
                    <Bug size={12} /> Debug this test
                  </button>
                )}
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
          )}
        </aside>
      </div>
    </div>
  );
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

function FileNode({ file, selected, onSelect, onOpen }: { file: TestFile; selected: string | null; onSelect: (t: TestCase) => void; onOpen: (file: string, line?: number) => void }) {
  const [open, setOpen] = useState(true);
  const passed = file.tests.filter((t) => t.status === "passed").length;
  return (
    <div>
      <div
        role="button"
        tabIndex={0}
        aria-expanded={open}
        className="flex items-center gap-1.5 px-2 py-1 hover:bg-bg-hover cursor-pointer outline-none"
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
        <span className="font-mono text-fg truncate">{file.file}</span>
        <span className="ml-auto text-[10px] text-fg-muted whitespace-nowrap tabular-nums">
          {passed}/{file.tests.length}
          {file.durationMs !== null ? ` · ${file.durationMs} ms` : ""}
        </span>
      </div>
      {file.message && file.tests.length === 0 && <pre className="mx-3 my-1 rounded border border-error/40 bg-bg p-2 text-[11px] text-error whitespace-pre-wrap">{file.message}</pre>}
      {open &&
        file.tests.map((t) => (
          <div
            key={t.id}
            role="button"
            tabIndex={0}
            className={clsx("flex items-center gap-1.5 pl-8 pr-2 py-0.5 cursor-pointer outline-none", selected === t.id ? "bg-bg-hover text-fg font-medium" : "hover:bg-bg-hover")}
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
            {t.durationMs !== null && <span className="ml-auto text-[10px] text-fg-muted tabular-nums shrink-0">{t.durationMs} ms</span>}
          </div>
        ))}
    </div>
  );
}
