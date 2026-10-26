import { AlertTriangle, ExternalLink, Play, RefreshCw, X } from "lucide-react";
import { useState } from "react";
import { useEngine } from "@/engine/context";
import type { EnvironmentPlugin } from "@/plugins/environment";
import { useEnv } from "@/store/env";
import { useIde } from "@/store/ide";

const GET_DOCKER = "https://docs.docker.com/get-started/get-docker/";

/**
 * A visible notice above the editor when the Docker local node cannot be used:
 *   - Docker missing or not running: how to install / start it, plus "check again"
 *   - Docker fine but the node stopped while the environment is "Local node": one-click Start
 * Dismissed notices stay hidden until the next reload; the underlying status is still in Servers.
 */
export function EnvNotice() {
  const engine = useEngine();
  const env = engine.get<EnvironmentPlugin>("environment");
  const docker = useEnv((s) => s.docker);
  const node = useEnv((s) => s.node);
  const nodeBusy = useEnv((s) => s.nodeBusy);
  const target = useIde((s) => s.target);
  const setTarget = useIde((s) => s.setTarget);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  const dockerMissing = docker !== null && !docker.installed;
  const dockerStopped = docker !== null && docker.installed && !docker.running;
  const nodeStopped = target === "localnet" && docker?.running === true && node !== null && !node.running;

  const kind = dockerMissing ? "docker-missing" : dockerStopped ? "docker-stopped" : nodeStopped ? "node-stopped" : null;
  if (!kind || dismissed === kind) return null;

  const check = async () => {
    setChecking(true);
    try {
      await env.refresh();
    } finally {
      setChecking(false);
    }
  };

  return (
    <div role="alert" className="shrink-0 flex items-start gap-3 px-3 py-2 border-b border-warn/40 bg-warn/10 text-xs">
      <AlertTriangle size={16} className="text-warn shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0 space-y-1">
        {kind === "docker-missing" && (
          <>
            <div className="font-semibold text-warn">Docker is not installed</div>
            <div className="text-fg-muted">
              The Local node is a real rusty-kaspad running in Docker, so it needs Docker. Install it, start it, then press Check again. Until then the IDE uses the in-memory Simulator, which needs nothing.
            </div>
          </>
        )}
        {kind === "docker-stopped" && (
          <>
            <div className="font-semibold text-warn">Docker is installed but not running</div>
            <div className="text-fg-muted">
              Start Docker Desktop (or the Docker service) and press Check again to use the Local node. Until then the IDE uses the in-memory Simulator.
            </div>
          </>
        )}
        {kind === "node-stopped" && (
          <>
            <div className="font-semibold text-warn">The local node is stopped</div>
            <div className="text-fg-muted">Transactions on the Local node need rusty-kaspad running. Start it (it also creates the dev accounts alice…erin and a miner).</div>
          </>
        )}
        <div className="flex flex-wrap items-center gap-2 pt-0.5">
          {kind === "docker-missing" && (
            <a className="btn-primary" href={GET_DOCKER} target="_blank" rel="noreferrer">
              <ExternalLink size={12} /> Install Docker
            </a>
          )}
          {kind === "node-stopped" && (
            <button type="button" className="btn-primary" disabled={nodeBusy !== null} onClick={() => void env.startNode()}>
              <Play size={12} /> {nodeBusy === "start" ? "Starting…" : "Start local node"}
            </button>
          )}
          {kind !== "node-stopped" && (
            <button type="button" className="btn-ghost" disabled={checking} onClick={() => void check()}>
              <RefreshCw size={12} className={checking ? "animate-spin" : ""} /> Check again
            </button>
          )}
          {target === "localnet" && kind !== "node-stopped" && (
            <button type="button" className="btn-ghost" onClick={() => setTarget("simulator")}>
              Use the Simulator
            </button>
          )}
        </div>
      </div>
      <button type="button" onClick={() => setDismissed(kind)} className="p-0.5 rounded text-fg-muted hover:text-fg hover:bg-bg-hover cursor-pointer shrink-0" title="Dismiss" aria-label="Dismiss notice">
        <X size={13} />
      </button>
    </div>
  );
}
