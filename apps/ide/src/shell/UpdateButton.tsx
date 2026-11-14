import clsx from "clsx";
import { Check, Copy, Download, ExternalLink, RefreshCw, TerminalSquare, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useEngine } from "@/engine/context";
import { useIde } from "@/store/ide";
import { hasPendingUpdate, useUpdates } from "@/store/updates";
import { copyText } from "@/utils/clipboard";

export function UpdateButton() {
  const engine = useEngine();
  const workspaceRoot = useIde((s) => s.workspace?.root ?? null);
  const report = useUpdates((s) => s.report);
  const checking = useUpdates((s) => s.checking);
  const error = useUpdates((s) => s.error);
  const popoverOpen = useUpdates((s) => s.popoverOpen);
  const dismissedKey = useUpdates((s) => s.dismissedKey);
  const check = useUpdates((s) => s.check);
  const togglePopover = useUpdates((s) => s.togglePopover);
  const closePopover = useUpdates((s) => s.closePopover);
  const dismissCurrent = useUpdates((s) => s.dismissCurrent);

  const [copied, setCopied] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Non-blocking background check when workbench mounts or switches workspace.
  useEffect(() => {
    void check(false);
  }, [workspaceRoot, check]);

  useEffect(() => {
    if (!popoverOpen) return;
    const onPointer = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) closePopover();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closePopover();
    };
    document.addEventListener("mousedown", onPointer, true);
    window.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", onPointer, true);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [popoverOpen, closePopover]);

  const pending = hasPendingUpdate(report, dismissedKey);
  if (!pending && !popoverOpen) return null;

  const ide = report?.ide;
  const cli = report?.cli;

  const summaryTitle = pending
    ? [
        ide?.hasUpdate ? `HardKas IDE v${ide.latestVersion}` : null,
        cli?.hasUpdate ? `HardKas CLI v${cli.targetVersion}` : null
      ]
        .filter(Boolean)
        .join(" · ")
    : "Check for Updates";

  const handleRefresh = async () => {
    await Promise.all([
      check(true),
      engine.call("environment", "refreshCli").catch(() => undefined)
    ]);
  };

  const handleCopyCommand = async () => {
    if (!cli?.updateCommand) return;
    if (await copyText(cli.updateCommand)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    }
  };

  const handleOpenTerminal = async () => {
    if (cli?.updateCommand) {
      await copyText(cli.updateCommand);
    }
    useIde.getState().requestTerminal();
    closePopover();
    useIde.getState().setStatus(
      cli?.updateCommand ? `Copied "${cli.updateCommand}" — paste in Terminal to update CLI` : "Opened Terminal"
    );
  };

  return (
    <div ref={wrapRef} className="titlebar-nodrag relative flex items-center shrink-0">
      <button
        type="button"
        onClick={togglePopover}
        aria-haspopup="dialog"
        aria-expanded={popoverOpen}
        aria-label={pending ? `Update (${summaryTitle})` : "Updates"}
        title={summaryTitle}
        className={clsx(
          "h-[1.35rem] inline-flex items-center gap-1.5 px-2.5 rounded text-[12px] font-medium cursor-pointer transition-all shrink-0",
          pending
            ? "bg-accent text-accent-fg hover:brightness-110 font-semibold shadow-xs"
            : "bg-bg-hover text-fg border border-border hover:border-fg-muted/40"
        )}
      >
        {pending ? "Update" : checking ? "Checking…" : "Updates"}
      </button>

      {popoverOpen && (
        <div
          role="dialog"
          aria-label="Updates"
          className="absolute right-0 top-full mt-1.5 z-50 w-80 max-w-[calc(100vw-1rem)] rounded-md border border-border bg-bg-elev shadow-2xl p-3 text-xs text-fg space-y-2.5"
        >
          <div className="flex items-center justify-between gap-2 pb-1.5 border-b border-border">
            <span className="font-semibold text-fg">Updates</span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => void handleRefresh()}
                disabled={checking}
                title="Check for updates now"
                aria-label="Check for updates now"
                className="p-1 rounded text-fg-muted hover:text-fg hover:bg-bg-hover cursor-pointer disabled:opacity-50"
              >
                <RefreshCw size={12} className={clsx(checking && "animate-spin")} />
              </button>
              <button
                type="button"
                onClick={closePopover}
                title="Close"
                aria-label="Close updates dialog"
                className="p-1 rounded text-fg-muted hover:text-fg hover:bg-bg-hover cursor-pointer"
              >
                <X size={13} />
              </button>
            </div>
          </div>

          {checking && !report && (
            <p className="text-fg-muted py-2">Checking HardKas IDE releases and CLI version…</p>
          )}

          {error && (
            <div className="rounded border border-warn/40 bg-warn/10 p-2 text-[12px] text-fg">
              Could not check updates: {error}
            </div>
          )}

          {ide && (
            <div className="rounded border border-border bg-bg/60 p-2.5 space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold text-fg">HardKas IDE</span>
                <span
                  className={clsx(
                    "px-1.5 py-0.5 rounded text-[12px] font-medium",
                    ide.hasUpdate
                      ? "bg-accent/15 text-accent border border-accent/40"
                      : ide.error
                        ? "bg-bg-panel text-fg-muted border border-border"
                        : "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30"
                  )}
                >
                  {ide.hasUpdate ? `v${ide.latestVersion} available` : ide.error ? "Offline" : "Up to date"}
                </span>
              </div>
              <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[12px] text-fg-muted font-mono">
                <span className="whitespace-nowrap">Installed: v{ide.currentVersion}</span>
                {ide.latestVersion && <span className="whitespace-nowrap">Latest: v{ide.latestVersion}</span>}
              </div>
              {ide.hasUpdate && ide.notes && (
                <p className="text-[12px] text-fg-muted whitespace-pre-line line-clamp-4 pt-0.5">{ide.notes}</p>
              )}
              <div className="flex flex-wrap items-center gap-2 pt-0.5">
                {ide.hasUpdate && ide.downloadUrl && (
                  <a
                    href={ide.downloadUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 px-2 py-1 rounded text-[12px] font-semibold bg-accent text-accent-fg hover:brightness-110 shadow-xs"
                  >
                    <Download size={11} /> Download installer
                  </a>
                )}
                <a
                  href={ide.releaseUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-[12px] text-accent hover:underline"
                >
                  <ExternalLink size={11} /> {ide.hasUpdate ? "Release notes" : "GitHub releases"}
                </a>
              </div>
            </div>
          )}

          {cli && (
            <div className="rounded border border-border bg-bg/60 p-2.5 space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold text-fg">HardKas CLI</span>
                <span
                  className={clsx(
                    "px-1.5 py-0.5 rounded text-[12px] font-medium",
                    cli.hasUpdate
                      ? "bg-warn/15 text-warn border border-warn/40"
                      : "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30"
                  )}
                >
                  {cli.hasUpdate ? `v${cli.targetVersion} available` : "Up to date"}
                </span>
              </div>
              <div className="text-[12px] text-fg-muted font-mono space-y-0.5">
                <div className="flex flex-wrap gap-x-3 gap-y-0.5">
                  <span className="whitespace-nowrap">
                    Active: {cli.runtimeVersion ? `v${cli.runtimeVersion} (${cli.runtimeSource})` : "not found"}
                  </span>
                  <span className="whitespace-nowrap">Tested: v{cli.pinnedVersion}</span>
                </div>
                {cli.projectVersion && cli.projectVersion !== cli.runtimeVersion && (
                  <div className="text-warn whitespace-nowrap">Project package: v{cli.projectVersion}</div>
                )}
              </div>
              {cli.hasUpdate && (
                <>
                  <div className="flex items-center gap-1 rounded border border-border bg-bg px-2 py-1 font-mono text-[12px] text-fg">
                    <span className="flex-1 truncate select-all" title={cli.updateCommand}>
                      {cli.updateCommand}
                    </span>
                    <button
                      type="button"
                      onClick={() => void handleCopyCommand()}
                      title="Copy command"
                      aria-label="Copy CLI update command"
                      className="p-0.5 rounded text-fg-muted hover:text-fg hover:bg-bg-hover cursor-pointer shrink-0"
                    >
                      {copied ? <Check size={11} className="text-emerald-400" /> : <Copy size={11} />}
                    </button>
                  </div>
                  <div className="flex items-center gap-2 pt-0.5">
                    <button
                      type="button"
                      onClick={() => void handleOpenTerminal()}
                      className="btn-ghost px-2 py-1 text-[12px]"
                    >
                      <TerminalSquare size={11} /> Copy &amp; open Terminal
                    </button>
                  </div>
                </>
              )}
            </div>
          )}

          {pending && (
            <div className="flex items-center justify-end pt-0.5">
              <button
                type="button"
                onClick={dismissCurrent}
                className="text-[12px] text-fg-muted hover:text-fg cursor-pointer"
              >
                Remind me later
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
