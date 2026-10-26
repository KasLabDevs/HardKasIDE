import clsx from "clsx";
import { Check, Coins, Copy, KeyRound, Play, Plus, RefreshCw, RotateCw, Square, UserRound } from "lucide-react";
import { useState } from "react";
import { useEngine } from "@/engine/context";
import type { EnvironmentPlugin } from "@/plugins/environment";
import { formatKas, useEnv, type AccountInfo } from "@/store/env";
import { ENVIRONMENTS, envOf, useIde } from "@/store/ide";
import { WalletCard } from "./WalletCard";

/** Eclipse "Servers"-style view: the node (start/stop/restart) and the accounts with balances. */
export function ServersPanel() {
  const engine = useEngine();
  const env = engine.get<EnvironmentPlugin>("environment");
  const node = useEnv((s) => s.node);
  const docker = useEnv((s) => s.docker);
  const nodeBusy = useEnv((s) => s.nodeBusy);
  const setTarget = useIde((s) => s.setTarget);
  const accounts = useEnv((s) => s.accounts);
  const accountsBusy = useEnv((s) => s.accountsBusy);
  const error = useEnv((s) => s.error);
  const lastRefresh = useEnv((s) => s.lastRefresh);
  const target = useIde((s) => s.target);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const say = (text: string) => {
    setNotice(text);
    setTimeout(() => setNotice(null), 2500);
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

  const dot = node ? (node.rpcReady ? "bg-ok" : node.running ? "bg-warn" : "bg-error") : "bg-fg-muted";
  const current = envOf(target);
  const dockerMissing = docker !== null && (!docker.installed || !docker.running);

  return (
    <div className="text-xs">
      {/* ------------------------------------------------------- environment */}
      <section className="border-b border-border">
        <label htmlFor="servers-env-select" className="px-3 py-1.5 label mb-0">Environment</label>
        <div className="px-3 pb-3 space-y-2">
          <select id="servers-env-select" className="input" value={target} onChange={(e) => setTarget(e.target.value as typeof target)}>
            {ENVIRONMENTS.map((e) => (
              <option key={e.id} value={e.id}>
                {e.label} · network {e.networkId}
              </option>
            ))}
          </select>
          <div className="text-fg-muted">{current.description}</div>
          <div className="text-[10px] text-fg-muted">
            HardKas names: <code>--target {current.id}</code> · <code>--network {current.networkId}</code>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------ node */}
      <section className="border-b border-border">
        <div className="flex items-center justify-between px-3 py-1.5">
          <span className="label mb-0 flex items-center gap-2">
            <span className={clsx("w-2 h-2 rounded-full", dot)} /> Local node (Docker)
          </span>
          <button type="button" onClick={() => void env.refreshNode()} className="p-0.5 rounded text-fg-muted hover:text-fg hover:bg-bg-hover cursor-pointer" title="Refresh node status" aria-label="Refresh node status">
            <RefreshCw size={13} className={nodeBusy ? "animate-spin" : ""} />
          </button>
        </div>
        <div className="px-3 pb-3 space-y-2">
          {dockerMissing && (
            <div className="rounded border border-warn/50 bg-warn/10 p-2 space-y-1">
              <div className="text-warn font-semibold">{docker?.installed ? "Docker is installed but not running" : "Docker is not installed"}</div>
              <div className="text-fg-muted">
                The local node is rusty-kaspad inside a Docker container.{" "}
                {docker?.installed ? "Start Docker Desktop and refresh." : (
                  <>
                    Install{" "}
                    <a className="text-accent hover:underline" href="https://www.docker.com/products/docker-desktop/" target="_blank" rel="noreferrer">
                      Docker Desktop
                    </a>{" "}
                    and refresh.
                  </>
                )}{" "}
                Until then, use the Simulator: it needs nothing.
              </div>
              {docker?.error && <div className="text-[10px] text-fg-muted font-mono break-all">{docker.error}</div>}
              {target === "localnet" && (
                <button type="button" className="btn-ghost w-full justify-center" onClick={() => setTarget("simulator")}>
                  Switch to Simulator
                </button>
              )}
            </div>
          )}
          {docker?.running && <div className="text-[10px] text-fg-muted">Docker {docker.serverVersion} running</div>}
          <div className="rounded border border-border bg-bg-elev p-2 space-y-1">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-fg">rusty-kaspad · {node?.network ?? "simnet"}</span>
              <span className={clsx("text-[10px] uppercase tracking-wide", node?.rpcReady ? "text-ok" : node?.running ? "text-warn" : "text-error")}>
                {node ? (node.rpcReady ? "ready" : node.running ? "starting" : "stopped") : "unknown"}
              </span>
            </div>
            <Row k="profile" v={node?.profile ?? "toccata-v2"} />
            <Row k="container" v={node?.containerName ?? "hardkas-kaspad-toccata-v2"} />
            <Row k="version" v={node?.serverVersion ?? "2.1.0"} />
            <Row k="rpc" v={node?.rpcUrl ?? "ws://127.0.0.1:18210"} />
            {node?.ports && <Row k="ports" v={`grpc ${node.ports.rpc ?? "?"} · borsh ${node.ports.borshRpc ?? "?"} · json ${node.ports.jsonRpc ?? "?"}`} />}
            {node?.virtualDaaScore && <Row k="DAA" v={node.virtualDaaScore} />}
            {typeof node?.isSynced === "boolean" && <Row k="synced" v={node.isSynced ? "yes" : "no (local simnet never syncs)"} />}
            {node?.miner && <Row k="miner" v={node.miner.running ? "running (cpuminer)" : node.miner.status || "stopped"} />}
            {node?.lastError && <div className="text-warn break-words">{node.lastError}</div>}
            {node?.status && <Row k="status" v={node.status} />}
          </div>
          <div className="grid grid-cols-3 gap-1">
            <button type="button" className="btn-ghost justify-center" disabled={nodeBusy !== null || node?.running === true || dockerMissing} onClick={() => void env.startNode()} title={dockerMissing ? "Docker is required" : "hardkas localnet start --toccata"}>
              <Play size={12} /> {nodeBusy === "start" ? "…" : "Start"}
            </button>
            <button type="button" className="btn-ghost justify-center" disabled={nodeBusy !== null || node?.running === false} onClick={() => void env.stopNode()} title="hardkas localnet stop">
              <Square size={12} /> {nodeBusy === "stop" ? "…" : "Stop"}
            </button>
            <button type="button" className="btn-ghost justify-center" disabled={nodeBusy !== null} onClick={() => void env.restartNode()} title="stop, then start">
              <RotateCw size={12} /> {nodeBusy === "restart" ? "…" : "Restart"}
            </button>
          </div>
          <div className="text-fg-muted">
            {target === "localnet"
              ? "Transactions go to this node."
              : target === "simulator"
                ? "Transactions stay in the in-memory Simulator; this node is only used when the environment is Local node."
                : "Transactions go to the remote testnet node in hardkas.config.ts; this local node is idle."}
          </div>
          {error && <div role="alert" className="text-error break-words">{error}</div>}
        </div>
      </section>

      <WalletCard />

      {/* -------------------------------------------------------- accounts */}
      <section>
        <div className="flex items-center justify-between px-3 py-1.5">
          <span className="label mb-0">Accounts · {accounts[0]?.balanceNetwork ?? "…"}</span>
          <button type="button" onClick={() => void env.refreshAccounts()} className="p-0.5 rounded text-fg-muted hover:text-fg hover:bg-bg-hover cursor-pointer" title="Refresh balances" aria-label="Refresh account balances">
            <RefreshCw size={13} className={accountsBusy ? "animate-spin" : ""} />
          </button>
        </div>
        <ul className="px-3 pb-2 space-y-2">
          {accounts.length === 0 && <li className="text-fg-muted">No accounts. Run hardkas init, or create one below.</li>}
          {accounts.map((a) => (
            <AccountCard key={a.name} account={a} env={env} say={say} />
          ))}
        </ul>
        <div className="px-3 pb-3 space-y-1">
          <div className="flex gap-1">
            <input
              aria-label="New simnet account name"
              className="input"
              placeholder="new account name (simnet)"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void create()}
            />
            <button type="button" className="btn-ghost shrink-0" disabled={creating || !newName.trim()} onClick={() => void create()} title="hardkas localnet account create <name>">
              <Plus size={12} /> {creating ? "…" : "Create"}
            </button>
          </div>
          <div className="text-fg-muted">Creates a real simnet key stored in plaintext in .hardkas/accounts.real.json (dev only).</div>
        </div>
        <div className="px-3 pb-3 text-[10px] text-fg-muted flex items-center justify-between tabular-nums">
          <span>{lastRefresh ? `updated ${new Date(lastRefresh).toLocaleTimeString(undefined, { hour12: false })}` : ""}</span>
          {notice && <span role="status" aria-live="polite" className="text-accent">{notice}</span>}
        </div>
      </section>
    </div>
  );
}

function AccountCard({ account, env, say }: { account: AccountInfo; env: EnvironmentPlugin; say: (t: string) => void }) {
  const [funding, setFunding] = useState(false);
  const [copiedAddr, setCopiedAddr] = useState(false);
  const copy = async (text: string, what: string) => {
    await navigator.clipboard.writeText(text);
    setCopiedAddr(true);
    say(`${what} of ${account.name} copied`);
    setTimeout(() => setCopiedAddr(false), 1500);
  };
  const copyKey = async () => {
    if (!account.hasPlainKey) {
      say("Keystore key not exportable");
      return;
    }
    if (!confirm(`Copy the private key of "${account.name}" to the clipboard? It will not be shown.`)) return;
    const ok = await env.copyPrivateKey(account.name);
    say(ok ? `Private key of ${account.name} copied (KasWare compatible)` : "No key available");
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
    <li className="rounded border border-border bg-bg-elev p-2 space-y-1">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 font-semibold text-fg truncate">
          <UserRound size={13} className="text-accent shrink-0" /> <span className="truncate">{account.name}</span>
          <span className="text-[10px] font-normal text-fg-muted shrink-0">{account.kind}</span>
        </span>
        <span className="font-mono text-fg tabular-nums shrink-0">{formatKas(account.balanceSompi)}</span>
      </div>
      <div className="flex items-center gap-1 min-w-0">
        <span className="text-fg-muted w-14 shrink-0">address</span>
        <span className="font-mono text-[10px] truncate flex-1" title={account.address}>
          {account.address}
        </span>
        <button
          type="button"
          onClick={() => void copy(account.address, "Address")}
          className="p-0.5 rounded text-fg-muted hover:text-accent cursor-pointer shrink-0"
          title="Copy address (public)"
          aria-label={`Copy address of ${account.name}`}
        >
          {copiedAddr ? <Check size={12} className="text-ok" /> : <Copy size={12} />}
        </button>
      </div>
      <div className="flex items-center gap-1 min-w-0">
        <span className="text-fg-muted w-14 shrink-0">private</span>
        <span className="font-mono text-[10px] text-fg-muted flex-1 truncate select-none">•••••••••••••••••••••••••••••••• {account.keystore === "plain" ? "(plaintext dev key)" : account.keystore === "dev-keystore" ? "(dev keystore - KasWare ready)" : account.keystore === "encrypted" ? "(argon2id/AES-GCM keystore)" : ""}</span>
        <button
          type="button"
          onClick={() => void copyKey()}
          aria-label={`Copy private key of ${account.name}`}
          className={clsx("p-0.5 rounded flex items-center gap-1 shrink-0", account.hasPlainKey ? "text-fg-muted hover:text-warn cursor-pointer" : "text-fg-muted/40 cursor-not-allowed")}
          title={account.hasPlainKey ? "Copy private key to clipboard (KasWare compatible)" : "Not exportable: encrypted keystore"}
        >
          <KeyRound size={12} />
        </button>
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

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex gap-2 min-w-0">
      <span className="w-16 shrink-0 text-fg-muted">{k}</span>
      <span className="font-mono text-[11px] truncate tabular-nums" title={v}>
        {v}
      </span>
    </div>
  );
}
