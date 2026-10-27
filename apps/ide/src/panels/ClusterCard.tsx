import clsx from "clsx";
import { Check, Copy, Minus, Play, Plus, RefreshCw, RotateCw, ScrollText, Square, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useEngine } from "@/engine/context";
import type { ClusterPlugin } from "@/plugins/cluster";
import { progressOf, useCluster, type ClusterNode } from "@/store/cluster";
import { copyText } from "@/utils/clipboard";

/** Local cluster: the HardKAS node and the extra nodes started next to it. Scale up and down, and see each node's chain. */
export function ClusterCard() {
  const engine = useEngine();
  const cluster = engine.get<ClusterPlugin>("cluster");
  const status = useCluster((s) => s.status);
  const error = useCluster((s) => s.error);
  const busy = useCluster((s) => s.busy);
  const loading = useCluster((s) => s.loading);
  const samples = useCluster((s) => s.samples);
  const logFor = useCluster((s) => s.logFor);
  const logText = useCluster((s) => s.logText);
  const cardRef = useRef<HTMLElement>(null);

  // Left-column views stay mounted while hidden: poll only while this card is on screen.
  useEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    void cluster.refresh(); // one reading right away; the 3-second polling starts when the card scrolls into view
    let running = false;
    const stop = () => {
      if (running) cluster.stop();
      running = false;
    };
    const observer = new IntersectionObserver(([entry]) => {
      if (entry?.isIntersecting && !running) {
        running = true;
        cluster.start();
      } else if (!entry?.isIntersecting) stop();
    });
    observer.observe(el);
    return () => {
      observer.disconnect();
      stop();
      cluster.closeLog();
    };
  }, [cluster]);

  const nodes = status?.nodes ?? [];
  const extras = nodes.filter((n) => n.role === "extra");
  const reference = nodes.find((n) => n.name === status?.reference);
  const inSync = nodes.filter((n) => n.inSync).length;
  const syncing = nodes.filter((n) => n.state === "running" && n.chain && n.inSync === false).length;
  const max = status?.max ?? 12;

  return (
    <section ref={cardRef} className="border-b border-border" aria-label="Cluster">
      <div className="flex items-center justify-between px-3 py-1.5">
        <span className="label mb-0 flex items-center gap-2">
          <span className={clsx("w-2 h-2 rounded-full", nodes.length > 0 ? "bg-ok" : "bg-fg-muted")} /> Cluster · {nodes.length || "…"} node{nodes.length === 1 ? "" : "s"}
        </span>
        <button type="button" onClick={() => void cluster.refresh()} className="p-0.5 rounded text-fg-muted hover:text-fg hover:bg-bg-hover cursor-pointer" title="Refresh now (updates every 3 s while this view is open)" aria-label="Refresh cluster">
          <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
        </button>
      </div>
      <div className="px-3 pb-3 space-y-2">
        {status && !status.docker && <div className="text-fg-muted">Docker is not running, so extra nodes cannot be started. Start Docker Desktop and refresh.</div>}

        {status?.docker && (
          <>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-fg-muted">Extra</span>
              <div className="flex items-center rounded border border-border overflow-hidden" role="group" aria-label="Number of extra nodes">
                <button type="button" aria-label="Remove one extra node" className="px-1.5 py-1 hover:bg-bg-hover cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed" disabled={!!busy || extras.length === 0} onClick={() => void cluster.scale(extras.length - 1)} title="Scale down by one (removes the newest extra node)">
                  <Minus size={12} />
                </button>
                <span className="px-2.5 tabular-nums text-fg font-medium min-w-6 text-center" aria-live="polite">
                  {extras.length}
                </span>
                <button type="button" aria-label="Add one extra node" className="px-1.5 py-1 hover:bg-bg-hover cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed" disabled={!!busy || extras.length >= max} onClick={() => void cluster.add(1)} title="Scale up by one">
                  <Plus size={12} />
                </button>
              </div>
              <button type="button" className="btn-ghost" disabled={!!busy || extras.length >= max} onClick={() => void cluster.add(2)} title="Start two more nodes">
                +2
              </button>
              {extras.length > 0 && (
                <button
                  type="button"
                  className="ml-auto text-[11px] text-fg-muted hover:text-error cursor-pointer disabled:opacity-40"
                  disabled={!!busy}
                  onClick={() => window.confirm(`Remove all ${extras.length} extra node${extras.length === 1 ? "" : "s"}?\n\nThey hold no data of their own (they copy the chain from the HardKAS node), so nothing is lost.`) && void cluster.scale(0)}
                >
                  remove all
                </button>
              )}
            </div>

            {busy && (
              <div role="status" className="text-info flex items-center gap-1.5">
                <RefreshCw size={11} className="animate-spin" /> {busy}
              </div>
            )}
            {error && <div role="alert" className="text-error break-words">{error}</div>}

            {nodes.length > 1 && (
              <div className="text-fg-muted tabular-nums">
                {inSync} of {nodes.length} in sync{syncing > 0 ? ` · ${syncing} syncing` : ""}
              </div>
            )}

            <ul className="space-y-2">
              {nodes.map((n) => (
                <NodeRow key={n.name} node={n} reference={reference} samples={samples[n.name] ?? []} busy={!!busy} cluster={cluster} logOpen={logFor === n.name} logText={logFor === n.name ? logText : ""} />
              ))}
              {nodes.length === 0 && <li className="text-fg-muted">The HardKAS node is not running. Start it above, then add extra nodes here.</li>}
            </ul>

            {reference?.chain && reference.chain.blocks > 50_000 && (
              <div className="rounded border border-warn/40 bg-warn/10 p-2 text-[11px] text-fg-muted leading-relaxed">
                The HardKAS chain is long ({reference.chain.blocks.toLocaleString()} blocks, the miner has been running for a while), so a new node needs a good while to copy it. Resetting the local node from scratch starts a short chain that new nodes copy in seconds.
              </div>
            )}
            <div className="text-[10px] text-fg-muted leading-relaxed">
              Extra nodes download the chain from the HardKAS node and then follow its blocks, so a long chain takes a while to copy. Mining and funding stay on the HardKAS node. Extra nodes live in Docker next to it; the HardKAS node itself is never changed from here.
            </div>
          </>
        )}
        {!status && !error && <div className="text-fg-muted">Reading the cluster…</div>}
      </div>
    </section>
  );
}

function NodeRow({ node: n, reference, samples, busy, cluster, logOpen, logText }: { node: ClusterNode; reference: ClusterNode | undefined; samples: Array<[number, number]>; busy: boolean; cluster: ClusterPlugin; logOpen: boolean; logText: string }) {
  const running = n.state === "running";
  const answering = !!n.chain;
  const progress = progressOf(n, reference);
  const syncing = running && answering && n.inSync === false;
  const [copied, setCopied] = useState(false);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    };
  }, []);

  const dot = !running ? "bg-fg-muted" : !answering ? "bg-warn animate-pulse" : n.inSync === false ? "bg-warn animate-pulse" : "bg-ok";
  const stateText = !running ? n.state : !answering ? "starting…" : n.role === "hardkas" ? "reference" : n.inSync ? "in sync" : "syncing";

  // Speed over the last readings, to tell how long a joining node still needs.
  let eta = "";
  if (syncing && reference?.chain && samples.length >= 3) {
    const [t0, v0] = samples[0];
    const [t1, v1] = samples[samples.length - 1];
    const rate = t1 > t0 ? (v1 - v0) / ((t1 - t0) / 1000) : 0;
    const left = Math.max(reference.chain.blocks, reference.chain.headers) - v1;
    if (rate > 0.5 && left > 0) {
      const s = left / rate;
      eta = ` · ~${s < 90 ? `${Math.round(s)} s` : s < 5400 ? `${Math.round(s / 60)} min` : `${(s / 3600).toFixed(1)} h`} left at ${Math.round(rate)}/s`;
    }
  }

  return (
    <li className="rounded border border-border bg-bg-elev p-2 space-y-1.5">
      <div className="flex items-center gap-2 min-w-0">
        <span className={clsx("w-2 h-2 rounded-full shrink-0", dot)} />
        <span className="font-semibold text-fg truncate" title={n.name}>{n.role === "hardkas" ? "HardKAS node" : `Node ${n.index}`}</span>
        <span className="ml-auto flex items-center gap-0.5 shrink-0">
          <Act label={logOpen ? `Hide log of ${n.name}` : `Show log of ${n.name}`} onClick={() => (logOpen ? cluster.closeLog() : cluster.openLog(n.name))} active={logOpen}>
            <ScrollText size={12} />
          </Act>
          {n.role === "extra" && (
            <>
              {running ? (
                <Act label={`Stop ${n.name}`} disabled={busy} onClick={() => void cluster.action(n.name, "stop")}>
                  <Square size={12} />
                </Act>
              ) : (
                <Act label={`Start ${n.name}`} disabled={busy} onClick={() => void cluster.action(n.name, "start")}>
                  <Play size={12} />
                </Act>
              )}
              <Act label={`Restart ${n.name}`} disabled={busy || !running} onClick={() => void cluster.action(n.name, "restart")}>
                <RotateCw size={12} />
              </Act>
              <Act label={`Remove ${n.name}`} disabled={busy} danger onClick={() => void cluster.action(n.name, "remove")}>
                <Trash2 size={12} />
              </Act>
            </>
          )}
        </span>
      </div>

      <div className={clsx("text-[10px] uppercase tracking-wide", !running ? "text-fg-muted" : syncing || !answering ? "text-warn" : "text-ok")}>{stateText}</div>

      {answering && n.chain && (
        <dl className="grid grid-cols-[4.2rem_1fr] gap-x-2 gap-y-0.5">
          <dt className="text-fg-muted">height</dt>
          <dd className="font-mono tabular-nums text-fg">
            {n.chain.daa.toLocaleString()}
            {n.inSync === false && n.behind ? <span className="text-warn"> · {n.behind.toLocaleString()} behind</span> : null}
          </dd>
          <dt className="text-fg-muted">final block</dt>
          <dd className="font-mono text-[11px] flex items-center gap-1 min-w-0">
            <span className="truncate" title={n.chain.sink}>
              {n.chain.sink.slice(0, 12)}…{n.chain.sink.slice(-6)}
            </span>
            <button
              type="button"
              aria-label="Copy final block hash"
              className="p-0.5 rounded text-fg-muted hover:text-accent cursor-pointer shrink-0"
              onClick={() =>
                void copyText(n.chain!.sink).then(() => {
                  setCopied(true);
                  if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
                  copyTimerRef.current = setTimeout(() => setCopied(false), 1200);
                })
              }
            >
              {copied ? <Check size={11} className="text-ok" /> : <Copy size={11} />}
            </button>
          </dd>
          <dt className="text-fg-muted">tips · peers</dt>
          <dd className="tabular-nums">
            {n.chain.tips} · {n.chain.peers.length} peer{n.chain.peers.length === 1 ? "" : "s"}
          </dd>
          <dt className="text-fg-muted">resources</dt>
          <dd className="tabular-nums text-fg-muted">
            {n.mem ?? "…"} · rpc :{n.rpcPort ?? "—"}
          </dd>
        </dl>
      )}

      {syncing && progress !== null && (
        <div className="space-y-0.5">
          <div role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)} className="h-1.5 rounded bg-bg-hover overflow-hidden">
            <div className="h-full bg-warn transition-all" style={{ width: `${Math.max(2, progress * 100)}%` }} />
          </div>
          <div className="text-[10px] text-fg-muted tabular-nums">
            downloading the chain · {Math.round(progress * 100)}%{eta}
          </div>
        </div>
      )}

      {!running && <div className="text-fg-muted">Stopped. Start it again and it catches up with the others.</div>}
      {running && !answering && <div className="text-fg-muted">Starting up, its RPC is not answering yet.</div>}

      {logOpen && (
        <div className="relative">
          <pre className="max-h-48 overflow-auto rounded border border-border bg-bg p-2 text-[10px] leading-snug whitespace-pre-wrap break-all">{logText}</pre>
          <button type="button" aria-label="Close log" className="absolute top-1 right-1 p-0.5 rounded text-fg-muted hover:text-fg bg-bg/80 cursor-pointer" onClick={() => cluster.closeLog()}>
            <X size={11} />
          </button>
        </div>
      )}
    </li>
  );
}

function Act({ label, onClick, disabled, danger, active, children }: { label: string; onClick: () => void; disabled?: boolean; danger?: boolean; active?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={clsx("p-1 rounded cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed", danger ? "text-fg-muted hover:text-error hover:bg-bg-hover" : active ? "text-accent bg-bg-hover" : "text-fg-muted hover:text-fg hover:bg-bg-hover")}
    >
      {children}
    </button>
  );
}
