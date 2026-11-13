import clsx from "clsx";
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  FileCode2,
  FolderSearch,
  Loader2,
  Replace,
  RotateCw,
  Search,
  Trash2,
  X
} from "lucide-react";
import { useMemo, useState } from "react";
import type { SearchMatchLine } from "@/api/client";
import { FileIcon } from "@/components/FileIcon";
import { useEngine } from "@/engine/context";
import { useIde } from "@/store/ide";
import { useSearch } from "@/store/search";

function renderHighlightedLine(m: SearchMatchLine) {
  const text = m.lineText;
  const start = Math.max(0, m.column - 1);
  const end = Math.min(text.length, start + Math.max(1, m.matchLength));
  const before = text.slice(0, start).trimStart();
  const matched = text.slice(start, end);
  const after = text.slice(end);
  return (
    <span className="font-mono text-[11px] whitespace-pre">
      <span className="text-fg-muted">{before}</span>
      <mark className="bg-warn/30 text-fg font-semibold px-0.5 rounded-xs border border-warn/50">{matched}</mark>
      <span className="text-fg-muted">{after}</span>
    </span>
  );
}

export function SearchResultsView() {
  const engine = useEngine();
  const query = useSearch((s) => s.query);
  const replacement = useSearch((s) => s.replacement);
  const showReplace = useSearch((s) => s.showReplace);
  const caseSensitive = useSearch((s) => s.caseSensitive);
  const regex = useSearch((s) => s.regex);
  const wholeWord = useSearch((s) => s.wholeWord);
  const filePatterns = useSearch((s) => s.filePatterns);
  const busy = useSearch((s) => s.busy);
  const error = useSearch((s) => s.error);
  const results = useSearch((s) => s.results);
  const totalMatches = useSearch((s) => s.totalMatches);
  const totalFiles = useSearch((s) => s.totalFiles);
  const lastSummary = useSearch((s) => s.lastSummary);
  const selectedMatch = useSearch((s) => s.selectedMatch);

  const setQuery = useSearch((s) => s.setQuery);
  const setReplacement = useSearch((s) => s.setReplacement);
  const setShowReplace = useSearch((s) => s.setShowReplace);
  const setOptions = useSearch((s) => s.setOptions);
  const setSelectedMatch = useSearch((s) => s.setSelectedMatch);
  const removeFileFromResults = useSearch((s) => s.removeFileFromResults);
  const clearResults = useSearch((s) => s.clearResults);
  const runSearch = useSearch((s) => s.runSearch);
  const runReplaceAll = useSearch((s) => s.runReplaceAll);
  const openSearchDialog = useSearch((s) => s.openSearchDialog);

  const [collapsedFiles, setCollapsedFiles] = useState<Record<string, boolean>>({});
  const [replaceStatus, setReplaceStatus] = useState<string | null>(null);

  const flatMatches = useMemo(() => {
    const out: Array<{ path: string; line: number; column: number }> = [];
    for (const f of results) {
      for (const m of f.matches) {
        out.push({ path: f.path, line: m.line, column: m.column });
      }
    }
    return out;
  }, [results]);

  const jumpToMatch = async (m: { path: string; line: number; column: number }) => {
    setSelectedMatch(m);
    await engine.call("fileManager", "open", m.path).catch(() => undefined);
    await engine.call("editor", "gotoLine", m.line, m.column).catch(() => undefined);
  };

  const stepMatch = (delta: 1 | -1) => {
    if (flatMatches.length === 0) return;
    const curIdx = selectedMatch
      ? flatMatches.findIndex(
          (m) => m.path === selectedMatch.path && m.line === selectedMatch.line && m.column === selectedMatch.column
        )
      : -1;
    const nextIdx = curIdx < 0 ? 0 : (curIdx + delta + flatMatches.length) % flatMatches.length;
    void jumpToMatch(flatMatches[nextIdx]);
  };

  const expandAll = () => setCollapsedFiles({});
  const collapseAll = () => {
    const next: Record<string, boolean> = {};
    for (const f of results) next[f.path] = true;
    setCollapsedFiles(next);
  };

  const handleReplace = async (targetFiles?: string[]) => {
    setReplaceStatus(null);
    const res = await runReplaceAll(targetFiles);
    await engine.call("fileManager", "refresh").catch(() => undefined);
    const msg = `Replaced ${res.replacedMatches} occurrence(s) across ${res.replacedFiles} file(s).`;
    setReplaceStatus(msg);
    useIde.getState().setStatus(msg);
  };

  return (
    <div className="h-full flex flex-col bg-bg text-xs select-none">
      {/* Top Eclipse + VS Code Hybrid Search Toolbar */}
      <div className="px-3 py-1.5 bg-bg-panel border-b border-border flex flex-wrap items-center gap-2 shrink-0">
        <div className="flex items-center gap-1.5 flex-1 min-w-[260px]">
          <div className="relative flex-1 max-w-xs">
            <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-fg-muted" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && query.trim()) {
                  e.preventDefault();
                  void runSearch({ revealInBottom: false });
                }
              }}
              placeholder="Search text in workspace…"
              className="input pl-7 py-0.5 text-[11px] font-mono w-full"
            />
          </div>

          <button
            type="button"
            onClick={() => setOptions({ caseSensitive: !caseSensitive })}
            className={clsx(
              "px-1.5 py-0.5 rounded border font-mono text-[10px] cursor-pointer",
              caseSensitive ? "border-accent bg-accent/15 text-accent font-bold" : "border-border bg-bg text-fg-muted hover:text-fg"
            )}
            title="Match Case (Case sensitive)"
          >
            Aa
          </button>
          <button
            type="button"
            onClick={() => setOptions({ wholeWord: !wholeWord })}
            className={clsx(
              "px-1.5 py-0.5 rounded border font-mono text-[10px] cursor-pointer",
              wholeWord ? "border-accent bg-accent/15 text-accent font-bold" : "border-border bg-bg text-fg-muted hover:text-fg"
            )}
            title="Match Whole Word"
          >
            ab
          </button>
          <button
            type="button"
            onClick={() => setOptions({ regex: !regex })}
            className={clsx(
              "px-1.5 py-0.5 rounded border font-mono text-[10px] cursor-pointer",
              regex ? "border-accent bg-accent/15 text-accent font-bold" : "border-border bg-bg text-fg-muted hover:text-fg"
            )}
            title="Use Regular Expression"
          >
            .*
          </button>

          <input
            value={filePatterns}
            onChange={(e) => setOptions({ filePatterns: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === "Enter" && query.trim()) {
                e.preventDefault();
                void runSearch({ revealInBottom: false });
              }
            }}
            placeholder="Files: *.sil, *.ts"
            className="input py-0.5 px-2 w-32 font-mono text-[11px]"
            title="File name patterns (e.g. *.sil, *.ts)"
          />

          <button
            type="button"
            disabled={!query.trim() || busy}
            onClick={() => void runSearch({ revealInBottom: false })}
            className="btn-primary px-2.5 py-0.5 text-[11px]"
            title="Run search"
          >
            {busy ? <Loader2 size={12} className="animate-spin" /> : <RotateCw size={12} />}
            <span>Search</span>
          </button>

          <button
            type="button"
            onClick={() => setShowReplace(!showReplace)}
            className={clsx(
              "btn-ghost border px-2 py-0.5 text-[11px]",
              showReplace ? "border-accent bg-accent/10 text-accent" : "border-border"
            )}
            title="Toggle Replace across files"
          >
            <Replace size={12} /> Replace
          </button>
        </div>

        {/* Eclipse Tree Navigation & Dialog Controls */}
        <div className="flex items-center gap-1 ml-auto">
          <button
            type="button"
            disabled={flatMatches.length === 0}
            onClick={() => stepMatch(-1)}
            className="p-1 rounded hover:bg-bg-hover text-fg-muted hover:text-fg disabled:opacity-40 cursor-pointer"
            title="Show Previous Match"
          >
            <ArrowUp size={13} />
          </button>
          <button
            type="button"
            disabled={flatMatches.length === 0}
            onClick={() => stepMatch(1)}
            className="p-1 rounded hover:bg-bg-hover text-fg-muted hover:text-fg disabled:opacity-40 cursor-pointer"
            title="Show Next Match"
          >
            <ArrowDown size={13} />
          </button>
          <span className="h-3.5 w-px bg-border mx-0.5" />
          <button
            type="button"
            disabled={results.length === 0}
            onClick={expandAll}
            className="p-1 rounded hover:bg-bg-hover text-fg-muted hover:text-fg disabled:opacity-40 cursor-pointer"
            title="Expand All Matches"
          >
            <ChevronsUpDown size={13} />
          </button>
          <button
            type="button"
            disabled={results.length === 0}
            onClick={collapseAll}
            className="p-1 rounded hover:bg-bg-hover text-fg-muted hover:text-fg disabled:opacity-40 cursor-pointer"
            title="Collapse All Files"
          >
            <ChevronsDownUp size={13} />
          </button>
          <span className="h-3.5 w-px bg-border mx-0.5" />
          <button
            type="button"
            onClick={() => openSearchDialog({ mode: "eclipse-search" })}
            className="btn-ghost border border-border px-2 py-0.5 text-[11px]"
            title="Open Eclipse Search Dialog (Ctrl+H)"
          >
            <FolderSearch size={12} className="text-accent" /> Search Dialog…
          </button>
          <button
            type="button"
            disabled={results.length === 0 && !lastSummary}
            onClick={clearResults}
            className="p-1 rounded hover:bg-bg-hover text-fg-muted hover:text-error disabled:opacity-40 cursor-pointer"
            title="Clear Search Results"
          >
            <Trash2 size={13} />
          </button>
        </div>
      </div>

      {/* Optional Replace Bar */}
      {showReplace && (
        <div className="px-3 py-1.5 bg-bg-panel/60 border-b border-border flex items-center gap-2 shrink-0">
          <Replace size={12} className="text-warn shrink-0" />
          <input
            value={replacement}
            onChange={(e) => setReplacement(e.target.value)}
            placeholder="Replace with…"
            className="input py-0.5 text-[11px] font-mono max-w-xs"
          />
          <button
            type="button"
            disabled={!query.trim() || results.length === 0 || busy}
            onClick={() => void handleReplace()}
            className="btn-ghost border border-warn/50 bg-warn/10 text-warn hover:bg-warn/20 px-2.5 py-0.5 text-[11px]"
          >
            Replace All ({totalMatches} matches in {totalFiles} files)
          </button>
          {replaceStatus && <span className="text-[11px] text-ok font-mono">{replaceStatus}</span>}
        </div>
      )}

      {/* Eclipse Search Summary Subheader */}
      <div className="px-3 py-1 bg-bg-elev border-b border-border text-[11px] text-fg-muted font-mono flex items-center justify-between shrink-0">
        <span className="truncate">
          {lastSummary || "No active search — type above or press Ctrl+H to open the Eclipse Search dialog."}
        </span>
        {results.length > 0 && (
          <span className="text-[10px] text-accent shrink-0">
            Click any line to jump in editor
          </span>
        )}
      </div>

      {/* Hierarchical Search Results Tree */}
      <div className="flex-1 overflow-auto p-1.5 space-y-1">
        {error && (
          <div className="p-3 rounded border border-error/40 bg-error/10 text-error text-xs">{error}</div>
        )}

        {!busy && results.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-fg-muted gap-2 p-6 text-center">
            <Search size={22} className="text-fg-muted/50" />
            <div>
              {lastSummary
                ? "0 matches found for your search criteria."
                : "Use the toolbar above, Search → Search… (Ctrl+H) or Quick Search (Ctrl+Alt+Shift+L) to search across contracts, scripts and tests."}
            </div>
          </div>
        ) : (
          results.map((fileRes) => {
            const isCollapsed = Boolean(collapsedFiles[fileRes.path]);
            const parts = fileRes.path.split("/");
            const fileName = parts.pop() || fileRes.path;
            const folderPath = parts.join("/");

            return (
              <div key={fileRes.path} className="rounded border border-border/70 bg-bg-panel/30 overflow-hidden">
                {/* File Tree Node Header */}
                <div
                  onClick={() => setCollapsedFiles((prev) => ({ ...prev, [fileRes.path]: !isCollapsed }))}
                  className="flex items-center gap-1.5 px-2 py-1 bg-bg-panel hover:bg-bg-hover cursor-pointer"
                >
                  {isCollapsed ? (
                    <ChevronRight size={13} className="text-fg-muted shrink-0" />
                  ) : (
                    <ChevronDown size={13} className="text-fg-muted shrink-0" />
                  )}
                  <FileIcon name={fileName} size={14} />
                  <span className="font-semibold text-fg truncate">{fileName}</span>
                  {folderPath && <span className="text-[10px] text-fg-muted font-mono truncate">— {folderPath}</span>}
                  <span className="ml-auto flex items-center gap-1.5 shrink-0">
                    {showReplace && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          void handleReplace([fileRes.path]);
                        }}
                        className="px-1.5 py-0.2 rounded border border-warn/40 bg-warn/10 text-warn hover:bg-warn/20 text-[10px] font-mono cursor-pointer"
                        title={`Replace matches in ${fileRes.path}`}
                      >
                        Replace ({fileRes.matches.length})
                      </button>
                    )}
                    <span className="font-mono text-[10px] px-1.5 py-0.2 rounded bg-bg border border-border text-fg-muted">
                      {fileRes.matches.length} {fileRes.matches.length === 1 ? "match" : "matches"}
                    </span>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        removeFileFromResults(fileRes.path);
                      }}
                      className="p-0.5 rounded text-fg-muted hover:text-fg hover:bg-bg cursor-pointer"
                      title="Remove file from search results"
                    >
                      <X size={11} />
                    </button>
                  </span>
                </div>

                {/* Matching Lines under File */}
                {!isCollapsed && (
                  <div className="divide-y divide-border/40 bg-bg">
                    {fileRes.matches.map((m, idx) => {
                      const isActive =
                        selectedMatch?.path === fileRes.path &&
                        selectedMatch?.line === m.line &&
                        selectedMatch?.column === m.column;
                      return (
                        <button
                          key={`${fileRes.path}:${m.line}:${m.column}:${idx}`}
                          type="button"
                          onClick={() => void jumpToMatch({ path: fileRes.path, line: m.line, column: m.column })}
                          className={clsx(
                            "w-full text-left pl-6 pr-3 py-1 flex items-center gap-2.5 cursor-pointer transition-colors overflow-x-auto",
                            isActive ? "bg-accent/15 text-fg" : "hover:bg-bg-hover"
                          )}
                        >
                          <FileCode2 size={11} className="text-accent shrink-0" />
                          <span className="font-mono text-[10px] text-accent w-12 shrink-0 tabular-nums">
                            {m.line}:{m.column}
                          </span>
                          <div className="truncate flex-1">{renderHighlightedLine(m)}</div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
