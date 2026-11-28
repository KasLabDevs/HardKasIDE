import clsx from "clsx";
import { Check, ChevronDown, Play, Server } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useEngine } from "@/engine/context";
import type { EnvironmentPlugin } from "@/plugins/environment";
import { useEnv } from "@/store/env";
import { ENVIRONMENTS, envOf, useIde } from "@/store/ide";

/**
 * Discrete VS Code-style environment & local-node status pill for StatusBar (`● simnet ▾`).
 * Opens an upward menu to switch target (simulator / localnet / testnet-10), start the local node, or open Servers.
 */
export function StatusEnvPill() {
  const engine = useEngine();
  const env = engine.get<EnvironmentPlugin>("environment");
  const node = useEnv((s) => s.node);
  const nodeBusy = useEnv((s) => s.nodeBusy);
  const docker = useEnv((s) => s.docker);
  const op = useEnv((s) => s.nodeOp);
  const target = useIde((s) => s.target);
  const setTarget = useIde((s) => s.setTarget);
  const setActiveSidePlugin = useIde((s) => s.setActiveSidePlugin);

  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDocDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDocDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const current = envOf(target);
  const opRunning = op?.state === "running";

  let dot = "bg-fg-muted";
  let statusText = `${current.label} · ${current.networkId}`;
  if (opRunning && op) {
    const step = op.steps.findIndex((s) => s.status === "running");
    dot = "bg-warn animate-pulse";
    statusText = `${op.title}… step ${Math.max(step, 0) + 1}/${op.steps.length}`;
  } else if (current.needsNode) {
    if (docker && (!docker.installed || !docker.running)) {
      dot = "bg-error";
      statusText = docker.installed ? "Docker not running" : "Docker not installed";
    } else if (node) {
      dot = node.rpcReady ? "bg-ok" : node.running ? "bg-warn" : "bg-error";
      statusText = node.rpcReady ? "Local node ready" : node.running ? "Local node starting…" : "Local node stopped";
    } else {
      statusText = "Checking local node…";
    }
  } else if (target === "simulator") {
    dot = "bg-ok";
    statusText = "Simulator in-memory (ready)";
  }

  const shortLabel = target === "simulator" ? "simulator" : current.networkId;
  const canStartNode = current.needsNode && docker?.running === true && node !== null && !node.running && !opRunning;

  return (
    <div ref={rootRef} className="relative flex items-center shrink-0">
      <button
        type="button"
        data-testid="statusbar-env-trigger"
        aria-label="Execution environment"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        title={`${current.label} — ${statusText}`}
        className={clsx(
          "inline-flex items-center gap-1.5 px-1.5 py-0.5 rounded cursor-pointer transition-colors whitespace-nowrap",
          open ? "bg-bg-hover text-fg" : "hover:bg-bg-hover hover:text-fg"
        )}
      >
        <span className={clsx("w-1.5 h-1.5 rounded-full shrink-0", dot)} />
        <span className="text-fg font-medium">{shortLabel}</span>
        <ChevronDown size={10} className={clsx("opacity-60 transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Execution environment switcher"
          className="absolute left-0 sm:left-auto sm:right-0 bottom-full pb-1.5 z-50"
        >
          <div className="w-72 rounded-md border border-border bg-bg-elev shadow-2xl overflow-hidden text-[12px]">
            <ul role="listbox" aria-label="Execution environment options" className="py-1">
              {ENVIRONMENTS.map((e) => {
                const selected = e.id === target;
                return (
                  <li key={e.id} role="option" aria-selected={selected}>
                    <button
                      type="button"
                      onClick={() => {
                        setTarget(e.id);
                        setOpen(false);
                      }}
                      className={clsx(
                        "w-full text-left px-2.5 py-1.5 flex items-start gap-2 cursor-pointer transition-colors hover:bg-bg-hover",
                        selected && "bg-bg-hover/60"
                      )}
                    >
                      <span className="mt-0.5 w-3.5 shrink-0 text-accent">{selected ? <Check size={12} /> : null}</span>
                      <span className="min-w-0 flex-1 whitespace-normal">
                        <span className={clsx("block font-medium", selected ? "text-accent" : "text-fg")}>{e.label}</span>
                        <span className="block text-[11px] text-fg-muted leading-snug mt-0.5 line-clamp-2">{e.description}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>

            <div className="border-t border-border/80 bg-bg-panel/60 px-2.5 py-1.5 flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 min-w-0 text-[11px] text-fg-muted">
                <span className={clsx("w-1.5 h-1.5 rounded-full shrink-0", dot)} />
                <span className="truncate">{statusText}</span>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                {canStartNode && (
                  <button
                    type="button"
                    disabled={nodeBusy !== null}
                    onClick={() => {
                      void env.startNode();
                      setOpen(false);
                    }}
                    className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-accent/15 text-accent border border-accent/30 hover:bg-accent/25 text-[11px] font-medium cursor-pointer"
                  >
                    <Play size={10} /> Start
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setActiveSidePlugin("environment");
                    setOpen(false);
                  }}
                  className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-fg-muted hover:text-fg hover:bg-bg-hover text-[11px] cursor-pointer"
                  title="Open Environment / Servers panel"
                >
                  <Server size={10} /> Servers
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
