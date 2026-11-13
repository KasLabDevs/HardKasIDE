import clsx from "clsx";
import { ChevronRight, Eraser, Play, RefreshCw, RotateCw, Square, UserRound } from "lucide-react";
import { useEngine } from "@/engine/context";
import type { EnvironmentPlugin } from "@/plugins/environment";
import { cliMismatch, formatKas, useEnv } from "@/store/env";
import { ENVIRONMENTS, envOf, useIde } from "@/store/ide";
import { OpSteps } from "@/shell/NodeOpProgress";
import { ExplorerCard } from "./ExplorerCard";
import { MinerNotice } from "./MinerNotice";
import { confirmDialog } from "@/utils/dialog";

/** Eclipse "Servers"-style view: the environment and the node (start/stop/restart). Accounts and the wallet live in the Accounts view. */
export function ServersPanel() {
  const engine = useEngine();
  const env = engine.get<EnvironmentPlugin>("environment");
  const node = useEnv((s) => s.node);
  const docker = useEnv((s) => s.docker);
  const nodeBusy = useEnv((s) => s.nodeBusy);
  const setTarget = useIde((s) => s.setTarget);
  const accounts = useEnv((s) => s.accounts);
  const error = useEnv((s) => s.error);
  const target = useIde((s) => s.target);

  const dot = node ? (node.rpcReady ? "bg-ok" : node.running ? "bg-warn" : "bg-error") : "bg-fg-muted";
  const current = envOf(target);
  const dockerMissing = docker !== null && (!docker.installed || !docker.running);
  const nodeOp = useEnv((s) => s.nodeOp);
  const cli = useEnv((s) => s.cli);

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
            {node?.lastError && <div className="text-warn break-words">{node.lastError}</div>}
            {node?.status && <Row k="status" v={node.status} />}
          </div>
          {nodeOp && <div className="rounded border border-border bg-bg p-2"><OpSteps op={nodeOp} compact /></div>}
          <MinerNotice />
          {cli && (
            <div className={clsx("text-[10px] break-words", cliMismatch(cli) ? "text-warn" : "text-fg-muted")} title={cli.command}>
              CLI {cli.version ?? "not found"} · {cli.source === "project" ? "project node_modules" : cli.source === "npx" ? "npx" : cli.source === "env" ? "HARDKAS_BIN" : "repo"}
              {cliMismatch(cli) ? ` · the IDE was tested with ${cli.pinned}` : ""}
              {!cli.version && cli.error ? ` · ${cli.error}` : ""}
            </div>
          )}
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
          <button
            type="button"
            className="btn-ghost w-full justify-center text-error border-error/40 hover:border-error"
            disabled={nodeBusy !== null || dockerMissing}
            onClick={async () => {
              if (await confirmDialog("Reset the local node from scratch?\n\nThis stops the node and miner, DELETES the whole local chain (deployed contracts and previous history disappear), then recreates and seeds the dev accounts (100 KAS each from localnet Treasury, waiting for confirmed balances). Account keys are not deleted: .hardkas/accounts.real.json and .hardkas/dev-accounts are moved to .hardkas/backups/reset-<time>/. Artifacts and your files are kept.", { title: "Reset local node", confirmLabel: "Reset from scratch", danger: true })) void env.resetNode();
            }}
            title="hardkas localnet stop → hardkas node reset --yes → hardkas localnet start"
          >
            <Eraser size={12} /> {nodeBusy === "reset" ? "Resetting…" : "Reset from scratch…"}
          </button>
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

      <ExplorerCard />


      {/* -------------------------------------------------------- accounts */}
      {/* The account list (keys, balances, fund, create) lives in the Accounts view; Servers only links to it. */}
      <section className="px-3 py-2">
        <button
          type="button"
          onClick={() => useIde.getState().revealPlugin("accounts", "Accounts")}
          className="w-full flex items-center justify-between gap-2 rounded border border-border bg-bg-elev px-2 py-1.5 hover:border-accent/60 hover:bg-bg-hover cursor-pointer"
          title="Open the Accounts view (keys, balances, fund, create)"
        >
          <span className="flex items-center gap-1.5 text-fg">
            <UserRound size={13} className="text-accent" />
            {accounts.length} account{accounts.length === 1 ? "" : "s"} · {accounts[0]?.balanceNetwork ?? current.networkId}
          </span>
          <span className="flex items-center gap-1 font-mono tabular-nums text-fg-muted">
            {formatKas(accounts.reduce((sum, a) => sum + BigInt(a.balanceSompi ?? 0), 0n).toString())}
            <ChevronRight size={12} />
          </span>
        </button>
      </section>
    </div>
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
