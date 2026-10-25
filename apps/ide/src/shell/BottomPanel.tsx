import clsx from "clsx";
import { Plus, ScrollText, TerminalSquare, X } from "lucide-react";
import { useState } from "react";
import { useIde } from "@/store/ide";
import { Console } from "./Console";
import { XTerminal } from "./XTerminal";

type Tab = { kind: "console" } | { kind: "terminal"; id: string; title: string };

let termSeq = 0;

/**
 * Bottom panel with tabs, VS Code style:
 *   Console   the HardKas journal (everything the IDE runs through the CLI)
 *   Terminal  real shells (PowerShell / bash) in the project folder; "+" opens another
 */
export function BottomPanel() {
  const workspace = useIde((s) => s.workspace);
  const setTerminalOpen = useIde((s) => s.setTerminalOpen);
  const [terminals, setTerminals] = useState<Array<{ id: string; title: string }>>([]);
  const [active, setActive] = useState<Tab>({ kind: "console" });

  const addTerminal = () => {
    termSeq += 1;
    const t = { id: `t${termSeq}-${Date.now().toString(36)}`, title: `Terminal ${termSeq}` };
    setTerminals((list) => [...list, t]);
    setActive({ kind: "terminal", id: t.id, title: t.title });
  };
  const closeTerminal = (id: string) => {
    setTerminals((list) => {
      const next = list.filter((t) => t.id !== id);
      if (active.kind === "terminal" && active.id === id) {
        const last = next.at(-1);
        setActive(last ? { kind: "terminal", id: last.id, title: last.title } : { kind: "console" });
      }
      return next;
    });
  };

  return (
    <div className="h-full flex flex-col bg-bg border-t border-border">
      <div className="h-8 shrink-0 flex items-stretch border-b border-border bg-bg-panel text-[11px] select-none">
        <TabButton active={active.kind === "console"} onClick={() => setActive({ kind: "console" })} icon={<ScrollText size={13} />} label="Console" />
        {terminals.map((t) => (
          <TabButton
            key={t.id}
            active={active.kind === "terminal" && active.id === t.id}
            onClick={() => setActive({ kind: "terminal", id: t.id, title: t.title })}
            icon={<TerminalSquare size={13} />}
            label={t.title}
            onClose={() => closeTerminal(t.id)}
          />
        ))}
        <button onClick={addTerminal} className="px-2 text-fg-muted hover:text-fg flex items-center gap-1" title={`New terminal in ${workspace?.root ?? "the workspace"}`}>
          <Plus size={13} /> {terminals.length === 0 && <span>Terminal</span>}
        </button>
        <span className="ml-auto flex items-center pr-2 text-fg-muted">
          <button onClick={() => setTerminalOpen(false)} className="hover:text-fg" title="Hide panel">
            <X size={13} />
          </button>
        </span>
      </div>
      <div className="flex-1 min-h-0 relative">
        <div className="absolute inset-0" style={{ display: active.kind === "console" ? "block" : "none" }}>
          <Console />
        </div>
        {terminals.map((t) => (
          <div key={t.id} className="absolute inset-0" style={{ display: active.kind === "terminal" && active.id === t.id ? "block" : "none" }}>
            <XTerminal id={t.id} visible={active.kind === "terminal" && active.id === t.id} />
          </div>
        ))}
      </div>
    </div>
  );
}

function TabButton({ active, onClick, icon, label, onClose }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string; onClose?: () => void }) {
  return (
    <div
      onClick={onClick}
      className={clsx(
        "group flex items-center gap-1.5 px-3 cursor-pointer border-r border-border uppercase tracking-wider font-semibold",
        active ? "text-fg bg-bg border-b-2 border-b-accent" : "text-fg-muted hover:text-fg hover:bg-bg-hover"
      )}
    >
      {icon} {label}
      {onClose && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
          className="ml-1 opacity-0 group-hover:opacity-100 hover:text-error"
          title="Close terminal"
        >
          <X size={11} />
        </button>
      )}
    </div>
  );
}
