import clsx from "clsx";
import { Check, Coins, Copy, Eye, EyeOff, KeyRound, Plus, RefreshCw, UserRound } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useEngine } from "@/engine/context";
import type { EnvironmentPlugin } from "@/plugins/environment";
import { formatKas, useEnv, type AccountInfo } from "@/store/env";
import { envOf, useIde } from "@/store/ide";

/** Accounts view: every account with its balance, public address and private key (hidden until revealed; both copyable). */
export function AccountsPanel() {
  const engine = useEngine();
  const env = engine.get<EnvironmentPlugin>("environment");
  const accounts = useEnv((s) => s.accounts);
  const busy = useEnv((s) => s.accountsBusy);
  const target = useIde((s) => s.target);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (accounts.length === 0) void env.refreshAccounts();
    return () => {
      if (noticeTimer.current) clearTimeout(noticeTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const say = (text: string) => {
    setNotice(text);
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(null), 2500);
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
      say(e instanceof Error ? e.message : String(e));
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="text-xs">
      <div className="flex items-center justify-between gap-2 px-3 py-1.5 border-b border-border">
        <span className="text-fg-muted tabular-nums">
          {accounts.length} account{accounts.length === 1 ? "" : "s"} · {envOf(target).networkId}
        </span>
        <button type="button" onClick={() => void env.refreshAccounts()} className="p-0.5 rounded text-fg-muted hover:text-fg hover:bg-bg-hover cursor-pointer" title="Refresh balances" aria-label="Refresh account balances">
          <RefreshCw size={13} className={busy ? "animate-spin" : ""} />
        </button>
      </div>
      <ul className="p-3 space-y-3">
        {accounts.length === 0 && (
          <li className="text-fg-muted text-center py-4">{busy ? "Loading accounts…" : "No accounts yet. Run hardkas init, or create one below."}</li>
        )}
        {accounts.map((a) => (
          <AccountItem key={a.name} account={a} env={env} say={say} />
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
          To use an account in KasWare: copy its private key (64 hex characters), open the KasWare extension on the <strong>Kaspa Simnet</strong> network (see the Wallet card in Servers for the RPC settings) and choose <em>Import Account &rarr; Private Key</em>. These are dev keys protected by a public password: simnet only, never real funds.
        </p>
      </div>
      <div role="status" aria-live="polite" className="px-3 pb-3 text-[11px] text-accent min-h-4">
        {notice}
      </div>
    </div>
  );
}

function CopyField({ label, value, mono = true, onCopy, copied }: { label: string; value: string; mono?: boolean; onCopy: () => void; copied: boolean }) {
  return (
    <div className="space-y-0.5">
      <div className="text-[10px] uppercase tracking-wide text-fg-muted">{label}</div>
      <div className="flex items-start gap-1 min-w-0">
        <span className={clsx("flex-1 min-w-0 break-all text-[11px] rounded bg-bg border border-border px-1.5 py-1", mono && "font-mono")}>{value}</span>
        <button type="button" onClick={onCopy} className="p-1 rounded text-fg-muted hover:text-accent hover:bg-bg-hover cursor-pointer shrink-0" title={`Copy ${label.toLowerCase()}`} aria-label={`Copy ${label.toLowerCase()}`}>
          {copied ? <Check size={13} className="text-ok" /> : <Copy size={13} />}
        </button>
      </div>
    </div>
  );
}

function AccountItem({ account, env, say }: { account: AccountInfo; env: EnvironmentPlugin; say: (t: string) => void }) {
  const [copied, setCopied] = useState<"pub" | "priv" | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
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
    await navigator.clipboard.writeText(account.address);
    flash("pub");
    say(`Public address of ${account.name} copied`);
  };

  const toggleSecret = async () => {
    if (secret !== null) {
      setSecret(null);
      return;
    }
    const key = await env.getPrivateKey(account.name);
    if (key) setSecret(key);
    else say(`${account.name}: key could not be retrieved`);
  };

  const copyPrivate = async () => {
    if (!account.hasPlainKey) {
      say(`${account.name}: key is not exportable`);
      return;
    }
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
      await env.fund(account.name, "1000");
      say(`${account.name} funded`);
    } catch (e) {
      say(e instanceof Error ? e.message : String(e));
    } finally {
      setFunding(false);
    }
  };

  return (
    <li className="rounded border border-border bg-bg-elev p-2.5 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 font-semibold text-fg min-w-0">
          <UserRound size={14} className="text-accent shrink-0" />
          <span className="truncate">{account.name}</span>
          <span className="text-[10px] font-normal text-fg-muted shrink-0">{account.kind}</span>
        </span>
        <span className="font-mono text-sm text-fg tabular-nums shrink-0">{formatKas(account.balanceSompi)}</span>
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
            <span className="flex-1 min-w-0 break-all font-mono text-[11px] rounded bg-bg border border-border px-1.5 py-1 select-all">
              {secret ?? "••••••••••••••••••••••••••••••••"}
            </span>
            <button type="button" onClick={() => void toggleSecret()} className="p-1 rounded text-fg-muted hover:text-warn hover:bg-bg-hover cursor-pointer shrink-0" title={secret ? "Hide private key" : "Reveal private key"} aria-label={secret ? `Hide private key of ${account.name}` : `Reveal private key of ${account.name}`} aria-pressed={secret !== null}>
              {secret ? <EyeOff size={13} /> : <Eye size={13} />}
            </button>
            <button type="button" onClick={() => void copyPrivate()} className="p-1 rounded text-fg-muted hover:text-warn hover:bg-bg-hover cursor-pointer shrink-0" title="Copy private key for KasWare" aria-label={`Copy private key of ${account.name}`}>
              {copied === "priv" ? <Check size={13} className="text-ok" /> : <Copy size={13} />}
            </button>
          </div>
        ) : (
          <div className="text-[11px] text-fg-muted rounded border border-dashed border-border px-1.5 py-1">
            Not exportable: encrypted production keystore without dev credentials.
          </div>
        )}
      </div>

      <div className="flex items-center justify-between text-[10px] text-fg-muted tabular-nums">
        <span>{account.utxoCount !== null ? `${account.utxoCount} utxo` : ""}</span>
        <button type="button" onClick={() => void fund()} disabled={funding} className="flex items-center gap-1 hover:text-accent disabled:opacity-50 cursor-pointer" title="Simulator: hardkas accounts fund · Local node: hardkas localnet fund --profile toccata-v2">
          <Coins size={11} /> {funding ? "funding…" : "fund 1000"}
        </button>
      </div>
    </li>
  );
}
