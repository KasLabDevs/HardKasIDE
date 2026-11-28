import { Background, Controls, Handle, MiniMap, Position, ReactFlow, type Edge, type Node, type NodeProps } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import clsx from "clsx";
import { Check, Copy, FileJson, RefreshCw, ShieldCheck, Wifi, WifiOff, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useEngine } from "@/engine/context";
import type { ConsolePlugin } from "@/plugins/console";
import type { LineagePlugin } from "@/plugins/lineage";
import { useEnv } from "@/store/env";
import { shortSchema, useLineage, type ArtifactRow } from "@/store/lineage";
import { describeSummary } from "@/utils/artifactSummary";
import { copyText } from "@/utils/clipboard";
import { collectArtifactKeys, matchesArtifactFilter } from "@/utils/lineageFilter";
import { Timeline } from "./Timeline";
import { SCHEMA_STYLE } from "./lineageStyle";

/**
 * Live lineage graph. One row per flow (a plan and everything derived from it),
 * nodes laid out left → right by depth. Fresh artifacts pulse for a few seconds.
 */

type ArtifactNode = Node<{ row: ArtifactRow; fresh: boolean; replay?: string; selected: boolean; dim?: boolean }, "artifact">;

const NODE_W = 220;
const NODE_H = 64;
const GAP_X = 70;
const GAP_Y = 28;
const NODE_TYPES = { artifact: ArtifactNodeView };

type Mode = "timeline" | "flow";
const MODE_KEY = "hardkas-ide.lineage.mode";
function loadMode(): Mode {
  try {
    return localStorage.getItem(MODE_KEY) === "flow" ? "flow" : "timeline";
  } catch {
    return "timeline";
  }
}

export function LineageView() {
  const engine = useEngine();
  const plugin = engine.get<LineagePlugin>("lineage");
  const artifacts = useLineage((s) => s.artifacts);
  const edges = useLineage((s) => s.edges);
  const fresh = useLineage((s) => s.fresh);
  const replays = useLineage((s) => s.replays);
  const live = useLineage((s) => s.live);
  const loading = useLineage((s) => s.loading);
  const error = useLineage((s) => s.error);
  const selected = useLineage((s) => s.selected);
  const select = useLineage((s) => s.select);
  const accounts = useEnv((s) => s.accounts);
  const [mode, setModeState] = useState<Mode>(loadMode);
  const [filter, setFilter] = useState("");
  const [onlyMatches, setOnlyMatches] = useState(true);
  const setMode = (m: Mode) => {
    setModeState(m);
    try {
      localStorage.setItem(MODE_KEY, m);
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    if (artifacts.length === 0) void plugin.refresh();
  }, [plugin, artifacts.length]);

  const hasFilter = filter.trim().length > 0;
  const matchedIds = useMemo(() => {
    if (!hasFilter) return null;
    const set = new Set<string>();
    for (const a of artifacts) {
      const styleLabel = SCHEMA_STYLE[shortSchema(a.schema)]?.label ?? "";
      if (matchesArtifactFilter(a, filter, accounts, styleLabel)) set.add(a.artifactId);
    }
    return set;
  }, [artifacts, filter, accounts, hasFilter]);

  const timelineArtifacts = useMemo(() => {
    if (!matchedIds || !onlyMatches) return artifacts;
    return artifacts.filter((a) => matchedIds.has(a.artifactId));
  }, [artifacts, matchedIds, onlyMatches]);

  const { nodes, flowEdges } = useMemo(
    () => (mode === "flow" ? layout(artifacts, edges, fresh, replays, selected, matchedIds) : { nodes: [], flowEdges: [] }),
    [mode, artifacts, edges, fresh, replays, selected, matchedIds]
  );
  const selectedRow = artifacts.find((a) => a.artifactId === selected) ?? null;
  const startDevServer = () => {
    void engine.get<ConsolePlugin>("console").runHardkas(["dev", "--headless"]);
    setTimeout(() => void plugin.refresh(), 2500);
  };

  return (
    <div className="h-full flex min-w-0">
      <div className="flex-1 min-w-0 flex flex-col">
        <div className="shrink-0 flex flex-wrap items-center gap-x-2 gap-y-1 px-3 py-1 min-h-9 border-b border-border bg-bg-panel text-[12px] tabular-nums">
          <span
            className={clsx("flex items-center gap-1 whitespace-nowrap", live ? "text-ok" : artifacts.length > 0 ? "text-fg-muted" : "text-warn")}
            title={live ? "Live: the dev-server streams new artifacts as they are written" : "Read from the files in .hardkas/ (the dev-server on :7420 is off, so nothing updates by itself; use Refresh)"}
          >
            {live ? <Wifi size={12} /> : <WifiOff size={12} />} {live ? "Live" : artifacts.length > 0 ? "From disk · dev-server off" : "Nothing yet · dev-server off"}
          </span>
          <span className="text-fg-muted whitespace-nowrap" title="Each artifact is a JSON file HardKAS wrote in .hardkas/ (a plan, a receipt, a compile…). A link says one was made from the other.">{artifacts.length} artifacts · {edges.length} links</span>
          <button type="button" onClick={() => void plugin.refresh()} className="p-0.5 rounded text-fg-muted hover:text-fg cursor-pointer" title="Refresh" aria-label="Refresh lineage graph">
            <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
          </button>
          {!live && (
            <button
              type="button"
              onClick={startDevServer}
              className="px-2 py-0.5 rounded border border-border text-fg-muted hover:text-fg hover:bg-bg-hover cursor-pointer whitespace-nowrap"
              title="Start hardkas dev --headless in Console to enable live streaming and replay verification"
            >
              Start dev-server
            </button>
          )}
          <div className="flex flex-wrap items-center gap-1 min-w-0 max-w-full ml-1">
            <div className="relative flex items-center min-w-0 max-w-full">
              <input
                aria-label="Filter artifacts"
                className={clsx("input !py-0.5 !w-52 max-w-full font-mono text-[11.5px]", hasFilter && "!pr-6")}
                placeholder="filter: alice, 0x pubkey, address, hash…"
                title="Filter by account alias (alice), full or partial Kaspa address (kaspa...), 32-byte hex public key (0x...), contract, schema, or hash"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              />
              {hasFilter && (
                <button
                  type="button"
                  onClick={() => setFilter("")}
                  className="absolute right-1 p-0.5 rounded text-fg-muted hover:text-fg cursor-pointer"
                  aria-label="Clear filter"
                  title="Clear filter"
                >
                  <X size={11} />
                </button>
              )}
            </div>
            {hasFilter && matchedIds && (
              <>
                <span className="text-[11px] text-fg-muted tabular-nums whitespace-nowrap px-1">
                  {matchedIds.size} / {artifacts.length}
                </span>
                {mode === "timeline" && (
                  <button
                    type="button"
                    aria-pressed={onlyMatches}
                    onClick={() => setOnlyMatches((v) => !v)}
                    className={clsx(
                      "px-2 py-0.5 rounded border text-[11px] cursor-pointer whitespace-nowrap",
                      onlyMatches ? "border-accent/50 bg-accent/15 text-accent" : "border-border text-fg-muted hover:text-fg"
                    )}
                    title={onlyMatches ? "Showing matching rows only (click to show all rows with dimmed non-matches)" : "Showing all rows with dimmed non-matches"}
                  >
                    Matches only
                  </button>
                )}
              </>
            )}
          </div>
          <div role="group" aria-label="Graph style" className="ml-auto flex rounded border border-border overflow-hidden">
            {(["timeline", "flow"] as const).map((m) => (
              <button key={m} type="button" aria-pressed={mode === m} onClick={() => setMode(m)} className={clsx("px-2 py-0.5 cursor-pointer", mode === m ? "bg-bg-hover text-fg" : "text-fg-muted hover:text-fg")}>
                {m === "timeline" ? "Timeline" : "Flow"}
              </button>
            ))}
          </div>
        </div>
        {mode === "timeline" && artifacts.length > 0 && (
          <div className="shrink-0 px-3 py-1 border-b border-border text-[12px] text-fg-muted">
            Each row is a file HardKAS wrote in <code>.hardkas/</code>. The lines on the left join the steps of one operation, read from the bottom up: <span className="text-fg">plan → signed → receipt</span>. Click a row for its details.
          </div>
        )}
        <div className="flex-1 min-h-0 relative">
          {error && (
            <div role="alert" className="absolute z-10 top-2 left-2 right-2 flex items-center justify-between gap-2 text-[12px] text-warn bg-bg-elev/90 border border-border rounded px-2 py-1">
              <span>
                {error} — start the dev-server with <code>hardkas dev --headless</code> (Console) to feed this graph.
              </span>
              <button type="button" onClick={startDevServer} className="btn-ghost shrink-0 !py-0.5 !px-2 text-fg">
                Start dev-server
              </button>
            </div>
          )}
          {loading && artifacts.length === 0 && (
            <div className="absolute inset-0 z-10 flex items-center justify-center gap-1.5 text-[12px] text-fg-muted pointer-events-none" role="status">
              <RefreshCw size={13} className="animate-spin" /> Reading the project's artifacts…
            </div>
          )}
          {!loading && !error && artifacts.length === 0 && (
            <div className="absolute inset-0 z-10 flex flex-col items-center justify-center p-6 text-center pointer-events-none">
              <div className="rounded-lg border border-border bg-bg-elev/95 p-4 max-w-sm space-y-2 pointer-events-auto shadow-lg">
                <div className="text-xs font-semibold text-fg">No lineage artifacts yet</div>
                <p className="text-[12px] text-fg-muted">
                  Execute a transaction flow (Plan → Sign → Send) or compile a SilverScript contract to visualize live provenance here.
                </p>
              </div>
            </div>
          )}
          {mode === "timeline" ? (
            <div role="presentation" className="absolute inset-0 overflow-auto" onClick={(e) => e.target === e.currentTarget && select(null)}>
              {hasFilter && matchedIds?.size === 0 ? (
                <div className="p-6 text-center text-xs text-fg-muted space-y-2">
                  <div>
                    No artifacts matched <code className="font-mono text-fg">{filter.trim()}</code>.
                  </div>
                  <div className="text-[11px]">
                    Supports account names (<code className="font-mono">alice</code>), Kaspa addresses (<code className="font-mono">kaspasim:...</code>), and hex public keys (<code className="font-mono">0x...</code>).
                  </div>
                </div>
              ) : (
                <Timeline
                  artifacts={timelineArtifacts}
                  edges={edges}
                  fresh={fresh}
                  replays={replays}
                  selected={selected}
                  filter={onlyMatches ? "" : filter}
                  onSelect={select}
                />
              )}
            </div>
          ) : (
            <ReactFlow<ArtifactNode, Edge>
              nodes={nodes}
              edges={flowEdges}
              nodeTypes={NODE_TYPES}
              fitView
              fitViewOptions={{ padding: 0.2, maxZoom: 1 }}
              minZoom={0.2}
              proOptions={{ hideAttribution: true }}
              onNodeClick={(_e, n) => select(n.id)}
              onPaneClick={() => select(null)}
              nodesDraggable={false}
              nodesConnectable={false}
              colorMode="dark"
            >
              <Background gap={24} color="var(--border)" />
              <Controls showInteractive={false} />
              <MiniMap pannable zoomable nodeColor={(n) => SCHEMA_STYLE[shortSchema((n as ArtifactNode).data.row.schema)]?.color ?? "#888"} />
            </ReactFlow>
          )}
        </div>
      </div>
      {selectedRow && <Details row={selectedRow} plugin={plugin} replay={replays[selectedRow.artifactId]?.status} live={live} onFilter={setFilter} />}
    </div>
  );
}

function ArtifactNodeView({ data }: NodeProps<ArtifactNode>) {
  const s = shortSchema(data.row.schema);
  const style = SCHEMA_STYLE[s] ?? { color: "var(--fg-muted)", label: s };
  const bad = data.row.integrityStatus && !["OK", "ok", "verified"].includes(data.row.integrityStatus);
  const accounts = useEnv((s) => s.accounts);
  const text = data.row.summary ? describeSummary(data.row.summary, accounts) : null;
  return (
    <div
      className={clsx(
        "rounded-md border bg-bg-elev text-[12px] px-2.5 py-1.5 w-[220px] shadow transition-all",
        data.selected ? "border-accent shadow-[0_0_0_2px_var(--accent)]" : "border-border",
        data.fresh && "animate-pulse",
        data.dim && "opacity-25"
      )}
      style={{ borderLeftWidth: 4, borderLeftColor: style.color }}
    >
      <Handle type="target" position={Position.Left} className="!bg-border !w-2 !h-2" />
      <div className="flex items-center justify-between">
        <span className="font-semibold" style={{ color: style.color }}>
          {style.label}
        </span>
        <span className="text-fg-muted">{data.row.networkId ?? ""}</span>
      </div>
      {text ? (
        <div className="text-[12px] text-fg truncate" title={`${text.title}${text.detail ? " · " + text.detail : ""}`}>
          {text.title}
          {text.detail && <span className="text-fg-muted"> · {text.detail}</span>}
        </div>
      ) : (
        <div className="font-mono text-[12px] text-fg-muted truncate" title={data.row.artifactId}>
          {data.row.artifactId.slice(0, 16)}…
        </div>
      )}
      <div className="flex items-center justify-between text-[12px]">
        <span className={bad ? "text-warn" : "text-ok"}>{data.row.integrityStatus ?? ""}</span>
        {data.replay && <span className={data.replay === "passed" ? "text-ok" : data.replay === "running" ? "text-info" : "text-warn"}>replay: {data.replay}</span>}
        {data.row.createdAt && !data.replay && <span className="text-fg-muted">{new Date(data.row.createdAt).toLocaleTimeString(undefined, { hour12: false })}</span>}
      </div>
      <Handle type="source" position={Position.Right} className="!bg-border !w-2 !h-2" />
    </div>
  );
}

function Details({ row, plugin, replay, live, onFilter }: { row: ArtifactRow; plugin: LineagePlugin; replay?: string; live: boolean; onFilter: (q: string) => void }) {
  const s = shortSchema(row.schema);
  const canReplay = s === "txReceipt" || s === "txSubmission" || s === "txPlan" || s === "signedTx";
  const accounts = useEnv((st) => st.accounts);
  const text = row.summary ? describeSummary(row.summary, accounts) : null;
  const { addresses, pubkeys } = useMemo(() => collectArtifactKeys(row, accounts), [row, accounts]);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const handleCopy = async (value: string) => {
    if (await copyText(value)) {
      setCopiedKey(value);
      setTimeout(() => setCopiedKey((cur) => (cur === value ? null : cur)), 1400);
    }
  };
  return (
    <aside className="w-72 shrink-0 border-l border-border bg-bg-panel p-3 text-xs space-y-3 overflow-auto">
      {text && (
        <div>
          <div className="text-sm font-semibold text-fg">{text.title}</div>
          {text.detail && <div className="text-fg-muted">{text.detail}</div>}
        </div>
      )}
      <div>
        <div className="label">File kind</div>
        <div className="font-semibold" style={{ color: SCHEMA_STYLE[s]?.color }}>
          {row.schema}
        </div>
      </div>
      <dl className="space-y-1">
        <Row k="id" v={row.artifactId} />
        {row.txId && <Row k="txId" v={row.txId} />}
        <Row k="mode" v={`${row.mode ?? "?"} · ${row.networkId ?? "?"}`} />
        {row.createdAt && <Row k="created" v={new Date(row.createdAt).toLocaleString()} />}
        {row.integrityStatus && <Row k="integrity" v={row.integrityStatus} />}
        {row.parentArtifactId && <Row k="parent" v={row.parentArtifactId} />}
        {row.flowId && <Row k="flow" v={row.flowId} />}
        {replay && <Row k="replay" v={replay} />}
      </dl>
      {(pubkeys.length > 0 || addresses.length > 0) && (
        <div className="space-y-1.5">
          <div className="label">Public Keys &amp; Addresses</div>
          <div className="space-y-1">
            {pubkeys.map((pk) => {
              const value = `0x${pk}`;
              return (
                <div key={pk} className="flex items-center gap-1 rounded border border-border bg-bg px-1.5 py-1 text-[11px] font-mono min-w-0">
                  <button
                    type="button"
                    onClick={() => onFilter(value)}
                    className="flex-1 min-w-0 truncate text-left text-accent hover:underline cursor-pointer"
                    title={`Filter Lineage by pubkey ${value}`}
                  >
                    {value}
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleCopy(value)}
                    className="shrink-0 p-0.5 text-fg-muted hover:text-fg cursor-pointer"
                    title="Copy public key"
                    aria-label="Copy public key"
                  >
                    {copiedKey === value ? <Check size={11} className="text-ok" /> : <Copy size={11} />}
                  </button>
                </div>
              );
            })}
            {addresses.map((addr) => (
              <div key={addr} className="flex items-center gap-1 rounded border border-border bg-bg px-1.5 py-1 text-[11px] font-mono min-w-0">
                <button
                  type="button"
                  onClick={() => onFilter(addr)}
                  className="flex-1 min-w-0 truncate text-left text-fg hover:text-accent hover:underline cursor-pointer"
                  title={`Filter Lineage by address ${addr}`}
                >
                  {addr}
                </button>
                <button
                  type="button"
                  onClick={() => void handleCopy(addr)}
                  className="shrink-0 p-0.5 text-fg-muted hover:text-fg cursor-pointer"
                  title="Copy address"
                  aria-label="Copy address"
                >
                  {copiedKey === addr ? <Check size={11} className="text-ok" /> : <Copy size={11} />}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="flex gap-2">
        <button type="button" className="btn-ghost flex-1 justify-center" onClick={() => void plugin.openArtifact(row)} disabled={!row.path}>
          <FileJson size={13} /> Open JSON
        </button>
        <button
          type="button"
          className="btn-primary flex-1 justify-center"
          onClick={() => void plugin.replay(row.artifactId)}
          disabled={!canReplay || replay === "running"}
          title={!live ? "Requires hardkas dev-server (:7420)" : undefined}
        >
          <ShieldCheck size={13} /> {replay === "running" ? "Replaying…" : "Replay verify"}
        </button>
      </div>
      <p className="text-fg-muted">
        Replay re-derives the artifact from its lineage and compares hashes. HardKas supports it for simulator receipts today; real-node artifacts report <code>unsupported</code>.
      </p>
    </aside>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex gap-2 min-w-0">
      <dt className="w-14 shrink-0 text-fg-muted">{k}</dt>
      <dd className="font-mono text-[12px] break-all">{v}</dd>
    </div>
  );
}

/** Layered layout: each flow (root artifact) is a row; depth from the root sets the column. */
function layout(artifacts: ArtifactRow[], edges: { source: string; target: string }[], fresh: Set<string>, replays: Record<string, { status: string }>, selected: string | null, matchedIds: Set<string> | null) {
  const ids = new Set(artifacts.map((a) => a.artifactId));
  const parents = new Map<string, string[]>();
  const children = new Map<string, string[]>();
  for (const e of edges) {
    if (!ids.has(e.source) || !ids.has(e.target)) continue;
    parents.set(e.target, [...(parents.get(e.target) ?? []), e.source]);
    children.set(e.source, [...(children.get(e.source) ?? []), e.target]);
  }
  for (const a of artifacts) {
    if (a.parentArtifactId && ids.has(a.parentArtifactId) && !(parents.get(a.artifactId) ?? []).includes(a.parentArtifactId)) {
      parents.set(a.artifactId, [...(parents.get(a.artifactId) ?? []), a.parentArtifactId]);
      children.set(a.parentArtifactId, [...(children.get(a.parentArtifactId) ?? []), a.artifactId]);
    }
  }
  // roots: no parents. Sort newest first so the latest flow is on top.
  const roots = artifacts.filter((a) => (parents.get(a.artifactId) ?? []).length === 0).sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
  const depth = new Map<string, number>();
  const rowOf = new Map<string, number>();
  let row = 0;
  const visit = (id: string, d: number, r: number) => {
    if (depth.has(id)) return;
    depth.set(id, d);
    rowOf.set(id, r);
    const kids = (children.get(id) ?? []).sort((x, y) => (artifactsById.get(x)?.createdAt ?? "").localeCompare(artifactsById.get(y)?.createdAt ?? ""));
    kids.forEach((k, i) => visit(k, d + 1, i === 0 ? r : r + i));
  };
  const artifactsById = new Map(artifacts.map((a) => [a.artifactId, a]));
  // Group single-node flows (snapshots, observations, silver records) into a compact grid at the end.
  const singles: ArtifactRow[] = [];
  for (const r of roots) {
    if ((children.get(r.artifactId) ?? []).length === 0) {
      singles.push(r);
      continue;
    }
    visit(r.artifactId, 0, row);
    let maxRow = row;
    for (const v of rowOf.values()) {
      if (v > maxRow) maxRow = v;
    }
    row = maxRow + 1;
  }
  const nodes: ArtifactNode[] = [];
  for (const a of artifacts) {
    if (!depth.has(a.artifactId)) continue;
    nodes.push(makeNode(a, depth.get(a.artifactId)! * (NODE_W + GAP_X), rowOf.get(a.artifactId)! * (NODE_H + GAP_Y), fresh, replays, selected, matchedIds !== null && !matchedIds.has(a.artifactId)));
  }
  const perLine = 4;
  singles.sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
  singles.forEach((a, i) => {
    nodes.push(makeNode(a, (i % perLine) * (NODE_W + GAP_X), (row + 1 + Math.floor(i / perLine)) * (NODE_H + GAP_Y), fresh, replays, selected, matchedIds !== null && !matchedIds.has(a.artifactId)));
  });
  const flowEdges: Edge[] = [];
  for (const [child, ps] of parents) {
    for (const p of ps) {
      if (!depth.has(child) || !depth.has(p)) continue;
      flowEdges.push({ id: `${p}->${child}`, source: p, target: child, animated: fresh.has(child), style: { stroke: "var(--border)" } });
    }
  }
  return { nodes, flowEdges };
}

function makeNode(a: ArtifactRow, x: number, y: number, fresh: Set<string>, replays: Record<string, { status: string }>, selected: string | null, dim = false): ArtifactNode {
  return {
    id: a.artifactId,
    type: "artifact",
    position: { x, y },
    data: { row: a, fresh: fresh.has(a.artifactId), replay: replays[a.artifactId]?.status, selected: selected === a.artifactId, dim },
    width: NODE_W,
    height: NODE_H
  };
}
