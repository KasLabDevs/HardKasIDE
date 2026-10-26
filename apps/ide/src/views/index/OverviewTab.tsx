import { AlertTriangle, CheckCircle2, DatabaseZap, RefreshCw, ShieldCheck, Stethoscope } from "lucide-react";
import { useEngine } from "@/engine/context";
import type { IndexPlugin } from "@/plugins/indexView";
import { shortKind, useIndex } from "@/store/indexStore";
import { Bars, KindChip, Stat, fmtBytes, when } from "./common";

/** Health of the store, what it holds, and the buttons that keep it current. */
export function OverviewTab() {
  const engine = useEngine();
  const plugin = engine.get<IndexPlugin>("queryIndex");
  const health = useIndex((s) => s.health);
  const error = useIndex((s) => s.healthError);
  const busy = useIndex((s) => s.busyAction);
  const message = useIndex((s) => s.actionMessage);
  const set = useIndex((s) => s.set);

  const pickFilter = (key: "schema" | "mode" | "network", value: string) => {
    set({ filters: { ...useIndex.getState().filters, schema: "", mode: "", network: "", q: "", [key]: value }, tab: "artifacts", selectedId: null });
  };

  const rebuild = () => {
    if (window.confirm("Rebuild the index from the artifacts on disk?\n\nIt only recreates .hardkas/store.db. Your artifacts and files are not touched.")) void plugin.rebuild();
  };

  if (error && !health) {
    return (
      <div className="p-4 space-y-2">
        <div role="alert" className="text-error">{error}</div>
        <button type="button" className="btn-ghost" onClick={() => void plugin.refresh()}>
          <RefreshCw size={13} /> Try again
        </button>
      </div>
    );
  }
  if (!health) return <div className="p-4 text-fg-muted">Reading the index…</div>;

  if (!health.exists) {
    return (
      <div className="p-6 max-w-lg space-y-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-fg">
          <DatabaseZap size={16} className="text-accent" /> This project has no index yet
        </div>
        <p className="text-fg-muted leading-relaxed">
          HardKAS keeps a SQLite index of every artifact, event and lineage link in <code>.hardkas/store.db</code>. It is built from the artifacts on disk, so building it is safe and repeatable. Once it exists you can browse, filter and query everything here.
        </p>
        <button type="button" className="btn-primary" disabled={!!busy} onClick={() => void plugin.rebuild()}>
          <DatabaseZap size={13} /> {busy === "Rebuild" ? "Building…" : "Build the index"}
        </button>
        {message && <div className="text-fg-muted">{message}</div>}
      </div>
    );
  }

  const c = health.counts!;
  const runningTraces = health.tracesByStatus?.find((t) => t.name === "running")?.count ?? 0;

  return (
    <div className="p-4 space-y-4">
      {/* freshness */}
      <div className={health.stale ? "rounded border border-warn/50 bg-warn/10 p-3 flex items-center gap-3 flex-wrap" : "rounded border border-ok/40 bg-ok/10 p-3 flex items-center gap-3 flex-wrap"}>
        {health.stale ? <AlertTriangle size={16} className="text-warn shrink-0" /> : <CheckCircle2 size={16} className="text-ok shrink-0" />}
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-fg">{health.stale ? "The index is behind the files on disk" : "The index is up to date"}</div>
          <div className="text-fg-muted">
            Last indexed {when(health.indexedAt)} · {c.artifacts.toLocaleString()} artifacts and {c.events.toLocaleString()} events in the index
            {health.stale && health.staleSince ? ` · newest file on disk ${when(health.staleSince)}` : ""}
          </div>
        </div>
        {health.stale && (
          <button type="button" className="btn-primary" disabled={!!busy} onClick={() => void plugin.sync()}>
            <RefreshCw size={13} className={busy === "Sync" ? "animate-spin" : ""} /> {busy === "Sync" ? "Syncing…" : "Sync now"}
          </button>
        )}
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-2">
        <Stat label="Artifacts" value={c.artifacts.toLocaleString()} sub={`${health.byKind?.length ?? 0} kinds`} />
        <Stat label="Events" value={c.events.toLocaleString()} sub={`${health.eventsByDomain?.length ?? 0} domains`} />
        <Stat label="Lineage links" value={c.lineageEdges.toLocaleString()} sub={`${c.lineageClosure.toLocaleString()} in the closure`} />
        <Stat label="Workflow traces" value={c.traces.toLocaleString()} sub={runningTraces ? `${runningTraces} still “running”` : "all finished"} tone={runningTraces ? "warn" : undefined} />
        <Stat label="Database" value={fmtBytes(health.sizeBytes)} sub={`+ ${fmtBytes(health.walBytes)} write-ahead log`} />
      </div>

      {/* actions */}
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="btn-ghost" disabled={!!busy} onClick={() => void plugin.sync()} title="hardkas query store sync: index what is new">
          <RefreshCw size={13} className={busy === "Sync" ? "animate-spin" : ""} /> Sync
        </button>
        <button type="button" className="btn-ghost" disabled={!!busy} onClick={rebuild} title="hardkas query store rebuild: wipe the index and build it again from the artifacts">
          <DatabaseZap size={13} /> {busy === "Rebuild" ? "Rebuilding…" : "Rebuild"}
        </button>
        <button type="button" className="btn-ghost" disabled={!!busy} onClick={() => void plugin.doctor()} title="hardkas query store doctor (the answer goes to the Console)">
          <Stethoscope size={13} /> Doctor
        </button>
        <button type="button" className="btn-ghost" onClick={() => set({ tab: "problems" })} title="Verify hashes and lineage, find orphans and replay divergences">
          <ShieldCheck size={13} /> Check for problems
        </button>
        {message && (
          <span role="status" className="text-fg-muted">
            {message}
          </span>
        )}
      </div>

      <div className="grid lg:grid-cols-2 gap-3">
        <Bars title="Artifacts by kind" items={health.byKind ?? []} onPick={(n) => pickFilter("schema", n)} label={(n) => <KindLabel name={n} />} />
        <div className="space-y-3 min-w-0">
          <Bars title="By mode" items={health.byMode ?? []} onPick={(n) => pickFilter("mode", n)} />
          <Bars title="By network" items={health.byNetwork ?? []} onPick={(n) => pickFilter("network", n)} />
        </div>
        <Bars title="Events by domain" items={health.eventsByDomain ?? []} />
        <Bars title="Workflow traces by status" items={health.tracesByStatus ?? []} />
      </div>

      <details className="rounded border border-border bg-bg-elev p-3">
        <summary className="cursor-pointer text-fg-muted">Schema and file</summary>
        <div className="mt-2 space-y-1 font-mono text-[11px]">
          <div className="break-all">{health.path}</div>
          {health.migrations?.map((m) => (
            <div key={m.version} className="text-fg-muted">
              migration {m.version} · {m.name} · {when(m.appliedAt)}
            </div>
          ))}
          {Object.entries(health.metadata ?? {}).map(([k, v]) => (
            <div key={k} className="text-fg-muted">
              {k} = {v}
            </div>
          ))}
        </div>
      </details>
    </div>
  );
}

function KindLabel({ name }: { name: string }) {
  return (
    <span className="flex items-center gap-1.5 min-w-0">
      <KindChip schema={name} />
      <span className="truncate text-fg-muted text-[10px]" title={name}>
        {shortKind(name)}
      </span>
    </span>
  );
}
