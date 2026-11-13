import clsx from "clsx";
import { Cpu, Play, Server, Users } from "lucide-react";
import { useEngine } from "@/engine/context";
import type { EnvironmentPlugin } from "@/plugins/environment";
import { EnvAccountsTrigger } from "@/shell/EnvAccountsTrigger";
import { useEnv } from "@/store/env";
import { ENVIRONMENTS, envOf, useIde, type ExecutionTarget } from "@/store/ide";

/** Thin strip above the editor: the environment you are on, the node (when it matters) and the accounts at a glance. */
export function EnvBar() {
  const engine = useEngine();
  const env = engine.get<EnvironmentPlugin>("environment");
  const node = useEnv((s) => s.node);
  const nodeBusy = useEnv((s) => s.nodeBusy);
  const docker = useEnv((s) => s.docker);
  const target = useIde((s) => s.target);
  const setTarget = useIde((s) => s.setTarget);
  const setActiveSidePlugin = useIde((s) => s.setActiveSidePlugin);
  const current = envOf(target);

  const op = useEnv((s) => s.nodeOp);
  const opRunning = op?.state === "running";

  // The node dot only means something when the environment needs the node.
  let dot = "bg-fg-muted";
  let nodeText = `${current.short} · network ${current.networkId}`;
  if (opRunning && op) {
    const step = op.steps.findIndex((s) => s.status === "running");
    dot = "bg-warn animate-pulse";
    nodeText = `${op.title}… step ${Math.max(step, 0) + 1}/${op.steps.length}`;
  } else if (current.needsNode) {
    if (docker && (!docker.installed || !docker.running)) {
      dot = "bg-error";
      nodeText = docker.installed ? "Local node · Docker not running" : "Local node · Docker not installed";
    } else if (node) {
      dot = node.rpcReady ? "bg-ok" : node.running ? "bg-warn" : "bg-error";
      nodeText = node.rpcReady ? `Local node · rusty-kaspad ${node.serverVersion ?? ""} · simnet · ready` : node.running ? "Local node · starting…" : "Local node · stopped";
    } else {
      nodeText = "Local node · checking…";
    }
  } else if (target === "simulator") {
    dot = "bg-ok";
    nodeText = "Simulator · in-memory, no node needed";
  }

  return (
    <div className="h-6 shrink-0 flex items-center gap-2.5 px-2.5 border-b border-border bg-bg-panel text-[11px] text-fg-muted select-none overflow-visible relative z-20">
      <label className="flex items-center gap-1.5 whitespace-nowrap shrink-0">
        <Cpu size={12} /> env
        <select
          aria-label="Execution environment"
          className="bg-transparent text-accent font-medium outline-none cursor-pointer rounded px-1 hover:bg-bg-hover"
          value={target}
          onChange={(e) => setTarget(e.target.value as ExecutionTarget)}
          title={current.description}
        >
          {ENVIRONMENTS.map((e) => (
            <option key={e.id} value={e.id}>
              {e.label}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        onClick={() => setActiveSidePlugin("environment")}
        className="flex items-center gap-1.5 hover:text-fg whitespace-nowrap min-w-0 shrink overflow-hidden cursor-pointer rounded px-1 py-0.5 hover:bg-bg-hover transition-colors"
        title={`${nodeText}${current.needsNode && node?.virtualDaaScore ? ` · DAA ${node.virtualDaaScore}` : ""} (Open Servers view)`}
      >
        <Server size={12} className="shrink-0" />
        <span className={clsx("w-2 h-2 rounded-full shrink-0", dot)} />
        <span className="text-fg truncate">{nodeText}</span>
        {current.needsNode && node?.virtualDaaScore && <span className="tabular-nums shrink-0">· DAA {node.virtualDaaScore}</span>}
      </button>
      {current.needsNode && docker?.running === true && node !== null && !node.running && !opRunning && (
        <button
          type="button"
          disabled={nodeBusy !== null}
          onClick={() => void env.startNode()}
          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-accent/15 text-accent border border-accent/30 hover:bg-accent/25 text-[10px] font-medium cursor-pointer shrink-0"
          title="Start the local rusty-kaspad node"
        >
          <Play size={10} /> Start
        </button>
      )}
      <span
        className={clsx(
          "hidden 2xl:inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] font-mono shrink-0",
          target === "simulator"
            ? "border-warn/40 bg-warn/10 text-warn"
            : "border-ok/30 bg-ok/10 text-ok"
        )}
        title={
          target === "simulator"
            ? "Simulator difference vs Real Node: In-memory UTXO ledger (0-block maturity, skips rusty-kaspad VM script/covenant verification)"
            : "Real Node Consensus: Full rusty-kaspad Covenant v1 VM verification, compute_budget enforcement & 100-DAA coinbase maturity"
        }
      >
        {target === "simulator" ? "Sim: No VM check · 0-DAA" : "Node: Covenant v1 VM · 100-DAA"}
      </span>
      <div className="ml-auto shrink-0 flex items-center">
        {current.needsNode && (!node?.running || !node?.rpcReady) ? (
          <span className="flex items-center gap-1.5 text-fg-muted/60 text-[10px] select-none" title="Start the local node to load the accounts and their balances">
            <Users size={11} className="opacity-50" />
            <span>accounts unavailable</span>
          </span>
        ) : (
          <EnvAccountsTrigger />
        )}
      </div>
    </div>
  );
}
