import { CornerDownLeft, GitBranch, Save } from "lucide-react";
import { useEffect } from "react";
import { FileIcon } from "@/components/FileIcon";
import { Editor } from "@/editor/Editor";
import { useEngine, useEngineVersion } from "@/engine/context";
import { ErrorBoundary } from "./ErrorBoundary";
import { HardKasMark } from "./Logo";
import { StatusBar } from "./StatusBar";
import { WindowControls, isDesktopApp } from "./WindowControls";
import { useIde, VIEW_PREFIX } from "@/store/ide";
import { postDetachMessage, type DetachTarget } from "@/utils/detach";

interface Props {
  target: DetachTarget;
}

/** Minimalist standalone workbench window for a tab popped out via right-click -> Detach. */
export function DetachedWorkbench({ target }: Props) {
  const engine = useEngine();
  useEngineVersion();
  const openFiles = useIde((s) => s.openFiles);
  const activeFile = useIde((s) => s.activeFile);
  const workspace = useIde((s) => s.workspace);

  const current = openFiles.find((f) => f.path === activeFile) ?? openFiles[0];
  const isView = target.kind === "view" || current?.kind === "view";
  const viewName = target.kind === "view" ? target.pluginName : activeFile?.startsWith(VIEW_PREFIX) ? activeFile.slice(VIEW_PREFIX.length) : null;
  const activeView = viewName && engine.has(viewName) ? engine.get(viewName) : null;
  const View = activeView?.view;
  const label = target.kind === "view" ? target.title : (target.path.split("/").pop() ?? target.path);
  const dirty = !isView && current ? current.content !== current.savedContent : false;

  useEffect(() => {
    document.title = `${dirty ? "● " : ""}${label} — HardKas IDE`;
  }, [dirty, label]);

  useEffect(() => {
    const off = engine.on("fileManager", "fileSaved", (savedPath) => {
      const f = useIde.getState().openFiles.find((item) => item.path === String(savedPath ?? ""));
      if (f) postDetachMessage({ type: "file-saved", path: f.path, content: f.content });
    });
    return () => off();
  }, [engine]);

  const dockBack = () => {
    if (target.kind === "view") {
      postDetachMessage({ type: "reattach-view", pluginName: target.pluginName, title: target.title });
    } else {
      const f = current;
      postDetachMessage({
        type: "reattach-file",
        path: target.path,
        content: f?.content ?? "",
        savedContent: f?.savedContent ?? "",
        language: f?.language ?? "plaintext"
      });
    }
    // Clear local buffer before closing so the main window owns the tab cleanly without firing beforeunload warnings.
    useIde.setState({ openFiles: [], activeFile: null });
    window.close();
  };

  return (
    <div className="h-full flex flex-col bg-bg">
      <header
        data-tauri-drag-region={isDesktopApp() ? true : undefined}
        className="titlebar h-8 shrink-0 flex items-center gap-2 pl-2.5 pr-2 border-b border-border bg-bg-panel select-none"
      >
        <HardKasMark size={20} />
        <span className="flex items-center gap-1.5 min-w-0 text-xs">
          {isView ? (
            (() => {
              const ViewIcon = activeView?.profile.icon;
              return ViewIcon ? <ViewIcon size={13} className="text-accent shrink-0" /> : <GitBranch size={13} className="text-accent shrink-0" />;
            })()
          ) : (
            <FileIcon name={target.path} size={14} />
          )}
          <span className="font-semibold text-fg truncate">{label}</span>
          {target.kind === "file" && target.path.includes("/") && (
            <span className="text-[12px] font-mono text-fg-muted truncate hidden sm:inline" title={target.path}>
              — {target.path}
            </span>
          )}
          {dirty && <span className="w-2 h-2 rounded-full bg-warn shrink-0" title="Unsaved changes" aria-label="Unsaved changes" />}
        </span>

        {workspace?.name && (
          <span className="text-[12px] text-fg-muted px-2 py-0.5 rounded bg-bg border border-border/60 shrink-0 hidden md:inline">
            {workspace.name}
          </span>
        )}

        <div className="ml-auto flex items-center gap-1.5 shrink-0">
          {!isView && dirty && (
            <button
              type="button"
              onClick={() => void engine.call("fileManager", "saveCurrentFile")}
              className="btn-ghost py-1 px-2 text-[12px]"
              title="Save file (Ctrl+S)"
            >
              <Save size={12} /> Save
            </button>
          )}
          <button
            type="button"
            onClick={dockBack}
            className="btn-ghost py-1 px-2 text-[12px]"
            title="Return tab to the main IDE window"
          >
            <CornerDownLeft size={12} /> Dock back
          </button>
        </div>

        {isDesktopApp() && <WindowControls />}
      </header>

      <div className="flex-1 min-h-0 relative">
        <div className="absolute inset-0" style={{ display: View ? "none" : "block" }}>
          <ErrorBoundary name="Editor">
            <Editor />
          </ErrorBoundary>
        </div>
        {View && (
          <div className="absolute inset-0">
            <ErrorBoundary name={activeView?.profile.displayName ?? "View"}>
              <View />
            </ErrorBoundary>
          </div>
        )}
      </div>

      <StatusBar />
    </div>
  );
}
