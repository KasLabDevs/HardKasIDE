import clsx from "clsx";
import { X } from "lucide-react";
import { Editor } from "@/editor/Editor";
import { useEngine } from "@/engine/context";
import { useIde } from "@/store/ide";

export function MainArea() {
  const engine = useEngine();
  const openFiles = useIde((s) => s.openFiles);
  const activeFile = useIde((s) => s.activeFile);
  const closeFile = useIde((s) => s.closeFile);

  return (
    <div className="h-full flex flex-col min-w-0 bg-bg">
      <div className="h-9 shrink-0 flex items-stretch border-b border-border bg-bg-panel overflow-x-auto">
        {openFiles.map((f) => {
          const dirty = f.content !== f.savedContent;
          const isActive = f.path === activeFile;
          return (
            <div
              key={f.path}
              onClick={() => void engine.call("fileManager", "open", f.path)}
              className={clsx(
                "group flex items-center gap-2 px-3 text-xs border-r border-border cursor-pointer select-none whitespace-nowrap",
                isActive ? "bg-bg text-fg border-t-2 border-t-accent" : "text-fg-muted hover:bg-bg-hover"
              )}
              title={f.path}
            >
              <span>{f.path.split("/").pop()}</span>
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
      <div className="flex-1 min-h-0">
        <Editor />
      </div>
    </div>
  );
}
