import clsx from "clsx";
import { Database, FilePlus2, FlaskConical, GitBranch, Rocket, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { FileIcon } from "@/components/FileIcon";
import { Editor } from "@/editor/Editor";
import { useEngine, useEngineVersion } from "@/engine/context";
import { useIde, VIEW_PREFIX, type OpenFile } from "@/store/ide";
import { confirmDialog } from "@/utils/dialog";
import { openDetachedWindow } from "@/utils/detach";
import { ErrorBoundary } from "./ErrorBoundary";
import { Breadcrumbs } from "./Breadcrumbs";
import { DockControls } from "./DockControls";
import { HardKasMark } from "./Logo";

interface TabMenuState {
  x: number;
  y: number;
  path: string;
}

/** Tabs + content: files open in the Monaco editor, "view:<plugin>" tabs render a main-panel plugin view. */
export function MainArea() {
  const engine = useEngine();
  useEngineVersion();
  const openFiles = useIde((s) => s.openFiles);
  const activeFile = useIde((s) => s.activeFile);
  const closeFiles = useIde((s) => s.closeFiles);
  const setActiveFile = useIde((s) => s.setActiveFile);
  const setActiveSidePlugin = useIde((s) => s.setActiveSidePlugin);
  const [tabMenu, setTabMenu] = useState<TabMenuState | null>(null);

  const active = openFiles.find((f) => f.path === activeFile);
  const viewName = active?.kind === "view" ? active.path.slice(VIEW_PREFIX.length) : null;
  const activeView = viewName && engine.has(viewName) ? engine.get(viewName) : null;
  const View = activeView?.view;
  const isEmpty = openFiles.length === 0;

  const closeTabsWithConfirm = useCallback(
    async (paths: string[], preferredActive?: string) => {
      if (paths.length === 0) return;
      const targets = useIde.getState().openFiles.filter((f) => paths.includes(f.path));
      const dirty = targets.filter((f) => f.kind !== "view" && f.content !== f.savedContent);
      if (dirty.length === 1) {
        const ok = await confirmDialog(`Discard unsaved changes in ${dirty[0].path}?`, {
          title: "Unsaved changes",
          confirmLabel: "Discard",
          danger: true
        });
        if (!ok) return;
      } else if (dirty.length > 1) {
        const list = dirty.map((d) => `• ${d.path}`).join("\n");
        const ok = await confirmDialog(`Discard unsaved changes in ${dirty.length} files?\n\n${list}`, {
          title: "Unsaved changes",
          confirmLabel: "Discard all",
          danger: true
        });
        if (!ok) return;
      }
      closeFiles(paths, preferredActive);
    },
    [closeFiles]
  );

  const detachTab = useCallback(
    (file: OpenFile) => {
      const opened = openDetachedWindow(file);
      if (opened) {
        closeFiles([file.path]);
      } else {
        useIde.getState().setStatus("Popup blocked: allow popups for this site to detach the tab.");
      }
    },
    [closeFiles]
  );

  return (
    <div className="h-full flex flex-col min-w-0 bg-bg panel-card">
      {!isEmpty && (
        <div role="tablist" aria-label="Open files" className="h-[1.8rem] shrink-0 flex items-end px-1 gap-0.5 border-b border-border bg-bg-panel overflow-x-auto">
          {openFiles.map((f) => {
            const isView = f.kind === "view";
            const dirty = !isView && f.content !== f.savedContent;
            const isActive = f.path === activeFile;
            const label = isView ? (f.title ?? f.path) : f.path.split("/").pop();
            const selectTab = () => (isView ? setActiveFile(f.path) : void engine.call("fileManager", "open", f.path));
            const handleClose = (e: React.MouseEvent) => {
              e.stopPropagation();
              void closeTabsWithConfirm([f.path]);
            };
            return (
              <div
                key={f.path}
                role="tab"
                tabIndex={0}
                aria-selected={isActive}
                onClick={selectTab}
                onMouseDown={(e) => {
                  if (e.button === 1) {
                    e.preventDefault();
                    void closeTabsWithConfirm([f.path]);
                  }
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setTabMenu({ x: e.clientX, y: e.clientY, path: f.path });
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    selectTab();
                  }
                }}
                className={clsx(
                  "group h-[calc(100%-3px)] flex items-center gap-1.5 pl-2 pr-1 text-[12px] rounded-t-[5px] border-t border-x cursor-pointer select-none whitespace-nowrap outline-none focus-visible:ring-1 focus-visible:ring-accent max-w-[220px]",
                  isActive
                    ? "bg-bg text-fg border-border border-t-accent relative z-10 -mb-px pb-px"
                    : "text-fg-muted border-transparent hover:text-fg hover:bg-bg-hover/70"
                )}
                title={f.path}
              >
                {isView ? (() => {
                  const ViewIcon = engine.has(f.path.slice(VIEW_PREFIX.length)) ? engine.get(f.path.slice(VIEW_PREFIX.length)).profile.icon : undefined;
                  return ViewIcon ? <ViewIcon size={12} className="text-accent shrink-0" /> : <GitBranch size={12} className="text-accent shrink-0" />;
                })() : (
                  <FileIcon name={f.path} size={13} />
                )}
                <span className="truncate leading-[1.4]">{label}</span>
                {dirty && <span className="w-1.5 h-1.5 rounded-full bg-warn shrink-0" title="Unsaved changes" aria-label="Unsaved changes" />}
                <button
                  type="button"
                  onClick={handleClose}
                  className="opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus:opacity-100 text-fg-muted hover:text-fg shrink-0 rounded p-0.5 cursor-pointer"
                  title={`Close ${label}`}
                  aria-label={`Close ${label}`}
                >
                  <X size={11} />
                </button>
              </div>
            );
          })}
          {viewName && activeView && (
            <div className="ml-auto self-stretch flex items-center gap-1.5 px-2.5 border-l border-border bg-bg-panel shrink-0 select-none">
              <span className="text-[10px] text-fg-muted uppercase tracking-wider">Position:</span>
              <DockControls pluginName={viewName} displayName={activeView.profile.displayName} />
            </div>
          )}
        </div>
      )}

      {tabMenu && (
        <TabContextMenu
          menu={tabMenu}
          openFiles={openFiles}
          onCloseMenu={() => setTabMenu(null)}
          onClosePaths={closeTabsWithConfirm}
          onDetach={detachTab}
        />
      )}
      {!View && !isEmpty && active && active.kind !== "view" && <Breadcrumbs file={active} />}
      <div className="flex-1 min-h-0 relative">
        {/* The editor stays mounted (and hidden) while a view tab or empty state is active, so Monaco keeps its models. */}
        <div className="absolute inset-0" style={{ display: View || isEmpty ? "none" : "block" }}>
          <ErrorBoundary name="Editor">
            <Editor />
          </ErrorBoundary>
        </div>
        {isEmpty && (
          <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center select-none">
            <div className="opacity-30 mb-3">
              <HardKasMark size={44} />
            </div>
            <div className="text-sm font-semibold text-fg">No open files</div>
            <p className="text-xs text-fg-muted mt-1 max-w-sm">
              Pick a file from the Explorer on the left, or use a shortcut below to jump right in.
            </p>
            <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
              <button type="button" className="btn-ghost" onClick={() => setActiveSidePlugin("files")}>
                <FilePlus2 size={13} /> Open Explorer
              </button>
              <button type="button" className="btn-ghost" onClick={() => setActiveSidePlugin("deployRun")}>
                <Rocket size={13} /> Deploy &amp; Run
              </button>
              <button type="button" className="btn-ghost" onClick={() => void engine.call("lineage", "open")}>
                <GitBranch size={13} /> Lineage Graph
              </button>
              <button type="button" className="btn-ghost" onClick={() => void engine.call("queryIndex", "open")}>
                <Database size={13} /> Index
              </button>
              <button type="button" className="btn-ghost" onClick={() => void engine.call("tests", "open")}>
                <FlaskConical size={13} /> Tests
              </button>
            </div>
            <div className="mt-4 text-[11px] text-fg-muted flex items-center gap-4">
              <span>
                Command Palette <kbd className="border border-border rounded px-1.5 py-0.5 text-[10px] bg-bg-elev">Ctrl+K</kbd>
              </span>
              <span>
                Compile .sil <kbd className="border border-border rounded px-1.5 py-0.5 text-[10px] bg-bg-elev">Ctrl+Enter</kbd>
              </span>
            </div>
          </div>
        )}
        {View && (
          <div className="absolute inset-0">
            <ErrorBoundary name={activeView?.profile.displayName ?? "View"}>
              <View />
            </ErrorBoundary>
          </div>
        )}
      </div>
    </div>
  );
}

interface TabContextMenuProps {
  menu: TabMenuState;
  openFiles: OpenFile[];
  onCloseMenu: () => void;
  onClosePaths: (paths: string[], preferredActive?: string) => Promise<void>;
  onDetach: (file: OpenFile) => void;
}

type TabMenuItem =
  | "sep"
  | { id: string; label: string; disabled?: boolean; onSelect: () => void };

function TabContextMenu({ menu, openFiles, onCloseMenu, onClosePaths, onDetach }: TabContextMenuProps) {
  const menuRef = useRef<HTMLUListElement | null>(null);

  useEffect(() => {
    const onPointerDown = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) onCloseMenu();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCloseMenu();
    };
    window.addEventListener("mousedown", onPointerDown, true);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("blur", onCloseMenu);
    return () => {
      window.removeEventListener("mousedown", onPointerDown, true);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("blur", onCloseMenu);
    };
  }, [onCloseMenu]);

  const idx = openFiles.findIndex((f) => f.path === menu.path);
  if (idx === -1) return null;

  const target = openFiles[idx];
  const leftPaths = openFiles.slice(0, idx).map((f) => f.path);
  const rightPaths = openFiles.slice(idx + 1).map((f) => f.path);
  const otherPaths = openFiles.filter((f) => f.path !== target.path).map((f) => f.path);
  const allPaths = openFiles.map((f) => f.path);

  const items: TabMenuItem[] = [
    {
      id: "close",
      label: "Close",
      onSelect: () => void onClosePaths([target.path])
    },
    {
      id: "close-others",
      label: "Close Others",
      disabled: otherPaths.length === 0,
      onSelect: () => void onClosePaths(otherPaths, target.path)
    },
    {
      id: "close-left",
      label: "Close Tabs to the Left",
      disabled: leftPaths.length === 0,
      onSelect: () => void onClosePaths(leftPaths, target.path)
    },
    {
      id: "close-right",
      label: "Close Tabs to the Right",
      disabled: rightPaths.length === 0,
      onSelect: () => void onClosePaths(rightPaths, target.path)
    },
    "sep",
    {
      id: "close-all",
      label: "Close All",
      disabled: allPaths.length === 0,
      onSelect: () => void onClosePaths(allPaths)
    },
    "sep",
    {
      id: "detach",
      label: "Detach",
      onSelect: () => onDetach(target)
    }
  ];

  const menuWidth = 208;
  const menuHeight = 220;
  const left = Math.min(menu.x, Math.max(8, window.innerWidth - menuWidth - 8));
  const top = Math.min(menu.y, Math.max(8, window.innerHeight - menuHeight - 8));
  const label = target.kind === "view" ? (target.title ?? target.path) : (target.path.split("/").pop() ?? target.path);

  return (
    <ul
      ref={menuRef}
      role="menu"
      aria-label={`Tab actions for ${label}`}
      className="fixed z-50 w-52 rounded border border-border bg-bg-elev shadow-2xl py-1 text-xs select-none"
      style={{ left, top }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((item, i) =>
        item === "sep" ? (
          <li key={`sep-${i}`} role="separator" className="my-1 border-t border-border" />
        ) : (
          <li key={item.id} role="none">
            <button
              type="button"
              role="menuitem"
              disabled={item.disabled}
              onClick={() => {
                if (item.disabled) return;
                onCloseMenu();
                item.onSelect();
              }}
              className={clsx(
                "w-full text-left px-3 py-1.5 flex items-center justify-between transition-colors",
                item.disabled
                  ? "text-fg-muted/45 cursor-default"
                  : "text-fg hover:bg-bg-hover cursor-pointer"
              )}
            >
              <span>{item.label}</span>
            </button>
          </li>
        )
      )}
    </ul>
  );
}
