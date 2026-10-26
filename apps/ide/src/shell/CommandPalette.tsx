import clsx from "clsx";
import { Command } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useEngine } from "@/engine/context";
import type { CompilerPlugin } from "@/plugins/compiler";
import type { EnvironmentPlugin } from "@/plugins/environment";
import type { LineagePlugin } from "@/plugins/lineage";
import { DEFAULT_ZOOM, useIde } from "@/store/ide";
import { PALETTE_EVENT, confirmAndResetNode, zoomBy } from "./actions";

interface CommandItem {
  id: string;
  title: string;
  hint?: string;
  keys?: string;
  run: () => void | Promise<unknown>;
}

/** VS Code-style command palette: Ctrl+Shift+P (or Ctrl+K). Also owns the global shortcuts. */
export function CommandPalette() {
  const engine = useEngine();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const activeFile = useIde((s) => s.activeFile);
  const tree = useIde((s) => s.tree);

  const commands = useMemo<CommandItem[]>(() => {
    const ide = useIde.getState;
    const files: CommandItem[] = [];
    const walk = (nodes: typeof tree) => {
      for (const n of nodes) {
        if (n.type === "file") files.push({ id: `open:${n.path}`, title: n.path, hint: "open file", run: () => engine.call("fileManager", "open", n.path) });
        else if (n.children) walk(n.children);
      }
    };
    walk(tree);
    return [
      { id: "compile", title: "Compile current SilverScript file", keys: "Ctrl+Enter", hint: "hardkas silver compile", run: () => engine.get<CompilerPlugin>("silverCompiler").compileCurrent() },
      { id: "save", title: "Save file", keys: "Ctrl+S", run: () => engine.call("fileManager", "saveCurrentFile") },
      { id: "lineage", title: "Show lineage graph", hint: "live artifact provenance", run: () => engine.get<LineagePlugin>("lineage").open() },
      { id: "tests", title: "Run all tests", hint: "vitest, JUnit-style results", run: () => engine.call("tests", "run") },
      { id: "tests:view", title: "Show Tests view", run: () => engine.call("tests", "open") },
      { id: "debug:file", title: "Debug: debug the tests in the open file", keys: "F5", hint: "breakpoints, stepping", run: () => (activeFile ? engine.call("debug", "debugFile", activeFile) : engine.call("debug", "debugAll")) },
      { id: "debug:all", title: "Debug: debug all tests", run: () => engine.call("debug", "debugAll") },
      { id: "debug:stop", title: "Debug: stop debugging", keys: "Shift+F5", run: () => engine.call("debug", "stop") },
      { id: "debug:clear", title: "Debug: remove all breakpoints", run: () => engine.call("debug", "clearBreakpoints") },
      { id: "debug:view", title: "Debug: show the Debug view", run: () => ide().revealPlugin("debug", "Debug") },
      { id: "history", title: "Show Run history (payments, deploys, contract calls)", run: () => engine.call("runHistory", "open") },
      { id: "outline", title: "Toggle Outline", run: () => ide().setOutlineOpen(!ide().outlineOpen) },
      { id: "layout:reset", title: "Layout: reset panels to their default places", hint: "undo any docking", run: () => ide().resetLayout() },
      { id: "run", title: "Open Deploy & Run", run: () => ide().setActiveSidePlugin("deployRun") },
      { id: "servers", title: "Open Servers (node & accounts)", run: () => ide().setActiveSidePlugin("environment") },
      { id: "accounts", title: "Open Accounts (keys & balances)", run: () => ide().setActiveSidePlugin("accounts") },
      { id: "assistant", title: "Open Assistant (chat about Kaspa & SilverScript)", hint: "grounded in docs.kaspa.org", run: () => ide().revealPlugin("assistant", "Assistant") },
      { id: "artifacts", title: "Open Artifacts", run: () => ide().setActiveSidePlugin("artifacts") },
      { id: "files", title: "Open Explorer", run: () => ide().setActiveSidePlugin("files") },
      { id: "node:start", title: "Node: start localnet (rusty-kaspad)", hint: "hardkas localnet start --toccata", run: () => engine.get<EnvironmentPlugin>("environment").startNode() },
      { id: "node:stop", title: "Node: stop localnet", hint: "hardkas localnet stop", run: () => engine.get<EnvironmentPlugin>("environment").stopNode() },
      { id: "node:restart", title: "Node: restart localnet", run: () => engine.get<EnvironmentPlugin>("environment").restartNode() },
      { id: "node:reset", title: "Node: reset from scratch (wipes the local chain)", hint: "hardkas node reset --yes", run: () => confirmAndResetNode(engine) },
      { id: "sidebar", title: "View: toggle primary side bar", keys: "Ctrl+B", run: () => ide().setSidebarOpen(!ide().sidebarOpen) },
      { id: "terminal:new", title: "Terminal: new terminal", keys: "Ctrl+Shift+`", run: () => ide().requestTerminal() },
      { id: "zoom:in", title: "View: zoom in", keys: "Ctrl+=", run: () => zoomBy(10) },
      { id: "zoom:out", title: "View: zoom out", keys: "Ctrl+-", run: () => zoomBy(-10) },
      { id: "zoom:reset", title: "View: reset zoom", keys: "Ctrl+0", run: () => ide().setZoom(DEFAULT_ZOOM) },
      { id: "accounts:refresh", title: "Accounts: refresh balances", run: () => engine.get<EnvironmentPlugin>("environment").refreshAccounts() },
      { id: "target:simulator", title: "Target: simulator", run: () => ide().setTarget("simulator") },
      { id: "target:localnet", title: "Target: localnet (simnet)", run: () => ide().setTarget("localnet") },
      { id: "target:rpc", title: "Target: rpc (testnet-10)", run: () => ide().setTarget("rpc") },
      { id: "dev", title: "Start HardKas dev-server (headless)", hint: "hardkas dev --headless", run: () => engine.call("console", "runHardkas", ["dev", "--headless"]) },
      { id: "panel", title: "Toggle console / terminal panel", run: () => ide().setTerminalOpen(!ide().terminalOpen) },
      ...files
    ];
  }, [engine, tree]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands.filter((c) => !c.id.startsWith("open:")).slice(0, 20);
    const words = q.split(/\s+/);
    return commands.filter((c) => words.every((w) => `${c.title} ${c.hint ?? ""}`.toLowerCase().includes(w))).slice(0, 20);
  }, [commands, query]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.shiftKey && e.key.toLowerCase() === "p") {
        e.preventDefault();
        setOpen((o) => !o);
      } else if (mod && (e.key.toLowerCase() === "k" || e.key.toLowerCase() === "p") && !e.shiftKey) {
        e.preventDefault();
        setOpen((o) => !o);
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
  }, [engine, activeFile, open]);

  // The title bar's search box and the menus open the palette through this event.
  useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener(PALETTE_EVENT, onOpen);
    return () => window.removeEventListener(PALETTE_EVENT, onOpen);
  }, []);

  useEffect(() => {
    if (open) {
      setQuery("");
      setIndex(0);
      setTimeout(() => inputRef.current?.focus(), 10);
    }
  }, [open]);

  if (!open) return null;

  const runItem = (item: CommandItem) => {
    setOpen(false);
    void Promise.resolve(item.run()).catch((e: unknown) => engine.call("console", "error", String(e)));
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center pt-20" onClick={() => setOpen(false)}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        className="w-full max-w-xl rounded-lg border border-border bg-bg-elev shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 px-3 border-b border-border">
          <Command size={14} className="text-fg-muted" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setIndex(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                setIndex((i) => Math.min(i + 1, filtered.length - 1));
                e.preventDefault();
              } else if (e.key === "ArrowUp") {
                setIndex((i) => Math.max(i - 1, 0));
                e.preventDefault();
              } else if (e.key === "Enter" && filtered[index]) {
                runItem(filtered[index]);
              }
            }}
            placeholder="Type a command or a file name…"
            className="flex-1 bg-transparent py-3 text-sm outline-none text-fg placeholder:text-fg-muted/60"
          />
          <span className="text-[10px] text-fg-muted">Esc</span>
        </div>
        <ul className="max-h-80 overflow-auto py-1 text-xs">
          {filtered.length === 0 && <li className="px-3 py-2 text-fg-muted">No matching command</li>}
          {filtered.map((c, i) => (
            <li
              key={c.id}
              onMouseEnter={() => setIndex(i)}
              onClick={() => runItem(c)}
              className={clsx("px-3 py-1.5 flex items-center gap-3 cursor-pointer", i === index ? "bg-bg-hover text-fg" : "text-fg-muted")}
            >
              <span className="flex-1 truncate">
                <span className="text-fg">{c.title}</span>
                {c.hint && <span className="ml-2 text-fg-muted">{c.hint}</span>}
              </span>
              {c.keys && <kbd className="text-[10px] border border-border rounded px-1 text-fg-muted">{c.keys}</kbd>}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
