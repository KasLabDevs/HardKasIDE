import clsx from "clsx";
import { Cpu, Server, Users } from "lucide-react";
import { formatKas, useEnv } from "@/store/env";
import { ENVIRONMENTS, envOf, useIde, type ExecutionTarget } from "@/store/ide";

/** Thin strip above the editor: the environment you are on, the node (when it matters) and the accounts at a glance. */
export function EnvBar() {
  const node = useEnv((s) => s.node);
  const docker = useEnv((s) => s.docker);
  const accounts = useEnv((s) => s.accounts);
  const target = useIde((s) => s.target);
  const setTarget = useIde((s) => s.setTarget);
  const setActiveSidePlugin = useIde((s) => s.setActiveSidePlugin);
  const current = envOf(target);

  // The node dot only means something when the environment needs the node.
  let dot = "bg-fg-muted";
  let nodeText = `${current.short} · network ${current.networkId}`;
  if (current.needsNode) {
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
    <div className="h-7 shrink-0 flex items-center gap-3 px-3 border-b border-border bg-bg-panel text-[11px] text-fg-muted select-none overflow-hidden">
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
      <button type="button" onClick={() => setActiveSidePlugin("environment")} className="flex items-center gap-1.5 hover:text-fg whitespace-nowrap shrink-0 cursor-pointer rounded px-1 py-0.5 hover:bg-bg-hover transition-colors" title="Open Servers view">
        <Server size={12} />
        <span className={clsx("w-2 h-2 rounded-full shrink-0", dot)} />
        <span className="text-fg">{nodeText}</span>
        {current.needsNode && node?.virtualDaaScore && <span className="tabular-nums">· DAA {node.virtualDaaScore}</span>}
      </button>
      <button
        type="button"
        onClick={() => setActiveSidePlugin("accounts")}
        className="flex items-center gap-2.5 min-w-0 overflow-hidden tabular-nums hover:text-fg whitespace-nowrap shrink-0 cursor-pointer rounded px-1 py-0.5 hover:bg-bg-hover transition-colors"
        title="Open Accounts view"
      >
        <Users size={12} className="shrink-0" />
        {accounts.slice(0, 5).map((a) => (
          <span key={a.name} className="whitespace-nowrap" title={`${a.name}: ${a.address}`}>
            <span className="text-fg font-medium">{a.name}</span> {formatKas(a.balanceSompi)}
          </span>
        ))}
        {accounts.length > 5 && <span>+{accounts.length - 5}</span>}
      </button>
    </div>
  );
}
