import clsx from "clsx";
import { FolderOpen } from "lucide-react";
import { cliMismatch, useEnv } from "@/store/env";
import { useEditorCursor } from "@/store/editorCursor";
import { useIde } from "@/store/ide";
import { isTextFile, openPalette } from "./actions";

export function StatusBar({ borderless = false }: { borderless?: boolean } = {}) {
  const workspace = useIde((s) => s.workspace);
  const activeFile = useIde((s) => s.activeFile);
  const status = useIde((s) => s.statusMessage);
  const cli = useEnv((s) => s.cli);
  const cursorFile = useEditorCursor((s) => s.file);
  const line = useEditorCursor((s) => s.line);
  const column = useEditorCursor((s) => s.column);
  const showCursor = isTextFile(activeFile) && cursorFile === activeFile;

  return (
    <footer className={clsx("h-[1.45rem] shrink-0 bg-bg-panel flex items-center gap-2.5 px-2.5 text-[12px] text-fg-muted select-none overflow-hidden", !borderless && "border-t border-border")}>
      <span className="flex items-center gap-1.5 text-fg shrink-0 max-w-[180px] truncate" title={workspace?.root ?? ""}>
        <FolderOpen size={12} className="shrink-0" /> <span className="truncate">{workspace?.name ?? "no workspace"}</span>
      </span>
      {activeFile && (
        <span className="truncate min-w-0 max-w-[260px] font-mono text-[12px]" title={activeFile}>
          {activeFile}
        </span>
      )}
      <span role="status" aria-live="polite" className="ml-auto truncate min-w-0 max-w-[360px]" title={status}>
        {status}
      </span>
      {showCursor && (
        <button
          type="button"
          onClick={() => openPalette(":")}
          className="shrink-0 px-1.5 py-0.5 rounded hover:bg-bg-hover hover:text-fg cursor-pointer tabular-nums transition-colors"
          title="Go to Line/Column (Ctrl+G)"
        >
          Ln {line}, Col {column}
        </button>
      )}
      <span
        className="shrink-0 hidden md:inline font-mono text-[12px] px-1.5 py-0.5 rounded bg-bg border border-border text-accent"
        title="Active SilverScript compiler & language spec version. Pin 'pragma silverscript ^0.1.0;' in your .sil contracts because the SilverScript API evolves rapidly."
      >
        silverc v1.0.0 · SilverScript ^0.1.0
      </span>
      <span
        className={clsx("shrink-0 hidden sm:inline tabular-nums", cliMismatch(cli) && "text-warn")}
        title={cli ? (cliMismatch(cli) ? `hardkas ${cli.version} from ${cli.source}; this IDE was tested with ${cli.pinned}` : `hardkas ${cli.version ?? "?"} from ${cli.source} (${cli.command})`) : "Asking the server which hardkas it runs…"}
      >
        HardKas IDE {__APP_VERSION__} · CLI {cli ? (cli.version ?? "not found") : "…"}
        {cliMismatch(cli) ? ` (tested with ${cli!.pinned})` : ""}
      </span>
    </footer>
  );
}
