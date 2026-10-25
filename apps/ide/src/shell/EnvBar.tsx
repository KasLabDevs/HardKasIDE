import clsx from "clsx";
import { Cpu, Server, Users } from "lucide-react";
import { formatKas, useEnv } from "@/store/env";
import { useIde, type ExecutionTarget } from "@/store/ide";

/** Thin strip above the editor: which node and target you are on, and the accounts at a glance. */
export function EnvBar() {
  const node = useEnv((s) => s.node);
  const accounts = useEnv((s) => s.accounts);
  const target = useIde((s) => s.target);
  const setTarget = useIde((s) => s.setTarget);
  const setActiveSidePlugin = useIde((s) => s.setActiveSidePlugin);

  const dot = node ? (node.rpcReady ? "bg-ok" : node.running ? "bg-warn" : "bg-error") : "bg-fg-muted";
  const nodeText = node ? (node.rpcReady ? `rusty-kaspad ${node.serverVersion ?? ""} · ${node.network ?? "simnet"} · ready` : node.running ? "node starting…" : "node stopped") : "node status unknown";

  return (
    <div className="h-7 shrink-0 flex items-center gap-3 px-3 border-b border-border bg-bg-panel text-[11px] text-fg-muted select-none overflow-hidden">
      <button onClick={() => setActiveSidePlugin("environment")} className="flex items-center gap-1.5 hover:text-fg whitespace-nowrap shrink-0" title="Open Servers view">
        <Server size={12} />
        <span className={clsx("w-2 h-2 rounded-full shrink-0", dot)} />
        <span className="text-fg">{nodeText}</span>
        {node?.virtualDaaScore && <span>· DAA {node.virtualDaaScore}</span>}
      </button>
      <span className="flex items-center gap-1.5 whitespace-nowrap shrink-0">
        <Cpu size={12} /> target
        <select className="bg-transparent text-accent outline-none cursor-pointer" value={target} onChange={(e) => setTarget(e.target.value as ExecutionTarget)}>
          <option value="simulator">simulator</option>
          <option value="localnet">localnet</option>
          <option value="rpc">rpc</option>
        </select>
      </span>
      <span className="flex items-center gap-2 min-w-0 overflow-hidden">
        <Users size={12} />
        {accounts.slice(0, 5).map((a) => (
          <span key={a.name} className="whitespace-nowrap" title={a.address}>
            <span className="text-fg">{a.name}</span> {formatKas(a.balanceSompi)}
          </span>
        ))}
        {accounts.length > 5 && <span>+{accounts.length - 5}</span>}
      </span>
    </div>
  );
}
