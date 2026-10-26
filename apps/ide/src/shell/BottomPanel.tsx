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
      <div role="tablist" aria-label="Bottom panel tabs" className="h-8 shrink-0 flex items-stretch border-b border-border bg-bg-panel text-[11px] select-none">
        <TabButton active={active.kind === "console"} onClick={() => setActive({ kind: "console" })} icon={<ScrollText size={13} />} label="Console" />
        <TabButton
          active={active.kind === "terminal"}
          onClick={() => (terminals.length ? setActive({ kind: "terminal", id: activeTerminal?.id ?? terminals[0].id }) : addTerminal())}
          icon={<TerminalSquare size={13} />}
          label={activeTerminal ? `Terminal · ${activeTerminal.title}` : "Terminal"}
        />
        <button
          type="button"
          onClick={addTerminal}
          className="px-2 text-fg-muted hover:text-fg flex items-center gap-1 cursor-pointer hover:bg-bg-hover transition-colors"
          title={`New terminal in ${workspace?.root ?? "the workspace"}`}
          aria-label="New terminal"
        >
          <Plus size={13} />
        </button>
        <span className="ml-auto flex items-center gap-2 pr-2 text-fg-muted tabular-nums">
          {terminals.length > 0 && <span>{terminals.length} terminal{terminals.length === 1 ? "" : "s"}</span>}
          <button type="button" onClick={() => setTerminalOpen(false)} className="p-1 rounded hover:text-fg hover:bg-bg-hover cursor-pointer" title="Hide panel" aria-label="Hide bottom panel">
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
              <button type="button" onClick={addTerminal} className="p-0.5 rounded hover:text-fg hover:bg-bg-hover cursor-pointer" title="New terminal" aria-label="New terminal">
                <Plus size={12} />
              </button>
            </div>
            <ul>
              {terminals.map((t, i) => {
                const isActive = active.kind === "terminal" && active.id === t.id;
                return (
                  <li
                    key={t.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => setActive({ kind: "terminal", id: t.id })}
                    onDoubleClick={() => startRename(t)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setActive({ kind: "terminal", id: t.id });
                      } else if (e.key === "F2") {
                        e.preventDefault();
                        startRename(t);
                      }
                    }}
                    className={clsx(
                      "group flex items-center gap-1.5 px-2 py-1 cursor-pointer outline-none",
                      isActive ? "bg-bg-hover text-fg" : "text-fg-muted hover:text-fg hover:bg-bg-hover"
                    )}
                  >
                    <TerminalSquare size={12} className={clsx("shrink-0", isActive ? "text-accent" : "")} />
                    {renaming === t.id ? (
                      <input
                        autoFocus
                        aria-label="Rename terminal"
                        className="input py-0 px-1 text-[11px]"
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        onBlur={commitRename}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") commitRename();
                          if (e.key === "Escape") setRenaming(null);
                          e.stopPropagation();
                        }}
                        onClick={(e) => e.stopPropagation()}
                      />
                    ) : (
                      <span className="truncate flex-1 tabular-nums">
                        {i + 1}: {t.title}
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        startRename(t);
                      }}
                      className="opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus:opacity-100 hover:text-fg p-0.5 rounded cursor-pointer"
                      title="Rename (F2)"
                      aria-label={`Rename ${t.title}`}
                    >
                      <Pencil size={11} />
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        killTerminal(t.id);
                      }}
                      className="opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus:opacity-100 hover:text-error p-0.5 rounded cursor-pointer"
                      title="Kill terminal"
                      aria-label={`Kill ${t.title}`}
                    >
                      <Trash2 size={11} />
                    </button>
                  </li>
                );
              })}
            </ul>
            <div className="px-2 py-1 text-[10px] text-fg-muted">double-click or F2 to rename</div>
          </aside>
        )}
      </div>
    </div>
  );
}

function TabButton({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={clsx(
        "flex items-center gap-1.5 px-3 cursor-pointer border-r border-border uppercase tracking-wider font-semibold whitespace-nowrap outline-none focus-visible:ring-1 focus-visible:ring-accent",
        active ? "text-fg bg-bg border-b-2 border-b-accent" : "text-fg-muted hover:text-fg hover:bg-bg-hover"
      )}
    >
      {icon} {label}
    </button>
  );
}
