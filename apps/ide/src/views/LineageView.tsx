import { Background, Controls, Handle, MiniMap, Position, ReactFlow, type Edge, type Node, type NodeProps } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import clsx from "clsx";
import { FileJson, RefreshCw, ShieldCheck, Wifi, WifiOff } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useEngine } from "@/engine/context";
import type { LineagePlugin } from "@/plugins/lineage";
import { shortSchema, useLineage, type ArtifactRow } from "@/store/lineage";
import { Timeline } from "./Timeline";
import { SCHEMA_STYLE } from "./lineageStyle";

/**
 * Live lineage graph. One row per flow (a plan and everything derived from it),
 * nodes laid out left → right by depth. Fresh artifacts pulse for a few seconds.
 */

type ArtifactNode = Node<{ row: ArtifactRow; fresh: boolean; replay?: string; selected: boolean }, "artifact">;

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
  const [mode, setModeState] = useState<Mode>(loadMode);
  const [filter, setFilter] = useState("");
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

  const { nodes, flowEdges } = useMemo(() => (mode === "flow" ? layout(artifacts, edges, fresh, replays, selected) : { nodes: [], flowEdges: [] }), [mode, artifacts, edges, fresh, replays, selected]);
  const selectedRow = artifacts.find((a) => a.artifactId === selected) ?? null;

  return (
    <div className="h-full flex min-w-0">
      <div className="flex-1 min-w-0 flex flex-col">
        <div className="shrink-0 flex items-center gap-2 px-3 h-9 border-b border-border bg-bg-panel text-[11px] tabular-nums">
          <span className={clsx("flex items-center gap-1", live ? "text-ok" : "text-warn")}>
            {live ? <Wifi size={12} /> : <WifiOff size={12} />} {live ? "live" : "not streaming"}
          </span>
          <span className="text-fg-muted">{artifacts.length} artifacts · {edges.length} links</span>
          <button type="button" onClick={() => void plugin.refresh()} className="p-0.5 rounded text-fg-muted hover:text-fg cursor-pointer" title="Refresh" aria-label="Refresh lineage graph">
            <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
          </button>
          {mode === "timeline" && (
            <input aria-label="Filter artifacts" className="input !py-0.5 !w-44 ml-2" placeholder="filter by id, tx, kind…" value={filter} onChange={(e) => setFilter(e.target.value)} />
          )}
          <div role="group" aria-label="Graph style" className="ml-auto flex rounded border border-border overflow-hidden">
            {(["timeline", "flow"] as const).map((m) => (
              <button key={m} type="button" aria-pressed={mode === m} onClick={() => setMode(m)} className={clsx("px-2 py-0.5 cursor-pointer", mode === m ? "bg-bg-hover text-fg" : "text-fg-muted hover:text-fg")}>
                {m === "timeline" ? "Timeline" : "Flow"}
              </button>
            ))}
          </div>
        </div>
        <div className="flex-1 min-h-0 relative">
          {error && (
            <div role="alert" className="absolute z-10 top-2 left-2 right-2 text-[11px] text-warn bg-bg-elev/90 border border-border rounded px-2 py-1">
              {error} — start the dev-server with <code>hardkas dev --headless</code> (Console) to feed this graph.
            </div>
          )}
          {!loading && !error && artifacts.length === 0 && (
            <div className="absolute inset-0 z-10 flex flex-col items-center justify-center p-6 text-center pointer-events-none">
              <div className="rounded-lg border border-border bg-bg-elev/95 p-4 max-w-sm space-y-2 pointer-events-auto shadow-lg">
                <div className="text-xs font-semibold text-fg">No lineage artifacts yet</div>
                <p className="text-[11px] text-fg-muted">
                  Execute a transaction flow (Plan → Sign → Send) or compile a SilverScript contract to visualize live provenance here.
                </p>
              </div>
            </div>
          )}
          {mode === "timeline" ? (
            <div role="presentation" className="absolute inset-0 overflow-auto" onClick={(e) => e.target === e.currentTarget && select(null)}>
              <Timeline artifacts={artifacts} edges={edges} fresh={fresh} replays={replays} selected={selected} filter={filter} onSelect={select} />
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
      {selectedRow && <Details row={selectedRow} plugin={plugin} replay={replays[selectedRow.artifactId]?.status} />}
    </div>
  );
}

function ArtifactNodeView({ data }: NodeProps<ArtifactNode>) {
  const s = shortSchema(data.row.schema);
  const style = SCHEMA_STYLE[s] ?? { color: "var(--fg-muted)", label: s };
  const bad = data.row.integrityStatus && !["OK", "ok", "verified"].includes(data.row.integrityStatus);
  return (
    <div
      className={clsx(
        "rounded-md border bg-bg-elev text-[11px] px-2.5 py-1.5 w-[220px] shadow transition-shadow",
        data.selected ? "border-accent shadow-[0_0_0_2px_var(--accent)]" : "border-border",
        data.fresh && "animate-pulse"
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
      <div className="font-mono text-[10px] text-fg-muted truncate" title={data.row.artifactId}>
        {data.row.artifactId.slice(0, 16)}…
      </div>
      <div className="flex items-center justify-between text-[10px]">
        <span className={bad ? "text-warn" : "text-ok"}>{data.row.integrityStatus ?? ""}</span>
        {data.replay && <span className={data.replay === "passed" ? "text-ok" : data.replay === "running" ? "text-info" : "text-warn"}>replay: {data.replay}</span>}
        {data.row.createdAt && !data.replay && <span className="text-fg-muted">{new Date(data.row.createdAt).toLocaleTimeString(undefined, { hour12: false })}</span>}
      </div>
      <Handle type="source" position={Position.Right} className="!bg-border !w-2 !h-2" />
    </div>
  );
}

function Details({ row, plugin, replay }: { row: ArtifactRow; plugin: LineagePlugin; replay?: string }) {
  const s = shortSchema(row.schema);
  const canReplay = s === "txReceipt" || s === "txSubmission" || s === "txPlan" || s === "signedTx";
  return (
    <aside className="w-72 shrink-0 border-l border-border bg-bg-panel p-3 text-xs space-y-3 overflow-auto">
      <div>
        <div className="label">Artifact</div>
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
      <div className="flex gap-2">
        <button type="button" className="btn-ghost flex-1 justify-center" onClick={() => void plugin.openArtifact(row)} disabled={!row.path}>
          <FileJson size={13} /> Open JSON
        </button>
        <button type="button" className="btn-primary flex-1 justify-center" onClick={() => void plugin.replay(row.artifactId)} disabled={!canReplay || replay === "running"}>
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
      <dd className="font-mono text-[10px] break-all">{v}</dd>
    </div>
  );
}

/** Layered layout: each flow (root artifact) is a row; depth from the root sets the column. */
function layout(artifacts: ArtifactRow[], edges: { source: string; target: string }[], fresh: Set<string>, replays: Record<string, { status: string }>, selected: string | null) {
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
    nodes.push(makeNode(a, depth.get(a.artifactId)! * (NODE_W + GAP_X), rowOf.get(a.artifactId)! * (NODE_H + GAP_Y), fresh, replays, selected));
  }
  const perLine = 4;
  singles.sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
  singles.forEach((a, i) => {
    nodes.push(makeNode(a, (i % perLine) * (NODE_W + GAP_X), (row + 1 + Math.floor(i / perLine)) * (NODE_H + GAP_Y), fresh, replays, selected));
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

function makeNode(a: ArtifactRow, x: number, y: number, fresh: Set<string>, replays: Record<string, { status: string }>, selected: string | null): ArtifactNode {
  return {
    id: a.artifactId,
    type: "artifact",
    position: { x, y },
    data: { row: a, fresh: fresh.has(a.artifactId), replay: replays[a.artifactId]?.status, selected: selected === a.artifactId },
    width: NODE_W,
    height: NODE_H
  };
}
