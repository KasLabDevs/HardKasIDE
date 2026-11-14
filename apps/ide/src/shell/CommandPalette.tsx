import clsx from "clsx";
import { Command, Hash, Search, Terminal } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { api, type CliCatalogCommand } from "@/api/client";
import { FileIcon } from "@/components/FileIcon";
import { useEngine } from "@/engine/context";
import type { CompilerPlugin } from "@/plugins/compiler";
import type { EditorPlugin } from "@/plugins/editor";
import type { EnvironmentPlugin } from "@/plugins/environment";
import type { LineagePlugin } from "@/plugins/lineage";
import { DEFAULT_ZOOM, useIde } from "@/store/ide";
import { useUpdates } from "@/store/updates";
import { extractDocumentSymbols } from "@/utils/symbols";
import { SymbolIcon } from "./Breadcrumbs";
import {
  PALETTE_EVENT,
  confirmAndResetNode,
  isTextFile,
  openPalette,
  zoomBy
} from "./actions";
import {
  filePathBonus,
  flattenTreePaths,
  parsePaletteQuery,
  scorePaletteMatch,
  type PaletteMode
} from "./commandPaletteModel";

interface PaletteItem {
  id: string;
  group?: string;
  kind: "file" | "command" | "symbol" | "line";
  title: string;
  hint?: string;
  keys?: string;
  badge?: string;
  indices?: number[];
  symbolKind?: ReturnType<typeof extractDocumentSymbols>[number]["kind"];
  indent?: boolean;
  run: () => void | Promise<unknown>;
}

/**
 * VS Code-style Quick Open & Command Center:
 * - `Ctrl+P` / click TitleBar: files + recent files (and matching commands; supports `file.sil:line`)
 * - `> ` / `Ctrl+Shift+P` / `Ctrl+K`: IDE + HardKas CLI commands
 * - `@` / `Ctrl+Shift+O`: symbols in active file (.sil contracts/entries, TS functions/tests, MD headings, JSON keys)
 * - `:` / `Ctrl+G`: jump to line with live snippet preview
 */
export function CommandPalette() {
  const engine = useEngine();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const activeFile = useIde((s) => s.activeFile);
  const openFiles = useIde((s) => s.openFiles);
  const recentFiles = useIde((s) => s.recentFiles);
  const tree = useIde((s) => s.tree);
  const [catalogItems, setCatalogItems] = useState<PaletteItem[]>([]);

  const activeTextDoc = useMemo(
    () => (isTextFile(activeFile) ? openFiles.find((f) => f.path === activeFile) ?? null : null),
    [activeFile, openFiles]
  );

  useEffect(() => {
    api.cli
      .catalog()
      .then((cat) => {
        if (!cat.ok || !Array.isArray(cat.commands)) return;
        const items: PaletteItem[] = [];
        const flatten = (cmds: CliCatalogCommand[], prefix: string[] = []) => {
          for (const c of cmds) {
            if (c.hidden) continue;
            const fullPath = [...prefix, c.name];
            const pathStr = fullPath.join(" ");
            if (c.commands && c.commands.length > 0) {
              flatten(c.commands, fullPath);
            } else {
              items.push({
                id: `cli:${pathStr}`,
                kind: "command",
                title: `CLI: hardkas ${pathStr}`,
                hint: c.summary || c.description || `Run hardkas ${pathStr}`,
                run: async () => {
                  useIde.getState().setTerminalOpen(true);
                  await engine.call("console", "runHardkas", [...fullPath, "--json"]);
                }
              });
            }
          }
        };
        flatten(cat.commands);
        setCatalogItems(items);
      })
      .catch(() => {});
  }, [engine]);

  const baseCommands = useMemo<PaletteItem[]>(() => {
    const ide = useIde.getState;
    return [
      { id: "compile", kind: "command", title: "Compile current SilverScript file", keys: "Ctrl+Enter", hint: "hardkas silver compile", run: () => engine.get<CompilerPlugin>("silverCompiler").compileCurrent() },
      { id: "save", kind: "command", title: "Save file", keys: "Ctrl+S", run: () => engine.call("fileManager", "saveCurrentFile") },
      { id: "lineage", kind: "command", title: "Show lineage graph", hint: "live artifact provenance", run: () => engine.get<LineagePlugin>("lineage").open() },
      { id: "covenant", kind: "command", title: "Show Covenant graph", hint: "visual UTXO & contract execution flow", run: () => engine.call("covenant", "open") },
      { id: "tests", kind: "command", title: "Run all tests", hint: "vitest, JUnit-style results", run: () => engine.call("tests", "run") },
      { id: "tests:view", kind: "command", title: "Show Tests view", run: () => engine.call("tests", "open") },
      { id: "debug:file", kind: "command", title: "Debug: debug the tests in the open file", keys: "F5", hint: "breakpoints, stepping", run: () => (activeFile ? engine.call("debug", "debugFile", activeFile) : engine.call("debug", "debugAll")) },
      { id: "debug:all", kind: "command", title: "Debug: debug all tests", run: () => engine.call("debug", "debugAll") },
      { id: "debug:stop", kind: "command", title: "Debug: stop debugging", keys: "Shift+F5", run: () => engine.call("debug", "stop") },
      { id: "debug:clear", kind: "command", title: "Debug: remove all breakpoints", run: () => engine.call("debug", "clearBreakpoints") },
      { id: "debug:view", kind: "command", title: "Debug: show the debugger (in the Tests view)", run: () => engine.call("tests", "open") },
      { id: "index", kind: "command", title: "Show Index (artifacts, events and SQL over HardKAS's query store)", run: () => engine.call("queryIndex", "open") },
      { id: "index:sql", kind: "command", title: "Index: open the SQL console", run: () => engine.call("queryIndex", "open", "sql") },
      { id: "index:sync", kind: "command", title: "Index: sync new artifacts into the query store", hint: "hardkas query store sync", run: () => engine.call("queryIndex", "sync") },
      { id: "history", kind: "command", title: "Show Run history (payments, deploys, contract calls)", run: () => engine.call("runHistory", "open") },
      { id: "go:symbol", kind: "command", title: "Go to Symbol in Editor…", keys: "Ctrl+Shift+O", run: () => openPalette("@") },
      { id: "go:line", kind: "command", title: "Go to Line/Column…", keys: "Ctrl+G", run: () => openPalette(":") },
      { id: "outline", kind: "command", title: "Toggle Outline", run: () => ide().setOutlineOpen(!ide().outlineOpen) },
      { id: "layout:reset", kind: "command", title: "Layout: reset panels to their default places", hint: "undo any docking", run: () => ide().resetLayout() },
      { id: "run", kind: "command", title: "Open Deploy & Run", run: () => ide().setActiveSidePlugin("deployRun") },
      { id: "servers", kind: "command", title: "Open Servers (node & accounts)", run: () => ide().setActiveSidePlugin("environment") },
      { id: "accounts", kind: "command", title: "Open Accounts (keys & balances)", run: () => ide().setActiveSidePlugin("accounts") },
      { id: "assistant", kind: "command", title: "Open Assistant (chat about Kaspa & SilverScript)", hint: "grounded in docs.kaspa.org", run: () => ide().revealPlugin("assistant", "Assistant") },
      { id: "artifacts", kind: "command", title: "Open Index (artifacts, transactions, SQL)", hint: "the files HardKAS wrote in .hardkas/", run: () => void engine.call("queryIndex", "open") },
      { id: "files", kind: "command", title: "Open Explorer", run: () => ide().setActiveSidePlugin("files") },
      { id: "node:start", kind: "command", title: "Node: start localnet (rusty-kaspad)", hint: "hardkas localnet start --toccata", run: () => engine.get<EnvironmentPlugin>("environment").startNode() },
      { id: "node:stop", kind: "command", title: "Node: stop localnet", hint: "hardkas localnet stop", run: () => engine.get<EnvironmentPlugin>("environment").stopNode() },
      { id: "node:restart", kind: "command", title: "Node: restart localnet", run: () => engine.get<EnvironmentPlugin>("environment").restartNode() },
      { id: "node:reset", kind: "command", title: "Node: reset from scratch (wipes the local chain)", hint: "hardkas node reset --yes", run: () => confirmAndResetNode(engine) },
      { id: "sidebar", kind: "command", title: "View: toggle primary side bar", keys: "Ctrl+B", run: () => ide().setSidebarOpen(!ide().sidebarOpen) },
      { id: "terminal:new", kind: "command", title: "Terminal: new terminal", keys: "Ctrl+Shift+`", run: () => ide().requestTerminal() },
      { id: "zoom:in", kind: "command", title: "View: zoom in", keys: "Ctrl+=", run: () => zoomBy(10) },
      { id: "zoom:out", kind: "command", title: "View: zoom out", keys: "Ctrl+-", run: () => zoomBy(-10) },
      { id: "zoom:reset", kind: "command", title: "View: reset zoom", keys: "Ctrl+0", run: () => ide().setZoom(DEFAULT_ZOOM) },
      { id: "accounts:refresh", kind: "command", title: "Accounts: refresh balances", run: () => engine.get<EnvironmentPlugin>("environment").refreshAccounts() },
      { id: "target:simulator", kind: "command", title: "Target: simulator", run: () => ide().setTarget("simulator") },
      { id: "target:localnet", kind: "command", title: "Target: localnet (simnet)", run: () => ide().setTarget("localnet") },
      { id: "target:rpc", kind: "command", title: "Target: rpc (testnet-10)", run: () => ide().setTarget("rpc") },
      { id: "dev", kind: "command", title: "Start HardKas dev-server (headless)", hint: "hardkas dev --headless", run: () => engine.call("console", "runHardkas", ["dev", "--headless"]) },
      { id: "panel", kind: "command", title: "Toggle console / terminal panel", run: () => ide().setTerminalOpen(!ide().terminalOpen) },
      {
        id: "help:updates",
        kind: "command",
        title: "Help: Check for Updates",
        hint: "check IDE release and HardKas CLI version",
        run: () => {
          useUpdates.getState().openPopover();
          void useUpdates.getState().check(true);
        }
      },
      ...catalogItems
    ];
  }, [engine, activeFile, catalogItems]);

  const parsed = useMemo(() => parsePaletteQuery(query), [query]);

  const workspacePaths = useMemo(() => {
    const includeNoise = parsed.filter.toLowerCase().includes("node_modules");
    return flattenTreePaths(tree, includeNoise);
  }, [tree, parsed.filter]);

  const activeSymbols = useMemo(
    () => (activeTextDoc ? extractDocumentSymbols(activeTextDoc.path, activeTextDoc.content) : []),
    [activeTextDoc]
  );

  const activeLines = useMemo(
    () => (activeTextDoc ? activeTextDoc.content.split(/\r?\n/) : []),
    [activeTextDoc]
  );

  const results = useMemo<PaletteItem[]>(() => {
    const openSet = new Set(openFiles.map((f) => f.path));

    if (parsed.mode === "symbols") {
      if (!activeTextDoc) return [];
      const q = parsed.filter;
      const scored = activeSymbols
        .map((sym) => {
          const m = scorePaletteMatch(q, sym.name);
          if (!m) {
            const detailHit = sym.detail && sym.detail.toLowerCase().includes(q.toLowerCase());
            if (!detailHit) return null;
            return { sym, score: 15, indices: [] as number[] };
          }
          return { sym, score: m.score + (sym.kind === "contract" ? 10 : 0), indices: m.indices };
        })
        .filter((x): x is { sym: (typeof activeSymbols)[number]; score: number; indices: number[] } => x !== null);
      if (q) scored.sort((a, b) => b.score - a.score || a.sym.line - b.sym.line);
      return scored.map(({ sym, indices }) => ({
        id: sym.id,
        kind: "symbol",
        symbolKind: sym.kind,
        indent: Boolean(sym.parentId && !q),
        title: sym.name,
        hint: sym.detail,
        badge: `Ln ${sym.line}`,
        indices,
        run: () => engine.get<EditorPlugin>("editor").gotoLine(sym.line)
      }));
    }

    if (parsed.mode === "line") {
      if (!activeTextDoc) return [];
      const total = Math.max(1, activeLines.length);
      const target = parsed.line !== null ? Math.min(parsed.line, total) : 1;
      const col = parsed.column ?? 1;
      return [
        {
          id: `goto:${target}:${col}`,
          kind: "line",
          title:
            parsed.line !== null
              ? `Jump to line ${target}${parsed.column ? `, column ${col}` : ""} of ${total}`
              : `Enter a line number (1–${total})`,
          hint: activeTextDoc.path,
          run: () => engine.get<EditorPlugin>("editor").gotoLine(target, col)
        }
      ];
    }

    if (parsed.mode === "commands") {
      return rankCommandItems(baseCommands, parsed.filter, 24);
    }

    // Default Quick Open (`Files` + recent + matching commands when typing text without prefix)
    const recentOrder = new Map<string, number>();
    for (const p of recentFiles) {
      if (!recentOrder.has(p)) recentOrder.set(p, recentOrder.size);
    }
    const allPaths = [...new Set([...recentFiles.filter((p) => workspacePaths.includes(p)), ...workspacePaths])];
    const openFile = (path: string) => async () => {
      await engine.call("fileManager", "open", path);
      if (parsed.line !== null) {
        engine.get<EditorPlugin>("editor").gotoFileLine(path, parsed.line, parsed.column ?? 1);
      }
    };

    if (!parsed.filter) {
      const scoredEmpty = allPaths.map((p) => ({
        path: p,
        recentIdx: recentOrder.get(p) ?? -1,
        score: filePathBonus(p, recentOrder.get(p) ?? -1, openSet.has(p))
      }));
      scoredEmpty.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
      return scoredEmpty.slice(0, 20).map(({ path, recentIdx }) => ({
        id: `open:${path}`,
        kind: "file" as const,
        group: recentIdx >= 0 ? "recently opened" : "workspace files",
        title: path,
        badge: parsed.line ? `:${parsed.line}` : recentIdx >= 0 ? "recent" : undefined,
        run: openFile(path)
      }));
    }

    const fileMatches = allPaths
      .map((path) => {
        const m = scorePaletteMatch(parsed.filter, path);
        if (!m) return null;
        const recentIdx = recentOrder.get(path) ?? -1;
        return {
          path,
          indices: m.indices,
          recentIdx,
          score: m.score + filePathBonus(path, recentIdx, openSet.has(path))
        };
      })
      .filter((x): x is { path: string; indices: number[]; recentIdx: number; score: number } => x !== null)
      .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path))
      .slice(0, 14)
      .map<PaletteItem>(({ path, indices, recentIdx }) => ({
        id: `open:${path}`,
        kind: "file",
        title: path,
        indices,
        badge: parsed.line ? `:${parsed.line}` : recentIdx >= 0 ? "recent" : undefined,
        run: openFile(path)
      }));

    if (parsed.line !== null) return fileMatches;

    const cmdMatches = rankCommandItems(baseCommands, parsed.filter, fileMatches.length > 0 ? 8 : 18, "Commands");
    return [...fileMatches, ...cmdMatches];
  }, [parsed, openFiles, recentFiles, workspacePaths, activeTextDoc, activeSymbols, activeLines.length, baseCommands, engine]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      const lower = e.key.toLowerCase();
      if (mod && e.shiftKey && lower === "p") {
        e.preventDefault();
        if (open && query.startsWith(">")) setOpen(false);
        else {
          setQuery("> ");
          setOpen(true);
        }
      } else if (mod && e.shiftKey && lower === "o") {
        e.preventDefault();
        if (open && query.startsWith("@")) setOpen(false);
        else {
          setQuery("@");
          setOpen(true);
        }
      } else if (mod && !e.shiftKey && lower === "g") {
        if (!activeTextDoc) return;
        e.preventDefault();
        if (open && query.startsWith(":")) setOpen(false);
        else {
          setQuery(":");
          setOpen(true);
        }
      } else if (mod && !e.shiftKey && lower === "k") {
        e.preventDefault();
        if (open && query.startsWith(">")) setOpen(false);
        else {
          setQuery("> ");
          setOpen(true);
        }
      } else if (mod && !e.shiftKey && lower === "p") {
        e.preventDefault();
        if (open && !query.startsWith(">") && !query.startsWith("@") && !query.startsWith(":")) setOpen(false);
        else {
          setQuery("");
          setOpen(true);
        }
      } else if (mod && e.key === "Enter") {
        if (activeFile?.endsWith(".sil")) {
          e.preventDefault();
          void engine.get<CompilerPlugin>("silverCompiler").compileCurrent();
        }
      } else if (e.key === "Escape" && open) {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [engine, activeFile, activeTextDoc, open, query]);

  useEffect(() => {
    const onOpen = (e: Event) => {
      const detail = (e as CustomEvent<{ initialQuery?: string }>).detail;
      setQuery(detail?.initialQuery ?? "");
      setIndex(0);
      setOpen(true);
    };
    window.addEventListener(PALETTE_EVENT, onOpen);
    return () => window.removeEventListener(PALETTE_EVENT, onOpen);
  }, []);

  useEffect(() => {
    if (!open) return;
    setIndex(0);
    setTimeout(() => {
      const el = inputRef.current;
      if (!el) return;
      el.focus();
      const len = el.value.length;
      el.setSelectionRange(len, len);
    }, 10);
  }, [open]);

  useEffect(() => {
    if (!open || !listRef.current) return;
    const row = listRef.current.querySelector<HTMLElement>(`[data-palette-idx="${index}"]`);
    row?.scrollIntoView({ block: "nearest" });
  }, [index, open]);

  if (!open) return null;

  const runItem = (item: PaletteItem) => {
    setOpen(false);
    void Promise.resolve(item.run()).catch((e: unknown) => engine.call("console", "error", String(e)));
  };

  const switchMode = (nextMode: PaletteMode) => {
    const body = parsed.filter;
    if (nextMode === "files") setQuery(body);
    else if (nextMode === "commands") setQuery(`> ${body}`);
    else if (nextMode === "symbols") setQuery(`@${body}`);
    else setQuery(":");
    setIndex(0);
    inputRef.current?.focus();
  };

  const lineTarget =
    parsed.mode === "line" && parsed.line !== null
      ? Math.min(Math.max(1, parsed.line), Math.max(1, activeLines.length))
      : null;

  return (
    <div role="presentation" className="fixed inset-0 z-50 bg-black/45 flex items-start justify-center pt-16 px-4" onClick={() => setOpen(false)}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        className="w-full max-w-xl rounded-lg border border-border bg-bg-elev shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 px-3 border-b border-border">
          {parsed.mode === "commands" ? (
            <Command size={14} className="text-accent shrink-0" />
          ) : parsed.mode === "symbols" ? (
            <Hash size={14} className="text-accent shrink-0" />
          ) : parsed.mode === "line" ? (
            <Terminal size={14} className="text-accent shrink-0" />
          ) : (
            <Search size={14} className="text-fg-muted shrink-0" />
          )}
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setIndex(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                setIndex((i) => Math.min(i + 1, Math.max(0, results.length - 1)));
                e.preventDefault();
              } else if (e.key === "ArrowUp") {
                setIndex((i) => Math.max(i - 1, 0));
                e.preventDefault();
              } else if (e.key === "Enter" && results[index]) {
                e.preventDefault();
                runItem(results[index]);
              }
            }}
            placeholder={
              parsed.mode === "commands"
                ? "Type a command name…"
                : parsed.mode === "symbols"
                  ? "Filter symbols in active file…"
                  : parsed.mode === "line"
                    ? `Go to line (1–${Math.max(1, activeLines.length)})…`
                    : "Search files by name (append :line), > commands, @ symbols, : line…"
            }
            className="flex-1 bg-transparent py-2.5 text-sm outline-none text-fg placeholder:text-fg-muted/60 min-w-0"
          />
          <kbd className="text-[12px] border border-border rounded px-1.5 py-0.5 text-fg-muted shrink-0">Esc</kbd>
        </div>

        <div className="flex items-center gap-1 px-3 py-1.5 border-b border-border/70 bg-bg-panel text-[12px] select-none">
          <ModePill active={parsed.mode === "files"} onClick={() => switchMode("files")} label="Files" />
          <ModePill active={parsed.mode === "commands"} onClick={() => switchMode("commands")} label="> Commands" />
          <ModePill
            active={parsed.mode === "symbols"}
            disabled={!activeTextDoc}
            onClick={() => switchMode("symbols")}
            label="@ Symbols"
          />
          <ModePill
            active={parsed.mode === "line"}
            disabled={!activeTextDoc}
            onClick={() => switchMode("line")}
            label=": Line"
          />
          {activeTextDoc && parsed.mode === "symbols" && (
            <span className="ml-auto text-[12px] text-fg-muted truncate max-w-[180px]">{activeTextDoc.path}</span>
          )}
        </div>

        {parsed.mode === "line" && lineTarget !== null && activeTextDoc && (
          <div className="border-b border-border/70 bg-bg px-3 py-2 font-mono text-[12px] space-y-0.5">
            {[-1, 0, 1].map((offset) => {
              const ln = lineTarget + offset;
              if (ln < 1 || ln > activeLines.length) return null;
              const isTarget = offset === 0;
              return (
                <div
                  key={ln}
                  className={clsx(
                    "flex items-center gap-3 px-1.5 py-0.5 rounded",
                    isTarget ? "bg-accent/15 text-fg" : "text-fg-muted/70"
                  )}
                >
                  <span className="w-8 text-right tabular-nums shrink-0 opacity-75">{ln}</span>
                  <span className="truncate whitespace-pre">{activeLines[ln - 1] || " "}</span>
                </div>
              );
            })}
          </div>
        )}

        <ul ref={listRef} className="max-h-80 overflow-auto py-1 text-xs">
          {results.length === 0 && (
            <li className="px-3 py-3 text-fg-muted">
              {parsed.mode === "symbols"
                ? activeTextDoc
                  ? "No matching symbols in active file."
                  : "Open a text file to jump between its symbols."
                : parsed.mode === "line"
                  ? "Open a text file to jump to a line."
                  : "No matching files or commands."}
            </li>
          )}
          {results.map((c, i) => {
            const prevGroup = i > 0 ? results[i - 1].group : undefined;
            const showGroupHeader = c.group && c.group !== prevGroup && parsed.mode === "files" && Boolean(parsed.filter);
            return (
              <li key={c.id} data-palette-idx={i}>
                {showGroupHeader && (
                  <div className="px-3 pt-2 pb-1 text-[12px] uppercase tracking-wider text-fg-muted border-t border-border/60 mt-1">
                    {c.group}
                  </div>
                )}
                <div
                  role="button"
                  tabIndex={-1}
                  onMouseEnter={() => setIndex(i)}
                  onClick={() => runItem(c)}
                  className={clsx(
                    "px-3 py-1.5 flex items-center gap-2.5 cursor-pointer",
                    c.indent && "pl-7",
                    i === index ? "bg-bg-hover text-fg" : "text-fg-muted"
                  )}
                >
                  {c.kind === "file" ? (
                    <FileIcon name={c.title} size={14} />
                  ) : c.kind === "symbol" && c.symbolKind ? (
                    <SymbolIcon kind={c.symbolKind} />
                  ) : c.kind === "line" ? (
                    <Terminal size={13} className="text-accent shrink-0" />
                  ) : null}
                  <span className="flex-1 min-w-0 truncate">
                    <HighlightedText text={c.title} indices={c.indices} className="text-fg" />
                    {c.hint && <span className="ml-2 text-fg-muted">{c.hint}</span>}
                  </span>
                  {c.badge && (
                    <span className="text-[12px] text-fg-muted tabular-nums px-1.5 py-0.5 rounded bg-bg border border-border/60 shrink-0">
                      {c.badge}
                    </span>
                  )}
                  {c.keys && <kbd className="text-[12px] border border-border rounded px-1 text-fg-muted shrink-0">{c.keys}</kbd>}
                </div>
              </li>
            );
          })}
        </ul>

        <div className="px-3 py-1.5 border-t border-border/70 bg-bg-panel text-[12px] text-fg-muted flex flex-wrap items-center gap-x-3 gap-y-1 select-none">
          <span>↑↓ navigate</span>
          <span>Enter open</span>
          <span>&gt; commands</span>
          <span>@ symbols</span>
          <span>: line</span>
          <span className="ml-auto">Esc close</span>
        </div>
      </div>
    </div>
  );
}

function ModePill({
  active,
  disabled,
  label,
  onClick
}: {
  active: boolean;
  disabled?: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={clsx(
        "px-2 py-0.5 rounded transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed",
        active ? "bg-accent/15 text-accent font-medium" : "text-fg-muted hover:text-fg hover:bg-bg-hover"
      )}
    >
      {label}
    </button>
  );
}

function HighlightedText({
  text,
  indices,
  className
}: {
  text: string;
  indices?: number[];
  className?: string;
}) {
  if (!indices || indices.length === 0) return <span className={className}>{text}</span>;
  const set = new Set(indices);
  return (
    <span className={className}>
      {Array.from(text).map((ch, idx) =>
        set.has(idx) ? (
          <span key={idx} className="text-accent font-semibold">
            {ch}
          </span>
        ) : (
          ch
        )
      )}
    </span>
  );
}

function rankCommandItems(commands: PaletteItem[], filter: string, limit: number, group?: string): PaletteItem[] {
  const q = filter.trim();
  if (!q) return commands.slice(0, limit);
  const scored: Array<{ item: PaletteItem; score: number }> = [];
  const lowerQ = q.toLowerCase();
  for (const c of commands) {
    const titleMatch = scorePaletteMatch(q, c.title);
    if (titleMatch) {
      scored.push({ item: { ...c, group: group ?? c.group, indices: titleMatch.indices }, score: titleMatch.score });
    } else if (c.hint && c.hint.toLowerCase().includes(lowerQ)) {
      scored.push({ item: { ...c, group: group ?? c.group, indices: [] }, score: 25 });
    }
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((s) => s.item);
}
