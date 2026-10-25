import { Cpu, FolderOpen, ListTree, TerminalSquare } from "lucide-react";
import { useIde } from "@/store/ide";

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
    <footer className="h-6 shrink-0 bg-bg-panel border-t border-border flex items-center gap-4 px-3 text-[11px] text-fg-muted select-none">
      <span className="flex items-center gap-1.5 text-fg" title={workspace?.root ?? ""}>
        <FolderOpen size={12} /> {workspace?.name ?? "no workspace"}
      </span>
      <span className="flex items-center gap-1.5">
        <Cpu size={12} /> target: <span className="text-accent">{target}</span>
      </span>
      {activeFile && <span className="truncate">{activeFile}</span>}
      <span className="ml-auto truncate">{status}</span>
      <button onClick={() => setTerminalOpen(!terminalOpen)} className="flex items-center gap-1 hover:text-fg" title="Toggle console / terminal">
        <TerminalSquare size={12} /> {terminalOpen ? "hide" : "show"} console
      </button>
      <button onClick={() => setOutlineOpen(!outlineOpen)} className="flex items-center gap-1 hover:text-fg" title="Toggle outline">
        <ListTree size={12} /> {outlineOpen ? "hide" : "show"} outline
      </button>
      <span>HardKas IDE 0.1 · CLI 0.12.0-rc.29</span>
    </footer>
  );
}
