import clsx from "clsx";
import { Check, ChevronLeft, ChevronRight, Copy, FileJson, Pickaxe, Radio, RefreshCw } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useEngine } from "@/engine/context";
import type { ExplorerPlugin } from "@/plugins/explorer";
import { formatKas, useEnv } from "@/store/env";
import { useExplorer } from "@/store/explorer";
import { useHistory } from "@/store/history";
import { copyText } from "@/utils/clipboard";
import { describeWindow, directionLabel, entryAmount, type HistoryEntry } from "@/utils/nodeHistory";

type Tab = "chain" | "blocks" | "mempool" | "utxos" | "history";

/** Block explorer for the Local node, inside the Servers view: chain, mined blocks, mempool, UTXOs (live with `hardkas watch`) and the history of an address. */
export function ExplorerCard() {
  const engine = useEngine();
  const explorer = engine.get<ExplorerPlugin>("explorer");
  const node = useEnv((s) => s.node);
  const dag = useExplorer((s) => s.dag);
  const busy = useExplorer((s) => s.busy);
  const error = useExplorer((s) => s.error);
  const updatedAt = useExplorer((s) => s.updatedAt);
  const mempool = useExplorer((s) => s.mempool);
  const watch = useExplorer((s) => s.watch);
  const [tab, setTab] = useState<Tab>("chain");
  // The address the UTXOs and History tabs look at: an account, or any pasted address.
  const accounts = useEnv((s) => s.accounts);
  const [picked, setPicked] = useState("");
  const [custom, setCustom] = useState("");
  const address = custom.trim() || picked || accounts[0]?.address || "";

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
    ["utxos", watch?.status === "live" || watch?.status === "starting" ? "UTXOs ●" : "UTXOs"],
    ["history", "History"]
  ];
  const picker = (
    <div className="space-y-1">
      <select aria-label="Account to inspect" className="input" value={picked || accounts[0]?.address || ""} onChange={(e) => setPicked(e.target.value)} disabled={accounts.length === 0}>
        {accounts.map((a) => (
          <option key={a.name} value={a.address}>
            {a.name} {a.utxoCount !== null ? `· ${a.utxoCount} utxo` : ""}
          </option>
        ))}
      </select>
      <input aria-label="Any address" className="input font-mono" placeholder="or paste any kaspasim: address" value={custom} onChange={(e) => setCustom(e.target.value)} />
    </div>
  );

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
              className={clsx("flex-1 min-w-[4.5rem] rounded px-1.5 py-1 text-[12px] cursor-pointer whitespace-nowrap transition-colors", tab === id ? "bg-bg-hover text-fg" : "text-fg-muted hover:text-fg")}
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
        {tab === "utxos" && <UtxosTab explorer={explorer} ready={ready} address={address} picker={picker} />}
        {tab === "history" && <HistoryTab explorer={explorer} ready={ready} address={address} picker={picker} />}

        {updatedAt && (
          <div className="text-[12px] text-fg-muted tabular-nums">
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
      <span className="font-mono text-[12px] truncate flex-1" title={value}>
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
            <div className="text-[12px] uppercase tracking-wider text-fg-muted">Virtual DAA score</div>
            <div className="text-lg font-semibold tabular-nums text-fg leading-tight">{dag.virtualDaaScore.toLocaleString()}</div>
          </div>
          <div className="text-right text-[12px] text-fg-muted tabular-nums">{rate !== null ? <span className={rate > 0 ? "text-ok" : ""}>{rate > 0 ? `+${rate.toFixed(1)}/s` : "idle"}</span> : "…"}</div>
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
      {miner.routeFull > 0 && (
        <div role="status" className="rounded border border-warn/40 bg-warn/10 p-1.5 text-[12px] text-warn leading-snug">
          The node refused {miner.routeFull} block{miner.routeFull === 1 ? "" : "s"} in this log window ("route is full"): the miner is faster than the node can accept, and transactions confirm slowly while that lasts. Stop the miner and mine in bursts (Local node card above).
        </div>
      )}
      <div className="text-[12px] text-fg-muted">The last {miner.blocks.length} of the {miner.windowBlocks} blocks in the miner log, newest first.</div>
      <ul className="space-y-0.5">
        {miner.blocks.map((b) => (
          <li key={b.hash} className="flex items-center gap-2">
            <span className="text-[12px] text-fg-muted tabular-nums w-14 shrink-0">{new Date(b.at).toLocaleTimeString(undefined, { hour12: false })}</span>
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

const UTXO_ROWS_SHOWN = 40;

function UtxosTab({ explorer, ready, address, picker }: { explorer: ExplorerPlugin; ready: boolean; address: string; picker: React.ReactNode }) {
  const accounts = useEnv((s) => s.accounts);
  const view = useExplorer((s) => s.utxos);
  const busy = useExplorer((s) => s.utxosBusy);
  const error = useExplorer((s) => s.utxosError);
  const watch = useExplorer((s) => s.watch);
  const nameOf = (a: string) => accounts.find((x) => x.address === a)?.name;
  const watching = watch !== null && watch.address === address && (watch.status === "live" || watch.status === "starting");
  const rows = view ? view.rows.slice(0, UTXO_ROWS_SHOWN) : [];

  return (
    <div className="space-y-2">
      {picker}
      <div className="flex gap-1">
        <button type="button" className="btn-ghost shrink-0" disabled={!ready || busy || !address} onClick={() => void explorer.loadUtxos(address)} title="hardkas rpc utxos <address>">
          {busy ? "…" : "Load"}
        </button>
        <button
          type="button"
          role="switch"
          aria-checked={watching}
          aria-label="Watch this address live"
          className={clsx("btn-ghost shrink-0 flex items-center gap-1", watching && "text-ok")}
          disabled={!address || (!ready && !watching)}
          onClick={() => void (watching ? explorer.stopWatch() : explorer.startWatch(address))}
          title={watching ? "Stop hardkas watch" : "hardkas watch <address> --json: apply the node's UTXO events to this list as they happen"}
        >
          <Radio size={12} className={watch?.status === "live" && watching ? "animate-pulse" : ""} /> {watching ? "Watching" : "Watch"}
        </button>
      </div>
      {!ready && !watching && <div className="text-fg-muted">Start the Local node to read UTXOs.</div>}
      {error && <div role="alert" className="text-error break-words">{error}</div>}
      {watch && watch.address === address && <WatchStatus />}
      {view && (
        <div className="space-y-1">
          <div className="rounded border border-border bg-bg-elev p-2 space-y-0.5">
            <Stat k="address" v={nameOf(view.address) ?? `${view.address.slice(0, 18)}…`} />
            <Stat k="UTXOs" v={view.count.toLocaleString()} />
            <Stat k="total" v={formatKas(view.totalSompi)} />
            {view.source === "watch" && watch?.balance && <Stat k="pending" v={formatKas(watch.balance.pending)} />}
          </div>
          <div className="text-[12px] text-fg-muted">
            {view.count === 0 ? "This address holds no UTXOs on the node." : view.count > rows.length ? `Biggest ${rows.length} of ${view.count.toLocaleString()}.` : `All ${view.count} UTXOs.`}
            {view.source === "watch" && " Kept live by hardkas watch."}
          </div>
          <ul className="space-y-0.5">
            {rows.map((u) => (
              <li key={`${u.txId}:${u.index}`} className="flex flex-wrap items-center gap-x-2 gap-y-0 tabular-nums border-b border-border/40 pb-0.5">
                <span className="min-w-24 text-fg">{formatKas(u.amountSompi)}</span>
                <span className="text-[12px] text-fg-muted shrink-0">{u.daa !== null ? `DAA ${u.daa}` : "DAA ? (Load fills it)"}</span>
                {u.coinbase && <span className="text-[12px] px-1 rounded bg-accent/15 text-accent shrink-0">coinbase</span>}
                {u.state === "pending" && <span className="text-[12px] px-1 rounded bg-warn/15 text-warn shrink-0">pending</span>}
                {u.covenantId && (
                  <span className="text-[12px] px-1 rounded bg-accent/15 text-accent shrink-0" title={`covenant ${u.covenantId}`}>
                    covenant
                  </span>
                )}
                <span className="font-mono text-[12px] text-fg-muted truncate" title={`${u.txId}:${u.index}`}>
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

/** The watch's state and its last events, newest first. */
function WatchStatus() {
  const watch = useExplorer((s) => s.watch);
  if (!watch) return null;
  const label =
    watch.status === "starting"
      ? "starting hardkas watch…"
      : watch.status === "live"
        ? `live${watch.network ? ` on ${watch.network}` : ""} · ${watch.events} event${watch.events === 1 ? "" : "s"}`
        : watch.status === "failed"
          ? `watch failed${watch.endReason ? ` (${watch.endReason})` : ""}`
          : `watch stopped${watch.endReason ? ` (${watch.endReason})` : ""}`;
  const feed = [...watch.feed].reverse().slice(0, 12);
  return (
    <div className="rounded border border-border bg-bg-elev p-2 space-y-1" aria-live="polite" aria-label="Watch events">
      <div className={clsx("flex items-center gap-1.5 text-[12px]", watch.status === "live" ? "text-ok" : watch.status === "failed" ? "text-error" : "text-fg-muted")}>
        <span className={clsx("w-1.5 h-1.5 rounded-full", watch.status === "live" ? "bg-ok" : watch.status === "starting" ? "bg-warn" : watch.status === "failed" ? "bg-error" : "bg-fg-muted")} />
        {label}
      </div>
      {watch.error && (
        <div role="alert" className="text-error text-[12px] break-words">
          {watch.error}
        </div>
      )}
      {feed.length > 0 && (
        <ul className="space-y-0.5">
          {feed.map((f, i) => (
            <li key={`${f.at}-${i}`} className="flex gap-2 text-[12px] leading-snug">
              <span className="text-fg-muted tabular-nums shrink-0 w-14">{f.at ? new Date(f.at).toLocaleTimeString(undefined, { hour12: false }) : ""}</span>
              <span className={clsx("break-words min-w-0", f.kind === "added" || f.kind === "matured" ? "text-ok" : f.kind === "removed" ? "text-warn" : f.kind === "error" ? "text-error" : "text-fg")} title={f.txid}>
                {f.text}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function HistoryTab({ explorer, ready, address, picker }: { explorer: ExplorerPlugin; ready: boolean; address: string; picker: React.ReactNode }) {
  const engine = useEngine();
  const accounts = useEnv((s) => s.accounts);
  const view = useExplorer((s) => s.history);
  const busy = useExplorer((s) => s.historyBusy);
  const error = useExplorer((s) => s.historyError);
  const trail = useExplorer((s) => s.historyTrail);
  const runItems = useHistory((s) => s.items);
  const nameOf = (a: string) => accounts.find((x) => x.address === a)?.name;
  const first = view ? view.offset + 1 : 0;
  const last = view ? view.offset + view.entries.length : 0;

  const openRecord = (e: HistoryEntry) => {
    // The Run history already read this workspace's record files: open the file when it has one for the tx; else the
    // Index view's Transactions tab, which reads the record from the query store by tx id.
    const item = runItems.find((i) => i.txId === e.txId);
    if (item?.recordPath) void engine.call("fileManager", "open", item.recordPath);
    else {
      void engine.call("queryIndex", "showTx", e.txId);
      void engine.call("queryIndex", "open", "transactions");
    }
  };

  return (
    <div className="space-y-2">
      {picker}
      <div className="flex gap-1 items-center">
        <button type="button" className="btn-ghost shrink-0" disabled={!ready || busy || !address} onClick={() => void explorer.loadHistory(address)} title="hardkas history <address> --json: the last 1000 chain blocks of the node's selected chain">
          {busy ? "…" : view ? "Reload" : "Load"}
        </button>
        {view && (
          <span className="ml-auto flex items-center gap-0.5 text-[12px] text-fg-muted tabular-nums">
            <button type="button" className="p-0.5 rounded hover:text-fg hover:bg-bg-hover cursor-pointer disabled:opacity-40 disabled:cursor-default" disabled={busy || trail.length === 0} onClick={() => void explorer.historyPage("prev")} aria-label="Previous page" title="Previous page">
              <ChevronLeft size={13} />
            </button>
            {view.total === 0 ? "0 entries" : `${first}–${last} of ${view.total}`}
            <button type="button" className="p-0.5 rounded hover:text-fg hover:bg-bg-hover cursor-pointer disabled:opacity-40 disabled:cursor-default" disabled={busy || !view.nextCursor} onClick={() => void explorer.historyPage("next")} aria-label="Next page" title={view.nextCursor ? "Next page (hardkas history --cursor)" : "Last page"}>
              <ChevronRight size={13} />
            </button>
          </span>
        )}
      </div>
      {!ready && !view && <div className="text-fg-muted">Start the Local node to read an address's history.</div>}
      {error && (
        <div role="alert" className="text-error break-words">
          {error}
        </div>
      )}
      {view && (
        <div className="space-y-1">
          <div className="rounded border border-border bg-bg-elev p-2 space-y-0.5">
            <Stat k="address" v={nameOf(view.address) ?? `${view.address.slice(0, 18)}…`} />
            <Stat k="window" v={`${view.window.chainBlocks.toLocaleString()} chain blocks · ${view.window.reachedTip ? "to the tip" : `stopped: ${view.window.stoppedBy}`}`} />
            <Stat k="tip" v={`DAA ${view.tipDaa} · blue ${view.sinkBlueScore}`} />
            {view.workspace.merged && <Stat k="records" v={`${view.workspace.records} of this workspace merged${view.workspace.outsideWindow ? `, ${view.workspace.outsideWindow} outside the window` : ""}${view.workspace.rejected ? `, ${view.workspace.rejected} rejected` : ""}`} />}
          </div>
          <p className="text-[12px] text-fg-muted leading-snug" data-testid="history-window">
            {describeWindow(view)}
            {view.nodeSynced === false && " The node says it is not synced."}
          </p>
          {view.entries.length === 0 && <div className="text-fg-muted">No transaction of this address in the window{view.workspace.merged ? " and no record of it in this workspace" : ""}.</div>}
          <ul className="space-y-1">
            {view.entries.map((e) => (
              <HistoryRow key={e.txId} entry={e} onRecord={e.workspace ? () => openRecord(e) : undefined} />
            ))}
          </ul>
          {view.notCovered.length > 0 && (
            <details className="text-[12px] text-fg-muted">
              <summary className="cursor-pointer">Not covered ({view.notCovered.length})</summary>
              <ul className="mt-0.5 list-disc pl-4 space-y-0.5">
                {view.notCovered.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </div>
  );
}

function HistoryRow({ entry: e, onRecord }: { entry: HistoryEntry; onRecord?: () => void }) {
  const amount = entryAmount(e);
  const dir = directionLabel(e.direction);
  return (
    <li className="rounded border border-border bg-bg-elev p-1.5 space-y-0.5" data-testid="history-entry">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 tabular-nums">
        <span className={clsx("text-[12px] px-1 rounded shrink-0", dir === "paid" ? "bg-ok/15 text-ok" : dir === "spent" ? "bg-warn/15 text-warn" : "bg-bg-hover text-fg")}>{dir}</span>
        <span className={clsx("text-fg", amount.sign === "-" && "text-warn")} title={amount.known ? "received − spent" : "received; what it spent is not known from the node's entry"}>
          {amount.sign === "-" ? "−" : amount.sign}
          {formatKas(amount.sompi)}
          {!amount.known && <span className="text-fg-muted"> (spent ?)</span>}
        </span>
        {e.acceptance ? (
          <span className="text-[12px] text-fg-muted shrink-0" title={`${e.acceptance.confirmationsDaa} DAA confirmations · accepted in chain block ${e.acceptance.chainBlockHash}`}>
            {e.acceptance.confirmationsBlue} conf · DAA {e.acceptance.daaScore}
          </span>
        ) : (
          <span className="text-[12px] text-fg-muted shrink-0">not in the window</span>
        )}
        {e.coinbase && <span className="text-[12px] px-1 rounded bg-accent/15 text-accent shrink-0">coinbase</span>}
        {e.covenantBound && (
          <span className="text-[12px] px-1 rounded bg-accent/15 text-accent shrink-0" title={e.covenantId ? `covenant ${e.covenantId}` : "covenant-bound"}>
            covenant
          </span>
        )}
        {e.workspace && (
          <button type="button" className="ml-auto flex items-center gap-1 text-[12px] text-fg-muted hover:text-accent cursor-pointer shrink-0" onClick={onRecord} title={`This workspace recorded it${e.workspace.state ? ` (${e.workspace.state})` : ""}: open the record`}>
            <FileJson size={11} /> record{e.workspace.state ? ` · ${e.workspace.state.toLowerCase()}` : ""}
          </button>
        )}
      </div>
      <Hash value={e.txId} label="tx" />
      {e.outsideWindow && <div className="text-[12px] text-fg-muted leading-snug">{e.outsideWindow}</div>}
    </li>
  );
}

function Stat({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex gap-2 min-w-0">
      <span className="w-14 shrink-0 text-fg-muted">{k}</span>
      <span className="font-mono text-[12px] truncate tabular-nums" title={v}>
        {v}
      </span>
    </div>
  );
}
