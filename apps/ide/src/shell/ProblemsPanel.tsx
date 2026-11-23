import clsx from "clsx";
import { AlertTriangle, ChevronDown, ChevronRight, Info, Sparkles, XCircle } from "lucide-react";
import { useMemo, useState } from "react";
import { api } from "@/api/client";
import { FileIcon } from "@/components/FileIcon";
import { useEngine } from "@/engine/context";
import type { EditorPlugin } from "@/plugins/editor";
import { normalizeDiagPath, useDiagnostics, type DiagnosticFix, type IdeDiagnostic } from "@/store/diagnostics";
import { useIde } from "@/store/ide";

export function applyTextEditToSource(source: string, edit: DiagnosticFix["edit"]): string {
  const eol = source.includes("\r\n") ? "\r\n" : "\n";
  const lines = source.split(/\r?\n/);
  const startLine = Math.max(1, Math.min(edit.startLineNumber, lines.length));
  const endLine = Math.max(startLine, Math.min(edit.endLineNumber, lines.length));
  const prefix = (lines[startLine - 1] ?? "").slice(0, Math.max(0, edit.startColumn - 1));
  const suffix = (lines[endLine - 1] ?? "").slice(Math.max(0, edit.endColumn - 1));
  const inserted = prefix + edit.text + suffix;
  const before = lines.slice(0, startLine - 1);
  const after = lines.slice(endLine);
  return [...before, ...inserted.split(/\r?\n/), ...after].join(eol);
}

/**
 * Eclipse-style workspace Problems view aggregating SilverScript, Covenant/HardKas, TypeScript, JSX, CSS, and HTML diagnostics.
 */
export function ProblemsPanel() {
  const engine = useEngine();
  const byFile = useDiagnostics((s) => s.byFile);
  const totals = useDiagnostics((s) => s.totals);
  const activeFile = useIde((s) => s.activeFile);

  const [severityFilter, setSeverityFilter] = useState<"all" | "error" | "warning">("all");
  const [scope, setScope] = useState<"workspace" | "active">("workspace");
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const activeNorm = activeFile && !activeFile.startsWith("view:") ? normalizeDiagPath(activeFile) : null;

  const grouped = useMemo(() => {
    const q = query.trim().toLowerCase();
    const groups: Array<{ file: string; items: IdeDiagnostic[]; errors: number; warnings: number }> = [];
    const entries = Object.entries(byFile).sort(([a], [b]) => a.localeCompare(b));
    for (const [file, list] of entries) {
      if (scope === "active" && activeNorm && file !== activeNorm) continue;
      if (scope === "active" && !activeNorm) continue;
      const filtered = list.filter((d) => {
        if (severityFilter === "error" && d.severity !== "error") return false;
        if (severityFilter === "warning" && d.severity !== "warning") return false;
        if (q) {
          const hay = `${file} ${d.message} ${d.code ?? ""} ${d.source} ${d.hint ?? ""}`.toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      });
      if (filtered.length === 0) continue;
      groups.push({
        file,
        items: filtered,
        errors: filtered.filter((d) => d.severity === "error").length,
        warnings: filtered.filter((d) => d.severity === "warning").length
      });
    }
    return groups;
  }, [byFile, scope, activeNorm, severityFilter, query]);

  const jumpTo = async (d: IdeDiagnostic) => {
    await engine.call("fileManager", "open", d.file);
    engine.get<EditorPlugin>("editor").gotoFileLine(d.file, d.line, d.column);
  };

  const applyFix = async (d: IdeDiagnostic, fix: DiagnosticFix) => {
    const ide = useIde.getState();
    const open = ide.openFiles.find((f) => normalizeDiagPath(f.path) === d.file);
    const current = open ? open.content : await api.fs.read(d.file);
    const next = applyTextEditToSource(current, fix.edit);
    if (open) {
      ide.updateContent(open.path, next);
      engine.get<EditorPlugin>("editor").notifyChange(open.path);
    }
    await engine.call("fileManager", "writeFile", d.file, next);
    await engine.call("fileManager", "open", d.file);
    engine.get<EditorPlugin>("editor").gotoFileLine(d.file, fix.edit.startLineNumber, fix.edit.startColumn);
  };

  return (
    <div className="h-full flex flex-col text-[12px] bg-bg">
      <div className="shrink-0 flex flex-wrap items-center gap-2 px-2.5 py-1 border-b border-border bg-bg-panel/60">
        <div className="inline-flex rounded border border-border bg-bg p-0.5 text-[11px]">
          <button
            type="button"
            onClick={() => setSeverityFilter("all")}
            className={clsx("px-2 py-0.5 rounded cursor-pointer", severityFilter === "all" ? "bg-bg-hover text-fg font-medium" : "text-fg-muted hover:text-fg")}
          >
            All ({totals.errors + totals.warnings + totals.infos})
          </button>
          <button
            type="button"
            onClick={() => setSeverityFilter("error")}
            className={clsx("px-2 py-0.5 rounded cursor-pointer flex items-center gap-1", severityFilter === "error" ? "bg-error/15 text-error font-medium" : "text-fg-muted hover:text-fg")}
          >
            <XCircle size={11} className="text-error" /> {totals.errors}
          </button>
          <button
            type="button"
            onClick={() => setSeverityFilter("warning")}
            className={clsx("px-2 py-0.5 rounded cursor-pointer flex items-center gap-1", severityFilter === "warning" ? "bg-warn/15 text-warn font-medium" : "text-fg-muted hover:text-fg")}
          >
            <AlertTriangle size={11} className="text-warn" /> {totals.warnings}
          </button>
        </div>

        <div className="inline-flex rounded border border-border bg-bg p-0.5 text-[11px]">
          <button
            type="button"
            onClick={() => setScope("workspace")}
            className={clsx("px-2 py-0.5 rounded cursor-pointer", scope === "workspace" ? "bg-bg-hover text-fg font-medium" : "text-fg-muted hover:text-fg")}
          >
            Workspace
          </button>
          <button
            type="button"
            onClick={() => setScope("active")}
            disabled={!activeNorm}
            className={clsx("px-2 py-0.5 rounded cursor-pointer disabled:opacity-40", scope === "active" ? "bg-bg-hover text-fg font-medium" : "text-fg-muted hover:text-fg")}
          >
            Current file
          </button>
        </div>

        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter problems (e.g. text, .sil, TS2304, checkSig)…"
          className="input h-6 text-[11px] flex-1 min-w-[180px] max-w-[340px]"
          aria-label="Filter problems"
        />
      </div>

      <div className="flex-1 overflow-auto">
        {grouped.length === 0 ? (
          <div className="h-full flex items-center justify-center text-fg-muted text-xs select-none px-4">
            {totals.errors === 0 && totals.warnings === 0
              ? "No problems detected in the workspace."
              : "No problems match the current filter."}
          </div>
        ) : (
          <div className="divide-y divide-border/40">
            {grouped.map((g) => {
              const isCollapsed = Boolean(collapsed[g.file]);
              const base = g.file.split("/").pop() ?? g.file;
              const dir = g.file.includes("/") ? g.file.slice(0, g.file.lastIndexOf("/")) : "";
              return (
                <div key={g.file}>
                  <button
                    type="button"
                    onClick={() => setCollapsed((s) => ({ ...s, [g.file]: !s[g.file] }))}
                    className="w-full flex items-center gap-1.5 px-2.5 py-1 bg-bg-panel/40 hover:bg-bg-hover/70 text-left cursor-pointer"
                  >
                    {isCollapsed ? <ChevronRight size={13} className="text-fg-muted shrink-0" /> : <ChevronDown size={13} className="text-fg-muted shrink-0" />}
                    <FileIcon name={g.file} size={14} />
                    <span className="font-medium text-fg truncate">{base}</span>
                    {dir && <span className="text-fg-muted text-[11px] truncate">{dir}</span>}
                    <span className="ml-auto flex items-center gap-1.5 shrink-0 text-[11px] tabular-nums">
                      {g.errors > 0 && <span className="px-1.5 py-0.2 rounded-full bg-error/15 text-error">{g.errors} err</span>}
                      {g.warnings > 0 && <span className="px-1.5 py-0.2 rounded-full bg-warn/15 text-warn">{g.warnings} warn</span>}
                    </span>
                  </button>
                  {!isCollapsed && (
                    <div className="divide-y divide-border/20">
                      {g.items.map((d) => {
                        const firstFix = d.fixes?.[0];
                        return (
                          <div
                            key={d.id}
                            className="flex items-start gap-2 pl-7 pr-3 py-1 hover:bg-bg-hover/60 group"
                          >
                            <button
                              type="button"
                              onClick={() => void jumpTo(d)}
                              className="flex items-start gap-2 flex-1 min-w-0 text-left cursor-pointer"
                            >
                              {d.severity === "error" ? (
                                <XCircle size={13} className="text-error shrink-0 mt-0.5" />
                              ) : d.severity === "warning" ? (
                                <AlertTriangle size={13} className="text-warn shrink-0 mt-0.5" />
                              ) : (
                                <Info size={13} className="text-info shrink-0 mt-0.5" />
                              )}
                              <div className="min-w-0 flex-1">
                                <div className="text-fg break-words leading-snug">
                                  {d.message}
                                  {d.code && <span className="ml-1.5 font-mono text-[10px] text-fg-muted">[{d.code}]</span>}
                                  <span className="ml-1.5 text-[10px] text-fg-muted">({d.source})</span>
                                </div>
                                {d.hint && <div className="text-[11px] text-fg-muted truncate">{d.hint}</div>}
                              </div>
                              <span className="shrink-0 font-mono text-[11px] text-fg-muted tabular-nums mt-0.5">
                                Ln {d.line}, Col {d.column}
                              </span>
                            </button>
                            {firstFix && (
                              <button
                                type="button"
                                onClick={() => void applyFix(d, firstFix)}
                                title={firstFix.title}
                                className="shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-accent/15 text-accent hover:bg-accent/25 text-[11px] cursor-pointer"
                              >
                                <Sparkles size={11} /> Fix
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
