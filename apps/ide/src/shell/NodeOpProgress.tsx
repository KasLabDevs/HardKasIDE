import clsx from "clsx";
import { AlertTriangle, CheckCircle2, Circle, Loader2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useEnv, type NodeOp } from "@/store/env";

/** Elapsed seconds since `since`, ticking while `active`. */
function useElapsed(since: number, active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [active]);
  return Math.max(0, Math.round(((active ? now : Date.now()) - since) / 1000));
}

/** The steps of a node operation with a spinner on the current one. Used by the banner and the Servers card. */
export function OpSteps({ op, compact }: { op: NodeOp; compact?: boolean }) {
  const elapsed = useElapsed(op.startedAt, op.state === "running");
  const done = op.steps.filter((s) => s.status === "done").length;
  return (
    <div className="space-y-1.5">
      <div className="h-1.5 rounded bg-bg-hover overflow-hidden" role="progressbar" aria-valuemin={0} aria-valuemax={op.steps.length} aria-valuenow={done} aria-label={op.title}>
        <div className={clsx("h-full transition-all duration-500", op.state === "error" ? "bg-error" : "bg-accent", op.state === "running" && "animate-pulse")} style={{ width: `${Math.max(6, (done / op.steps.length) * 100)}%` }} />
      </div>
      <ol className={clsx("space-y-0.5", compact && "text-[11px]")}>
        {op.steps.map((s, i) => (
          <li key={i} className={clsx("flex items-start gap-1.5", s.status === "pending" && "text-fg-muted/70", s.status === "running" && "text-fg", s.status === "done" && "text-fg-muted", s.status === "error" && "text-error")}>
            <span className="mt-0.5 shrink-0">
              {s.status === "running" ? <Loader2 size={12} className="animate-spin text-accent" /> : s.status === "done" ? <CheckCircle2 size={12} className="text-ok" /> : s.status === "error" ? <AlertTriangle size={12} /> : <Circle size={12} />}
            </span>
            <span className="min-w-0">
              {s.label}
              {s.detail && <span className="ml-1.5 text-[10px] text-fg-muted break-words">{s.detail}</span>}
            </span>
          </li>
        ))}
      </ol>
      {op.state === "running" && <div className="text-[10px] text-fg-muted tabular-nums">{elapsed}s elapsed · step {Math.min(done + 1, op.steps.length)} of {op.steps.length}</div>}
    </div>
  );
}

/** Global banner above the editor while a node operation runs (and after it, until dismissed or faded). */
export function NodeOpBanner() {
  const op = useEnv((s) => s.nodeOp);
  const setNodeOp = useEnv((s) => s.setNodeOp);
  if (!op) return null;
  return (
    <div role="status" aria-live="polite" className={clsx("shrink-0 px-3 py-2 border-b text-xs", op.state === "error" ? "border-error/40 bg-error/10" : op.state === "done" ? "border-ok/40 bg-ok/10" : "border-accent/40 bg-accent/10")}>
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0 space-y-1.5">
          <div className={clsx("font-semibold", op.state === "error" ? "text-error" : op.state === "done" ? "text-ok" : "text-accent")}>
            {op.state === "running" ? `${op.title}…` : op.state === "done" ? `${op.title}: done` : `${op.title}: failed`}
          </div>
          {op.state === "running" && <div className="text-fg-muted">Please wait: the Accounts and Deploy & Run views unlock when the node is ready.</div>}
          {op.state === "done" && op.next && <div className="text-fg-muted">{op.next}</div>}
          {op.state === "error" && op.error && <div className="text-fg-muted break-words">{op.error}</div>}
          <OpSteps op={op} compact />
        </div>
        {op.state !== "running" && (
          <button type="button" onClick={() => setNodeOp(null)} className="p-0.5 rounded text-fg-muted hover:text-fg hover:bg-bg-hover cursor-pointer shrink-0" title="Dismiss" aria-label="Dismiss progress">
            <X size={13} />
          </button>
        )}
      </div>
    </div>
  );
}

/** Dimmed, click-blocking cover for views whose data is stale while the node changes underneath. */
export function NodeBusyCover({ label = "Waiting for the local node…" }: { label?: string }) {
  const op = useEnv((s) => s.nodeOp);
  if (!op || op.state !== "running") return null;
  const done = op.steps.filter((s) => s.status === "done").length;
  const current = op.steps.find((s) => s.status === "running");
  return (
    <div className="absolute inset-0 z-10 flex flex-col items-center justify-start pt-16 gap-2 bg-bg/85 backdrop-blur-[1px] text-xs px-4 text-center" role="status" aria-live="polite">
      <Loader2 size={22} className="animate-spin text-accent" />
      <div className="font-semibold text-fg">{label}</div>
      <div className="text-fg-muted">{op.title}</div>
      {current && <div className="text-fg-muted text-[11px]">Step {done + 1} of {op.steps.length}: {current.label}</div>}
    </div>
  );
}
