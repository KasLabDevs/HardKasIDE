import clsx from "clsx";
import {
  Activity,
  ArrowDownLeft,
  ArrowUpRight,
  Boxes,
  Check,
  Copy,
  Cpu,
  HardDrive,
  Layers,
  Network,
  Play,
  RefreshCw,
  RotateCw,
  ScrollText,
  Search,
  Square,
  Tag,
  Terminal,
  Trash2
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useEngine } from "@/engine/context";
import type { ClusterPlugin } from "@/plugins/cluster";
import { progressOf, useCluster, type InspectTab, type NodeInspectDetail } from "@/store/cluster";
import { copyText } from "@/utils/clipboard";
import { confirmDialog } from "@/utils/dialog";

/** OpenShift Pod Details-inspired center inspector for any cluster node (Docker container + live Kaspa DAG/wRPC telemetry). */
export function ClusterNodeView() {
  const engine = useEngine();
  const cluster = engine.get<ClusterPlugin>("cluster");
  const status = useCluster((s) => s.status);
  const busy = useCluster((s) => s.busy);
  const selectedNode = useCluster((s) => s.selectedNode);
  const detail = useCluster((s) => s.inspect);
  const loading = useCluster((s) => s.inspectLoading);
  const error = useCluster((s) => s.inspectError);
  const logs = useCluster((s) => s.inspectLogs);
  const tab = useCluster((s) => s.inspectTab);
  const setCluster = useCluster((s) => s.set);

  const nodes = status?.nodes ?? [];
  const activeName = selectedNode ?? nodes[0]?.name ?? null;

  useEffect(() => {
    void cluster.refresh();
    cluster.startInspectPoll();
    return () => {
      cluster.stopInspectPoll();
    };
  }, [cluster]);

  // If the previously selected node was removed, fall back cleanly to the first remaining node.
  useEffect(() => {
    if (!selectedNode && nodes[0]) {
      setCluster({ selectedNode: nodes[0].name });
      void cluster.refreshInspect(nodes[0].name);
    } else if (selectedNode && nodes.length > 0 && !nodes.some((n) => n.name === selectedNode)) {
      const next = nodes[0].name;
      setCluster({ selectedNode: next });
      void cluster.refreshInspect(next);
    }
  }, [cluster, nodes, selectedNode, setCluster]);

  const currentSummary = nodes.find((n) => n.name === activeName);
  const referenceNode = nodes.find((n) => n.name === status?.reference);

  return (
    <div className="h-full flex flex-col min-w-0 bg-bg text-xs">
      {/* Cluster Pod Switcher Bar */}
      <div className="shrink-0 flex items-center gap-1.5 px-3 py-2 border-b border-border bg-bg-panel overflow-x-auto">
        <span className="text-[10px] uppercase tracking-wider text-fg-muted mr-1 shrink-0 flex items-center gap-1">
          <Boxes size={12} className="text-accent" /> Pods
        </span>
        {nodes.map((n) => {
          const active = n.name === activeName;
          const running = n.state === "running";
          const dot = !running ? "bg-fg-muted" : !n.chain || n.inSync === false ? "bg-warn animate-pulse" : "bg-ok";
          return (
            <button
              key={n.name}
              type="button"
              onClick={() => void cluster.openNode(n.name)}
              className={clsx(
                "flex items-center gap-1.5 px-2.5 py-1 rounded border text-xs cursor-pointer transition-colors shrink-0",
                active ? "bg-bg-elev border-accent/60 text-fg font-medium" : "border-border bg-bg/60 text-fg-muted hover:text-fg hover:bg-bg-hover"
              )}
              title={n.name}
            >
              <span className={clsx("w-2 h-2 rounded-full shrink-0", dot)} />
              <span>{n.role === "hardkas" ? "HardKAS node" : `Node ${n.index}`}</span>
              {n.chain && <span className="text-[10px] font-mono text-fg-muted tabular-nums">#{n.chain.daa.toLocaleString()}</span>}
            </button>
          );
        })}
        <button
          type="button"
          onClick={() => void Promise.all([cluster.refresh(), activeName ? cluster.refreshInspect(activeName) : Promise.resolve()])}
          className="ml-auto p-1 rounded text-fg-muted hover:text-fg hover:bg-bg-hover cursor-pointer shrink-0"
          title="Refresh pod properties now"
          aria-label="Refresh pod properties"
        >
          <RefreshCw size={13} className={loading ? "animate-spin text-accent" : ""} />
        </button>
      </div>

      {!activeName && (
        <div className="flex-1 flex flex-col items-center justify-center p-6 text-center text-fg-muted space-y-2">
          <Boxes size={28} className="opacity-30" />
          <div className="text-sm font-medium text-fg">No cluster nodes found</div>
          <p className="max-w-md text-xs">Start the local node in Servers to inspect containers and add extra cluster pods.</p>
        </div>
      )}

      {activeName && (
        <div className="flex-1 min-h-0 flex flex-col">
          {/* OpenShift Pod Header */}
          <PodHeroHeader
            detail={detail}
            fallbackName={activeName}
            busy={busy}
            loading={loading}
            cluster={cluster}
            referenceIp={referenceNode?.ip ?? null}
            onAction={async (act) => {
              if (act === "remove") {
                const label = detail?.role === "hardkas" ? "HardKAS node" : `Node ${detail?.index ?? activeName}`;
                const ok = await confirmDialog(`Remove ${label} (${activeName})?\n\nExtra pods hold no unique state and can be recreated anytime.`, { title: "Remove pod", confirmLabel: "Remove pod", danger: true });
                if (!ok) return;
              }
              await cluster.action(activeName, act);
            }}
          />

          {/* OpenShift Sub-tabs: Details | Peers | Environment & Spec | Logs */}
          <div role="tablist" aria-label="Pod detail sections" className="shrink-0 flex items-stretch border-b border-border bg-bg-panel px-3">
            {(
              [
                { id: "details", label: "Details", icon: <Activity size={12} /> },
                { id: "peers", label: `Peers (${detail?.chain?.peerDetails?.length ?? detail?.chain?.peers.length ?? 0})`, icon: <Network size={12} /> },
                { id: "env", label: "Environment & Spec", icon: <Terminal size={12} /> },
                { id: "logs", label: "Logs", icon: <ScrollText size={12} /> }
              ] as Array<{ id: InspectTab; label: string; icon: React.ReactNode }>
            ).map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={tab === t.id}
                onClick={() => {
                  setCluster({ inspectTab: t.id });
                  if (t.id === "logs" || t.id === "details") void cluster.refreshInspect(activeName);
                }}
                className={clsx(
                  "flex items-center gap-1.5 px-3 py-2 text-xs border-b-2 cursor-pointer transition-colors",
                  tab === t.id ? "border-accent text-fg font-medium" : "border-transparent text-fg-muted hover:text-fg"
                )}
              >
                {t.icon}
                <span>{t.label}</span>
              </button>
            ))}
          </div>

          {error && (
            <div role="alert" className="mx-4 mt-3 rounded border border-error/40 bg-error/10 px-3 py-2 text-error">
              {error}
            </div>
          )}

          {!detail && !error && (
            <div className="p-6 flex items-center gap-2 text-fg-muted">
              <RefreshCw size={14} className="animate-spin text-accent" />
              <span>Inspecting pod {activeName}…</span>
            </div>
          )}

          {detail && (
            <div className="flex-1 min-h-0 overflow-auto p-4 space-y-4">
              {tab === "details" && (
                <PodDetailsTab
                  detail={detail}
                  syncProgress={currentSummary ? progressOf(currentSummary, referenceNode) : null}
                />
              )}
              {tab === "peers" && <PodPeersTab detail={detail} referenceIp={referenceNode?.ip ?? null} />}
              {tab === "env" && <PodEnvTab detail={detail} />}
              {tab === "logs" && (
                <PodLogsTab
                  nodeName={detail.name}
                  logs={logs}
                  running={detail.running}
                  onRefresh={() => void cluster.refreshInspect(detail.name)}
                />
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function PodHeroHeader({
  detail,
  fallbackName,
  busy,
  loading,
  cluster,
  onAction
}: {
  detail: NodeInspectDetail | null;
  fallbackName: string;
  busy: string | null;
  loading: boolean;
  cluster: ClusterPlugin;
  referenceIp: string | null;
  onAction: (action: "start" | "stop" | "restart" | "remove") => Promise<void>;
}) {
  const running = detail?.running ?? false;
  const answering = Boolean(detail?.chain);
  const syncing = running && answering && detail?.inSync === false;
  const phaseLabel = !detail ? "Loading" : !running ? detail.state : !answering ? "Starting" : syncing ? "Syncing" : "Running";
  const phaseClass = !running
    ? "bg-bg-elev text-fg-muted border-border"
    : syncing || !answering
      ? "bg-warn/15 text-warn border-warn/30"
      : "bg-ok/15 text-ok border-ok/30";

  const title = detail ? (detail.role === "hardkas" ? "HardKAS node" : `Node ${detail.index}`) : fallbackName;
  const rpcUrl = detail?.rpcPort ? `ws://127.0.0.1:${detail.rpcPort}` : null;

  return (
    <div className="shrink-0 px-4 py-3 border-b border-border bg-bg-elev/50 flex flex-wrap items-center gap-3">
      <div className="w-9 h-9 rounded-md bg-accent/15 border border-accent/30 grid place-items-center text-accent shrink-0">
        <Layers size={18} />
      </div>
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex items-center gap-2 flex-wrap">
          <h1 className="text-sm font-semibold text-fg">{title}</h1>
          <CopyChip label={detail?.name ?? fallbackName} value={detail?.name ?? fallbackName} />
          {detail && (
            <span
              className={clsx(
                "px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide border",
                detail.role === "hardkas" ? "bg-ok/10 text-ok border-ok/30" : "bg-info/10 text-info border-info/30"
              )}
            >
              {detail.role === "hardkas" ? "Reference Pod" : "Replica Pod"}
            </span>
          )}
          <span className={clsx("inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-medium border uppercase tracking-wide", phaseClass)}>
            <span className={clsx("w-1.5 h-1.5 rounded-full", !running ? "bg-fg-muted" : syncing || !answering ? "bg-warn animate-pulse" : "bg-ok")} />
            {phaseLabel}
          </span>
        </div>
        <div className="flex items-center gap-3 text-[11px] text-fg-muted flex-wrap">
          {detail?.image && <span className="font-mono truncate max-w-[360px]" title={detail.image}>{detail.image}</span>}
          {detail?.startedAt && <span>Uptime: <strong className="text-fg font-medium">{formatUptime(detail.startedAt)}</strong></span>}
          {detail && <span>Restarts: <strong className="text-fg font-medium tabular-nums">{detail.restarts}</strong></span>}
          {rpcUrl && <CopyChip label={`wRPC ${rpcUrl}`} value={rpcUrl} />}
        </div>
      </div>

      <div className="flex items-center gap-1.5 shrink-0">
        {detail?.role === "extra" ? (
          <>
            {running ? (
              <button type="button" disabled={!!busy} onClick={() => void onAction("stop")} className="btn-ghost py-1 px-2 text-[11px]">
                <Square size={11} /> Stop
              </button>
            ) : (
              <button type="button" disabled={!!busy} onClick={() => void onAction("start")} className="btn-ghost py-1 px-2 text-[11px]">
                <Play size={11} /> Start
              </button>
            )}
            <button type="button" disabled={!!busy || !running} onClick={() => void onAction("restart")} className="btn-ghost py-1 px-2 text-[11px]">
              <RotateCw size={11} /> Restart
            </button>
            <button type="button" disabled={!!busy} onClick={() => void onAction("remove")} className="btn-ghost py-1 px-2 text-[11px] text-error border-error/30 hover:bg-error/10">
              <Trash2 size={11} /> Delete pod
            </button>
          </>
        ) : (
          <button type="button" onClick={() => void cluster.refreshInspect(fallbackName)} disabled={loading} className="btn-ghost py-1 px-2 text-[11px]">
            <RefreshCw size={11} className={loading ? "animate-spin" : ""} /> Refresh
          </button>
        )}
      </div>
    </div>
  );
}

function PodDetailsTab({ detail, syncProgress }: { detail: NodeInspectDetail; syncProgress: number | null }) {
  const c = detail.chain;
  const memLimitText = detail.memLimit || (detail.memoryLimitBytes > 0 ? formatBytes(detail.memoryLimitBytes) : "unlimited");
  const cpuLimitText = detail.nanoCpus > 0 ? `${(detail.nanoCpus / 1e9).toFixed(1)} vCPU` : "unlimited";
  const labelEntries = Object.entries(detail.labels ?? {});

  return (
    <>
      {/* Live Resource & Consensus KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-2.5">
        <MetricCard icon={<Cpu size={13} />} label="CPU Usage" value={detail.cpu || "—"} sub={`Limit: ${cpuLimitText}`} />
        <MetricCard icon={<Activity size={13} />} label="Memory" value={detail.mem || "—"} sub={`${detail.memPercent ? `${detail.memPercent} · ` : ""}Limit: ${memLimitText}`} />
        <MetricCard icon={<Network size={13} />} label="Network I/O" value={detail.netIo || "—"} sub={`IP: ${detail.ip ?? "—"}`} />
        <MetricCard icon={<Layers size={13} />} label="Virtual DAA" value={c ? c.daa.toLocaleString() : "—"} sub={detail.behind ? `${detail.behind.toLocaleString()} behind ref` : c ? "Tip height" : "RPC offline"} warn={Boolean(detail.behind && detail.behind > 0)} />
        <MetricCard icon={<HardDrive size={13} />} label="Blocks / Headers" value={c ? `${c.blocks.toLocaleString()} / ${c.headers.toLocaleString()}` : "—"} sub={c ? `${c.tips} DAG tips · ${c.mempool} mempool` : "—"} />
        <MetricCard icon={<Terminal size={13} />} label="Runtime PIDs" value={detail.pids || (detail.pid ? String(detail.pid) : "0")} sub={`Restarts: ${detail.restarts}${detail.oomKilled ? " · OOMKilled" : ""}`} warn={detail.oomKilled} />
      </div>

      {/* Sync Progress Bar when Catching Up */}
      {detail.running && c && detail.inSync === false && syncProgress !== null && (
        <div className="rounded border border-warn/40 bg-warn/10 p-3 space-y-1.5">
          <div className="flex items-center justify-between text-xs">
            <span className="font-medium text-warn">Syncing chain from {detail.reference?.name ?? "reference pod"}</span>
            <span className="font-mono tabular-nums text-fg">
              {Math.round(syncProgress * 100)}% · {detail.behind?.toLocaleString() ?? 0} DAA behind
            </span>
          </div>
          <div role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(syncProgress * 100)} className="h-2 rounded bg-bg-panel overflow-hidden border border-border">
            <div className="h-full bg-warn transition-all" style={{ width: `${Math.max(2, syncProgress * 100)}%` }} />
          </div>
        </div>
      )}

      {/* Main OpenShift Two-Column Details Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Container & Pod Metadata */}
        <section className="rounded border border-border bg-bg-panel overflow-hidden">
          <div className="px-3 py-2 border-b border-border bg-bg-elev/60 font-semibold text-fg flex items-center justify-between">
            <span>Pod &amp; Container Details</span>
            <span className="text-[10px] font-mono text-fg-muted">ID {detail.id}</span>
          </div>
          <div className="p-3 space-y-3">
            <dl className="grid grid-cols-[9rem_1fr] gap-x-3 gap-y-1.5 items-baseline">
              <dt className="text-fg-muted">Container name</dt>
              <dd className="font-mono text-fg select-all">{detail.name}</dd>
              <dt className="text-fg-muted">Container ID</dt>
              <dd className="font-mono text-fg flex items-center gap-1.5">
                <span>{detail.id}</span>
                <CopyIconButton value={detail.id} title="Copy container ID" />
              </dd>
              <dt className="text-fg-muted">State / Exit code</dt>
              <dd className="font-mono text-fg">
                {detail.state} (exit {detail.exitCode}{detail.oomKilled ? ", OOMKilled" : ""})
              </dd>
              <dt className="text-fg-muted">Image</dt>
              <dd className="font-mono text-fg break-all">{detail.image}</dd>
              <dt className="text-fg-muted">Image ID</dt>
              <dd className="font-mono text-fg-muted">{detail.imageId || "—"} ({detail.platform})</dd>
              <dt className="text-fg-muted">Created</dt>
              <dd className="font-mono text-fg-muted">{formatTimestamp(detail.createdAt)}</dd>
              <dt className="text-fg-muted">Started</dt>
              <dd className="font-mono text-fg">{detail.startedAt ? `${formatTimestamp(detail.startedAt)} (${formatUptime(detail.startedAt)})` : "stopped"}</dd>
              <dt className="text-fg-muted">Restart policy</dt>
              <dd className="font-mono text-fg">{detail.restartPolicy}</dd>
              <dt className="text-fg-muted">Pod IP</dt>
              <dd className="font-mono text-fg">{detail.ip ?? "—"}</dd>
              <dt className="text-fg-muted">Networks</dt>
              <dd className="font-mono text-fg-muted">
                {detail.networks.length > 0 ? detail.networks.map((n) => `${n.name} (${n.ip || "no ip"}${n.gateway ? ` gw ${n.gateway}` : ""})`).join(", ") : "—"}
              </dd>
              <dt className="text-fg-muted">Exposed ports</dt>
              <dd className="font-mono text-fg flex flex-wrap gap-1">
                {detail.ports.length > 0 ? (
                  detail.ports.map((p, i) => (
                    <span key={i} className="px-1.5 py-0.5 rounded bg-bg border border-border text-[11px]">
                      {p.hostPort ? `${p.hostIp || "0.0.0.0"}:${p.hostPort} → ${p.containerPort}` : p.containerPort}
                    </span>
                  ))
                ) : (
                  <span className="text-fg-muted">—</span>
                )}
              </dd>
            </dl>

            {/* OpenShift-style Pod Labels */}
            <div className="pt-2 border-t border-border space-y-1.5">
              <div className="text-[11px] font-semibold text-fg-muted flex items-center gap-1">
                <Tag size={11} /> Labels
              </div>
              {labelEntries.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {labelEntries.map(([k, v]) => (
                    <span key={k} className="inline-flex items-center rounded border border-border bg-bg px-2 py-0.5 text-[11px] font-mono">
                      <span className="text-info">{k}</span>
                      <span className="text-fg-muted mx-1">=</span>
                      <span className="text-fg">{v || '""'}</span>
                    </span>
                  ))}
                </div>
              ) : (
                <div className="text-fg-muted">No labels set on this container.</div>
              )}
            </div>
          </div>
        </section>

        {/* Kaspa Chain & wRPC State */}
        <section className="rounded border border-border bg-bg-panel overflow-hidden">
          <div className="px-3 py-2 border-b border-border bg-bg-elev/60 font-semibold text-fg flex items-center justify-between">
            <span>Kaspa Node &amp; Consensus State</span>
            <span className="text-[10px] font-mono text-fg-muted">{c ? c.network : "RPC unavailable"}</span>
          </div>
          <div className="p-3">
            {!c ? (
              <div className="py-6 text-center text-fg-muted">
                {detail.running ? "Node container is running, waiting for JSON wRPC on port " + (detail.rpcPort ?? "18210") + "…" : "Start this pod to query live DAG, sink, peer, and mempool state."}
              </div>
            ) : (
              <dl className="grid grid-cols-[9rem_1fr] gap-x-3 gap-y-1.5 items-baseline">
                <dt className="text-fg-muted">Server version</dt>
                <dd className="font-mono text-fg">rusty-kaspad {c.version || "—"}</dd>
                <dt className="text-fg-muted">Sync vs cluster</dt>
                <dd>
                  {detail.role === "hardkas" ? (
                    <span className="text-ok font-medium">Reference chain</span>
                  ) : detail.inSync ? (
                    <span className="text-ok font-medium">In sync (identical sink)</span>
                  ) : (
                    <span className="text-warn font-medium">Catching up ({detail.behind?.toLocaleString() ?? 0} behind)</span>
                  )}
                </dd>
                <dt className="text-fg-muted">wRPC endpoint</dt>
                <dd className="font-mono text-accent flex items-center gap-1.5">
                  <span>{detail.rpcPort ? `ws://127.0.0.1:${detail.rpcPort}` : "not published"}</span>
                  {detail.rpcPort && <CopyIconButton value={`ws://127.0.0.1:${detail.rpcPort}`} title="Copy wRPC URL" />}
                </dd>
                <dt className="text-fg-muted">UTXO index</dt>
                <dd className="font-mono text-fg">{c.utxoIndexed === undefined ? "—" : c.utxoIndexed ? "enabled" : "disabled"}</dd>
                <dt className="text-fg-muted">Virtual DAA score</dt>
                <dd className="font-mono text-fg tabular-nums">{c.daa.toLocaleString()}</dd>
                <dt className="text-fg-muted">Blocks / Headers</dt>
                <dd className="font-mono text-fg tabular-nums">
                  {c.blocks.toLocaleString()} blocks · {c.headers.toLocaleString()} headers
                </dd>
                <dt className="text-fg-muted">DAG tips / Mempool</dt>
                <dd className="font-mono text-fg tabular-nums">
                  {c.tips} tips · {c.mempool} mempool tx
                </dd>
                <dt className="text-fg-muted">Difficulty</dt>
                <dd className="font-mono text-fg tabular-nums">{c.difficulty.toLocaleString()}</dd>
                <dt className="text-fg-muted">Sink hash</dt>
                <dd className="font-mono text-fg flex items-center gap-1.5 min-w-0">
                  <span className="truncate" title={c.sink}>{c.sink}</span>
                  {c.sink && <CopyIconButton value={c.sink} title="Copy sink hash" />}
                </dd>
                {c.pruningPoint && (
                  <>
                    <dt className="text-fg-muted">Pruning point</dt>
                    <dd className="font-mono text-fg-muted flex items-center gap-1.5 min-w-0">
                      <span className="truncate" title={c.pruningPoint}>{c.pruningPoint}</span>
                      <CopyIconButton value={c.pruningPoint} title="Copy pruning point hash" />
                    </dd>
                  </>
                )}
                {c.p2pId && (
                  <>
                    <dt className="text-fg-muted">P2P identity</dt>
                    <dd className="font-mono text-fg-muted flex items-center gap-1.5 min-w-0">
                      <span className="truncate" title={c.p2pId}>{c.p2pId}</span>
                      <CopyIconButton value={c.p2pId} title="Copy P2P ID" />
                    </dd>
                  </>
                )}
              </dl>
            )}
          </div>
        </section>
      </div>

      {/* Volumes / Mounts Table */}
      <section className="rounded border border-border bg-bg-panel overflow-hidden">
        <div className="px-3 py-2 border-b border-border bg-bg-elev/60 font-semibold text-fg flex items-center justify-between">
          <span>Volumes &amp; Mounts</span>
          <span className="text-[10px] text-fg-muted">{detail.mounts.length} mount{detail.mounts.length === 1 ? "" : "s"}</span>
        </div>
        {detail.mounts.length === 0 ? (
          <div className="p-3 text-fg-muted">Ephemeral container storage only (no persistent mounts — syncs chain directly from peers).</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-border text-[10px] uppercase tracking-wider text-fg-muted bg-bg/40">
                  <th className="py-1.5 px-3 font-semibold">Type</th>
                  <th className="py-1.5 px-3 font-semibold">Host / Volume Source</th>
                  <th className="py-1.5 px-3 font-semibold">Container Path</th>
                  <th className="py-1.5 px-3 font-semibold">Access</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border font-mono text-[11px]">
                {detail.mounts.map((m, i) => (
                  <tr key={i} className="hover:bg-bg-hover/40">
                    <td className="py-1.5 px-3 text-fg-muted">{m.type}</td>
                    <td className="py-1.5 px-3 text-fg break-all">{m.source}</td>
                    <td className="py-1.5 px-3 text-info break-all">{m.destination}</td>
                    <td className="py-1.5 px-3">
                      <span className={clsx("px-1.5 py-0.5 rounded text-[10px]", m.rw ? "bg-ok/15 text-ok" : "bg-bg-elev text-fg-muted")}>
                        {m.rw ? "RW" : "RO"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

function PodPeersTab({ detail, referenceIp }: { detail: NodeInspectDetail; referenceIp: string | null }) {
  const peers = detail.chain?.peerDetails ?? detail.chain?.peers.map((p, i) => ({ id: String(i), address: p.address, outbound: p.outbound, userAgent: "", synced: true, lastPingMs: null, timeOffsetMs: null })) ?? [];

  if (!detail.running || !detail.chain) {
    return <div className="p-6 text-center text-fg-muted">Pod RPC is offline. Peer mesh appears once the container answers JSON wRPC.</div>;
  }

  if (peers.length === 0) {
    return <div className="p-6 text-center text-fg-muted">0 connected peers right now.</div>;
  }

  return (
    <section className="rounded border border-border bg-bg-panel overflow-hidden">
      <div className="px-3 py-2 border-b border-border bg-bg-elev/60 font-semibold text-fg flex items-center justify-between">
        <span>Connected P2P Peers</span>
        <span className="text-[10px] text-fg-muted">{peers.length} connected</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-border text-[10px] uppercase tracking-wider text-fg-muted bg-bg/40">
              <th className="py-1.5 px-3 font-semibold">Direction</th>
              <th className="py-1.5 px-3 font-semibold">Address</th>
              <th className="py-1.5 px-3 font-semibold">User Agent</th>
              <th className="py-1.5 px-3 font-semibold">Ping</th>
              <th className="py-1.5 px-3 font-semibold">Synced</th>
              <th className="py-1.5 px-3 font-semibold">Peer ID</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border font-mono text-[11px]">
            {peers.map((p, i) => {
              const isRef = Boolean(referenceIp && p.address.startsWith(referenceIp));
              return (
                <tr key={p.id || i} className="hover:bg-bg-hover/40">
                  <td className="py-1.5 px-3">
                    <span className={clsx("inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px]", p.outbound ? "bg-info/15 text-info" : "bg-bg-elev text-fg-muted")}>
                      {p.outbound ? <ArrowUpRight size={10} /> : <ArrowDownLeft size={10} />}
                      {p.outbound ? "outbound" : "inbound"}
                    </span>
                  </td>
                  <td className="py-1.5 px-3 text-fg">
                    <span>{p.address}</span>
                    {isRef && <span className="ml-2 px-1.5 py-0.5 rounded bg-ok/15 text-ok text-[10px]">HardKAS reference</span>}
                  </td>
                  <td className="py-1.5 px-3 text-fg-muted">{p.userAgent || "—"}</td>
                  <td className="py-1.5 px-3 text-fg tabular-nums">{p.lastPingMs !== null ? `${p.lastPingMs} ms` : "—"}</td>
                  <td className="py-1.5 px-3">
                    <span className={p.synced ? "text-ok" : "text-warn"}>{p.synced ? "yes" : "no"}</span>
                  </td>
                  <td className="py-1.5 px-3 text-fg-muted truncate max-w-[180px]" title={p.id}>{p.id || "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function PodEnvTab({ detail }: { detail: NodeInspectDetail }) {
  const [showRaw, setShowRaw] = useState(false);

  return (
    <div className="space-y-4">
      <section className="rounded border border-border bg-bg-panel overflow-hidden">
        <div className="px-3 py-2 border-b border-border bg-bg-elev/60 font-semibold text-fg flex items-center justify-between">
          <span>Entrypoint &amp; Command Arguments</span>
          <CopyChip label="Copy command" value={detail.cmd.join(" ")} />
        </div>
        <div className="p-3 font-mono text-[11px] bg-bg/60 space-y-1">
          {detail.cmd.map((arg, i) => (
            <div key={i} className={clsx(i === 0 ? "text-accent font-semibold" : arg.startsWith("--addpeer=") ? "text-ok" : "text-fg")}>
              {i === 0 ? arg : `  ${arg}`}
            </div>
          ))}
        </div>
      </section>

      <section className="rounded border border-border bg-bg-panel overflow-hidden">
        <div className="px-3 py-2 border-b border-border bg-bg-elev/60 font-semibold text-fg flex items-center justify-between">
          <span>Environment Variables</span>
          <span className="text-[10px] text-fg-muted">{detail.env.length} variables (secrets redacted)</span>
        </div>
        {detail.env.length === 0 ? (
          <div className="p-3 text-fg-muted">No environment variables configured.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-border text-[10px] uppercase tracking-wider text-fg-muted bg-bg/40">
                  <th className="py-1.5 px-3 font-semibold w-56">Name</th>
                  <th className="py-1.5 px-3 font-semibold">Value</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border font-mono text-[11px]">
                {detail.env.map((e, i) => (
                  <tr key={i} className="hover:bg-bg-hover/40">
                    <td className="py-1.5 px-3 text-info">{e.key}</td>
                    <td className="py-1.5 px-3 text-fg break-all">{e.value || <span className="text-fg-muted">(empty)</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className="flex items-center justify-between">
        <button type="button" onClick={() => setShowRaw((v) => !v)} className="btn-ghost text-[11px]">
          {showRaw ? "Hide raw inspect JSON" : "Show raw inspect JSON"}
        </button>
        {showRaw && <CopyChip label="Copy JSON" value={JSON.stringify(detail, null, 2)} />}
      </div>
      {showRaw && (
        <pre className="rounded border border-border bg-bg-panel p-3 text-[11px] font-mono text-fg-muted overflow-auto max-h-96 select-text">
          {JSON.stringify(detail, null, 2)}
        </pre>
      )}
    </div>
  );
}

function PodLogsTab({ nodeName, logs, running, onRefresh }: { nodeName: string; logs: string; running: boolean; onRefresh: () => void }) {
  const [filter, setFilter] = useState("");
  const lines = useMemo(() => {
    const raw = logs ? logs.split(/\r?\n/) : [];
    const q = filter.trim().toLowerCase();
    return q ? raw.filter((line) => line.toLowerCase().includes(q)) : raw;
  }, [logs, filter]);

  return (
    <div className="h-full flex flex-col rounded border border-border bg-bg-panel overflow-hidden min-h-[340px]">
      <div className="shrink-0 px-3 py-2 border-b border-border bg-bg-elev/60 flex items-center gap-2 flex-wrap">
        <span className="font-semibold text-fg">Container logs · {nodeName}</span>
        <div className="relative flex-1 min-w-[180px] max-w-xs ml-auto">
          <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-fg-muted" />
          <input
            type="search"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter logs…"
            aria-label="Filter container logs"
            className="input pl-6 py-1 text-[11px]"
          />
        </div>
        <CopyChip label="Copy" value={lines.join("\n")} />
        <button type="button" onClick={onRefresh} className="btn-ghost py-1 px-2 text-[11px]">
          <RefreshCw size={11} /> Refresh
        </button>
      </div>
      <pre className="flex-1 min-h-0 overflow-auto p-3 font-mono text-[11px] leading-relaxed text-fg-muted select-text whitespace-pre-wrap break-all">
        {lines.length > 0 ? lines.join("\n") : running ? "No matching log lines yet." : "Container stopped (no new logs)."}
      </pre>
    </div>
  );
}

function MetricCard({ icon, label, value, sub, warn }: { icon: React.ReactNode; label: string; value: string; sub: string; warn?: boolean }) {
  return (
    <div className="rounded border border-border bg-bg-panel p-2.5 space-y-1">
      <div className="text-[10px] uppercase tracking-wider text-fg-muted flex items-center gap-1.5">
        <span className="text-accent">{icon}</span>
        <span>{label}</span>
      </div>
      <div className={clsx("text-sm font-mono font-semibold tabular-nums truncate", warn ? "text-warn" : "text-fg")} title={value}>
        {value}
      </div>
      <div className="text-[10px] text-fg-muted truncate" title={sub}>
        {sub}
      </div>
    </div>
  );
}

function CopyChip({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);
  return (
    <button
      type="button"
      onClick={() =>
        void copyText(value).then(() => {
          setCopied(true);
          if (timerRef.current) clearTimeout(timerRef.current);
          timerRef.current = setTimeout(() => setCopied(false), 1200);
        })
      }
      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-bg border border-border text-[11px] font-mono text-fg-muted hover:text-fg hover:border-fg-muted/40 cursor-pointer"
      title={`Copy: ${value}`}
    >
      <span className="truncate max-w-[220px]">{label}</span>
      {copied ? <Check size={10} className="text-ok shrink-0" /> : <Copy size={10} className="shrink-0" />}
    </button>
  );
}

function CopyIconButton({ value, title }: { value: string; title: string }) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);
  return (
    <button
      type="button"
      onClick={() =>
        void copyText(value).then(() => {
          setCopied(true);
          if (timerRef.current) clearTimeout(timerRef.current);
          timerRef.current = setTimeout(() => setCopied(false), 1200);
        })
      }
      className="p-0.5 rounded text-fg-muted hover:text-accent cursor-pointer shrink-0"
      title={title}
      aria-label={title}
    >
      {copied ? <Check size={11} className="text-ok" /> : <Copy size={11} />}
    </button>
  );
}

function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return "0 B";
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function formatTimestamp(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

function formatUptime(startedAt: string): string {
  const start = new Date(startedAt).getTime();
  if (Number.isNaN(start)) return "—";
  const sec = Math.max(0, Math.floor((Date.now() - start) / 1000));
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ${sec % 60}s`;
  const hrs = Math.floor(min / 60);
  if (hrs < 24) return `${hrs}h ${min % 60}m`;
  const days = Math.floor(hrs / 24);
  return `${days}d ${hrs % 24}h`;
}
