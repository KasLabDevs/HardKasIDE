import clsx from "clsx";
import { Code2, ExternalLink, FileCode2, FileSearch, FolderSearch, Loader2, Replace, Search, ShieldCheck, Sparkles, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { api, type SearchFileResult } from "@/api/client";
import { FileIcon } from "@/components/FileIcon";
import { useEngine } from "@/engine/context";
import { useIde } from "@/store/ide";
import { useSearch, type SearchDialogTab, type SearchScope } from "@/store/search";

const FILE_PATTERN_PRESETS = [
  { label: "All files (*)", value: "*" },
  { label: "SilverScript (*.sil)", value: "*.sil" },
  { label: "Contracts & TS (*.sil, *.ts, *.tsx)", value: "*.sil, *.ts, *.tsx" },
  { label: "TypeScript (*.ts, *.tsx)", value: "*.ts, *.tsx" },
  { label: "Configs & JSON (*.json, *.ts)", value: "*.json, *.ts" }
];

const SILVER_QUICK_TOKENS = [
  { label: "contract", query: "contract ", pattern: "*.sil" },
  { label: "entrypoint", query: "entrypoint function", pattern: "*.sil" },
  { label: "tx.outputs[i]", query: "tx.outputs[", pattern: "*.sil" },
  { label: "lockingBytecode", query: "lockingBytecode", pattern: "*.sil" },
  { label: "checkSig", query: "checkSig(", pattern: "*.sil" },
  { label: "require(...)", query: "require(", pattern: "*.sil" }
];

const SYMBOL_QUICK_TOKENS = [
  { label: "export class", query: "class ", pattern: "*.ts, *.tsx" },
  { label: "interface", query: "interface ", pattern: "*.ts, *.tsx" },
  { label: "export function", query: "function ", pattern: "*.ts, *.tsx" },
  { label: "test / describe", query: "describe(", pattern: "*.test.ts, *.spec.ts" }
];

export function SearchDialog() {
  const engine = useEngine();
  const dialogMode = useSearch((s) => s.dialogMode);
  const dialogTab = useSearch((s) => s.dialogTab);
  const query = useSearch((s) => s.query);
  const replacement = useSearch((s) => s.replacement);
  const showReplace = useSearch((s) => s.showReplace);
  const caseSensitive = useSearch((s) => s.caseSensitive);
  const regex = useSearch((s) => s.regex);
  const wholeWord = useSearch((s) => s.wholeWord);
  const filePatterns = useSearch((s) => s.filePatterns);
  const scope = useSearch((s) => s.scope);
  const scopeDir = useSearch((s) => s.scopeDir);
  const history = useSearch((s) => s.history);
  const closeDialog = useSearch((s) => s.closeDialog);
  const setQuery = useSearch((s) => s.setQuery);
  const setReplacement = useSearch((s) => s.setReplacement);
  const setShowReplace = useSearch((s) => s.setShowReplace);
  const setOptions = useSearch((s) => s.setOptions);
  const runSearch = useSearch((s) => s.runSearch);
  const runReplaceAll = useSearch((s) => s.runReplaceAll);

  const activeFile = useIde((s) => s.activeFile);
  const openFiles = useIde((s) => s.openFiles);
  const inputRef = useRef<HTMLInputElement>(null);

  // Quick Search live state
  const [quickFiles, setQuickFiles] = useState<SearchFileResult[]>([]);
  const [quickBusy, setQuickBusy] = useState(false);
  const [quickSelectedIdx, setQuickSelectedIdx] = useState(0);
  const [previewLines, setPreviewLines] = useState<{ path: string; line: number; lines: Array<{ num: number; text: string }> } | null>(null);

  useEffect(() => {
    if (dialogMode !== "closed") {
      setTimeout(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      }, 20);
    }
  }, [dialogMode, dialogTab]);

  useEffect(() => {
    if (dialogMode === "closed") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        closeDialog();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dialogMode, closeDialog]);

  // Live debounced search when in "quick-search" mode
  useEffect(() => {
    if (dialogMode !== "quick-search") return;
    const q = query.trim();
    if (!q) {
      setQuickFiles([]);
      setPreviewLines(null);
      return;
    }
    let cancelled = false;
    setQuickBusy(true);
    const timer = setTimeout(() => {
      api.fs
        .search({
          query: q,
          caseSensitive,
          regex,
          wholeWord,
          filePatterns,
          maxResults: 250
        })
        .then((res) => {
          if (cancelled) return;
          setQuickFiles(res.files);
          setQuickSelectedIdx(0);
          setQuickBusy(false);
        })
        .catch(() => {
          if (!cancelled) setQuickBusy(false);
        });
    }, 140);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [dialogMode, query, caseSensitive, regex, wholeWord, filePatterns]);

  const flatQuickMatches = useMemo(() => {
    const out: Array<{ path: string; line: number; column: number; lineText: string; matchText: string }> = [];
    for (const f of quickFiles) {
      for (const m of f.matches) {
        out.push({ path: f.path, line: m.line, column: m.column, lineText: m.lineText, matchText: m.matchText });
      }
    }
    return out;
  }, [quickFiles]);

  const activeQuickMatch = flatQuickMatches[quickSelectedIdx] ?? null;

  // Load surrounding context lines for Quick Search preview pane
  useEffect(() => {
    if (dialogMode !== "quick-search" || !activeQuickMatch) {
      setPreviewLines(null);
      return;
    }
    let cancelled = false;
    const openTab = openFiles.find((f) => f.path === activeQuickMatch.path);
    const loadContent = openTab
      ? Promise.resolve(openTab.content)
      : engine.call<string>("fileManager", "readFile", activeQuickMatch.path);

    loadContent
      .then((content) => {
        if (cancelled) return;
        const all = content.split(/\r?\n/);
        const start = Math.max(0, activeQuickMatch.line - 4);
        const end = Math.min(all.length, activeQuickMatch.line + 3);
        const slice = [];
        for (let i = start; i < end; i++) {
          slice.push({ num: i + 1, text: all[i] });
        }
        setPreviewLines({ path: activeQuickMatch.path, line: activeQuickMatch.line, lines: slice });
      })
      .catch(() => {
        if (!cancelled) setPreviewLines(null);
      });
    return () => {
      cancelled = true;
    };
  }, [dialogMode, activeQuickMatch, openFiles, engine]);

  if (dialogMode === "closed") return null;

  const submitEclipseSearch = async () => {
    if (!query.trim()) return;
    closeDialog();
    await runSearch({ revealInBottom: true });
  };

  const submitEclipseReplace = async () => {
    if (!query.trim()) return;
    await runReplaceAll();
    closeDialog();
  };

  const openMatchAndClose = async (m: { path: string; line: number; column: number }) => {
    closeDialog();
    await engine.call("fileManager", "open", m.path).catch(() => undefined);
    await engine.call("editor", "gotoLine", m.line, m.column).catch(() => undefined);
  };

  const switchTab = (tab: SearchDialogTab) => {
    if (tab === "silver") {
      setOptions({ dialogTab: tab, filePatterns: "*.sil" });
    } else if (tab === "symbol") {
      setOptions({ dialogTab: tab, filePatterns: "*.sil, *.ts, *.tsx" });
    } else {
      setOptions({ dialogTab: tab });
    }
  };

  // ============================================================================
  // Mode 2: Eclipse Quick Search Dialog (Ctrl+Alt+Shift+L / Ctrl+Shift+F)
  // ============================================================================
  if (dialogMode === "quick-search") {
    return (
      <div
        role="presentation"
        className="fixed inset-0 z-50 bg-black/65 backdrop-blur-[1px] flex items-center justify-center p-4"
        onClick={closeDialog}
      >
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Quick Search"
          className="w-full max-w-[740px] max-h-[88vh] flex flex-col overflow-hidden rounded-md border border-border bg-bg-elev shadow-2xl text-xs select-none"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Window Bar */}
          <div className="flex items-center justify-between px-3 py-1.5 bg-bg-panel border-b border-border">
            <div className="flex items-center gap-2">
              <Search size={13} className="text-accent" />
              <span className="font-semibold text-fg">Quick Search</span>
              <span className="text-[10px] font-mono text-fg-muted">Ctrl+Alt+Shift+L</span>
            </div>
            <button type="button" onClick={closeDialog} className="text-fg-muted hover:text-fg p-0.5 rounded hover:bg-bg-hover cursor-pointer">
              <X size={14} />
            </button>
          </div>

          {/* Search Input & Pattern Row */}
          <div className="p-3 bg-bg border-b border-border space-y-2">
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-muted" />
                <input
                  ref={inputRef}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "ArrowDown") {
                      e.preventDefault();
                      setQuickSelectedIdx((i) => Math.min(Math.max(0, flatQuickMatches.length - 1), i + 1));
                    } else if (e.key === "ArrowUp") {
                      e.preventDefault();
                      setQuickSelectedIdx((i) => Math.max(0, i - 1));
                    } else if (e.key === "Enter" && activeQuickMatch) {
                      e.preventDefault();
                      void openMatchAndClose(activeQuickMatch);
                    }
                  }}
                  placeholder="Type text or pattern to quick-search across workspace…"
                  className="input pl-8 py-1.5 font-mono text-xs w-full"
                />
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <span className="text-fg-muted text-[11px]">In:</span>
                <input
                  value={filePatterns}
                  onChange={(e) => setOptions({ filePatterns: e.target.value })}
                  className="input py-1.5 w-36 font-mono text-[11px]"
                  placeholder="*.sil, *.ts"
                  title="Comma-separated file patterns (e.g. *.sil, *.ts)"
                />
              </div>
              <button
                type="button"
                onClick={() => setOptions({ caseSensitive: !caseSensitive })}
                className={clsx(
                  "px-2 py-1 rounded border font-mono text-[11px] cursor-pointer",
                  caseSensitive ? "border-accent bg-accent/15 text-accent font-bold" : "border-border bg-bg-panel text-fg-muted"
                )}
                title="Case Sensitive"
              >
                Aa
              </button>
            </div>
          </div>

          {/* Live Matches List */}
          <div className="flex-1 min-h-0 flex flex-col divide-y divide-border">
            <div className="h-52 overflow-y-auto bg-bg">
              {quickBusy ? (
                <div className="p-4 flex items-center gap-2 text-fg-muted">
                  <Loader2 size={14} className="animate-spin text-accent" /> Searching workspace…
                </div>
              ) : flatQuickMatches.length === 0 ? (
                <div className="p-4 text-fg-muted">
                  {query.trim() ? "No matches found." : "Start typing above to search across all workspace files in real time."}
                </div>
              ) : (
                <ul className="divide-y divide-border/50">
                  {flatQuickMatches.map((m, idx) => {
                    const isSelected = idx === quickSelectedIdx;
                    return (
                      <li
                        key={`${m.path}:${m.line}:${m.column}:${idx}`}
                        onClick={() => setQuickSelectedIdx(idx)}
                        onDoubleClick={() => void openMatchAndClose(m)}
                        className={clsx(
                          "px-3 py-1.5 flex items-center justify-between gap-3 cursor-pointer font-mono text-[11px]",
                          isSelected ? "bg-accent/15 text-fg" : "hover:bg-bg-hover text-fg-muted"
                        )}
                      >
                        <span className="truncate flex-1 inline-flex items-center gap-1.5 min-w-0">
                          <FileIcon name={m.path} size={13} />
                          <span className="text-accent font-semibold shrink-0">{m.path.split("/").pop()}</span>
                          <span className="text-fg-muted shrink-0">:{m.line} </span>
                          <span className="text-fg truncate">{m.lineText.trim()}</span>
                        </span>
                        <span className="text-[10px] text-fg-muted shrink-0 truncate max-w-[180px]">{m.path}</span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            {/* Source Code Context Preview Pane */}
            <div className="h-40 bg-bg-panel p-2.5 flex flex-col">
              <div className="flex items-center justify-between text-[10px] text-fg-muted mb-1 font-mono">
                <span>{previewLines ? `${previewLines.path} (line ${previewLines.line})` : "Code preview"}</span>
                <span>Double-click or press Enter to open</span>
              </div>
              <div className="flex-1 overflow-auto rounded border border-border bg-bg p-2 font-mono text-[11px] space-y-0.5 select-text">
                {previewLines ? (
                  previewLines.lines.map((l) => (
                    <div
                      key={l.num}
                      className={clsx(
                        "px-1.5 py-0.5 rounded flex items-start gap-3",
                        l.num === previewLines.line ? "bg-warn/20 text-fg font-semibold border-l-2 border-accent" : "text-fg-muted"
                      )}
                    >
                      <span className="w-7 text-right text-fg-muted/60 select-none shrink-0">{l.num}</span>
                      <span className="whitespace-pre overflow-x-auto">{l.text}</span>
                    </div>
                  ))
                ) : (
                  <div className="text-fg-muted text-[11px] p-1">Select a match above to preview surrounding lines.</div>
                )}
              </div>
            </div>
          </div>

          {/* Footer */}
          <footer className="flex items-center justify-between px-4 py-2.5 bg-bg-panel border-t border-border">
            <span className="text-[11px] text-fg-muted font-mono">
              {flatQuickMatches.length} match{flatQuickMatches.length === 1 ? "" : "es"} in {quickFiles.length} file{quickFiles.length === 1 ? "" : "s"}
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={!query.trim()}
                onClick={() => void submitEclipseSearch()}
                className="btn-ghost border border-border px-3 py-1 text-xs"
                title="Open these results in the bottom Search panel"
              >
                <ExternalLink size={12} /> Open in Search View
              </button>
              <button
                type="button"
                disabled={!activeQuickMatch}
                onClick={() => activeQuickMatch && void openMatchAndClose(activeQuickMatch)}
                className="btn-primary px-4 py-1 text-xs"
              >
                Open Match
              </button>
              <button type="button" onClick={closeDialog} className="btn-ghost border border-border px-3 py-1 text-xs">
                Close
              </button>
            </div>
          </footer>
        </div>
      </div>
    );
  }

  // ============================================================================
  // Mode 1: Classic Eclipse Multi-Tab "Search" Dialog (Ctrl+H)
  // ============================================================================
  return (
    <div
      role="presentation"
      className="fixed inset-0 z-50 bg-black/65 backdrop-blur-[1px] flex items-center justify-center p-4"
      onClick={closeDialog}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="eclipse-search-dialog-title"
        className="w-full max-w-[650px] flex flex-col overflow-hidden rounded-md border border-border bg-bg-elev shadow-2xl text-xs select-none"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Classic Eclipse Window Header */}
        <div className="flex items-center justify-between px-3 py-1.5 bg-bg-panel border-b border-border">
          <div className="flex items-center gap-2">
            <Search size={13} className="text-accent" />
            <h2 id="eclipse-search-dialog-title" className="font-semibold text-fg">
              Search
            </h2>
          </div>
          <button type="button" onClick={closeDialog} className="text-fg-muted hover:text-fg p-0.5 rounded hover:bg-bg-hover cursor-pointer">
            <X size={14} />
          </button>
        </div>

        {/* Eclipse Search Mode Tabs */}
        <div className="flex items-center gap-1 px-3 pt-2 bg-bg border-b border-border">
          <button
            type="button"
            onClick={() => switchTab("file")}
            className={clsx(
              "flex items-center gap-1.5 px-3 py-1.5 rounded-t border-t border-x text-xs cursor-pointer -mb-px",
              dialogTab === "file"
                ? "border-border bg-bg-elev text-fg font-semibold"
                : "border-transparent text-fg-muted hover:text-fg"
            )}
          >
            <FileSearch size={13} className="text-accent" />
            File Search
          </button>
          <button
            type="button"
            onClick={() => switchTab("silver")}
            className={clsx(
              "flex items-center gap-1.5 px-3 py-1.5 rounded-t border-t border-x text-xs cursor-pointer -mb-px",
              dialogTab === "silver"
                ? "border-border bg-bg-elev text-fg font-semibold"
                : "border-transparent text-fg-muted hover:text-fg"
            )}
          >
            <ShieldCheck size={13} className="text-accent" />
            SilverScript / Covenant Search
          </button>
          <button
            type="button"
            onClick={() => switchTab("symbol")}
            className={clsx(
              "flex items-center gap-1.5 px-3 py-1.5 rounded-t border-t border-x text-xs cursor-pointer -mb-px",
              dialogTab === "symbol"
                ? "border-border bg-bg-elev text-fg font-semibold"
                : "border-transparent text-fg-muted hover:text-fg"
            )}
          >
            <Code2 size={13} className="text-accent" />
            TypeScript / Symbol Search
          </button>
        </div>

        {/* Form Body */}
        <div className="p-5 space-y-4">
          {/* Quick Construct Pills for SilverScript or Symbol tabs */}
          {dialogTab === "silver" && (
            <div className="rounded border border-accent/30 bg-accent/5 p-2.5 space-y-1.5">
              <div className="text-[11px] font-semibold text-fg flex items-center gap-1.5">
                <Sparkles size={12} className="text-accent" /> Quick SilverScript &amp; TX v1 Constructs
              </div>
              <div className="flex flex-wrap gap-1.5">
                {SILVER_QUICK_TOKENS.map((tok) => (
                  <button
                    key={tok.label}
                    type="button"
                    onClick={() => {
                      setQuery(tok.query);
                      setOptions({ filePatterns: tok.pattern });
                    }}
                    className="px-2 py-0.5 rounded border border-border bg-bg hover:bg-bg-hover font-mono text-[11px] text-accent cursor-pointer"
                  >
                    {tok.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {dialogTab === "symbol" && (
            <div className="rounded border border-border bg-bg-panel/60 p-2.5 space-y-1.5">
              <div className="text-[11px] font-semibold text-fg flex items-center gap-1.5">
                <FileCode2 size={12} className="text-accent" /> Quick TypeScript / Test Declarations
              </div>
              <div className="flex flex-wrap gap-1.5">
                {SYMBOL_QUICK_TOKENS.map((tok) => (
                  <button
                    key={tok.label}
                    type="button"
                    onClick={() => {
                      setQuery(tok.query);
                      setOptions({ filePatterns: tok.pattern });
                    }}
                    className="px-2 py-0.5 rounded border border-border bg-bg hover:bg-bg-hover font-mono text-[11px] text-accent cursor-pointer"
                  >
                    {tok.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Containing text row + options on right (just like Eclipse File Search) */}
          <div className="grid grid-cols-12 gap-4 items-start">
            <div className="col-span-8 space-y-1.5">
              <label htmlFor="eclipse-search-input" className="block text-fg font-medium">
                Containing text:
              </label>
              <input
                id="eclipse-search-input"
                ref={inputRef}
                list="eclipse-search-history"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void submitEclipseSearch();
                  }
                }}
                placeholder="Search string (e.g. tx.outputs, PaymentSplitter, checkSig)…"
                className="input font-mono py-1.5 w-full"
              />
              <datalist id="eclipse-search-history">
                {history.map((h) => (
                  <option key={h} value={h} />
                ))}
              </datalist>
              <div className="text-[10px] text-fg-muted">(* = any string, ? = any character, \ = escape for literals)</div>

              {showReplace && (
                <div className="pt-2 space-y-1">
                  <label htmlFor="eclipse-replace-input" className="block text-fg font-medium">
                    Replace with:
                  </label>
                  <input
                    id="eclipse-replace-input"
                    value={replacement}
                    onChange={(e) => setReplacement(e.target.value)}
                    placeholder="Replacement text…"
                    className="input font-mono py-1.5 w-full"
                  />
                </div>
              )}
            </div>

            <div className="col-span-4 space-y-2 pt-5">
              <label className="flex items-center gap-2 cursor-pointer text-fg">
                <input
                  type="checkbox"
                  checked={caseSensitive}
                  onChange={(e) => setOptions({ caseSensitive: e.target.checked })}
                />
                <span>Case sensitive</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer text-fg">
                <input
                  type="checkbox"
                  checked={regex}
                  onChange={(e) => setOptions({ regex: e.target.checked })}
                />
                <span>Regular expression</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer text-fg">
                <input
                  type="checkbox"
                  checked={wholeWord}
                  onChange={(e) => setOptions({ wholeWord: e.target.checked })}
                />
                <span>Whole word</span>
              </label>
            </div>
          </div>

          {/* File name patterns */}
          <div className="space-y-1.5">
            <label htmlFor="eclipse-file-patterns" className="block text-fg font-medium">
              File name patterns:
            </label>
            <div className="flex items-center gap-2">
              <input
                id="eclipse-file-patterns"
                value={filePatterns}
                onChange={(e) => setOptions({ filePatterns: e.target.value })}
                className="input font-mono py-1 flex-1"
                placeholder="*.sil, *.ts, *.tsx"
              />
              <select
                aria-label="Choose file pattern preset"
                value={FILE_PATTERN_PRESETS.some((p) => p.value === filePatterns) ? filePatterns : ""}
                onChange={(e) => e.target.value && setOptions({ filePatterns: e.target.value })}
                className="input py-1 w-48 text-[11px]"
              >
                <option value="" disabled>
                  Choose preset…
                </option>
                {FILE_PATTERN_PRESETS.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="text-[10px] text-fg-muted">Patterns are separated by a comma (,) — e.g. *.sil, *.ts, *.json</div>
          </div>

          {/* Scope Fieldset (Eclipse style) */}
          <fieldset className="border border-border rounded px-3.5 py-2.5 bg-bg-panel/40 space-y-2">
            <legend className="px-1.5 text-[11px] font-semibold text-fg">Scope</legend>
            <div className="grid grid-cols-2 gap-2">
              <label className="flex items-center gap-2 cursor-pointer text-fg">
                <input
                  type="radio"
                  name="search-scope"
                  checked={scope === "workspace"}
                  onChange={() => setOptions({ scope: "workspace" as SearchScope })}
                />
                <span>Workspace (all project files)</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer text-fg">
                <input
                  type="radio"
                  name="search-scope"
                  checked={scope === "open-files"}
                  onChange={() => setOptions({ scope: "open-files" as SearchScope })}
                />
                <span>Open editors ({openFiles.filter((f) => f.kind !== "view").length})</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer text-fg">
                <input
                  type="radio"
                  name="search-scope"
                  checked={scope === "current-file"}
                  disabled={!activeFile || activeFile.startsWith("view:")}
                  onChange={() => setOptions({ scope: "current-file" as SearchScope })}
                />
                <span className="truncate">Current file ({activeFile?.split("/").pop() || "none"})</span>
              </label>
              <div className="flex items-center gap-2">
                <label className="flex items-center gap-2 cursor-pointer text-fg shrink-0">
                  <input
                    type="radio"
                    name="search-scope"
                    checked={scope === "directory"}
                    onChange={() => setOptions({ scope: "directory" as SearchScope, scopeDir: scopeDir || "contracts" })}
                  />
                  <span>Folder:</span>
                </label>
                <input
                  value={scopeDir}
                  disabled={scope !== "directory"}
                  onChange={(e) => setOptions({ scopeDir: e.target.value })}
                  placeholder="contracts"
                  className="input py-0.5 px-2 font-mono text-[11px] flex-1 disabled:opacity-50"
                />
              </div>
            </div>
          </fieldset>
        </div>

        {/* Classic Eclipse Dialog Footer */}
        <footer className="flex items-center justify-between px-5 py-3 bg-bg-panel border-t border-border">
          <button
            type="button"
            onClick={() => useSearch.getState().openSearchDialog({ mode: "quick-search" })}
            className="text-[11px] text-accent hover:underline flex items-center gap-1 cursor-pointer"
          >
            <FolderSearch size={13} /> Switch to Live Quick Search…
          </button>

          <div className="flex items-center gap-2">
            {!showReplace ? (
              <button
                type="button"
                onClick={() => setShowReplace(true)}
                className="btn-ghost border border-border px-3.5 py-1 text-xs"
              >
                <Replace size={12} /> Replace…
              </button>
            ) : (
              <button
                type="button"
                disabled={!query.trim()}
                onClick={() => void submitEclipseReplace()}
                className="btn-ghost border border-warn/50 bg-warn/10 text-warn hover:bg-warn/20 px-3.5 py-1 text-xs"
              >
                <Replace size={12} /> Replace All
              </button>
            )}
            <button
              type="button"
              disabled={!query.trim()}
              onClick={() => void submitEclipseSearch()}
              className="btn-primary px-5 py-1 text-xs font-semibold"
            >
              Search
            </button>
            <button
              type="button"
              onClick={closeDialog}
              className="btn-ghost border border-border px-4 py-1 text-xs"
            >
              Cancel
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
