import clsx from "clsx";
import { Check, Coins, Copy, KeyRound, Pickaxe, Play, Plus, RefreshCw, UserRound } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useEngine } from "@/engine/context";
import { copyText } from "@/utils/clipboard";
import type { EnvironmentPlugin } from "@/plugins/environment";
import { formatKas, useEnv, type AccountInfo } from "@/store/env";
import { envOf, useIde } from "@/store/ide";
import { NodeBusyCover } from "@/shell/NodeOpProgress";
import { WalletCard } from "./WalletCard";
import { confirmDialog } from "@/utils/dialog";

/** Accounts view: every account with its balance, public address and private key (never shown; copy only). */
export function AccountsPanel() {
  const engine = useEngine();
  const env = engine.get<EnvironmentPlugin>("environment");
  const accounts = useEnv((s) => s.accounts);
  const busy = useEnv((s) => s.accountsBusy);
  const node = useEnv((s) => s.node);
  const nodeBusy = useEnv((s) => s.nodeBusy);
  const target = useIde((s) => s.target);
  const isNodeDown = target === "localnet" && (!node?.running || !node?.rpcReady);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [fundingAll, setFundingAll] = useState(false);
  const [fundAllProgress, setFundAllProgress] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ text: string; isError?: boolean } | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const state = useEnv.getState();
    if (state.accounts.length === 0 && !state.accountsBusy) void env.refreshAccounts();
    return () => {
      if (noticeTimer.current) clearTimeout(noticeTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const say = (text: string, isError = false) => {
    setNotice({ text, isError });
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(null), isError ? 10_000 : 2500);
  };

  const create = async () => {
    const name = newName.trim();
    if (!name) return;
    setCreating(true);
    try {
      await env.createAccount(name);
      setNewName("");
      say(`Account ${name} created`);
    } catch (e) {
      say(e instanceof Error ? e.message : String(e), true);
    } finally {
      setCreating(false);
    }
  };

  const fundAll = async () => {
    setFundingAll(true);
    setFundAllProgress("seeding dev accounts from Treasury…");
    try {
      await env.fundAll("100", (msg) => setFundAllProgress(msg));
      say("All accounts funded and confirmed");
    } catch (e) {
      say(e instanceof Error ? e.message : String(e), true);
    } finally {
      setFundingAll(false);
      setFundAllProgress(null);
    }
  };

  return (
    <div className="text-xs relative min-h-full">
      {target === "localnet" && <NodeBusyCover label="Accounts are loading…" />}
      <div className="flex items-center justify-between gap-2 px-3 py-1.5 border-b border-border">
        <span className="text-fg-muted tabular-nums">
          {accounts.length} account{accounts.length === 1 ? "" : "s"} · {envOf(target).networkId}
        </span>
        <div className="flex items-center gap-1.5">
          {busy && (
            <span className="inline-flex items-center gap-1 text-[10px] text-accent font-medium animate-pulse">
              Loading balances…
            </span>
          )}
          {!isNodeDown && accounts.length > 0 && target !== "rpc" && (
            <button
              type="button"
              onClick={() => void fundAll()}
              disabled={fundingAll || busy}
              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] text-accent border border-accent/25 bg-accent/10 hover:bg-accent/20 disabled:opacity-50 cursor-pointer"
              title="Seed all empty accounts with 100 KAS"
            >
              <Coins size={11} />
              <span>{fundingAll ? "Funding all…" : "Fund all"}</span>
            </button>
          )}
          <button type="button" onClick={() => void env.refreshAccounts()} className="p-0.5 rounded text-fg-muted hover:text-fg hover:bg-bg-hover cursor-pointer" title="Refresh balances" aria-label="Refresh account balances">
            <RefreshCw size={13} className={busy ? "animate-spin text-accent" : ""} />
          </button>
        </div>
      </div>
      {isNodeDown ? (
        <div className="p-6 text-center space-y-3">
          <div className="w-10 h-10 mx-auto rounded-full bg-warn/10 text-warn flex items-center justify-center">
            <UserRound size={20} />
          </div>
          <div>
            <div className="font-semibold text-fg text-sm">Local node stopped</div>
            <p className="text-fg-muted text-xs mt-1.5 max-w-[280px] mx-auto leading-relaxed">
              Dev accounts and their simnet balances are unavailable while the <code>rusty-kaspad</code> node is stopped.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void env.startNode()}
            disabled={Boolean(nodeBusy)}
            className="btn-primary mx-auto flex items-center justify-center gap-1.5 text-xs py-1.5 px-4 shadow-sm"
          >
            <Play size={14} /> Start local node
          </button>
        </div>
      ) : (
        <>
          {fundingAll && fundAllProgress && (
            <div role="status" aria-live="polite" className="mx-3 mt-2.5 px-2.5 py-1.5 rounded border border-accent/30 bg-accent/10 text-[11px] text-accent flex items-center gap-1.5">
              <RefreshCw size={11} className="animate-spin shrink-0" />
              <span className="truncate">{fundAllProgress}</span>
            </div>
          )}
          <ul className="p-3 space-y-3">
            {accounts.length === 0 && (
              <li className="text-fg-muted text-center py-4">{busy ? "Loading accounts…" : "No accounts yet. Run hardkas init, or create one below."}</li>
            )}
            {accounts.map((a) => (
              <AccountItem key={a.name} account={a} busy={busy} env={env} say={say} />
            ))}
          </ul>
          <div className="px-3 pb-3 space-y-1">
            <div className="flex gap-1">
              <input aria-label="New account name" className="input" placeholder="new account name" value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void create()} />
              <button type="button" className="btn-ghost shrink-0" disabled={creating || !newName.trim()} onClick={() => void create()}>
                <Plus size={12} /> {creating ? "…" : "Create"}
              </button>
            </div>
            <div className="text-fg-muted text-[11px]">Created accounts store a plaintext simnet key in .hardkas/accounts.real.json (dev only, never use on mainnet).</div>
          </div>
          <div className="mx-3 mb-3 p-2 rounded bg-bg-elev border border-border/80 text-[11px] space-y-1">
            <div className="font-medium text-fg flex items-center justify-between">
              <span>KasWare Wallet Import</span>
              <span className="text-[9px] px-1 py-0.5 rounded bg-accent/15 text-accent font-mono">Simnet</span>
            </div>
            <p className="text-fg-muted text-[10px] leading-relaxed">
              To use an account in KasWare: copy its private key (64 hex characters), open the KasWare extension on the <strong>Kaspa Simnet</strong> network (RPC settings in the Wallet card below) and choose <em>Import Account &rarr; Private Key</em>. These are dev keys protected by a public password: simnet only, never real funds.
            </p>
          </div>
        </>
      )}
      <div className="border-t border-border">
        <WalletCard />
      </div>
      <div role="status" aria-live="polite" className={clsx("px-3 pb-3 text-[11px] min-h-4", notice?.isError ? "text-err" : "text-accent")}>
        {notice?.text}
      </div>
    </div>
  );
}

function CopyField({ label, value, mono = true, onCopy, copied }: { label: string; value: string; mono?: boolean; onCopy: () => void; copied: boolean }) {
  return (
    <div className="space-y-0.5">
      <div className="text-[10px] uppercase tracking-wide text-fg-muted">{label}</div>
      <div className="flex items-start gap-1 min-w-0">
        <span className={clsx("flex-1 min-w-0 break-all text-[11px] rounded bg-bg border border-border px-1.5 py-0.5", mono && "font-mono")}>{value}</span>
        <button type="button" onClick={onCopy} className="p-1 rounded text-fg-muted hover:text-accent hover:bg-bg-hover cursor-pointer shrink-0" title={`Copy ${label.toLowerCase()}`} aria-label={`Copy ${label.toLowerCase()}`}>
          {copied ? <Check size={13} className="text-ok" /> : <Copy size={13} />}
        </button>
      </div>
    </div>
  );
}

function AccountItem({ account, busy, env, say }: { account: AccountInfo; busy: boolean; env: EnvironmentPlugin; say: (t: string, isError?: boolean) => void }) {
  const target = useIde((s) => s.target);
  const [copied, setCopied] = useState<"pub" | "priv" | null>(null);
  const [funding, setFunding] = useState(false);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (copiedTimer.current) clearTimeout(copiedTimer.current);
  }, []);

  const flash = (which: "pub" | "priv") => {
    setCopied(which);
    if (copiedTimer.current) clearTimeout(copiedTimer.current);
    copiedTimer.current = setTimeout(() => setCopied(null), 1500);
  };

  const copyPublic = async () => {
    await copyText(account.address);
    flash("pub");
    say(`Public address of ${account.name} copied`);
  };

  const copyPrivate = async () => {
    if (!account.hasPlainKey) {
      say(`${account.name}: key is not exportable`);
      return;
    }
    if (!(await confirmDialog(`Copy the private key of "${account.name}" to the clipboard?\n\nIt is never shown on screen. Paste it straight into KasWare (Import Account → Private Key).`, { title: "Copy private key", confirmLabel: "Copy" }))) return;
    if (!(await env.copyPrivateKey(account.name))) {
      say("No private key available");
      return;
    }
    flash("priv");
    say(`Private key of ${account.name} copied (KasWare ready)`);
  };

  const fund = async () => {
    setFunding(true);
    try {
      await env.fund(account.name, "100");
      say(`${account.name} funded and confirmed`);
    } catch (e) {
      say(e instanceof Error ? e.message : String(e), true);
    } finally {
      setFunding(false);
    }
  };

  return (
    <li className="rounded border border-border bg-bg-elev p-2 space-y-1.5">
      {/* name and balance header */}
      <div className="flex items-center justify-between gap-2 min-w-0">
        <div className="flex items-center gap-1.5 font-semibold text-fg min-w-0">
          <UserRound size={14} className="text-accent shrink-0" />
          <span className="truncate">{account.name}</span>
          <span className="text-[10px] font-normal text-fg-muted shrink-0">{account.kind}</span>
        </div>
        {account.balanceSompi === null ? (
          <span role="status" className="inline-flex items-center gap-1.5 text-[11px] text-accent font-mono px-2 py-0.5 rounded bg-accent/10 border border-accent/25 shrink-0">
            <RefreshCw size={11} className="animate-spin shrink-0" />
            <span>Loading balance…</span>
          </span>
        ) : (
          <div className="flex items-center justify-end gap-1.5 font-mono text-sm text-fg tabular-nums shrink-0">
            {busy && (
              <span title="Refreshing balance…" className="inline-flex">
                <RefreshCw size={11} className="animate-spin text-accent shrink-0" />
              </span>
            )}
            <span>{formatKas(account.balanceSompi)}</span>
          </div>
        )}
      </div>

      <CopyField label="Public key (address)" value={account.address} onCopy={() => void copyPublic()} copied={copied === "pub"} />

      <div className="space-y-0.5">
        <div className="text-[10px] uppercase tracking-wide text-fg-muted flex items-center justify-between">
          <span className="flex items-center gap-1">
            <KeyRound size={10} /> Private key
          </span>
          {account.keystore === "dev-keystore" && (
            <span className="text-[9px] text-accent/80 font-mono">dev keystore (KasWare)</span>
          )}
          {account.keystore === "plain" && (
            <span className="text-[9px] text-ok/80 font-mono">dev plaintext (KasWare)</span>
          )}
        </div>
        {account.hasPlainKey ? (
          <div className="flex items-start gap-1 min-w-0">
            <span className="flex-1 min-w-0 truncate font-mono text-[11px] text-fg-muted rounded bg-bg border border-border px-1.5 py-0.5 select-none" title="Hidden: it can be copied, never shown">
              ••••••••••••••••••••••••••••••••
            </span>
            <button type="button" onClick={() => void copyPrivate()} className="p-1 rounded text-fg-muted hover:text-warn hover:bg-bg-hover cursor-pointer shrink-0" title="Copy private key for KasWare (it is never shown)" aria-label={`Copy private key of ${account.name}`}>
              {copied === "priv" ? <Check size={13} className="text-ok" /> : <KeyRound size={13} />}
            </button>
          </div>
        ) : (
          <div className="text-[11px] text-fg-muted rounded border border-dashed border-border px-1.5 py-1">
            Not exportable: encrypted production keystore without dev credentials.
          </div>
        )}
      </div>

      {funding && target === "localnet" && (
        <div role="status" className="rounded bg-accent/10 border border-accent/30 p-2 space-y-1">
          <div className="flex items-center gap-1.5 text-[11px] text-accent font-medium">
            <Pickaxe size={12} className="animate-spin" /> Funding on the local node…
          </div>
          <div className="text-[10px] text-fg-muted">hardkas localnet fund --treasury: transfers exact KAS from the localnet Treasury (only mines coinbases if empty).</div>
        </div>
      )}

      <div className="flex items-center justify-between text-[10px] text-fg-muted tabular-nums">
        <span>
          {account.utxoCount !== null ? (
            `${account.utxoCount} utxo`
          ) : (
            <span className="inline-flex items-center gap-1 text-accent/80">
              <RefreshCw size={10} className="animate-spin" /> querying UTXOs…
            </span>
          )}
        </span>
        <button type="button" onClick={() => void fund()} disabled={funding} className="flex items-center gap-1 hover:text-accent disabled:opacity-50 cursor-pointer" title="Simulator: hardkas accounts fund · Local node: hardkas localnet fund --treasury --profile toccata-v2">
          <Coins size={11} /> {funding ? "funding…" : "fund 100"}
        </button>
      </div>
    </li>
  );
}
