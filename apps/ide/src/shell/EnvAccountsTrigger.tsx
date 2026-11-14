import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Copy, RefreshCw, Users } from "lucide-react";
import clsx from "clsx";
import { useEnv, formatKas, type AccountInfo } from "@/store/env";
import { useIde } from "@/store/ide";
import { useEngine } from "@/engine/context";

export function formatCompactKas(sompi: string | null): string {
  if (sompi === null) return "…";
  const trimmed = sompi.trim();
  if (!/^-?\d+$/.test(trimmed)) return sompi;
  try {
    const raw = BigInt(trimmed);
    const whole = Number(raw / 100_000_000n);
    const frac = Number(raw % 100_000_000n) / 1e8;
    const val = whole + frac;
    if (Math.abs(val) >= 1_000_000) return `${(val / 1_000_000).toFixed(2).replace(/\.?0+$/, "")}M KAS`;
    if (Math.abs(val) >= 1_000) return `${(val / 1_000).toFixed(1).replace(/\.0$/, "")}k KAS`;
    if (val === 0) return "0 KAS";
    return `${val.toFixed(val >= 10 ? 1 : 3).replace(/\.?0+$/, "")} KAS`;
  } catch {
    return formatKas(sompi);
  }
}

export function summarizeAccountsBar(accounts: AccountInfo[]): {
  primaryName: string;
  primaryCompact: string;
  fundedCount: number;
  totalSompi: string;
} {
  let total = 0n;
  let fundedCount = 0;
  let knownCount = 0;
  for (const a of accounts) {
    if (a.balanceSompi !== null && /^-?\d+$/.test(a.balanceSompi.trim())) {
      const v = BigInt(a.balanceSompi.trim());
      total += v;
      knownCount++;
      if (v > 0n) fundedCount++;
    }
  }
  const primary =
    accounts.find((a) => a.balanceSompi !== null && /^-?\d+$/.test(a.balanceSompi.trim()) && BigInt(a.balanceSompi.trim()) > 0n) ??
    accounts[0];
  return {
    primaryName: primary?.name ?? "accounts",
    primaryCompact: primary ? formatCompactKas(primary.balanceSompi) : "—",
    fundedCount,
    totalSompi: knownCount > 0 ? total.toString() : "0"
  };
}

function shortAddr(addr: string): string {
  if (!addr) return "";
  if (addr.length <= 24) return addr;
  return `${addr.slice(0, 14)}…${addr.slice(-8)}`;
}

export function EnvAccountsTrigger() {
  const accounts = useEnv((s) => s.accounts);
  const accountsBusy = useEnv((s) => s.accountsBusy);
  const setActiveSidePlugin = useIde((s) => s.setActiveSidePlugin);
  const engine = useEngine();

  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [copiedAddr, setCopiedAddr] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = () => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  };

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
        setPinned(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        setPinned(false);
      }
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      clearTimer();
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  const handleMouseEnter = () => {
    clearTimer();
    setOpen(true);
  };

  const handleMouseLeave = () => {
    if (pinned) return;
    clearTimer();
    closeTimerRef.current = setTimeout(() => setOpen(false), 180);
  };

  const summary = summarizeAccountsBar(accounts);

  const copyAddress = async (addr: string) => {
    try {
      await navigator.clipboard.writeText(addr);
      setCopiedAddr(addr);
      setTimeout(() => setCopiedAddr((cur) => (cur === addr ? null : cur)), 1400);
    } catch {
      // Clipboard unavailable in insecure context.
    }
  };

  const refreshBalances = () => {
    void engine.call("environment", "refresh").catch(() => undefined);
  };

  return (
    <div
      ref={rootRef}
      className="relative flex items-center min-w-0 shrink-0"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <button
        type="button"
        data-testid="envbar-accounts-trigger"
        onClick={() => {
          const next = !(open && pinned);
          setPinned(next);
          setOpen(next);
        }}
        className={clsx(
          "flex items-center gap-2 min-h-[24px] min-w-0 tabular-nums whitespace-nowrap cursor-pointer rounded px-1.5 py-0.5 transition-colors",
          open ? "bg-bg-hover text-fg" : "hover:bg-bg-hover hover:text-fg"
        )}
        title="Show account balances (click to pin, or open Accounts)"
      >
        <Users size={11} className="opacity-70 shrink-0" />

        {/* Compact summary for medium viewports (~1280px) so balances never get clipped */}
        <span className="flex 2xl:hidden items-center gap-1.5 text-[12px]">
          {accounts.length === 0 ? (
            <span className="text-fg-muted">{accountsBusy ? "loading accounts…" : "accounts"}</span>
          ) : (
            <>
              <span className="text-fg-muted">{accounts.length} accts</span>
              <span className="text-fg-muted/40">·</span>
              <span>
                <span className="text-fg-muted">{summary.primaryName}</span>{" "}
                <span className="text-fg font-medium">{summary.primaryCompact}</span>
              </span>
            </>
          )}
        </span>

        {/* Full inline strip on wide screens (>=1536px) */}
        <span className="hidden 2xl:flex items-center gap-2.5">
          {accounts.map((a) => (
            <span key={a.name} className="inline-flex items-baseline gap-1">
              <span className="text-fg-muted">{a.name}</span>
              <span className="text-fg">{formatKas(a.balanceSompi)}</span>
            </span>
          ))}
          {accounts.length === 0 && <span className="text-fg-muted">{accountsBusy ? "loading accounts…" : "accounts"}</span>}
        </span>

        <ChevronDown size={10} className={clsx("opacity-60 shrink-0 transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <div
          data-testid="envbar-accounts-popover"
          role="dialog"
          aria-label="Account balances"
          className="absolute right-0 top-full mt-1 w-80 z-50 rounded-md border border-border bg-bg-panel shadow-xl p-2.5 text-[12px] space-y-2"
        >
          <div className="flex items-center justify-between border-b border-border/70 pb-1.5">
            <div className="flex items-center gap-1.5">
              <Users size={12} className="text-accent" />
              <span className="font-semibold text-fg">Accounts ({accounts.length})</span>
              {accounts.length > 0 && (
                <span className="text-[12px] text-fg-muted tabular-nums">
                  · Total {formatCompactKas(summary.totalSompi)}
                </span>
              )}
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={refreshBalances}
                disabled={accountsBusy}
                className="btn-ghost p-1 text-[12px]"
                title="Refresh balances"
              >
                <RefreshCw size={11} className={accountsBusy ? "animate-spin" : ""} />
              </button>
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  setPinned(false);
                  setActiveSidePlugin("accounts");
                }}
                className="btn-ghost px-1.5 py-0.5 text-[12px] text-accent"
              >
                Open View
              </button>
            </div>
          </div>

          {accounts.length === 0 ? (
            <div className="py-3 text-center text-fg-muted">
              {accountsBusy ? "Loading account balances…" : "No accounts loaded for this target."}
            </div>
          ) : (
            <div className="space-y-1 max-h-64 overflow-y-auto pr-0.5">
              {accounts.map((a) => (
                <div
                  key={a.name}
                  className="flex items-center justify-between gap-2 rounded px-2 py-1.5 bg-bg-elev/60 hover:bg-bg-hover/70 border border-border/40"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="font-medium text-fg">{a.name}</span>
                      <span className="text-[12px] uppercase tracking-wide px-1 rounded bg-bg-panel text-fg-muted border border-border/60">
                        {a.keystore === "dev-keystore" ? "dev" : a.keystore}
                      </span>
                      {a.utxoCount !== null && (
                        <span className="text-[12px] text-fg-muted tabular-nums">{a.utxoCount} UTXO</span>
                      )}
                    </div>
                    <div className="flex items-center gap-1 text-[12px] font-mono text-fg-muted">
                      <span className="truncate">{shortAddr(a.address)}</span>
                      {a.address && (
                        <button
                          type="button"
                          onClick={() => void copyAddress(a.address)}
                          className="p-0.5 hover:text-fg shrink-0 cursor-pointer"
                          title={`Copy ${a.address}`}
                        >
                          {copiedAddr === a.address ? <Check size={10} className="text-ok" /> : <Copy size={10} />}
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="text-right tabular-nums shrink-0">
                    <div className={clsx("font-medium", a.balanceSompi && a.balanceSompi !== "0" ? "text-fg" : "text-fg-muted")}>
                      {formatKas(a.balanceSompi)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
