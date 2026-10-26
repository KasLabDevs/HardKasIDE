import clsx from "clsx";
import { ArrowRight, Check, Copy, FileJson, Lock, PackageCheck, RefreshCw, Rocket, Send } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useEngine } from "@/engine/context";
import type { HistoryPlugin } from "@/plugins/history";
import { formatKas, useEnv } from "@/store/env";
import { useHistory, type HistoryItem } from "@/store/history";
import { useSilver } from "@/store/silver";
import { copyText } from "@/utils/clipboard";

/**
 * Run history: tabs for All, Transfers and one per deployed contract. Each row is one call with the amount that
 * moved, the fee and the balance it left behind (the contract's locked value, or the sender's change).
 */
export function HistoryView() {
  const engine = useEngine();
  const plugin = engine.get<HistoryPlugin>("runHistory");
  const items = useHistory((s) => s.items);
  const tab = useHistory((s) => s.tab);
  const setTab = useHistory((s) => s.setTab);
  const loading = useHistory((s) => s.loading);
  const error = useHistory((s) => s.error);
  const deployments = useSilver((s) => s.deployments);
  const accounts = useEnv((s) => s.accounts);

  useEffect(() => {
    void plugin.refresh();
  }, [plugin]);

  const nameOf = useMemo(() => {
    const map = new Map<string, string>();
    for (const a of accounts) map.set(a.address, a.name);
    for (const d of deployments) map.set(d.address, `${d.contract} contract`);
    // Simulator accounts are addressed "kaspa:sim_<name>", whichever environment is selected now.
    return (addr?: string) => (addr ? (map.get(addr) ?? addr.match(/^kaspa:sim_(\w+)$/)?.[1] ?? shorten(addr)) : "?");
  }, [accounts, deployments]);

  const contractTabs = useMemo(
    () =>
      [...deployments]
        .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""))
        .map((d) => ({ id: `contract:${d.contentHash}`, label: `${d.contract} · ${d.contentHash.slice(0, 6)}`, spent: !!d.spent, deploy: d })),
    [deployments]
  );
  const transferCount = items.filter((i) => i.group === "transfers").length;
  const current = contractTabs.find((t) => t.id === tab);
  const visible = items.filter((i) => (tab === "all" ? true : i.group === tab));
  const activeTab = tab === "all" || tab === "transfers" || current ? tab : "all";

  const fees = visible.reduce((sum, i) => sum + BigInt(i.feeSompi && /^\d+$/.test(i.feeSompi) ? i.feeSompi : "0"), 0n);
  const moved = visible.filter((i) => i.kind !== "deploy").reduce((sum, i) => sum + BigInt(i.amountSompi && /^\d+$/.test(i.amountSompi) ? i.amountSompi : "0"), 0n);
  const involved = useMemo(() => {
    const addrs = new Set<string>();
    for (const i of visible) {
      if (i.from) addrs.add(i.from);
      if (i.to) addrs.add(i.to);
    }
    return accounts.filter((a) => addrs.has(a.address));
  }, [visible, accounts]);

  return (
    <div className="h-full flex flex-col min-w-0 text-xs">
      <div role="tablist" aria-label="Run history tabs" className="shrink-0 flex items-stretch border-b border-border bg-bg-panel overflow-x-auto">
        <TabButton active={activeTab === "all"} onClick={() => setTab("all")} label="All activity" count={items.length} />
        <TabButton active={activeTab === "transfers"} onClick={() => setTab("transfers")} label="Payments" count={transferCount} />
        {contractTabs.map((t) => (
          <TabButton key={t.id} active={activeTab === t.id} onClick={() => setTab(t.id)} label={t.label} count={items.filter((i) => i.group === t.id).length} icon={t.spent ? <PackageCheck size={12} className="text-fg-muted" /> : <Lock size={12} className="text-accent" />} />
        ))}
        <button type="button" onClick={() => void plugin.refresh()} className="ml-auto px-3 text-fg-muted hover:text-fg cursor-pointer" title="Refresh" aria-label="Refresh history">
          <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-auto p-3 space-y-3">
        {error && (
          <div role="alert" className="text-error">
            {error}
          </div>
        )}

        {current && (
          <div className="rounded border border-border bg-bg-elev p-3 space-y-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold text-fg text-sm">{current.deploy.contract}</span>
              <span className={clsx("px-1.5 py-0.5 rounded text-[10px] font-medium", current.spent ? "bg-bg-hover text-fg-muted" : "bg-accent/15 text-accent")}>{current.spent ? "spent" : "locked"}</span>
              <span className="text-fg-muted">on {current.deploy.networkId ?? "simnet"}</span>
              <button type="button" className="ml-auto flex items-center gap-1 text-fg-muted hover:text-accent cursor-pointer" onClick={() => void engine.call("fileManager", "open", current.deploy.recordPath)}>
                <FileJson size={12} /> deploy record
              </button>
            </div>
            <div className="font-mono text-[11px] text-fg-muted break-all">{current.deploy.address}</div>
          </div>
        )}

        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <Stat label="Calls" value={String(visible.length)} />
          <Stat label={tab === "all" ? "Moved" : "Moved out"} value={formatKas(moved.toString())} />
          <Stat label="Fees paid" value={formatKas(fees.toString())} />
          {current ? <Stat label="Locked now" value={current.spent ? formatKas("0") : formatKas(current.deploy.valueSompi)} accent={!current.spent} /> : <Stat label="Accounts involved" value={String(involved.length)} />}
        </div>

        {involved.length > 0 && (
          <div className="flex flex-wrap gap-1.5 items-center">
            <span className="text-fg-muted">Balances now</span>
            {involved.map((a) => (
              <span key={a.name} className="rounded border border-border bg-bg-elev px-2 py-0.5 tabular-nums" title={a.address}>
                <span className="text-fg font-medium">{a.name}</span> {formatKas(a.balanceSompi)}
              </span>
            ))}
          </div>
        )}

        {visible.length === 0 ? (
          <div className="rounded border border-dashed border-border p-6 text-center text-fg-muted">
            Nothing here yet. Run Plan → Sign → Send, or deploy a contract and call one of its entries from Deploy &amp; Run, and it shows up in this list.
          </div>
        ) : (
          <div className="rounded border border-border overflow-x-auto">
           <div className="min-w-[56rem]">
            <div className="grid grid-cols-[7.5rem_minmax(8rem,1.2fr)_minmax(8rem,1.4fr)_7rem_6rem_7.5rem_6rem_3.5rem] gap-2 px-3 py-1.5 bg-bg-panel text-[10px] uppercase tracking-wider text-fg-muted">
              <span>Time</span>
              <span>Call</span>
              <span>From → To</span>
              <span className="text-right">Amount</span>
              <span className="text-right">Fee</span>
              <span className="text-right">{tab.startsWith("contract:") ? "Contract balance" : "Change back"}</span>
              <span>Status</span>
              <span />
            </div>
            {visible.map((i) => (
              <Row key={i.id} item={i} nameOf={nameOf} onOpen={() => void engine.call("fileManager", "open", i.recordPath)} showGroup={tab === "all"} onGroup={() => setTab(i.group)} contractLabel={contractTabs.find((t) => t.id === i.group)?.label} />
            ))}
           </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Row({ item: i, nameOf, onOpen, showGroup, onGroup, contractLabel }: { item: HistoryItem; nameOf: (a?: string) => string; onOpen: () => void; showGroup: boolean; onGroup: () => void; contractLabel?: string }) {
  const [copied, setCopied] = useState(false);
  const ok = /accepted|confirmed|submitted/i.test(i.status) && !/reject/i.test(i.status);
  const Icon = i.kind === "deploy" ? Rocket : i.kind === "spend" ? Send : ArrowRight;
  const after = i.kind === "transfer" ? i.changeSompi : i.balanceAfterSompi;
  return (
    <div className="grid grid-cols-[7.5rem_minmax(8rem,1.2fr)_minmax(8rem,1.4fr)_7rem_6rem_7.5rem_6rem_3.5rem] gap-2 px-3 py-2 border-t border-border items-center hover:bg-bg-hover/40">
      <span className="text-fg-muted tabular-nums" title={i.at}>
        {i.at ? new Date(i.at).toLocaleString(undefined, { hour12: false, month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "—"}
      </span>
      <span className="min-w-0">
        <span className="flex items-center gap-1.5 text-fg font-medium truncate">
          <Icon size={12} className={clsx("shrink-0", i.kind === "transfer" ? "text-info" : i.kind === "deploy" ? "text-accent" : "text-warn")} /> <span className="truncate">{i.title}</span>
        </span>
        {showGroup && i.group !== "transfers" && (
          <button type="button" onClick={onGroup} className="text-[10px] text-fg-muted hover:text-accent cursor-pointer truncate max-w-full">
            {contractLabel ?? "contract"}
          </button>
        )}
      </span>
      <span className="min-w-0 truncate text-fg-muted" title={`${i.from ?? ""} → ${i.to ?? ""}`}>
        {i.kind === "deploy" ? (
          <>funded → <span className="text-fg">{nameOf(i.to)}</span></>
        ) : (
          <>
            <span className="text-fg">{nameOf(i.from)}</span> → <span className="text-fg">{nameOf(i.to)}</span>
          </>
        )}
      </span>
      <span className="text-right tabular-nums text-fg">{i.amountSompi ? formatKas(i.amountSompi) : "—"}</span>
      <span className="text-right tabular-nums text-fg-muted">{i.feeSompi ? formatKas(i.feeSompi) : "—"}</span>
      <span className="text-right tabular-nums text-fg">{after !== undefined ? formatKas(after) : "—"}</span>
      <span className={clsx("truncate", ok ? "text-ok" : "text-warn")} title={i.status}>
        {i.status}
      </span>
      <span className="flex items-center justify-end gap-1">
        <button
          type="button"
          className="p-1 rounded text-fg-muted hover:text-accent hover:bg-bg-hover cursor-pointer"
          title={`Copy tx id ${i.txId}`}
          aria-label="Copy transaction id"
          onClick={() => {
            void copyText(i.txId).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1200);
            });
          }}
        >
          {copied ? <Check size={12} className="text-ok" /> : <Copy size={12} />}
        </button>
        <button type="button" className="p-1 rounded text-fg-muted hover:text-accent hover:bg-bg-hover cursor-pointer" title="Open the artifact JSON" aria-label="Open artifact" onClick={onOpen}>
          <FileJson size={12} />
        </button>
      </span>
    </div>
  );
}

function TabButton({ active, onClick, label, count, icon }: { active: boolean; onClick: () => void; label: string; count: number; icon?: React.ReactNode }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={clsx(
        "flex items-center gap-1.5 px-3 h-9 whitespace-nowrap cursor-pointer border-r border-border outline-none focus-visible:ring-1 focus-visible:ring-accent",
        active ? "bg-bg text-fg border-b-2 border-b-accent" : "text-fg-muted hover:text-fg hover:bg-bg-hover"
      )}
    >
      {icon}
      {label}
      <span className="text-[10px] tabular-nums rounded bg-bg-hover px-1">{count}</span>
    </button>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded border border-border bg-bg-elev px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider text-fg-muted">{label}</div>
      <div className={clsx("text-sm font-semibold tabular-nums mt-0.5", accent ? "text-accent" : "text-fg")}>{value}</div>
    </div>
  );
}

const shorten = (a: string) => (a.length > 24 ? `${a.slice(0, 14)}…${a.slice(-6)}` : a);
