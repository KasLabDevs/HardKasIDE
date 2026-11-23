import clsx from "clsx";
import { AlertCircle, ExternalLink, Pencil, Plus, RotateCw, ScrollText, Search, Square, TerminalSquare, Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useDiagnostics } from "@/store/diagnostics";
import { useIde } from "@/store/ide";
import { useScripts, type TerminalTab } from "@/store/scripts";
import { useSearch } from "@/store/search";
import { portOfUrl } from "@/utils/scriptUrls";
import { Console } from "./Console";
import { ProblemsPanel } from "./ProblemsPanel";
import { SearchResultsView } from "./SearchResultsView";
import { XTerminal } from "./XTerminal";

/**
 * Bottom panel with tabs, VS Code style:
 *   Console   the HardKas journal (everything the IDE runs through the CLI)
 *   Search    project-wide workspace search results
 *   Terminal  real PTY shells and package.json script tabs with Play/Stop and localhost links.
 */
export function BottomPanel() {
  const workspace = useIde((s) => s.workspace);
  const setTerminalOpen = useIde((s) => s.setTerminalOpen);
  const pendingTerminal = useIde((s) => s.pendingTerminal);
  const bottomSearchOpen = useSearch((s) => s.bottomSearchOpen);
  const revealBottomSeq = useSearch((s) => s.revealBottomSeq);
  const closeBottomSearch = useSearch((s) => s.closeBottomSearch);
  const totalSearchMatches = useSearch((s) => s.totalMatches);
  const diagTotals = useDiagnostics((s) => s.totals);

  const terminals = useScripts((s) => s.terminals);
  const active = useScripts((s) => s.activeBottomTab);
  const setActive = useScripts((s) => s.setActiveBottomTab);
  const openShellTerminal = useScripts((s) => s.openShellTerminal);
  const restartTerminal = useScripts((s) => s.restartTerminal);
  const stopTerminal = useScripts((s) => s.stopTerminal);
  const closeTerminalTab = useScripts((s) => s.closeTerminalTab);
  const renameTerminalTab = useScripts((s) => s.renameTerminalTab);

  const [renaming, setRenaming] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  // "Terminal → New terminal" in the title bar: open one as soon as this panel is on screen.
  useEffect(() => {
    if (!useIde.getState().pendingTerminal) return;
    useIde.getState().clearTerminalRequest();
    openShellTerminal();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingTerminal]);

  useEffect(() => {
    if (revealBottomSeq > 0 && useSearch.getState().bottomSearchOpen) {
      setActive({ kind: "search" });
    }
  }, [revealBottomSeq, setActive]);

  useEffect(() => {
    if (!bottomSearchOpen && active.kind === "search") {
      const last = terminals.at(-1);
      setActive(last ? { kind: "terminal", id: last.id } : { kind: "console" });
    }
  }, [bottomSearchOpen, active.kind, terminals, setActive]);

  const startRename = (t: TerminalTab) => {
    setRenaming(t.id);
    setDraft(t.title);
  };
  const commitRename = () => {
    if (renaming) renameTerminalTab(renaming, draft);
    setRenaming(null);
  };

  const activeTerminal = active.kind === "terminal" ? terminals.find((t) => t.id === active.id) : undefined;

  return (
    <div className="h-full flex flex-col bg-bg panel-card">
      <div role="tablist" aria-label="Bottom panel tabs" className="h-[26px] shrink-0 flex items-stretch border-b border-border bg-bg-panel text-[12px] select-none overflow-x-auto">
        <TabButton active={active.kind === "console"} onClick={() => setActive({ kind: "console" })} icon={<ScrollText size={13} />} label="Console" />
        <TabButton
          active={active.kind === "problems"}
          onClick={() => setActive({ kind: "problems" })}
          icon={<AlertCircle size={13} className={diagTotals.errors > 0 ? "text-error" : diagTotals.warnings > 0 ? "text-warn" : undefined} />}
          label={
            diagTotals.errors + diagTotals.warnings > 0
              ? `Problems (${diagTotals.errors > 0 ? `${diagTotals.errors}E` : ""}${diagTotals.errors > 0 && diagTotals.warnings > 0 ? " · " : ""}${diagTotals.warnings > 0 ? `${diagTotals.warnings}W` : ""})`
              : "Problems"
          }
        />
        {bottomSearchOpen && (
          <TabButton
            active={active.kind === "search"}
            onClick={() => setActive({ kind: "search" })}
            onClose={closeBottomSearch}
            closeTitle="Close Search tab"
            icon={<Search size={13} />}
            label={totalSearchMatches > 0 ? `Search (${totalSearchMatches})` : "Search"}
          />
        )}
        <TabButton
          active={active.kind === "terminal"}
          onClick={() => (terminals.length ? setActive({ kind: "terminal", id: activeTerminal?.id ?? terminals[0].id }) : openShellTerminal())}
          icon={<TerminalSquare size={13} />}
          label={activeTerminal ? `Terminal · ${activeTerminal.title}` : "Terminal"}
        />
        <button
          type="button"
          onClick={() => openShellTerminal()}
          className="px-2 text-fg-muted hover:text-fg flex items-center gap-1 cursor-pointer hover:bg-bg-hover transition-colors"
          title={`New terminal in ${workspace?.root ?? "the workspace"}`}
          aria-label="New terminal"
        >
          <Plus size={13} />
        </button>

        {active.kind === "terminal" && activeTerminal && (
          <div className="flex items-center gap-1.5 px-2 border-l border-border min-w-0">
            {activeTerminal.scriptRun && (
              <>
                <StatusPill tab={activeTerminal} />
                {activeTerminal.status === "running" ? (
                  <button
                    type="button"
                    onClick={() => void stopTerminal(activeTerminal.id)}
                    className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-error/15 text-error hover:bg-error/25 cursor-pointer whitespace-nowrap"
                    title={`Stop ${activeTerminal.scriptRun.commandLine}`}
                  >
                    <Square size={10} className="fill-current" /> Stop
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => void restartTerminal(activeTerminal.id)}
                    className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-bg-hover text-fg hover:text-accent cursor-pointer whitespace-nowrap"
                    title={`Re-run ${activeTerminal.scriptRun.commandLine}`}
                  >
                    <RotateCw size={11} /> Re-run
                  </button>
                )}
              </>
            )}
            {activeTerminal.urls.map((url) => {
              const port = portOfUrl(url);
              return (
                <a
                  key={url}
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-accent/15 text-accent hover:bg-accent/25 whitespace-nowrap"
                  title={`Open ${url} in browser`}
                >
                  <ExternalLink size={10} /> {port ? `:${port}` : url}
                </a>
              );
            })}
          </div>
        )}

        <span className="ml-auto flex items-center gap-2 pr-2 text-fg-muted tabular-nums shrink-0">
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
          <div className="absolute inset-0" style={{ display: active.kind === "problems" ? "block" : "none" }}>
            <ProblemsPanel />
          </div>
          {bottomSearchOpen && (
            <div className="absolute inset-0" style={{ display: active.kind === "search" ? "block" : "none" }}>
              <SearchResultsView />
            </div>
          )}
          {terminals.map((t) => (
            <div key={t.id} className="absolute inset-0" style={{ display: active.kind === "terminal" && active.id === t.id ? "block" : "none" }}>
              <XTerminal tab={t} visible={active.kind === "terminal" && active.id === t.id} />
            </div>
          ))}
        </div>

        {active.kind === "terminal" && terminals.length > 0 && (
          <aside className="w-48 shrink-0 border-l border-border bg-bg-panel text-[12px] overflow-auto">
            <div className="flex items-center justify-between px-2 py-1 text-fg-muted uppercase tracking-wider text-[12px]">
              <span>Terminals</span>
              <button type="button" onClick={() => openShellTerminal()} className="p-0.5 rounded hover:text-fg hover:bg-bg-hover cursor-pointer" title="New terminal" aria-label="New terminal">
                <Plus size={12} />
              </button>
            </div>
            <ul>
              {terminals.map((t, i) => {
                const isActive = active.kind === "terminal" && active.id === t.id;
                const firstUrl = t.urls[0];
                const port = firstUrl ? portOfUrl(firstUrl) : null;
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
                    <TerminalDot tab={t} isActive={isActive} />
                    {renaming === t.id ? (
                      <input
                        autoFocus
                        aria-label="Rename terminal"
                        className="input py-0 px-1 text-[12px]"
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
                      <span className="truncate flex-1 tabular-nums" title={t.scriptRun?.commandLine ?? t.title}>
                        {i + 1}: {t.title}
                      </span>
                    )}
                    {port && (
                      <a
                        href={firstUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="shrink-0 text-[11px] font-mono text-accent hover:underline"
                        title={`Open ${firstUrl}`}
                      >
                        :{port}
                      </a>
                    )}
                    {t.scriptRun && t.status === "running" && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          void stopTerminal(t.id);
                        }}
                        className="opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus:opacity-100 text-error p-0.5 rounded cursor-pointer"
                        title="Stop script"
                        aria-label={`Stop ${t.title}`}
                      >
                        <Square size={10} className="fill-current" />
                      </button>
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
                        closeTerminalTab(t.id);
                      }}
                      className="opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus:opacity-100 hover:text-error p-0.5 rounded cursor-pointer"
                      title="Close terminal"
                      aria-label={`Close ${t.title}`}
                    >
                      <Trash2 size={11} />
                    </button>
                  </li>
                );
              })}
            </ul>
            <div className="px-2 py-1 text-[12px] text-fg-muted">double-click or F2 to rename</div>
          </aside>
        )}
      </div>
    </div>
  );
}

function StatusPill({ tab }: { tab: TerminalTab }) {
  if (tab.status === "running") {
    return (
      <span className="inline-flex items-center gap-1 text-ok whitespace-nowrap">
        <span className="w-1.5 h-1.5 rounded-full bg-ok animate-pulse" /> running
      </span>
    );
  }
  if (tab.status === "stopped") {
    return <span className="text-fg-muted whitespace-nowrap">stopped</span>;
  }
  if (tab.status === "succeeded") {
    return <span className="text-ok whitespace-nowrap">exited 0</span>;
  }
  return <span className="text-error whitespace-nowrap">exit {tab.exitCode ?? 1}</span>;
}

function TerminalDot({ tab, isActive }: { tab: TerminalTab; isActive: boolean }) {
  if (!tab.scriptRun) {
    return <TerminalSquare size={12} className={clsx("shrink-0", isActive ? "text-accent" : "")} />;
  }
  const color =
    tab.status === "running"
      ? "bg-ok animate-pulse"
      : tab.status === "succeeded"
        ? "bg-ok"
        : tab.status === "failed"
          ? "bg-error"
          : "bg-fg-muted";
  return <span className={clsx("w-2 h-2 rounded-full shrink-0", color)} />;
}

function TabButton({
  active,
  onClick,
  onClose,
  closeTitle,
  icon,
  label
}: {
  active: boolean;
  onClick: () => void;
  onClose?: () => void;
  closeTitle?: string;
  icon: React.ReactNode;
  label: string;
}) {
  const baseClass = clsx(
    "flex items-center gap-1.5 px-2.5 cursor-pointer border-r border-border uppercase tracking-wider font-semibold whitespace-nowrap outline-none focus-visible:ring-1 focus-visible:ring-accent",
    active ? "text-fg bg-bg border-b-2 border-b-accent" : "text-fg-muted hover:text-fg hover:bg-bg-hover"
  );
  if (!onClose) {
    return (
      <button type="button" role="tab" aria-selected={active} onClick={onClick} className={baseClass}>
        {icon} {label}
      </button>
    );
  }
  return (
    <div
      role="tab"
      tabIndex={0}
      aria-selected={active}
      onClick={onClick}
      onMouseDown={(e) => {
        if (e.button === 1) {
          e.preventDefault();
          onClose();
        }
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
      className={clsx(baseClass, "pr-1.5")}
    >
      {icon}
      <span>{label}</span>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        title={closeTitle ?? `Close ${label}`}
        aria-label={closeTitle ?? `Close ${label}`}
        className="ml-0.5 p-0.5 rounded text-fg-muted hover:text-fg hover:bg-bg-hover cursor-pointer"
      >
        <X size={11} />
      </button>
    </div>
  );
}
