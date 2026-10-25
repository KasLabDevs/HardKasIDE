import clsx from "clsx";
import { Pencil, Plus, ScrollText, TerminalSquare, Trash2, X } from "lucide-react";
import { useState } from "react";
import { useIde } from "@/store/ide";
import { Console } from "./Console";
import { XTerminal } from "./XTerminal";

type Tab = { kind: "console" } | { kind: "terminal"; id: string };

interface TerminalEntry {
  id: string;
  title: string;
}

let termSeq = 0;

/**
 * Bottom panel with tabs, VS Code style:
 *   Console   the HardKas journal (everything the IDE runs through the CLI)
 *   Terminal  real shells in the project folder. A list on the right (like VS Code's)
 *             lets you create, rename, select and kill them.
 */
export function BottomPanel() {
  const workspace = useIde((s) => s.workspace);
  const setTerminalOpen = useIde((s) => s.setTerminalOpen);
  const [terminals, setTerminals] = useState<TerminalEntry[]>([]);
  const [active, setActive] = useState<Tab>({ kind: "console" });
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  const addTerminal = () => {
    termSeq += 1;
    const t: TerminalEntry = { id: `t${termSeq}-${Date.now().toString(36)}`, title: `powershell ${termSeq}` };
    setTerminals((list) => [...list, t]);
    setActive({ kind: "terminal", id: t.id });
  };
  const killTerminal = (id: string) => {
    setTerminals((list) => {
      const next = list.filter((t) => t.id !== id);
      if (active.kind === "terminal" && active.id === id) {
        const last = next.at(-1);
        setActive(last ? { kind: "terminal", id: last.id } : { kind: "console" });
      }
      return next;
    });
  };
  const startRename = (t: TerminalEntry) => {
    setRenaming(t.id);
    setDraft(t.title);
  };
  const commitRename = () => {
    if (renaming) setTerminals((list) => list.map((t) => (t.id === renaming ? { ...t, title: draft.trim() || t.title } : t)));
    setRenaming(null);
  };

  const activeTerminal = active.kind === "terminal" ? terminals.find((t) => t.id === active.id) : undefined;

  return (
    <div className="h-full flex flex-col bg-bg border-t border-border">
      <div className="h-8 shrink-0 flex items-stretch border-b border-border bg-bg-panel text-[11px] select-none">
        <TabButton active={active.kind === "console"} onClick={() => setActive({ kind: "console" })} icon={<ScrollText size={13} />} label="Console" />
        <TabButton
          active={active.kind === "terminal"}
          onClick={() => (terminals.length ? setActive({ kind: "terminal", id: activeTerminal?.id ?? terminals[0].id }) : addTerminal())}
          icon={<TerminalSquare size={13} />}
          label={activeTerminal ? `Terminal · ${activeTerminal.title}` : "Terminal"}
        />
        <button onClick={addTerminal} className="px-2 text-fg-muted hover:text-fg flex items-center gap-1" title={`New terminal in ${workspace?.root ?? "the workspace"}`}>
          <Plus size={13} />
        </button>
        <span className="ml-auto flex items-center gap-2 pr-2 text-fg-muted">
          {terminals.length > 0 && <span>{terminals.length} terminal{terminals.length === 1 ? "" : "s"}</span>}
          <button onClick={() => setTerminalOpen(false)} className="hover:text-fg" title="Hide panel">
            <X size={13} />
          </button>
        </span>
      </div>
      <div className="flex-1 min-h-0 flex">
        <div className="flex-1 min-w-0 relative">
          <div className="absolute inset-0" style={{ display: active.kind === "console" ? "block" : "none" }}>
            <Console />
          </div>
          {terminals.map((t) => (
            <div key={t.id} className="absolute inset-0" style={{ display: active.kind === "terminal" && active.id === t.id ? "block" : "none" }}>
              <XTerminal id={t.id} visible={active.kind === "terminal" && active.id === t.id} onExit={killTerminal} />
            </div>
          ))}
        </div>
        {active.kind === "terminal" && terminals.length > 0 && (
          <aside className="w-44 shrink-0 border-l border-border bg-bg-panel text-[11px] overflow-auto">
            <div className="flex items-center justify-between px-2 py-1 text-fg-muted uppercase tracking-wider text-[10px]">
              <span>Terminals</span>
              <button onClick={addTerminal} className="hover:text-fg" title="New terminal">
                <Plus size={12} />
              </button>
            </div>
            <ul>
              {terminals.map((t, i) => {
                const isActive = active.kind === "terminal" && active.id === t.id;
                return (
                  <li
                    key={t.id}
                    onClick={() => setActive({ kind: "terminal", id: t.id })}
                    onDoubleClick={() => startRename(t)}
                    className={clsx("group flex items-center gap-1.5 px-2 py-1 cursor-pointer", isActive ? "bg-bg-hover text-fg" : "text-fg-muted hover:text-fg hover:bg-bg-hover")}
                  >
                    <TerminalSquare size={12} className={isActive ? "text-accent" : ""} />
                    {renaming === t.id ? (
                      <input
                        autoFocus
                        className="input py-0 px-1 text-[11px]"
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        onBlur={commitRename}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") commitRename();
                          if (e.key === "Escape") setRenaming(null);
                        }}
                        onClick={(e) => e.stopPropagation()}
                      />
                    ) : (
                      <span className="truncate flex-1">
                        {i + 1}: {t.title}
                      </span>
                    )}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        startRename(t);
                      }}
                      className="opacity-0 group-hover:opacity-100 hover:text-fg"
                      title="Rename"
                    >
                      <Pencil size={11} />
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        killTerminal(t.id);
                      }}
                      className="opacity-0 group-hover:opacity-100 hover:text-error"
                      title="Kill terminal"
                    >
                      <Trash2 size={11} />
                    </button>
                  </li>
                );
              })}
            </ul>
            <div className="px-2 py-1 text-[10px] text-fg-muted">double-click to rename</div>
          </aside>
        )}
      </div>
    </div>
  );
}

function TabButton({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <div
      onClick={onClick}
      className={clsx(
        "flex items-center gap-1.5 px-3 cursor-pointer border-r border-border uppercase tracking-wider font-semibold whitespace-nowrap",
        active ? "text-fg bg-bg border-b-2 border-b-accent" : "text-fg-muted hover:text-fg hover:bg-bg-hover"
      )}
    >
      {icon} {label}
    </div>
  );
}
