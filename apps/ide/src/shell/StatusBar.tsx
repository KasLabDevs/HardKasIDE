import { Cpu, Droplets, FolderOpen, ListTree, TerminalSquare } from "lucide-react";
import { useState } from "react";
import { useEngine } from "@/engine/context";
import type { EnvironmentPlugin } from "@/plugins/environment";
import { useEnv } from "@/store/env";
import { envOf, useIde } from "@/store/ide";

export function StatusBar() {
  const engine = useEngine();
  const workspace = useIde((s) => s.workspace);
  const target = useIde((s) => s.target);
  const activeFile = useIde((s) => s.activeFile);
  const status = useIde((s) => s.statusMessage);
  const terminalOpen = useIde((s) => s.terminalOpen);
  const setTerminalOpen = useIde((s) => s.setTerminalOpen);
  const outlineOpen = useIde((s) => s.outlineOpen);
  const setOutlineOpen = useIde((s) => s.setOutlineOpen);
  const accounts = useEnv((s) => s.accounts);
  const node = useEnv((s) => s.node);
  const [funding, setFunding] = useState(false);

  const quickFund = async () => {
    if (funding) return;
    const acct = accounts[0]?.name ?? "alice";
    setFunding(true);
    useIde.getState().setStatus(`Funding ${acct} with 100 KAS...`);
    try {
      await engine.get<EnvironmentPlugin>("environment").fund(acct, "100");
      useIde.getState().setStatus(`Funded ${acct} with 100 KAS!`);
    } catch (e) {
      useIde.getState().setStatus(`Funding failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setFunding(false);
    }
  };

  return (
    <footer className="h-6 shrink-0 bg-bg-panel border-t border-border flex items-center gap-3 px-3 text-[11px] text-fg-muted select-none overflow-hidden">
      <span className="flex items-center gap-1.5 text-fg shrink-0 max-w-[180px] truncate" title={workspace?.root ?? ""}>
        <FolderOpen size={12} className="shrink-0" /> <span className="truncate">{workspace?.name ?? "no workspace"}</span>
      </span>
      <span className="flex items-center gap-1.5 shrink-0 whitespace-nowrap">
        <Cpu size={12} /> env: <span className="text-accent font-medium">{envOf(target).short}</span> <span className="text-fg-muted">({envOf(target).networkId})</span>
      </span>
      {target === "localnet" && (
        <button
          type="button"
          onClick={() => void quickFund()}
          disabled={funding || !node?.rpcReady}
          className="flex items-center gap-1 text-accent hover:text-fg shrink-0 cursor-pointer rounded px-1.5 py-0.5 hover:bg-bg-hover transition-colors border border-accent/20 bg-accent/5 disabled:opacity-50 disabled:cursor-not-allowed"
          title={node?.rpcReady ? `Fund ${accounts[0]?.name ?? "alice"} with 100 KAS on simnet (hardkas localnet fund)` : "Start the local node to fund accounts"}
        >
          <Droplets size={11} className={funding ? "animate-bounce text-accent" : ""} />
          <span>{funding ? "Funding…" : "Airdrop +100 KAS"}</span>
        </button>
      )}
      {activeFile && (
        <span className="truncate min-w-0 max-w-[260px] font-mono text-[10px]" title={activeFile}>
          {activeFile}
        </span>
      )}
      <span role="status" aria-live="polite" className="ml-auto truncate min-w-0 max-w-[360px]" title={status}>
        {status}
      </span>
      <button type="button" onClick={() => setTerminalOpen(!terminalOpen)} className="flex items-center gap-1 hover:text-fg shrink-0 cursor-pointer rounded px-1 hover:bg-bg-hover transition-colors" title="Toggle console / terminal">
        <TerminalSquare size={12} /> {terminalOpen ? "hide" : "show"} console
      </button>
      <button type="button" onClick={() => setOutlineOpen(!outlineOpen)} className="flex items-center gap-1 hover:text-fg shrink-0 cursor-pointer rounded px-1 hover:bg-bg-hover transition-colors" title="Toggle outline">
        <ListTree size={12} /> {outlineOpen ? "hide" : "show"} outline
      </button>
      <span className="shrink-0 hidden sm:inline tabular-nums">HardKas IDE {__APP_VERSION__} · CLI 0.12.0-rc.29</span>
    </footer>
  );
}
