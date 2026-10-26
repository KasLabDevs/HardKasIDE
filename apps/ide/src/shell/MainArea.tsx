import clsx from "clsx";
import { Database, FilePlus2, FlaskConical, GitBranch, Rocket, X } from "lucide-react";
import { Editor } from "@/editor/Editor";
import { useEngine, useEngineVersion } from "@/engine/context";
import { useIde, VIEW_PREFIX } from "@/store/ide";
import { ErrorBoundary } from "./ErrorBoundary";
import { HardKasMark } from "./Logo";

/** Tabs + content: files open in the Monaco editor, "view:<plugin>" tabs render a main-panel plugin view. */
export function MainArea() {
  const engine = useEngine();
  useEngineVersion();
  const openFiles = useIde((s) => s.openFiles);
  const activeFile = useIde((s) => s.activeFile);
  const closeFile = useIde((s) => s.closeFile);
  const setActiveFile = useIde((s) => s.setActiveFile);
  const setActiveSidePlugin = useIde((s) => s.setActiveSidePlugin);

  const active = openFiles.find((f) => f.path === activeFile);
  const viewName = active?.kind === "view" ? active.path.slice(VIEW_PREFIX.length) : null;
  const activeView = viewName && engine.has(viewName) ? engine.get(viewName) : null;
  const View = activeView?.view;
  const isEmpty = openFiles.length === 0;

  return (
    <div className="h-full flex flex-col min-w-0 bg-bg">
      <div role="tablist" aria-label="Open files" className="h-9 shrink-0 flex items-stretch border-b border-border bg-bg-panel overflow-x-auto">
        {openFiles.map((f) => {
          const isView = f.kind === "view";
          const dirty = !isView && f.content !== f.savedContent;
          const isActive = f.path === activeFile;
          const label = isView ? (f.title ?? f.path) : f.path.split("/").pop();
          const selectTab = () => (isView ? setActiveFile(f.path) : void engine.call("fileManager", "open", f.path));
          const handleClose = (e: React.MouseEvent) => {
            e.stopPropagation();
            if (dirty && !window.confirm(`Discard unsaved changes in ${f.path}?`)) return;
            closeFile(f.path);
          };
          return (
            <div
              key={f.path}
              role="tab"
              tabIndex={0}
              aria-selected={isActive}
              onClick={selectTab}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  selectTab();
                }
              }}
              className={clsx(
                "group flex items-center gap-2 px-3 text-xs border-r border-border cursor-pointer select-none whitespace-nowrap outline-none focus-visible:ring-1 focus-visible:ring-accent max-w-[220px]",
                isActive ? "bg-bg text-fg border-t-2 border-t-accent" : "text-fg-muted hover:bg-bg-hover"
              )}
              title={f.path}
            >
              {isView && (() => {
                const ViewIcon = engine.has(f.path.slice(VIEW_PREFIX.length)) ? engine.get(f.path.slice(VIEW_PREFIX.length)).profile.icon : undefined;
                return ViewIcon ? <ViewIcon size={12} className="text-accent shrink-0" /> : <GitBranch size={12} className="text-accent shrink-0" />;
              })()}
              <span className="truncate">{label}</span>
              {dirty && <span className="w-2 h-2 rounded-full bg-warn shrink-0" title="Unsaved changes" aria-label="Unsaved changes" />}
              <button
                type="button"
                onClick={handleClose}
                className="opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus:opacity-100 text-fg-muted hover:text-fg shrink-0 rounded p-0.5 cursor-pointer"
                title={`Close ${label}`}
                aria-label={`Close ${label}`}
              >
                <X size={12} />
              </button>
            </div>
          );
        })}
      </div>
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
