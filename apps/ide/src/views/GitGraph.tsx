import clsx from "clsx";
import { useMemo } from "react";
import { shortSchema, type ArtifactRow } from "@/store/lineage";
import { LANE_COLORS, SCHEMA_STYLE } from "./lineageStyle";

/**
 * Lineage as a Git history: every artifact is a commit, newest on top, and the lanes on the left follow how artifacts
 * derive from each other (plan → signed → receipt …), drawn like the VS Code source-control graph.
 */

const ROW_H = 34;
const LANE_W = 14;
const PAD = 12;
const DOT_R = 4.5;

interface GraphRow {
  row: ArtifactRow;
  lane: number;
  color: string;
  /** lanes that continue straight through this row */
  through: Array<{ lane: number; color: string }>;
  /** a line from the top into the dot (this artifact has children above) */
  fromTop: boolean;
  /** other lanes that end in this dot (merges), drawn as curves from the top */
  merges: Array<{ lane: number; color: string }>;
  /** lines leaving the dot towards the parents below */
  outs: Array<{ lane: number; color: string }>;
}

export function buildGitGraph(artifacts: ArtifactRow[], edges: Array<{ source: string; target: string }>): { rows: GraphRow[]; lanes: number } {
  const byId = new Map(artifacts.map((a) => [a.artifactId, a]));
  const parents = new Map<string, string[]>();
  const children = new Map<string, string[]>();
  const link = (parent: string, child: string) => {
    if (!byId.has(parent) || !byId.has(child) || parent === child) return;
    const ps = parents.get(child) ?? [];
    if (ps.includes(parent)) return;
    parents.set(child, [...ps, parent]);
    children.set(parent, [...(children.get(parent) ?? []), child]);
  };
  for (const e of edges) link(e.source, e.target);
  for (const a of artifacts) if (a.parentArtifactId) link(a.parentArtifactId, a.artifactId);

  // Newest first, but a parent never comes before any of its children.
  const remainingChildren = new Map(artifacts.map((a) => [a.artifactId, (children.get(a.artifactId) ?? []).length]));
  const time = (a: ArtifactRow) => a.createdAt ?? "";
  const ready = artifacts.filter((a) => remainingChildren.get(a.artifactId) === 0);
  const ordered: ArtifactRow[] = [];
  while (ready.length > 0) {
    ready.sort((a, b) => time(a).localeCompare(time(b)));
    const next = ready.pop()!; // the newest ready one
    ordered.push(next);
    for (const p of parents.get(next.artifactId) ?? []) {
      const left = (remainingChildren.get(p) ?? 1) - 1;
      remainingChildren.set(p, left);
      if (left === 0) ready.push(byId.get(p)!);
    }
  }
  // Cycles would never become ready; keep them visible at the end rather than dropping them.
  for (const a of artifacts) if (!ordered.includes(a)) ordered.push(a);

  const lanes: Array<string | null> = [];
  const laneColor: string[] = [];
  let colorSeq = 0;
  const freeLane = (): number => {
    const i = lanes.indexOf(null);
    if (i >= 0) return i;
    lanes.push(null);
    laneColor.push(LANE_COLORS[0]);
    return lanes.length - 1;
  };
  const newColor = () => LANE_COLORS[colorSeq++ % LANE_COLORS.length];

  let maxLane = 0;
  const rows: GraphRow[] = [];
  for (const a of ordered) {
    const incoming = lanes.map((id, i) => (id === a.artifactId ? i : -1)).filter((i) => i >= 0);
    let lane: number;
    if (incoming.length === 0) {
      lane = freeLane();
      laneColor[lane] = newColor();
    } else {
      lane = Math.min(...incoming);
    }
    const color = laneColor[lane];
    const through = lanes.map((id, i) => ({ id, i })).filter(({ id, i }) => id !== null && !incoming.includes(i)).map(({ i }) => ({ lane: i, color: laneColor[i] }));
    const merges = incoming.filter((i) => i !== lane).map((i) => ({ lane: i, color: laneColor[i] }));
    for (const i of incoming) lanes[i] = null;

    const outs: Array<{ lane: number; color: string }> = [];
    const ps = parents.get(a.artifactId) ?? [];
    ps.forEach((p, j) => {
      const existing = lanes.indexOf(p);
      if (existing >= 0) {
        outs.push({ lane: existing, color: laneColor[existing] });
      } else if (j === 0) {
        lanes[lane] = p;
        outs.push({ lane, color });
      } else {
        const idx = freeLane();
        laneColor[idx] = newColor();
        lanes[idx] = p;
        outs.push({ lane: idx, color: laneColor[idx] });
      }
    });
    maxLane = Math.max(maxLane, lane, ...through.map((t) => t.lane), ...outs.map((o) => o.lane), ...merges.map((m) => m.lane));
    rows.push({ row: a, lane, color, through, fromTop: incoming.length > 0, merges, outs });
  }
  return { rows, lanes: maxLane + 1 };
}

const x = (lane: number) => PAD + lane * LANE_W;
const CY = ROW_H / 2;

function curve(x0: number, y0: number, x1: number, y1: number): string {
  const mid = (y0 + y1) / 2;
  return `M${x0},${y0} C${x0},${mid} ${x1},${mid} ${x1},${y1}`;
}

interface Props {
  artifacts: ArtifactRow[];
  edges: Array<{ source: string; target: string }>;
  fresh: Set<string>;
  replays: Record<string, { status: string }>;
  selected: string | null;
  filter: string;
  onSelect: (id: string | null) => void;
}

export function GitGraph({ artifacts, edges, fresh, replays, selected, filter, onSelect }: Props) {
  const { rows, lanes } = useMemo(() => buildGitGraph(artifacts, edges), [artifacts, edges]);
  const width = PAD * 2 + Math.max(1, lanes) * LANE_W;
  const q = filter.trim().toLowerCase();
  // Matches what is on screen too: the kind chip ("submitted", "receipt"…), the id, tx and network.
  const matches = (a: ArtifactRow) => !q || [a.artifactId, a.txId ?? "", a.schema, SCHEMA_STYLE[shortSchema(a.schema)]?.label ?? "", shortSchema(a.schema), a.networkId ?? "", a.mode ?? ""].some((s) => s.toLowerCase().includes(q));

  return (
    <div role="list" aria-label="Artifact history" className="min-w-[34rem]">
      {rows.map((g) => {
        const s = shortSchema(g.row.schema);
        const style = SCHEMA_STYLE[s] ?? { color: "var(--fg-muted)", label: s };
        const isSelected = selected === g.row.artifactId;
        const isFresh = fresh.has(g.row.artifactId);
        const replay = replays[g.row.artifactId]?.status;
        const bad = g.row.integrityStatus && !["OK", "ok", "verified"].includes(g.row.integrityStatus);
        const dim = !matches(g.row);
        return (
          <div
            key={g.row.artifactId}
            role="listitem"
            tabIndex={0}
            aria-selected={isSelected}
            onClick={() => onSelect(isSelected ? null : g.row.artifactId)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onSelect(isSelected ? null : g.row.artifactId);
              }
            }}
            className={clsx("flex items-center cursor-pointer outline-none border-b border-border/30 transition-colors", isSelected ? "bg-accent/10" : "hover:bg-bg-hover/60", isFresh && "animate-pulse bg-accent/5", dim && "opacity-25")}
            style={{ height: ROW_H }}
            title={`${g.row.schema}\n${g.row.artifactId}`}
          >
            <svg width={width} height={ROW_H} className="shrink-0" aria-hidden="true">
              {g.through.map((t) => (
                <line key={`t${t.lane}`} x1={x(t.lane)} y1={0} x2={x(t.lane)} y2={ROW_H} stroke={t.color} strokeWidth={2} strokeOpacity={0.9} />
              ))}
              {g.fromTop && <line x1={x(g.lane)} y1={0} x2={x(g.lane)} y2={CY} stroke={g.color} strokeWidth={2} />}
              {g.merges.map((m) => (
                <path key={`m${m.lane}`} d={curve(x(m.lane), 0, x(g.lane), CY)} fill="none" stroke={m.color} strokeWidth={2} />
              ))}
              {g.outs.map((o, i) =>
                o.lane === g.lane ? (
                  <line key={`o${i}`} x1={x(g.lane)} y1={CY} x2={x(g.lane)} y2={ROW_H} stroke={o.color} strokeWidth={2} />
                ) : (
                  <path key={`o${i}`} d={curve(x(g.lane), CY, x(o.lane), ROW_H)} fill="none" stroke={o.color} strokeWidth={2} />
                )
              )}
              {isSelected && <circle cx={x(g.lane)} cy={CY} r={DOT_R + 3.5} fill="none" stroke="var(--accent)" strokeWidth={1.5} />}
              <circle cx={x(g.lane)} cy={CY} r={DOT_R} fill={style.color} stroke="var(--bg)" strokeWidth={2} />
            </svg>
            <div className="flex-1 min-w-0 flex items-center gap-2 pr-3 text-[11px]">
              <span className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold border" style={{ color: style.color, borderColor: `color-mix(in srgb, ${style.color} 45%, transparent)`, background: `color-mix(in srgb, ${style.color} 12%, transparent)` }}>
                {style.label}
              </span>
              <span className="font-mono text-fg truncate">{g.row.artifactId.slice(0, 12)}</span>
              {g.row.txId && <span className="font-mono text-fg-muted truncate hidden md:inline">tx {g.row.txId.slice(0, 12)}</span>}
              <span className="ml-auto flex items-center gap-2 shrink-0">
                {g.row.networkId && <span className="text-fg-muted hidden sm:inline">{g.row.networkId}</span>}
                {replay && <span className={clsx("rounded px-1 text-[10px]", replay === "passed" ? "text-ok bg-ok/10" : replay === "running" ? "text-info bg-info/10" : "text-warn bg-warn/10")}>replay {replay}</span>}
                {bad && <span className="rounded px-1 text-[10px] text-warn bg-warn/10">{g.row.integrityStatus}</span>}
                <span className="text-fg-muted tabular-nums w-16 text-right">{g.row.createdAt ? new Date(g.row.createdAt).toLocaleTimeString(undefined, { hour12: false }) : ""}</span>
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
