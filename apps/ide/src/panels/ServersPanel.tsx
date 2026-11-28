import clsx from "clsx";
import { Eraser, Loader2, Play, RefreshCw, RotateCw, Square } from "lucide-react";
import { InfoTip } from "@/components/InfoTip";
import { useEngine } from "@/engine/context";
import type { EnvironmentPlugin } from "@/plugins/environment";
import { cliMismatch, useEnv } from "@/store/env";
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
        <div className="flex items-center justify-between px-3 py-1.5">
          <label htmlFor="servers-env-select" className="label mb-0">Environment</label>
          <InfoTip label="Environment details">
            <div>{current.description}</div>
            <div>
              HardKas CLI: <code>--target {current.id}</code> · <code>--network {current.networkId}</code>
            </div>
          </InfoTip>
        </div>
        <div className="px-3 pb-2.5">
          <select id="servers-env-select" className="input" value={target} onChange={(e) => setTarget(e.target.value as typeof target)}>
            {ENVIRONMENTS.map((e) => (
              <option key={e.id} value={e.id}>
                {e.label} · {e.networkId}
              </option>
            ))}
          </select>
        </div>
      </section>

      {/* ------------------------------------------------------------ node */}
      <section className="border-b border-border">
        <div className="flex items-center justify-between px-3 py-1.5">
          <span className="label mb-0 flex items-center gap-2">
            <span className={clsx("w-2 h-2 rounded-full", dot)} /> Local node (Docker)
          </span>
          <div className="flex items-center gap-1">
            <InfoTip label="Local node routing & details">
              <div>
                {target === "localnet"
                  ? "Transactions are sent directly to this local node."
                  : target === "simulator"
                    ? "Transactions run in the in-memory Simulator; this node is only used when Environment is Local node."
                    : "Transactions use the remote testnet node from hardkas.config.ts; this local node stays idle."}
              </div>
              {docker?.running && <div className="text-fg/80">Docker {docker.serverVersion} running.</div>}
            </InfoTip>
            <button type="button" onClick={() => void env.refreshNode()} className="p-0.5 rounded text-fg-muted hover:text-fg hover:bg-bg-hover cursor-pointer" title="Refresh node status" aria-label="Refresh node status">
              <RefreshCw size={13} className={nodeBusy ? "animate-spin" : ""} />
            </button>
          </div>
        </div>
        <div className="px-3 pb-3 space-y-2">
          {dockerMissing && (
            <div className="rounded border border-warn/50 bg-warn/10 p-2 space-y-1">
              <div className="text-warn font-semibold">{docker?.installed ? "Docker is installed but not running" : "Docker is not installed"}</div>
              <div className="text-fg-muted">
                Needs{" "}
                {docker?.installed ? "Docker Desktop running." : (
                  <a className="text-accent hover:underline" href="https://www.docker.com/products/docker-desktop/" target="_blank" rel="noreferrer">
                    Docker Desktop
                  </a>
                )}{" "}
                Use Simulator meanwhile.
              </div>
              {docker?.error && (
                <details className="text-[12px] text-fg-muted">
                  <summary className="cursor-pointer hover:text-fg">Technical details</summary>
                  <div className="mt-1 font-mono break-all select-text">{docker.error}</div>
                </details>
              )}
              {target === "localnet" && (
                <button type="button" className="btn-ghost w-full justify-center" onClick={() => setTarget("simulator")}>
                  Switch to Simulator
                </button>
              )}
            </div>
          )}
          <div className="rounded border border-border bg-bg-elev p-2 space-y-1">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-fg">rusty-kaspad · {node?.network ?? "simnet"}</span>
              <span className={clsx("text-[12px] uppercase tracking-wide", node?.rpcReady ? "text-ok" : node?.running ? "text-warn" : "text-error")}>
                {node ? (node.rpcReady ? "ready" : node.running ? "starting" : "stopped") : "unknown"}
              </span>
            </div>
            {/* Before the first status arrives, say so: made-up defaults (a version, a container) read as facts. */}
            {!node && !error && (
              <div className="flex items-center gap-1.5 text-fg-muted" role="status">
                <Loader2 size={12} className="animate-spin" /> Asking the local node for its status…
              </div>
            )}
            {node && (
              <>
                <Row k="profile" v={node.profile || "—"} />
                <Row k="container" v={node.containerName ?? "—"} />
                <Row k="version" v={node.serverVersion ?? (node.running ? "—" : "not running")} />
                <Row k="rpc" v={node.rpcUrl ?? "—"} />
              </>
            )}
            {node?.ports && <Row k="ports" v={`grpc ${node.ports.rpc ?? "?"} · borsh ${node.ports.borshRpc ?? "?"} · json ${node.ports.jsonRpc ?? "?"}`} />}
            {node?.virtualDaaScore && <Row k="DAA" v={node.virtualDaaScore} />}
            {typeof node?.isSynced === "boolean" && <Row k="synced" v={node.isSynced ? "yes" : "no (local simnet never syncs)"} />}
            {node?.lastError && <div className="text-warn break-words">{node.lastError}</div>}
            {node?.status && <Row k="status" v={node.status} />}
          </div>
          {nodeOp && <div className="rounded border border-border bg-bg p-2"><OpSteps op={nodeOp} compact /></div>}
          <MinerNotice />
          {cli && (
            <div className={clsx("text-[12px] break-words", cliMismatch(cli) ? "text-warn" : "text-fg-muted")} title={cli.command}>
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
              if (await confirmDialog("Reset the local node from scratch?\n\nThis stops the node and miner, DELETES the whole local chain (deployed contracts and previous history disappear), then recreates and seeds the dev accounts (100 KAS each from localnet Treasury, waiting for confirmed balances). Account keys are not deleted: the simnet dev keystores (.hardkas/dev-accounts) are moved to .hardkas/backups/reset-<time>/, and .hardkas/accounts.real.json stays where it is (a copy goes to the same backup), so testnet accounts keep working. Artifacts and your files are kept.", { title: "Reset local node", confirmLabel: "Reset from scratch", danger: true })) void env.resetNode();
            }}
            title="hardkas localnet stop → hardkas localnet reset --yes → hardkas localnet start"
          >
            <Eraser size={12} /> {nodeBusy === "reset" ? "Resetting…" : "Reset from scratch…"}
          </button>
          {error && <div role="alert" className="text-error break-words">{error}</div>}
        </div>
      </section>

      <ExplorerCard />
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex gap-2 min-w-0">
      <span className="w-16 shrink-0 text-fg-muted">{k}</span>
      <span className="font-mono text-[12px] truncate tabular-nums" title={v}>
        {v}
      </span>
    </div>
  );
}
