import clsx from "clsx";
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, CircleDashed, Loader2, ShieldCheck, XCircle } from "lucide-react";
import { useState } from "react";
import { useEngine } from "@/engine/context";
import type { IndexPlugin } from "@/plugins/indexView";
import { useIndex } from "@/store/indexStore";
import { storePost } from "@/utils/storeApi";
import { shorten, useRelativePath } from "./common";

type Level = "pending" | "running" | "ok" | "warn" | "error";
interface Check {
  id: string;
  title: string;
  level: Level;
  summary: string;
  items: Array<{ key: string; label: string; detail?: string; txId?: string; file?: string; artifactId?: string }>;
}

const INITIAL: Check[] = [
  { id: "fresh", title: "Index is current", level: "pending", summary: "", items: [] },
  { id: "verify", title: "Artifacts verify (hashes, schema, lineage)", level: "pending", summary: "", items: [] },
  { id: "orphans", title: "Lineage has no broken links", level: "pending", summary: "", items: [] },
  { id: "replay", title: "Replays match their receipts", level: "pending", summary: "", items: [] },
  { id: "traces", title: "Workflow traces finished", level: "pending", summary: "", items: [] }
];

/** One button runs every integrity check HardKAS has; each result is a list you can click through. */
export function ProblemsTab() {
  const engine = useEngine();
  const plugin = engine.get<IndexPlugin>("queryIndex");
  const rel = useRelativePath();
  const [checks, setChecks] = useState<Check[]>(INITIAL);
  const [running, setRunning] = useState(false);
  const [ranAt, setRanAt] = useState<Date | null>(null);

  const patch = (id: string, p: Partial<Check>) => setChecks((cs) => cs.map((c) => (c.id === id ? { ...c, ...p } : c)));

  const runAll = async () => {
    setRunning(true);
    setChecks(INITIAL.map((c) => ({ ...c, level: "pending" })));
    const guard = async (id: string, fn: () => Promise<Partial<Check>>) => {
      patch(id, { level: "running" });
      try {
        patch(id, await fn());
      } catch (e) {
        patch(id, { level: "error", summary: e instanceof Error ? e.message : String(e), items: [] });
      }
    };

    await guard("fresh", async () => {
      await plugin.refresh();
      const h = useIndex.getState().health;
      if (!h?.exists) return { level: "warn", summary: "There is no index yet. Build it from the Overview tab." };
      return h.stale ? { level: "warn", summary: "Files on disk are newer than the index. Sync it from the Overview tab." } : { level: "ok", summary: `Indexed ${h.counts?.artifacts ?? 0} artifacts, nothing newer on disk.` };
    });

    await guard("verify", async () => {
      const r = (await plugin.verify()) as { result?: { scanned?: number; failCount?: number; results?: Array<{ file: string; result: { ok: boolean; errors?: string[]; issues?: Array<{ code: string; message: string }> } }> } } | null;
      const res = r?.result;
      if (!res?.results) return { level: "error", summary: "verify did not return a report." };
      const bad = res.results.filter((x) => !x.result.ok);
      const codes = new Map<string, number>();
      for (const b of bad) for (const i of b.result.issues ?? []) codes.set(i.code, (codes.get(i.code) ?? 0) + 1);
      return {
        level: bad.length ? "error" : "ok",
        summary: bad.length ? `${bad.length} of ${res.scanned} files fail${codes.size ? ` · ${[...codes].map(([c, n]) => `${c} ×${n}`).join(", ")}` : ""}` : `All ${res.scanned} files verify.`,
        items: bad.map((b) => ({ key: b.file, label: b.file, detail: (b.result.issues?.map((i) => i.message) ?? b.result.errors ?? []).join(" · "), file: `.hardkas/artifacts/${b.file.replace(/\\/g, "/")}` }))
      };
    });

    await guard("orphans", async () => {
      const r = (await plugin.query(["query", "lineage", "orphans", "--json"])) as { result?: { items?: Array<Record<string, unknown>> } } | null;
      const items = r?.result?.items ?? [];
      return { level: items.length ? "warn" : "ok", summary: items.length ? `${items.length} artifact${items.length === 1 ? "" : "s"} point to a parent that is missing.` : "Every lineage link resolves.", items: items.slice(0, 100).map((i, n) => ({ key: String(n), label: String(i.artifactId ?? i.artifact_id ?? JSON.stringify(i)).slice(0, 80), detail: JSON.stringify(i).slice(0, 200), artifactId: String(i.artifactId ?? i.artifact_id ?? "") || undefined })) };
    });

    await guard("replay", async () => {
      const r = (await plugin.query(["query", "replay", "divergences", "--json"])) as { result?: { items?: Array<{ txId: string; kind: string; field: string; expected: string; actual: string }> } } | null;
      const items = r?.result?.items ?? [];
      const kinds = new Map<string, number>();
      for (const i of items) kinds.set(i.kind, (kinds.get(i.kind) ?? 0) + 1);
      return {
        level: items.length ? "warn" : "ok",
        summary: items.length ? `${items.length} divergence${items.length === 1 ? "" : "s"} · ${[...kinds].map(([k, n]) => `${k} ×${n}`).join(", ")}` : "No receipt diverges from its replay.",
        items: items.slice(0, 200).map((i, n) => ({ key: `${i.txId}-${n}`, label: `${i.kind} · ${i.field}`, detail: `expected ${i.expected}; got ${i.actual}`, txId: i.txId }))
      };
    });

    await guard("traces", async () => {
      const r = await storePost<{ rows: Array<{ trace_id: string; workflow_id: string; started_at: string }> }>("sql", { sql: "select trace_id, workflow_id, started_at from traces where status = 'running' and ended_at is null order by started_at" });
      return {
        level: r.rows.length ? "warn" : "ok",
        summary: r.rows.length ? `${r.rows.length} trace${r.rows.length === 1 ? "" : "s"} still say “running” (the process that wrote them probably ended).` : "Every trace has an end.",
        items: r.rows.map((t) => ({ key: t.trace_id, label: t.workflow_id, detail: `started ${t.started_at}` }))
      };
    });

    setRanAt(new Date());
    setRunning(false);
  };

  return (
    <div className="h-full overflow-auto p-4 space-y-3 max-w-4xl">
      <div className="flex items-center gap-3">
        <button type="button" className="btn-primary" disabled={running} onClick={() => void runAll()}>
          {running ? <Loader2 size={13} className="animate-spin" /> : <ShieldCheck size={13} />} {running ? "Checking…" : ranAt ? "Check again" : "Run all checks"}
        </button>
        <span className="text-fg-muted">{ranAt ? `Last run ${ranAt.toLocaleTimeString(undefined, { hour12: false })}` : "Runs verify, lineage, replay and trace checks (a few seconds)."}</span>
      </div>
      {checks.map((c) => (
        <CheckCard key={c.id} check={c} rel={rel} onTx={(id) => plugin.showTx(id)} onArtifact={(id) => plugin.showArtifact(id)} onFile={(f) => void engine.call("fileManager", "open", f).catch(() => undefined)} />
      ))}
    </div>
  );
}

function Icon({ level }: { level: Level }) {
  if (level === "ok") return <CheckCircle2 size={15} className="text-ok shrink-0" />;
  if (level === "warn") return <AlertTriangle size={15} className="text-warn shrink-0" />;
  if (level === "error") return <XCircle size={15} className="text-error shrink-0" />;
  if (level === "running") return <Loader2 size={15} className="animate-spin text-info shrink-0" />;
  return <CircleDashed size={15} className="text-fg-muted shrink-0" />;
}

function CheckCard({ check, rel, onTx, onArtifact, onFile }: { check: Check; rel: ReturnType<typeof useRelativePath>; onTx: (id: string) => void; onArtifact: (id: string) => void; onFile: (f: string) => void }) {
  const [open, setOpen] = useState(false);
  const expandable = check.items.length > 0;
  return (
    <div className={clsx("rounded border bg-bg-elev", check.level === "error" ? "border-error/40" : check.level === "warn" ? "border-warn/40" : "border-border")}>
      <button type="button" disabled={!expandable} aria-expanded={open} onClick={() => setOpen((o) => !o)} className={clsx("w-full flex items-start gap-2 px-3 py-2 text-left", expandable && "cursor-pointer")}>
        <Icon level={check.level} />
        <span className="min-w-0 flex-1">
          <span className="block font-semibold text-fg">{check.title}</span>
          {check.summary && <span className="block text-fg-muted break-words">{check.summary}</span>}
        </span>
        {expandable && (open ? <ChevronDown size={14} className="text-fg-muted shrink-0 mt-0.5" /> : <ChevronRight size={14} className="text-fg-muted shrink-0 mt-0.5" />)}
      </button>
      {open && (
        <div className="border-t border-border max-h-80 overflow-auto">
          {check.items.map((i) => (
            <div key={i.key} className="px-3 py-1.5 border-b border-border/40 last:border-0 space-y-0.5">
              <div className="flex items-center gap-2 min-w-0">
                <span className="font-mono text-[11px] truncate" title={i.label}>
                  {i.label}
                </span>
                <span className="ml-auto flex gap-2 shrink-0">
                  {i.txId && (
                    <button type="button" className="text-[10px] text-accent hover:underline cursor-pointer" onClick={() => onTx(i.txId!)}>
                      {shorten(i.txId, 12)} → transaction
                    </button>
                  )}
                  {i.artifactId && (
                    <button type="button" className="text-[10px] text-accent hover:underline cursor-pointer" onClick={() => onArtifact(i.artifactId!)}>
                      artifact
                    </button>
                  )}
                  {i.file && rel(i.file) && (
                    <button type="button" className="text-[10px] text-accent hover:underline cursor-pointer" onClick={() => onFile(rel(i.file)!)}>
                      open file
                    </button>
                  )}
                </span>
              </div>
              {i.detail && <div className="text-fg-muted break-words">{i.detail}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
