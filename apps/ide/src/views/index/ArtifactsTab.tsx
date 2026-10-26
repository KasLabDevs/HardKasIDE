import clsx from "clsx";
import { ChevronLeft, ChevronRight, FileJson, GitCompare, Receipt, Search, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useEngine } from "@/engine/context";
import type { IndexPlugin } from "@/plugins/indexView";
import { shortKind, useIndex, type ArtifactDetail, type ArtifactRow, type LineageRef } from "@/store/indexStore";
import { diffJson, show } from "@/utils/jsonDiff";
import { storeGet } from "@/utils/storeApi";
import { CopyBtn, KindChip, shorten, useRelativePath, when } from "./common";

const PAGE = 50;

/** Every indexed artifact: filter, page through, inspect, follow lineage, compare two. */
export function ArtifactsTab() {
  const engine = useEngine();
  const plugin = engine.get<IndexPlugin>("queryIndex");
  const filters = useIndex((s) => s.filters);
  const selectedId = useIndex((s) => s.selectedId);
  const health = useIndex((s) => s.health);
  const set = useIndex((s) => s.set);
  const [rows, setRows] = useState<ArtifactRow[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [draft, setDraft] = useState(filters.q);

  // The search box waits for a pause in typing before asking the database.
  useEffect(() => {
    if (draft === filters.q) return;
    const t = setTimeout(() => set({ filters: { ...useIndex.getState().filters, q: draft } }), 280);
    return () => clearTimeout(t);
  }, [draft, filters.q, set]);
  useEffect(() => setDraft(filters.q), [filters.q]);
  useEffect(() => setOffset(0), [filters.schema, filters.mode, filters.network, filters.q]);

  useEffect(() => {
    if (!health) void plugin.refresh();
  }, [health, plugin]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    storeGet<{ rows: ArtifactRow[]; total: number }>("artifacts", { schema: filters.schema, mode: filters.mode, network: filters.network, q: filters.q, limit: PAGE, offset })
      .then((r) => {
        if (cancelled) return;
        setRows(r.rows);
        setTotal(r.total);
        setError(null);
      })
      .catch((e: unknown) => !cancelled && setError(e instanceof Error ? e.message : String(e)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [filters.schema, filters.mode, filters.network, filters.q, offset, health?.indexedAt]);

  const anyFilter = filters.schema || filters.mode || filters.network || filters.q;
  const select = (id: string | null) => set({ selectedId: id });

  return (
    <div className="h-full flex min-w-0">
      <div className="flex-1 min-w-0 flex flex-col">
        <div className="shrink-0 flex flex-wrap items-center gap-2 px-3 py-2 border-b border-border">
          <div className="relative flex-1 min-w-40">
            <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-fg-muted" />
            <input aria-label="Search artifacts" className="input !pl-7" placeholder="id, hash, tx id, file or kind…" value={draft} onChange={(e) => setDraft(e.target.value)} />
          </div>
          <FilterSelect label="Kind" value={filters.schema} options={health?.byKind ?? []} display={shortKind} onChange={(v) => set({ filters: { ...filters, schema: v } })} />
          <FilterSelect label="Mode" value={filters.mode} options={health?.byMode ?? []} onChange={(v) => set({ filters: { ...filters, mode: v } })} />
          <FilterSelect label="Network" value={filters.network} options={health?.byNetwork ?? []} onChange={(v) => set({ filters: { ...filters, network: v } })} />
          {anyFilter && (
            <button type="button" className="btn-ghost" onClick={() => set({ filters: { schema: "", mode: "", network: "", q: "" } })}>
              <X size={12} /> Clear
            </button>
          )}
        </div>

        {error && (
          <div role="alert" className="px-3 py-2 text-error">
            {error}
          </div>
        )}

        <div className="flex-1 min-h-0 overflow-auto">
          <div className="min-w-[40rem]">
            <div className="sticky top-0 z-10 grid grid-cols-[8.5rem_6.5rem_5.5rem_5.5rem_minmax(8rem,1fr)_minmax(8rem,1.2fr)] gap-2 px-3 py-1.5 bg-bg-panel text-[10px] uppercase tracking-wider text-fg-muted border-b border-border">
              <span>Time</span>
              <span>Kind</span>
              <span>Mode</span>
              <span>Network</span>
              <span>Transaction</span>
              <span>Artifact</span>
            </div>
            {rows.map((r) => (
              <button
                key={r.artifact_id}
                type="button"
                onClick={() => select(selectedId === r.artifact_id ? null : r.artifact_id)}
                className={clsx("w-full grid grid-cols-[8.5rem_6.5rem_5.5rem_5.5rem_minmax(8rem,1fr)_minmax(8rem,1.2fr)] gap-2 px-3 py-1.5 border-b border-border/40 text-left items-center cursor-pointer", selectedId === r.artifact_id ? "bg-accent/10" : "hover:bg-bg-hover/60")}
              >
                <span className="text-fg-muted tabular-nums">{when(r.created_at)}</span>
                <span>
                  <KindChip schema={r.schema} />
                </span>
                <span className="text-fg-muted truncate">{r.mode ?? "—"}</span>
                <span className="text-fg-muted truncate">{r.network_id ?? "—"}</span>
                <span className="font-mono text-[11px] text-fg-muted truncate" title={r.tx_id ?? ""}>
                  {shorten(r.tx_id, 18)}
                </span>
                <span className="font-mono text-[11px] truncate" title={r.artifact_id}>
                  {shorten(r.artifact_id, 16)}
                </span>
              </button>
            ))}
            {!loading && rows.length === 0 && !error && <div className="p-6 text-center text-fg-muted">{anyFilter ? "Nothing matches these filters." : "The index has no artifacts yet."}</div>}
          </div>
        </div>

        <div className="shrink-0 flex items-center gap-2 px-3 py-1.5 border-t border-border bg-bg-panel text-fg-muted tabular-nums">
          <span>
            {total === 0 ? "0" : `${offset + 1}–${Math.min(offset + PAGE, total)}`} of {total.toLocaleString()}
          </span>
          <button type="button" aria-label="Previous page" className="p-1 rounded hover:bg-bg-hover disabled:opacity-30 cursor-pointer" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>
            <ChevronLeft size={14} />
          </button>
          <button type="button" aria-label="Next page" className="p-1 rounded hover:bg-bg-hover disabled:opacity-30 cursor-pointer" disabled={offset + PAGE >= total} onClick={() => setOffset(offset + PAGE)}>
            <ChevronRight size={14} />
          </button>
        </div>
      </div>

      {selectedId && <Detail id={selectedId} onClose={() => select(null)} onNavigate={(id) => select(id)} />}
    </div>
  );
}

function FilterSelect({ label, value, options, display, onChange }: { label: string; value: string; options: Array<{ name: string; count: number }>; display?: (n: string) => string; onChange: (v: string) => void }) {
  return (
    <select aria-label={`Filter by ${label.toLowerCase()}`} className="input !w-auto" value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{label}: all</option>
      {options.map((o) => (
        <option key={o.name} value={o.name}>
          {(display ?? ((n) => n))(o.name)} ({o.count})
        </option>
      ))}
    </select>
  );
}

type DetailTab = "json" | "lineage" | "compare";

function Detail({ id, onClose, onNavigate }: { id: string; onClose: () => void; onNavigate: (id: string) => void }) {
  const engine = useEngine();
  const plugin = engine.get<IndexPlugin>("queryIndex");
  const rel = useRelativePath();
  const [detail, setDetail] = useState<ArtifactDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<DetailTab>("json");

  useEffect(() => {
    let cancelled = false;
    setDetail(null);
    setError(null);
    storeGet<ArtifactDetail>("artifact", { id })
      .then((d) => !cancelled && setDetail(d))
      .catch((e: unknown) => !cancelled && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
    };
  }, [id]);

  const a = detail?.artifact;
  const file = rel(a?.file_path);

  return (
    <aside className="w-[46%] min-w-[20rem] max-w-[40rem] shrink-0 border-l border-border bg-bg-panel flex flex-col min-h-0">
      <div className="shrink-0 flex items-center gap-2 px-3 py-2 border-b border-border">
        {a && <KindChip schema={a.schema} />}
        <span className="font-mono text-[11px] truncate flex-1" title={id}>
          {shorten(id, 18, 6)}
        </span>
        <CopyBtn text={id} label="Copy artifact id" />
        <button type="button" aria-label="Close details" className="p-0.5 rounded text-fg-muted hover:text-fg hover:bg-bg-hover cursor-pointer" onClick={onClose}>
          <X size={13} />
        </button>
      </div>
      {error && (
        <div role="alert" className="p-3 text-error">
          {error}
        </div>
      )}
      {!detail && !error && <div className="p-3 text-fg-muted">Loading…</div>}
      {a && (
        <>
          <div className="shrink-0 px-3 py-2 space-y-1 border-b border-border">
            <div className="text-fg-muted tabular-nums">
              {a.mode ?? "?"} · {a.network_id ?? "?"} · {when(a.created_at)}
            </div>
            <div className="flex flex-wrap gap-2">
              {file && (
                <button type="button" className="btn-ghost" onClick={() => void engine.call("fileManager", "open", file)}>
                  <FileJson size={12} /> Open file
                </button>
              )}
              {a.tx_id && (
                <button type="button" className="btn-ghost" onClick={() => plugin.showTx(a.tx_id!)}>
                  <Receipt size={12} /> Transaction
                </button>
              )}
            </div>
          </div>
          <div role="tablist" aria-label="Artifact details" className="shrink-0 flex border-b border-border text-[11px]">
            {(["json", "lineage", "compare"] as const).map((t) => (
              <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={clsx("px-3 py-1.5 cursor-pointer capitalize", tab === t ? "text-fg border-b-2 border-b-accent" : "text-fg-muted hover:text-fg")}>
                {t === "json" ? "JSON" : t === "lineage" ? `Lineage · ${detail!.ancestors.length + detail!.descendants.length}` : "Compare"}
              </button>
            ))}
          </div>
          <div className="flex-1 min-h-0 overflow-auto p-3">
            {tab === "json" && <pre className="font-mono text-[11px] whitespace-pre-wrap break-words">{JSON.stringify(detail!.json, null, 2)}</pre>}
            {tab === "lineage" && <LineageList detail={detail!} onNavigate={onNavigate} />}
            {tab === "compare" && <Compare detail={detail!} />}
          </div>
        </>
      )}
    </aside>
  );
}

function LineageList({ detail, onNavigate }: { detail: ArtifactDetail; onNavigate: (id: string) => void }) {
  const group = (title: string, refs: LineageRef[]) => (
    <div className="space-y-1">
      <div className="label">{title} · {refs.length}</div>
      {refs.length === 0 && <div className="text-fg-muted">None.</div>}
      {refs.map((r) => (
        <button key={r.artifact_id} type="button" onClick={() => onNavigate(r.artifact_id)} className="w-full flex items-center gap-2 rounded px-1.5 py-1 hover:bg-bg-hover cursor-pointer text-left" style={{ paddingLeft: `${0.375 + (r.depth - 1) * 0.75}rem` }}>
          <KindChip schema={r.schema} />
          <span className="font-mono text-[11px] truncate">{shorten(r.artifact_id, 16)}</span>
          <span className="ml-auto text-[10px] text-fg-muted tabular-nums shrink-0">{r.schema ? when(r.created_at) : "not indexed"}</span>
        </button>
      ))}
    </div>
  );
  return (
    <div className="space-y-4">
      {group("Derived from (ancestors)", detail.ancestors)}
      {group("Led to (descendants)", detail.descendants)}
    </div>
  );
}

function Compare({ detail }: { detail: ArtifactDetail }) {
  const [other, setOther] = useState("");
  const [otherJson, setOtherJson] = useState<unknown>(undefined);
  const [error, setError] = useState<string | null>(null);
  const candidates = useMemo(() => [...detail.ancestors, ...detail.descendants], [detail]);

  const load = (id: string) => {
    setOther(id);
    setError(null);
    setOtherJson(undefined);
    if (!id.trim()) return;
    storeGet<ArtifactDetail>("artifact", { id: id.trim() })
      .then((d) => setOtherJson(d.json))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  };
  const diffs = otherJson === undefined ? null : diffJson(detail.json, otherJson);

  return (
    <div className="space-y-3">
      <div className="flex gap-1">
        <input aria-label="Artifact to compare with" className="input font-mono" list="compare-candidates" placeholder="artifact id to compare with" value={other} onChange={(e) => load(e.target.value)} />
        <datalist id="compare-candidates">
          {candidates.map((c) => (
            <option key={c.artifact_id} value={c.artifact_id}>
              {shortKind(c.schema)}
            </option>
          ))}
        </datalist>
      </div>
      <div className="text-fg-muted">Pick an ancestor or descendant from the list, or paste any artifact id from the table.</div>
      {error && <div role="alert" className="text-error">{error}</div>}
      {diffs && (
        <div className="space-y-1">
          <div className="flex items-center gap-1.5 text-fg">
            <GitCompare size={13} /> {diffs.length === 0 ? "Identical." : `${diffs.length} difference${diffs.length === 1 ? "" : "s"} (left = this artifact, right = the other)`}
          </div>
          {diffs.slice(0, 200).map((d) => (
            <div key={d.path} className="rounded border border-border bg-bg p-1.5 font-mono text-[11px] break-all">
              <div className={d.kind === "added" ? "text-ok" : d.kind === "removed" ? "text-error" : "text-warn"}>
                {d.kind === "added" ? "+" : d.kind === "removed" ? "−" : "~"} {d.path}
              </div>
              {d.kind !== "added" && <div className="text-error/80">− {show(d.left)}</div>}
              {d.kind !== "removed" && <div className="text-ok/80">+ {show(d.right)}</div>}
            </div>
          ))}
          {diffs.length > 200 && <div className="text-fg-muted">…and {diffs.length - 200} more.</div>}
        </div>
      )}
    </div>
  );
}
