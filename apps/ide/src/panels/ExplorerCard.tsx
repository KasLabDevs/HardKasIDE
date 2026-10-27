import clsx from "clsx";
import { Check, Copy, Pickaxe, RefreshCw } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useEngine } from "@/engine/context";
import type { ExplorerPlugin } from "@/plugins/explorer";
import { formatKas, useEnv } from "@/store/env";
import { useExplorer } from "@/store/explorer";
import { copyText } from "@/utils/clipboard";

type Tab = "chain" | "blocks" | "mempool" | "utxos";

/** Block explorer for the Local node, inside the Servers view: chain, mined blocks, mempool and UTXOs. */
export function ExplorerCard() {
  const engine = useEngine();
  const explorer = engine.get<ExplorerPlugin>("explorer");
  const node = useEnv((s) => s.node);
  const dag = useExplorer((s) => s.dag);
  const busy = useExplorer((s) => s.busy);
  const error = useExplorer((s) => s.error);
  const updatedAt = useExplorer((s) => s.updatedAt);
  const mempool = useExplorer((s) => s.mempool);
  const [tab, setTab] = useState<Tab>("chain");

  // Left-column views stay mounted while hidden, so "mounted" does not mean "on screen": poll only while the card is visible.
  const cardRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    let running = false;
    const stop = () => {
      if (running) explorer.stop();
      running = false;
    };
    const observer = new IntersectionObserver(([entry]) => {
      if (entry?.isIntersecting && !running) {
        running = true;
        explorer.start();
      } else if (!entry?.isIntersecting) stop();
    });
    observer.observe(el);
    return () => {
      observer.disconnect();
      stop();
    };
  }, [explorer]);

  const ready = node?.rpcReady === true;
  const TABS: Array<[Tab, string]> = [
    ["chain", "Chain"],
    ["blocks", "Blocks"],
    ["mempool", mempool && mempool.length > 0 ? `Mempool ${mempool.length}` : "Mempool"],
    ["utxos", "UTXOs"]
  ];

  return (
    <section ref={cardRef} className="border-b border-border" aria-label="Node explorer">
      <div className="flex items-center justify-between px-3 py-1.5">
        <span className="label mb-0 flex items-center gap-2">
          <span className={clsx("w-2 h-2 rounded-full", ready ? "bg-ok" : "bg-fg-muted")} /> Explorer · {dag?.networkId ?? "simnet"}
        </span>
        <button type="button" onClick={() => void explorer.refresh()} className="p-0.5 rounded text-fg-muted hover:text-fg hover:bg-bg-hover cursor-pointer" title="Refresh now (updates every 4 s while this view is open)" aria-label="Refresh explorer">
          <RefreshCw size={13} className={busy ? "animate-spin" : ""} />
        </button>
      </div>
      <div className="px-3 pb-3 space-y-2">
        <div role="tablist" aria-label="Explorer sections" className="flex flex-wrap gap-0.5 rounded bg-bg-panel border border-border p-0.5">
          {TABS.map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              onClick={() => setTab(id)}
              className={clsx("flex-1 min-w-[4.5rem] rounded px-1.5 py-1 text-[11px] cursor-pointer whitespace-nowrap transition-colors", tab === id ? "bg-bg-hover text-fg" : "text-fg-muted hover:text-fg")}
            >
              {label}
            </button>
          ))}
        </div>

        {!ready && !dag && <div className="text-fg-muted">The explorer shows the Local node once it is running. {error}</div>}
        {ready && error && !dag && <div className="text-warn">{error}</div>}

        {(ready || dag) && tab === "chain" && <ChainTab />}
        {(ready || dag) && tab === "blocks" && <BlocksTab />}
        {(ready || dag) && tab === "mempool" && <MempoolTab />}
        {tab === "utxos" && <UtxosTab explorer={explorer} ready={ready} />}

        {updatedAt && (
          <div className="text-[10px] text-fg-muted tabular-nums">
            updated {new Date(updatedAt).toLocaleTimeString(undefined, { hour12: false })}
            {!ready && " · node stopped, showing the last reading"}
          </div>
        )}
      </div>
    </section>
  );
}

function Hash({ value, label }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    };
  }, []);

  return (
    <span className="flex items-center gap-1 min-w-0">
      {label && <span className="text-fg-muted w-14 shrink-0">{label}</span>}
      <span className="font-mono text-[10px] truncate flex-1" title={value}>
        {value.slice(0, 14)}…{value.slice(-8)}
      </span>
      <button
        type="button"
        className="p-0.5 rounded text-fg-muted hover:text-accent cursor-pointer shrink-0"
        title="Copy hash"
        aria-label="Copy hash"
        onClick={() =>
          void copyText(value).then(() => {
            setCopied(true);
            if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
            copyTimerRef.current = setTimeout(() => setCopied(false), 1200);
          })
        }
      >
        {copied ? <Check size={11} className="text-ok" /> : <Copy size={11} />}
      </button>
    </span>
  );
}

function ChainTab() {
  const dag = useExplorer((s) => s.dag);
  const samples = useExplorer((s) => s.daaSamples);
  const rate = useMemo(() => {
    if (samples.length < 2) return null;
    const [t0, d0] = samples[0];
    const [t1, d1] = samples[samples.length - 1];
    return t1 > t0 ? (d1 - d0) / ((t1 - t0) / 1000) : null;
  }, [samples]);
  if (!dag) return <div className="text-fg-muted">Reading the node…</div>;
  return (
    <div className="space-y-2">
      <div className="rounded border border-border bg-bg-elev p-2 space-y-1">
        <div className="flex items-end justify-between gap-2">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-fg-muted">Virtual DAA score</div>
            <div className="text-lg font-semibold tabular-nums text-fg leading-tight">{dag.virtualDaaScore.toLocaleString()}</div>
          </div>
          <div className="text-right text-[10px] text-fg-muted tabular-nums">{rate !== null ? <span className={rate > 0 ? "text-ok" : ""}>{rate > 0 ? `+${rate.toFixed(1)}/s` : "idle"}</span> : "…"}</div>
        </div>
        <Spark samples={samples} />
      </div>
      <div className="rounded border border-border bg-bg-elev p-2 space-y-1">
        <Hash value={dag.sink} label="sink" />
        <Stat k="tips" v={String(dag.tipHashes.length)} />
        <Stat k="parents" v={`${dag.virtualParentHashes.length} virtual parents`} />
        <Stat k="synced" v={dag.isSynced === undefined ? "?" : dag.isSynced ? "yes" : "no (a private simnet never syncs)"} />
        {dag.serverVersion && <Stat k="node" v={`rusty-kaspad ${dag.serverVersion}`} />}
      </div>
      <details className="rounded border border-border bg-bg-elev p-2">
        <summary className="cursor-pointer text-fg-muted">Tips ({dag.tipHashes.length})</summary>
        <div className="mt-1 space-y-0.5">
          {dag.tipHashes.map((h) => (
            <Hash key={h} value={h} />
          ))}
        </div>
      </details>
    </div>
  );
}

function Spark({ samples }: { samples: Array<[number, number]> }) {
  if (samples.length < 2) return <div className="h-8" />;
  const w = 220;
  const h = 32;
  const ys = samples.map((s) => s[1]);
  const min = Math.min(...ys);
  const max = Math.max(...ys);
  const span = Math.max(1, max - min);
  const pts = samples.map(([, y], i) => `${((i / (samples.length - 1)) * w).toFixed(1)},${(h - 2 - ((y - min) / span) * (h - 4)).toFixed(1)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-8" role="img" aria-label="DAA score over the last readings">
      <polyline points={pts} fill="none" stroke="var(--accent)" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

function BlocksTab() {
  const miner = useExplorer((s) => s.miner);
  if (!miner) return <div className="text-fg-muted">Reading the miner…</div>;
  if (!miner.exists) return <div className="text-fg-muted">There is no miner container yet. Fund an account (Accounts → fund) and the CPU miner starts mining to it.</div>;
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between rounded border border-border bg-bg-elev px-2 py-1.5">
        <span className="flex items-center gap-1.5 text-fg">
          <Pickaxe size={13} className={miner.running ? "text-ok" : "text-fg-muted"} /> CPU miner {miner.running ? "running" : "stopped"}
        </span>
        <span className="text-fg-muted tabular-nums">{miner.perSecond > 0 ? `${miner.perSecond} blocks/s` : "—"}</span>
      </div>
      <div className="text-[10px] text-fg-muted">The last {miner.blocks.length} of the {miner.windowBlocks} blocks in the miner log, newest first.</div>
      <ul className="space-y-0.5">
        {miner.blocks.map((b) => (
          <li key={b.hash} className="flex items-center gap-2">
            <span className="text-[10px] text-fg-muted tabular-nums w-14 shrink-0">{new Date(b.at).toLocaleTimeString(undefined, { hour12: false })}</span>
            <Hash value={b.hash} />
          </li>
        ))}
        {miner.blocks.length === 0 && <li className="text-fg-muted">No blocks mined yet.</li>}
      </ul>
    </div>
  );
}

function MempoolTab() {
  const pool = useExplorer((s) => s.mempool);
  if (pool === null) return <div className="text-fg-muted">Reading the mempool…</div>;
  if (pool.length === 0) return <div className="text-fg-muted">The mempool is empty: every transaction sent so far is already in a block. Send one from Deploy &amp; Run and it appears here until it is mined.</div>;
  return (
    <ul className="space-y-1">
      {pool.map((e, i) => (
        <li key={e.txId || i} className="rounded border border-border bg-bg-elev p-1.5 space-y-0.5">
          <Hash value={e.txId} label="tx" />
          {e.feeSompi && <Stat k="fee" v={formatKas(e.feeSompi)} />}
        </li>
      ))}
    </ul>
  );
}

function UtxosTab({ explorer, ready }: { explorer: ExplorerPlugin; ready: boolean }) {
  const accounts = useEnv((s) => s.accounts);
  const view = useExplorer((s) => s.utxos);
  const busy = useExplorer((s) => s.utxosBusy);
  const error = useExplorer((s) => s.utxosError);
  const [picked, setPicked] = useState("");
  const [custom, setCustom] = useState("");
  const address = custom.trim() || picked || accounts[0]?.address || "";
  const nameOf = (a: string) => accounts.find((x) => x.address === a)?.name;

  return (
    <div className="space-y-2">
      <div className="flex gap-1">
        <select aria-label="Account to inspect" className="input" value={picked || accounts[0]?.address || ""} onChange={(e) => setPicked(e.target.value)} disabled={accounts.length === 0}>
          {accounts.map((a) => (
            <option key={a.name} value={a.address}>
              {a.name} {a.utxoCount !== null ? `· ${a.utxoCount} utxo` : ""}
            </option>
          ))}
        </select>
        <button type="button" className="btn-ghost shrink-0" disabled={!ready || busy || !address} onClick={() => void explorer.loadUtxos(address)} title="hardkas rpc utxos <address>">
          {busy ? "…" : "Load"}
        </button>
      </div>
      <input aria-label="Any address" className="input font-mono" placeholder="or paste any kaspasim: address" value={custom} onChange={(e) => setCustom(e.target.value)} />
      {!ready && <div className="text-fg-muted">Start the Local node to read UTXOs.</div>}
      {error && <div role="alert" className="text-error break-words">{error}</div>}
      {view && (
        <div className="space-y-1">
          <div className="rounded border border-border bg-bg-elev p-2 space-y-0.5">
            <Stat k="address" v={nameOf(view.address) ?? `${view.address.slice(0, 18)}…`} />
            <Stat k="UTXOs" v={view.count.toLocaleString()} />
            <Stat k="total" v={formatKas(view.totalSompi)} />
          </div>
          <div className="text-[10px] text-fg-muted">{view.count === 0 ? "This address holds no UTXOs on the node." : view.count > view.rows.length ? `Biggest ${view.rows.length} of ${view.count.toLocaleString()}.` : `All ${view.count} UTXOs.`}</div>
          <ul className="space-y-0.5">
            {view.rows.map((u) => (
              <li key={`${u.txId}:${u.index}`} className="flex flex-wrap items-center gap-x-2 gap-y-0 tabular-nums border-b border-border/40 pb-0.5">
                <span className="min-w-24 text-fg">{formatKas(u.amountSompi)}</span>
                <span className="text-[10px] text-fg-muted shrink-0">DAA {u.daa}</span>
                {u.coinbase && <span className="text-[9px] px-1 rounded bg-accent/15 text-accent shrink-0">coinbase</span>}
                <span className="font-mono text-[10px] text-fg-muted truncate" title={`${u.txId}:${u.index}`}>
                  {u.txId.slice(0, 10)}…:{u.index}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function Stat({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex gap-2 min-w-0">
      <span className="w-14 shrink-0 text-fg-muted">{k}</span>
      <span className="font-mono text-[11px] truncate tabular-nums" title={v}>
        {v}
      </span>
    </div>
  );
}
