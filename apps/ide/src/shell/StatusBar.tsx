import { Cpu, FolderOpen, ListTree, TerminalSquare } from "lucide-react";
import { envOf, useIde } from "@/store/ide";

export function StatusBar() {
  const workspace = useIde((s) => s.workspace);
  const target = useIde((s) => s.target);
  const activeFile = useIde((s) => s.activeFile);
  const status = useIde((s) => s.statusMessage);
  const terminalOpen = useIde((s) => s.terminalOpen);
  const setTerminalOpen = useIde((s) => s.setTerminalOpen);
  const outlineOpen = useIde((s) => s.outlineOpen);
  const setOutlineOpen = useIde((s) => s.setOutlineOpen);

  return (
    <footer className="h-6 shrink-0 bg-bg-panel border-t border-border flex items-center gap-3 px-3 text-[11px] text-fg-muted select-none overflow-hidden">
      <span className="flex items-center gap-1.5 text-fg shrink-0 max-w-[180px] truncate" title={workspace?.root ?? ""}>
        <FolderOpen size={12} className="shrink-0" /> <span className="truncate">{workspace?.name ?? "no workspace"}</span>
      </span>
      <span className="flex items-center gap-1.5 shrink-0 whitespace-nowrap">
        <Cpu size={12} /> env: <span className="text-accent font-medium">{envOf(target).short}</span> <span className="text-fg-muted">({envOf(target).networkId})</span>
      </span>
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
      <span className="shrink-0 hidden sm:inline tabular-nums">HardKas IDE 0.1 · CLI 0.12.0-rc.29</span>
    </footer>
  );
}
