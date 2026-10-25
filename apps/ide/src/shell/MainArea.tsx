import clsx from "clsx";
import { GitBranch, X } from "lucide-react";
import { Editor } from "@/editor/Editor";
import { useEngine, useEngineVersion } from "@/engine/context";
import { useIde, VIEW_PREFIX } from "@/store/ide";

/** Tabs + content: files open in the Monaco editor, "view:<plugin>" tabs render a main-panel plugin view. */
export function MainArea() {
  const engine = useEngine();
  useEngineVersion();
  const openFiles = useIde((s) => s.openFiles);
  const activeFile = useIde((s) => s.activeFile);
  const closeFile = useIde((s) => s.closeFile);
  const setActiveFile = useIde((s) => s.setActiveFile);

  const active = openFiles.find((f) => f.path === activeFile);
  const viewName = active?.kind === "view" ? active.path.slice(VIEW_PREFIX.length) : null;
  const activeView = viewName && engine.has(viewName) ? engine.get(viewName) : null;
  const View = activeView?.view;

  return (
    <div className="h-full flex flex-col min-w-0 bg-bg">
      <div className="h-9 shrink-0 flex items-stretch border-b border-border bg-bg-panel overflow-x-auto">
        {openFiles.map((f) => {
          const isView = f.kind === "view";
          const dirty = !isView && f.content !== f.savedContent;
          const isActive = f.path === activeFile;
          return (
            <div
              key={f.path}
              onClick={() => (isView ? setActiveFile(f.path) : void engine.call("fileManager", "open", f.path))}
              className={clsx(
                "group flex items-center gap-2 px-3 text-xs border-r border-border cursor-pointer select-none whitespace-nowrap",
                isActive ? "bg-bg text-fg border-t-2 border-t-accent" : "text-fg-muted hover:bg-bg-hover"
              )}
              title={f.path}
            >
              {isView && <GitBranch size={12} className="text-accent" />}
              <span>{isView ? (f.title ?? f.path) : f.path.split("/").pop()}</span>
              {dirty && <span className="w-2 h-2 rounded-full bg-warn" title="Unsaved changes" />}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  closeFile(f.path);
                }}
                className="opacity-0 group-hover:opacity-100 text-fg-muted hover:text-fg"
                title="Close"
              >
                <X size={12} />
              </button>
            </div>
          );
        })}
      </div>
      <div className="flex-1 min-h-0 relative">
        {/* The editor stays mounted (and hidden) while a view tab is active, so Monaco keeps its models. */}
        <div className="absolute inset-0" style={{ display: View ? "none" : "block" }}>
          <Editor />
        </div>
        {View && (
          <div className="absolute inset-0">
            <View />
          </div>
        )}
      </div>
    </div>
  );
}
