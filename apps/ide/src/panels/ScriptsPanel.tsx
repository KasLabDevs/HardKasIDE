import clsx from "clsx";
import {
  ChevronDown,
  ChevronRight,
  ExternalLink,
  FileJson,
  FlaskConical,
  Hammer,
  Package,
  Play,
  RefreshCw,
  Rocket,
  RotateCw,
  Search,
  Square,
  Terminal,
  Upload,
  X
} from "lucide-react";
import { useMemo, useState } from "react";
import type { PackageScriptEntry, ScriptKind, WorkspacePackageScripts } from "@/api/client";
import { useEngine } from "@/engine/context";
import type { ScriptsPlugin } from "@/plugins/scripts";
import { useIde } from "@/store/ide";
import { scriptKeyOf, useScripts, type TerminalTab } from "@/store/scripts";
import { portOfUrl } from "@/utils/scriptUrls";

const KIND_ORDER: Record<ScriptKind, number> = {
  launch: 0,
  deploy: 1,
  test: 2,
  build: 3,
  other: 4
};

function KindIcon({ kind, running }: { kind: ScriptKind; running: boolean }) {
  const cls = clsx("shrink-0", running ? "text-ok" : "text-fg-muted");
  switch (kind) {
    case "launch":
      return <Rocket size={13} className={running ? "text-ok shrink-0" : "text-accent shrink-0"} />;
    case "deploy":
      return <Upload size={13} className={cls} />;
    case "test":
      return <FlaskConical size={13} className={cls} />;
    case "build":
      return <Hammer size={13} className={cls} />;
    default:
      return <Terminal size={13} className={cls} />;
  }
}

/**
 * A test script that runs vitest goes to the Tests view instead of a terminal: same vitest, but the view shows each
 * file as it finishes and every test green or red at the end. Other test runners keep their terminal.
 */
function runsVitest(script: PackageScriptEntry): boolean {
  return script.kind === "test" && /\bvitest\b/.test(script.command);
}

/**
 * Project Scripts launcher: discovers root & monorepo package.json files, detects pnpm/npm/yarn/bun,
 * and gives every script a one-click Play/Stop terminal button with live localhost URL links.
 */
export function ScriptsPanel() {
  const engine = useEngine();
  const scriptsPlugin = engine.get<ScriptsPlugin>("scripts");
  const workspace = useIde((s) => s.workspace);
  const packages = useScripts((s) => s.packages);
  const loading = useScripts((s) => s.loading);
  const error = useScripts((s) => s.error);
  const terminals = useScripts((s) => s.terminals);
  const launchScript = useScripts((s) => s.launchScript);
  const stopTerminal = useScripts((s) => s.stopTerminal);
  const restartTerminal = useScripts((s) => s.restartTerminal);
  const stopAllScripts = useScripts((s) => s.stopAllScripts);
  const setActiveBottomTab = useScripts((s) => s.setActiveBottomTab);
  const setTerminalOpen = useIde((s) => s.setTerminalOpen);

  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState(false);

  const tabByKey = useMemo(() => {
    const map = new Map<string, TerminalTab>();
    for (const t of terminals) {
      if (t.scriptRun) map.set(t.scriptRun.key, t);
    }
    return map;
  }, [terminals]);

  const runningCount = useMemo(
    () => terminals.filter((t) => t.scriptRun && t.status === "running").length,
    [terminals]
  );

  const rootPkg = useMemo(
    () => packages.find((p) => p.relDir === ".") ?? packages[0] ?? null,
    [packages]
  );

  const visibleScripts = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rows: Array<{ pkg: WorkspacePackageScripts; script: PackageScriptEntry }> = [];
    for (const pkg of packages) {
      const pkgMatches = !q || pkg.name.toLowerCase().includes(q) || pkg.relDir.toLowerCase().includes(q);
      for (const script of pkg.scripts) {
        if (pkgMatches || script.name.toLowerCase().includes(q) || script.command.toLowerCase().includes(q)) {
          rows.push({ pkg, script });
        }
      }
    }
    rows.sort((a, b) => {
      const kindDiff = KIND_ORDER[a.script.kind] - KIND_ORDER[b.script.kind];
      if (kindDiff !== 0) return kindDiff;
      const rootDiff = (a.pkg.relDir === "." ? 0 : 1) - (b.pkg.relDir === "." ? 0 : 1);
      if (rootDiff !== 0) return rootDiff;
      return a.script.name.localeCompare(b.script.name);
    });
    return rows;
  }, [packages, query]);

  const untrusted = workspace?.trusted === false;

  const focusTab = (tabId: string) => {
    setActiveBottomTab({ kind: "terminal", id: tabId });
    setTerminalOpen(true);
  };

  const projectDisplayName =
    workspace?.name ||
    (rootPkg && rootPkg.name !== "hardkas-project" ? rootPkg.name : undefined) ||
    rootPkg?.name ||
    "Workspace";

  return (
    <div className="text-xs flex flex-col min-h-full min-w-0">
      <div className="sticky top-0 z-10 bg-bg-panel px-2 py-1.5 border-b border-border space-y-1.5">
        <div className="flex items-center gap-1.5 min-w-0">
          <div className="input flex items-center gap-1.5 px-2 py-1 flex-1 min-w-0">
            <Search size={12} className="shrink-0 text-fg-muted pointer-events-none" />
            <input
              aria-label="Filter scripts"
              className="flex-1 min-w-0 bg-transparent outline-none text-fg placeholder:text-fg-muted"
              placeholder="Filter scripts…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                className="shrink-0 p-0.5 text-fg-muted hover:text-fg cursor-pointer"
                aria-label="Clear filter"
              >
                <X size={11} />
              </button>
            )}
          </div>
          <button
            type="button"
            onClick={() => void scriptsPlugin.refresh()}
            className="p-1 rounded border border-border text-fg-muted hover:text-fg hover:bg-bg-hover cursor-pointer shrink-0"
            title="Rescan package.json scripts"
            aria-label="Refresh scripts"
          >
            <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
          </button>
        </div>

        {runningCount > 0 && (
          <div className="flex items-center justify-between gap-2 rounded border border-ok/30 bg-ok/10 px-2 py-1">
            <span className="flex items-center gap-1.5 text-ok font-medium tabular-nums">
              <span className="w-2 h-2 rounded-full bg-ok animate-pulse" />
              {runningCount} running
            </span>
            <button
              type="button"
              onClick={() => void stopAllScripts()}
              className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium bg-error/15 text-error hover:bg-error/25 cursor-pointer"
              title="Stop all running script terminals"
            >
              <Square size={10} className="fill-current" /> Stop all
            </button>
          </div>
        )}

        {untrusted && (
          <div className="rounded border border-warn/40 bg-warn/10 px-2 py-1.5 text-warn text-[12px]">
            Trust this folder in the top banner before running package scripts.
          </div>
        )}

        {error && (
          <div role="alert" className="text-error break-words">
            {error}
          </div>
        )}
      </div>

      <div className="flex-1 overflow-auto p-2 space-y-2">
        {loading && packages.length === 0 && (
          <div className="p-4 flex items-center justify-center gap-1.5 text-fg-muted" role="status">
            <RefreshCw size={12} className="animate-spin" /> Reading package.json scripts…
          </div>
        )}
        {!loading && packages.length === 0 && !error && (
          <div className="rounded border border-dashed border-border p-4 text-center text-fg-muted space-y-1">
            <div className="text-fg font-medium">No package.json scripts found</div>
            <div>Add scripts to your root package.json or subpackages (e.g. apps/web) and refresh.</div>
          </div>
        )}

        {!loading && packages.length > 0 && visibleScripts.length === 0 && (
          <div className="p-4 text-center text-fg-muted">No scripts match “{query}”.</div>
        )}

        {visibleScripts.length > 0 && rootPkg && (
          <section className="rounded border border-border bg-bg-elev overflow-hidden">
            <div className="flex items-center gap-1.5 px-2 py-1.5 bg-bg-panel border-b border-border/70">
              <button
                type="button"
                onClick={() => setCollapsed((c) => !c)}
                className="flex items-center gap-1.5 flex-1 min-w-0 text-left cursor-pointer group"
                aria-expanded={!collapsed}
              >
                {collapsed ? <ChevronRight size={13} className="text-fg-muted shrink-0" /> : <ChevronDown size={13} className="text-fg-muted shrink-0" />}
                <Package size={12} className="text-accent shrink-0" />
                <span
                  className="font-semibold text-fg truncate group-hover:text-accent"
                  title={`${projectDisplayName} (${packages.map((p) => p.manifestPath).join(", ")})`}
                >
                  {projectDisplayName}
                </span>
              </button>
              {runningCount > 0 && (
                <span className="w-2 h-2 rounded-full bg-ok animate-pulse shrink-0" title={`${runningCount} running`} />
              )}
              <span
                className="px-1.5 py-0.5 rounded bg-bg border border-border text-[11px] font-mono text-fg-muted shrink-0"
                title={`Detected package manager: ${rootPkg.manager}`}
              >
                {rootPkg.manager}
              </span>
              <button
                type="button"
                onClick={() => void engine.call("fileManager", "open", rootPkg.manifestPath)}
                className="p-0.5 rounded text-fg-muted hover:text-accent hover:bg-bg-hover cursor-pointer shrink-0"
                title={`Open ${rootPkg.manifestPath}`}
                aria-label={`Open ${rootPkg.manifestPath}`}
              >
                <FileJson size={12} />
              </button>
            </div>

            {!collapsed && (
              <div className="divide-y divide-border/40">
                {visibleScripts.map(({ pkg, script }) => (
                  <ScriptRow
                    key={scriptKeyOf(pkg.relDir, script.name)}
                    pkg={pkg}
                    script={script}
                    tab={tabByKey.get(scriptKeyOf(pkg.relDir, script.name))}
                    disabled={untrusted}
                    onLaunch={() => (runsVitest(script) ? void engine.call("tests", "run") : launchScript(pkg, script))}
                    onStop={(tabId) => void stopTerminal(tabId)}
                    onRestart={(tabId) => void restartTerminal(tabId)}
                    onFocus={focusTab}
                    onOpenManifest={() => void engine.call("fileManager", "open", pkg.manifestPath)}
                  />
                ))}
              </div>
            )}
          </section>
        )}
      </div>
    </div>
  );
}

function ScriptRow({
  pkg,
  script,
  tab,
  disabled,
  onLaunch,
  onStop,
  onRestart,
  onFocus,
  onOpenManifest
}: {
  pkg: WorkspacePackageScripts;
  script: PackageScriptEntry;
  tab?: TerminalTab;
  disabled: boolean;
  onLaunch: () => void;
  onStop: (tabId: string) => void;
  onRestart: (tabId: string) => void;
  onFocus: (tabId: string) => void;
  onOpenManifest: () => void;
}) {
  const running = tab?.status === "running";
  const urls = tab?.urls ?? [];

  return (
    <div
      className={clsx(
        "px-2 py-1 transition-colors",
        running ? "bg-ok/5" : "hover:bg-bg-hover/60"
      )}
    >
      <div className="flex items-center gap-1.5 min-w-0">
        <button
          type="button"
          disabled={disabled && !tab}
          onClick={() => (tab ? onFocus(tab.id) : onLaunch())}
          className="flex items-center gap-1.5 flex-1 min-w-0 text-left cursor-pointer disabled:cursor-not-allowed group"
          title={tab ? `Focus terminal · ${script.cliPreview}\n${script.command}` : `Run ${script.cliPreview}\n${script.command}`}
        >
          <KindIcon kind={script.kind} running={running} />
          <span className={clsx("font-medium shrink-0 max-w-[55%] truncate", running ? "text-fg" : "text-fg group-hover:text-accent")}>
            {script.name}
          </span>
          <span className="font-mono text-[11px] text-fg-muted/80 truncate flex-1 min-w-0">
            {script.command}
          </span>
        </button>

        <div className="flex items-center gap-1 shrink-0">
          {pkg.relDir !== "." && (
            <button
              type="button"
              onClick={onOpenManifest}
              className="px-1 py-0.2 rounded border border-border bg-bg text-[10px] font-mono text-fg-muted hover:text-accent hover:border-accent/40 cursor-pointer max-w-[5.5rem] truncate"
              title={`Open ${pkg.manifestPath}`}
            >
              {pkg.relDir}
            </button>
          )}
          {tab && !running && (
            <span
              className={clsx(
                "px-1 py-0.2 rounded text-[10.5px] font-mono tabular-nums",
                tab.status === "succeeded"
                  ? "text-ok bg-ok/10"
                  : tab.status === "failed"
                    ? "text-error bg-error/10"
                    : "text-fg-muted bg-bg-panel"
              )}
            >
              {tab.status === "succeeded" ? "ok" : tab.status === "stopped" ? "stopped" : `exit ${tab.exitCode ?? 1}`}
            </span>
          )}

          {running && urls.map((url) => {
            const port = portOfUrl(url);
            return (
              <a
                key={url}
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-0.5 px-1 py-0.5 rounded bg-accent/15 text-accent hover:bg-accent/25 font-mono text-[10.5px]"
                title={`Open ${url} in browser`}
              >
                <ExternalLink size={10} /> {port ? `:${port}` : "open"}
              </a>
            );
          })}

          {running && tab ? (
            <>
              <button
                type="button"
                disabled={disabled}
                onClick={() => onRestart(tab.id)}
                className="p-1 rounded text-fg-muted hover:text-fg hover:bg-bg-hover cursor-pointer disabled:opacity-40"
                title={`Restart ${script.cliPreview}`}
                aria-label={`Restart ${script.name}`}
              >
                <RotateCw size={11} />
              </button>
              <button
                type="button"
                onClick={() => onStop(tab.id)}
                className="p-1 rounded text-error hover:bg-error/15 cursor-pointer"
                title={`Stop ${script.cliPreview}`}
                aria-label={`Stop ${script.name}`}
              >
                <Square size={10} className="fill-current" />
              </button>
            </>
          ) : (
            <button
              type="button"
              disabled={disabled}
              onClick={onLaunch}
              className="p-1 rounded text-fg-muted hover:text-accent hover:bg-bg-hover cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              title={runsVitest(script) ? `Run in Tests view: ${script.command}` : `Run ${script.cliPreview}`}
              aria-label={`Run ${script.name}`}
            >
              <Play size={11} className="fill-current" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
