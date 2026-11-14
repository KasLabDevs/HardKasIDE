import clsx from "clsx";
import {
  Check,
  ChevronRight,
  Download,
  FilePenLine,
  FileSearch,
  FolderOpen,
  Printer,
  RefreshCw,
  Save,
  SaveAll,
  Search,
  Upload,
  X
} from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import { api, type RecentEntry } from "@/api/client";
import { FileIcon } from "@/components/FileIcon";
import { useEngine } from "@/engine/context";
import type { CompilerPlugin } from "@/plugins/compiler";
import type { DebugPlugin } from "@/plugins/debug";
import { useDebug } from "@/store/debug";
import { useEnv } from "@/store/env";
import type { EnvironmentPlugin } from "@/plugins/environment";
import type { LineagePlugin } from "@/plugins/lineage";
import { DEFAULT_ZOOM, MAX_ZOOM, MIN_ZOOM, envOf, useIde, type ExecutionTarget } from "@/store/ide";
import { useSearch } from "@/store/search";
import { useUpdates } from "@/store/updates";
import {
  closeAllEditors,
  closeEditor,
  confirmAndResetNode,
  convertLineDelimiters,
  editorCommand,
  exportActiveFile,
  importExternalFile,
  isDirty,
  isTextFile,
  moveActiveFile,
  newFile,
  openPalette,
  renameActiveFile,
  revertActiveFile,
  saveAll,
  saveAs,
  zoomBy
} from "./actions";
import { EclipseTypeBadge } from "./NewArtifactDialog";
import { HardKasMark } from "./Logo";
import { SEARCH_MAX_REM, computeSearchBarFrame } from "./titleBarLayout";
import { UpdateButton } from "./UpdateButton";
import { WindowControls, isDesktopApp } from "./WindowControls";

type Entry =
  | { type: "item"; label: string; keys?: string; icon?: React.ReactNode; run: () => unknown; disabled?: boolean; checked?: boolean }
  | { type: "submenu"; label: string; keys?: string; icon?: React.ReactNode; entries: Entry[] }
  | { type: "sep" }
  | { type: "heading"; label: string };

interface Menu {
  label: string;
  entries: Entry[];
}

const item = (
  label: string,
  run: () => unknown,
  opts: { keys?: string; icon?: React.ReactNode; disabled?: boolean; checked?: boolean } = {}
): Entry => ({ type: "item", label, run, ...opts });
const submenu = (label: string, entries: Entry[], opts: { keys?: string; icon?: React.ReactNode } = {}): Entry => ({
  type: "submenu",
  label,
  entries,
  ...opts
});
const sep: Entry = { type: "sep" };
const heading = (label: string): Entry => ({ type: "heading", label });

const REPO_URL = "https://github.com/KasLabDevs/HardKasIDE";

interface Props {
  onHome: () => void;
  mainRef?: RefObject<HTMLElement | null>;
}

/**
 * Top menu bar and command strip: Eclipse-structured File & Search menus + VS Code command centre.
 */
export function TitleBar({ onHome, mainRef }: Props) {
  const engine = useEngine();
  const workspace = useIde((s) => s.workspace);
  const activeFile = useIde((s) => s.activeFile);
  const openFiles = useIde((s) => s.openFiles);
  const tree = useIde((s) => s.tree);
  const recentFiles = useIde((s) => s.recentFiles);
  const sidebarOpen = useIde((s) => s.sidebarOpen);
  const outlineOpen = useIde((s) => s.outlineOpen);
  const terminalOpen = useIde((s) => s.terminalOpen);
  const target = useIde((s) => s.target);
  const zoom = useIde((s) => s.zoom);
  const [about, setAbout] = useState(false);
  const [propertiesOpen, setPropertiesOpen] = useState(false);
  const [recentWorkspaces, setRecentWorkspaces] = useState<RecentEntry[]>([]);

  const debugState = useDebug((s) => s.state);
  const breakpointCount = useDebug((s) => Object.values(s.breakpoints).reduce((n, l) => n + l.length, 0));
  const debugLive = debugState === "starting" || debugState === "running" || debugState === "paused";

  const textFile = isTextFile(activeFile);
  const activeDirty = textFile && isDirty(activeFile);
  const isSil = textFile && activeFile.endsWith(".sil");
  const isTest = textFile && /\.(test|spec)\.[cm]?[jt]sx?$/.test(activeFile);
  const anyDirty = openFiles.some((f) => f.kind !== "view" && f.content !== f.savedContent);
  const env = () => engine.get<EnvironmentPlugin>("environment");
  const ide = useIde.getState;

  // Load recent workspaces for "Switch Workspace >"
  useEffect(() => {
    api.workspace
      .recents()
      .then((r) => setRecentWorkspaces(r.recents ?? []))
      .catch(() => undefined);
  }, [workspace?.root]);

  const switchWorkspaceTo = async (path: string) => {
    const ws = await api.workspace.open(path);
    useIde.getState().setWorkspace(ws);
    await engine.call("fileManager", "refresh").catch(() => undefined);
    useIde.getState().setStatus(`Switched workspace to ${ws.name ?? path}`);
  };

  const menus = useMemo<Menu[]>(() => {
    const reveal = (name: string, title: string) => () => ide().revealPlugin(name, title);
    const editor = (commandId: string) => () => editorCommand(engine, commandId);
    const external = (url: string) => () => void window.open(url, "_blank", "noopener,noreferrer");
    const setEnv = (t: ExecutionTarget) => () => ide().setTarget(t);

    // Collect workspace files for Recent Files fallback when user hasn't opened many yet
    const fallbackFiles: string[] = [];
    const walk = (nodes: typeof tree) => {
      for (const n of nodes) {
        if (fallbackFiles.length >= 8) break;
        if (n.type === "file") fallbackFiles.push(n.path);
        else if (n.children) walk(n.children);
      }
    };
    walk(tree);
    const effectiveRecentFiles = recentFiles.length > 0 ? recentFiles : fallbackFiles;

    return [
      {
        label: "File",
        entries: [
          submenu(
            "New",
            [
              item("HardKas Project…", onHome, { icon: <FolderOpen size={12} className="text-accent" /> }),
              sep,
              item("File", () => newFile(engine, "empty-file"), { icon: <EclipseTypeBadge text="F" tone="slate" /> }),
              item("Folder", () => newFile(engine, "folder"), { icon: <EclipseTypeBadge text="D" tone="amber" /> }),
              item("SQL File", () => newFile(engine, "sql-file"), { icon: <EclipseTypeBadge text="Q" tone="blue" /> }),
              sep,
              item("SilverScript Contract", () => newFile(engine, "silver-basic"), { icon: <EclipseTypeBadge text="S" tone="teal" /> }),
              item("Covenant 1:N (Splitter)", () => newFile(engine, "covenant-1-n"), { icon: <EclipseTypeBadge text="N" tone="green" /> }),
              item("Covenant 1:1 (Stateful Vault)", () => newFile(engine, "covenant-1-1"), { icon: <EclipseTypeBadge text="1" tone="teal" /> }),
              item("Covenant Escrow 2-of-3", () => newFile(engine, "covenant-escrow"), { icon: <EclipseTypeBadge text="E" tone="amber" /> }),
              item("Covenant Timelock", () => newFile(engine, "covenant-timelock"), { icon: <EclipseTypeBadge text="T" tone="purple" /> }),
              sep,
              item("Class", () => newFile(engine, "ts-class"), { icon: <EclipseTypeBadge text="C" tone="green" /> }),
              item("Interface", () => newFile(engine, "ts-interface"), { icon: <EclipseTypeBadge text="I" tone="purple" /> }),
              item("Enum", () => newFile(engine, "ts-enum"), { icon: <EclipseTypeBadge text="E" tone="amber" /> }),
              item("Record", () => newFile(engine, "ts-record"), { icon: <EclipseTypeBadge text="R" tone="gold" /> }),
              item("Test Suite", () => newFile(engine, "ts-contract-test"), { icon: <EclipseTypeBadge text="T" tone="blue" /> }),
              sep,
              item("Other…", () => newFile(engine), { keys: "Ctrl+N" })
            ],
            { keys: "Alt+Shift+N" }
          ),
          item("Open File…", openPalette, { keys: "Ctrl+P" }),
          item("Open Projects from File System…", onHome, { icon: <FolderOpen size={12} className="text-accent" /> }),
          submenu(
            "Recent Files",
            effectiveRecentFiles.length > 0
              ? effectiveRecentFiles.map((f) =>
                  item(f, () => engine.call("fileManager", "open", f), {
                    icon: <FileIcon name={f} size={13} />,
                    checked: f === activeFile
                  })
                )
              : [item("No recent files", () => undefined, { disabled: true })]
          ),
          sep,
          item("Close Editor", () => activeFile && closeEditor(activeFile), { keys: "Ctrl+W", disabled: !activeFile }),
          item("Close All Editors", closeAllEditors, { keys: "Ctrl+Shift+W", disabled: openFiles.length === 0 }),
          sep,
          item("Save", () => engine.call("fileManager", "saveCurrentFile"), {
            keys: "Ctrl+S",
            icon: <Save size={12} />,
            disabled: !textFile || !activeDirty
          }),
          item("Save As…", () => saveAs(engine), {
            icon: <Save size={12} className="text-accent" />,
            disabled: !textFile
          }),
          item("Save All", () => saveAll(engine), {
            keys: "Ctrl+Shift+S",
            icon: <SaveAll size={12} />,
            disabled: !anyDirty
          }),
          item("Revert", () => revertActiveFile(), {
            disabled: !textFile || !activeDirty
          }),
          sep,
          item("Move…", () => moveActiveFile(engine), { disabled: !textFile }),
          item("Rename…", () => renameActiveFile(engine), {
            keys: "F2",
            icon: <FilePenLine size={12} />,
            disabled: !textFile
          }),
          item("Refresh", () => engine.call("fileManager", "refresh"), {
            keys: "F5",
            icon: <RefreshCw size={12} />
          }),
          submenu("Convert Line Delimiters To", [
            item("Windows (CRLF, \\r\\n)", () => convertLineDelimiters(engine, "CRLF"), { disabled: !textFile }),
            item("Unix / Linux / macOS (LF, \\n)", () => convertLineDelimiters(engine, "LF"), { disabled: !textFile })
          ]),
          sep,
          item("Print…", () => window.print(), {
            keys: "Ctrl+Alt+P",
            icon: <Printer size={12} />,
            disabled: !textFile
          }),
          sep,
          item("Import…", () => importExternalFile(engine), {
            icon: <Download size={12} className="text-accent" />
          }),
          item("Export…", () => exportActiveFile(), {
            icon: <Upload size={12} className="text-accent" />,
            disabled: !textFile
          }),
          sep,
          item("Properties", () => setPropertiesOpen(true), { keys: "Alt+Enter" }),
          sep,
          submenu("Switch Workspace", [
            ...recentWorkspaces.slice(0, 8).map((rw) =>
              item(`${rw.name} (${rw.path})`, () => void switchWorkspaceTo(rw.path), {
                checked: rw.path === workspace?.root
              })
            ),
            ...(recentWorkspaces.length > 0 ? [sep] : []),
            item("Other…", onHome)
          ]),
          item("Restart", () => window.location.reload()),
          item("Exit", onHome)
        ]
      },
      {
        label: "Edit",
        entries: [
          item("Undo", editor("undo"), { keys: "Ctrl+Z", disabled: !textFile }),
          item("Redo", editor("redo"), { keys: "Ctrl+Y", disabled: !textFile }),
          sep,
          item("Find in file", editor("actions.find"), { keys: "Ctrl+F", disabled: !textFile }),
          item("Replace in file", editor("editor.action.startFindReplace"), { keys: "Ctrl+Alt+F", disabled: !textFile }),
          sep,
          item("Select all", editor("editor.action.selectAll"), { keys: "Ctrl+A", disabled: !textFile }),
          item("Toggle line comment", editor("editor.action.commentLine"), { keys: "Ctrl+/", disabled: !textFile }),
          item("Format document", editor("editor.action.formatDocument"), { keys: "Shift+Alt+F", disabled: !textFile })
        ]
      },
      {
        label: "Search",
        entries: [
          item(
            "Search…",
            () => useSearch.getState().openSearchDialog({ mode: "eclipse-search", tab: "file" }),
            { keys: "Ctrl+H", icon: <Search size={12} className="text-accent" /> }
          ),
          item(
            "File…",
            () => useSearch.getState().openSearchDialog({ mode: "eclipse-search", tab: "file", scope: "workspace" }),
            { icon: <FileSearch size={12} className="text-accent" /> }
          ),
          sep,
          submenu("Text", [
            item("Workspace", () => useSearch.getState().openSearchDialog({ mode: "eclipse-search", tab: "file", scope: "workspace" })),
            item("Project (contracts/ & scripts/)", () =>
              useSearch.getState().openSearchDialog({ mode: "eclipse-search", tab: "file", scope: "directory", scopeDir: "contracts" })
            ),
            item("Open Editors", () => useSearch.getState().openSearchDialog({ mode: "eclipse-search", tab: "file", scope: "open-files" })),
            item("File (Current Editor)", () => useSearch.getState().openSearchDialog({ mode: "eclipse-search", tab: "file", scope: "current-file" }), {
              disabled: !textFile
            })
          ]),
          item(
            "Quick Search…",
            () => useSearch.getState().openSearchDialog({ mode: "quick-search" }),
            { keys: "Ctrl+Alt+Shift+L" }
          ),
          sep,
          item("SilverScript / Covenant Search…", () =>
            useSearch.getState().openSearchDialog({ mode: "eclipse-search", tab: "silver", filePatterns: "*.sil" })
          ),
          item("TypeScript / Symbol Search…", () =>
            useSearch.getState().openSearchDialog({ mode: "eclipse-search", tab: "symbol", filePatterns: "*.sil, *.ts, *.tsx" })
          ),
          sep,
          item("Open Search View (Bottom Panel)", () => useSearch.getState().revealBottomSearch(), { keys: "Ctrl+Shift+F" })
        ]
      },
      {
        label: "Go",
        entries: [
          item("Go to file…", () => openPalette(""), { keys: "Ctrl+P" }),
          item("Go to line…", () => openPalette(":"), { keys: "Ctrl+G", disabled: !textFile }),
          item("Go to symbol…", () => openPalette("@"), { keys: "Ctrl+Shift+O", disabled: !textFile })
        ]
      },
      {
        label: "View",
        entries: [
          item("Command palette…", () => openPalette("> "), { keys: "Ctrl+Shift+P" }),
          sep,
          heading("Views"),
          item("Explorer", reveal("files", "Explorer")),
          item("Deploy & Run", reveal("deployRun", "Deploy & Run")),
          item("Servers (node)", reveal("environment", "Servers")),
          item("Accounts", reveal("accounts", "Accounts")),
          item("Assistant", reveal("assistant", "Assistant")),
          item("Tests", () => engine.call("tests", "open")),
          item("Run history", () => engine.call("runHistory", "open")),
          item("Index (artifacts, transactions, SQL)", () => engine.call("queryIndex", "open")),
          item("Lineage graph", () => engine.get<LineagePlugin>("lineage").open()),
          item("Covenant graph", () => engine.call("covenant", "open")),
          item("Plugin manager", reveal("pluginManager", "Plugin manager")),
          sep,
          heading("Layout"),
          item("Primary side bar", () => ide().setSidebarOpen(!ide().sidebarOpen), { keys: "Ctrl+B", checked: sidebarOpen }),
          item("Outline and right dock", () => ide().setOutlineOpen(!ide().outlineOpen), { checked: outlineOpen }),
          item("Console / terminal panel", () => ide().setTerminalOpen(!ide().terminalOpen), { keys: "Ctrl+J", checked: terminalOpen }),
          item("Reset panel layout", () => ide().resetLayout()),
          sep,
          heading(`Zoom · ${zoom}%`),
          item("Zoom in", () => zoomBy(10), { keys: "Ctrl+=", disabled: zoom >= MAX_ZOOM }),
          item("Zoom out", () => zoomBy(-10), { keys: "Ctrl+-", disabled: zoom <= MIN_ZOOM }),
          item("Reset zoom", () => ide().setZoom(DEFAULT_ZOOM), { keys: "Ctrl+0", disabled: zoom === DEFAULT_ZOOM })
        ]
      },
      {
        label: "Run",
        entries: [
          item("Compile SilverScript file", () => engine.get<CompilerPlugin>("silverCompiler").compileCurrent(), { keys: "Ctrl+Enter", disabled: !isSil }),
          item("Run all tests", () => engine.call("tests", "run")),
          item("Run tests in this file", () => activeFile && engine.call("tests", "runFile", activeFile), { disabled: !isTest }),
          item("Open Deploy & Run", reveal("deployRun", "Deploy & Run")),
          sep,
          heading("Debug tests"),
          item("Debug tests in this file", () => activeFile && engine.get<DebugPlugin>("debug").debugFile(activeFile), { keys: "F5", disabled: !isTest || debugLive }),
          item("Debug all tests", () => engine.get<DebugPlugin>("debug").debugAll(), { disabled: debugLive }),
          item("Continue", () => engine.get<DebugPlugin>("debug").resume(), { keys: "F5", disabled: debugState !== "paused" }),
          item("Step over", () => engine.get<DebugPlugin>("debug").stepOver(), { keys: "F10", disabled: debugState !== "paused" }),
          item("Step into", () => engine.get<DebugPlugin>("debug").stepInto(), { keys: "F11", disabled: debugState !== "paused" }),
          item("Step out", () => engine.get<DebugPlugin>("debug").stepOut(), { keys: "Shift+F11", disabled: debugState !== "paused" }),
          item("Stop debugging", () => engine.get<DebugPlugin>("debug").stop(), { keys: "Shift+F5", disabled: !debugLive }),
          item("Toggle breakpoint", () => editorCommand(engine, "hardkas.debug.toggleBreakpoint"), { keys: "F9", disabled: !textFile }),
          item("Remove all breakpoints", () => engine.get<DebugPlugin>("debug").clearBreakpoints(), { disabled: breakpointCount === 0 }),
          sep,
          heading("Environment"),
          ...(["simulator", "localnet", "rpc"] as const).map((t) => item(envOf(t).label, setEnv(t), { checked: target === t })),
          sep,
          heading("Local node"),
          item("Start node", () => env().startNode()),
          item("Stop node", () => env().stopNode()),
          item("Restart node", () => env().restartNode()),
          item("Reset from scratch…", () => confirmAndResetNode(engine))
        ]
      },
      {
        label: "Terminal",
        entries: [
          item("New terminal", () => ide().requestTerminal(), { keys: "Ctrl+Shift+`" }),
          item("Toggle console / terminal", () => ide().setTerminalOpen(!ide().terminalOpen), { keys: "Ctrl+`" }),
          item("Clear console", () => ide().clearJournal()),
          sep,
          item("Start HardKas dev-server (headless)", () => engine.call("console", "runHardkas", ["dev", "--headless"]))
        ]
      },
      {
        label: "Help",
        entries: [
          item("Ask the Assistant", reveal("assistant", "Assistant")),
          item("Keyboard shortcuts and commands", openPalette),
          sep,
          item("Kaspa developer docs", external("https://docs.kaspa.org")),
          item("HardKas IDE on GitHub", external(REPO_URL)),
          item("Report an issue", external(`${REPO_URL}/issues/new`)),
          sep,
          item("Check for Updates…", () => {
            useUpdates.getState().openPopover();
            void useUpdates.getState().check(true);
          }),
          item("About HardKas IDE", () => setAbout(true))
        ]
      }
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    engine,
    onHome,
    textFile,
    activeDirty,
    isSil,
    isTest,
    activeFile,
    anyDirty,
    openFiles.length,
    sidebarOpen,
    outlineOpen,
    terminalOpen,
    target,
    zoom,
    debugState,
    debugLive,
    breakpointCount,
    recentWorkspaces,
    recentFiles,
    tree,
    workspace?.root
  ]);

  // Global shortcuts that live in the shell (editor ones stay with Monaco, the palette owns Ctrl+P / Ctrl+Shift+P).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Alt+Enter -> Properties dialog (Eclipse shortcut)
      if (e.altKey && !e.ctrlKey && !e.shiftKey && e.key === "Enter") {
        e.preventDefault();
        setPropertiesOpen(true);
        return;
      }
      // Alt+Shift+N -> New Artifact Wizard (Eclipse shortcut)
      if (e.altKey && e.shiftKey && !e.ctrlKey && e.key.toLowerCase() === "n") {
        e.preventDefault();
        void newFile(engine);
        return;
      }
      // Debugger keys (VS Code's): F5 continue / start, Shift+F5 stop, F10 over, F11 into, Shift+F11 out.
      if (/^F(5|10|11)$/.test(e.key) && !e.ctrlKey && !e.altKey && !e.metaKey) {
        if ((e.target as HTMLElement | null)?.closest?.(".xterm")) return;
        const dbg = engine.get<DebugPlugin>("debug");
        const st = useDebug.getState().state;
        const live = st === "starting" || st === "running" || st === "paused";
        const active = useIde.getState().activeFile;
        let action: Promise<unknown> | null = null;
        if (e.key === "F5" && e.shiftKey) action = live ? dbg.stop() : null;
        else if (e.key === "F5") action = st === "paused" ? dbg.resume() : !live && isTextFile(active) && /\.(test|spec)\.[cm]?[jt]sx?$/.test(active) ? dbg.debugFile(active) : null;
        else if (st === "paused") action = e.key === "F10" ? dbg.stepOver() : e.shiftKey ? dbg.stepOut() : dbg.stepInto();
        if (action) {
          e.preventDefault();
          void action.catch((err: unknown) => engine.call("console", "error", err instanceof Error ? err.message : String(err)));
        }
        return;
      }
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      // Eclipse Quick Search: Ctrl+Alt+Shift+L
      if (e.altKey && e.shiftKey && e.key.toLowerCase() === "l") {
        e.preventDefault();
        useSearch.getState().openSearchDialog({ mode: "quick-search" });
        return;
      }
      if (e.altKey) return;
      // Inside a real terminal these chords belong to the shell (Ctrl+W deletes a word, Ctrl+B moves back…).
      if ((e.target as HTMLElement | null)?.closest?.(".xterm")) return;
      const key = e.key;
      const s = useIde.getState();
      if (!e.shiftKey && key.toLowerCase() === "h") {
        useSearch.getState().openSearchDialog({ mode: "eclipse-search", tab: "file" });
      } else if (e.shiftKey && key.toLowerCase() === "f") {
        useSearch.getState().openSearchDialog({ mode: "quick-search" });
      } else if (e.shiftKey && key.toLowerCase() === "s") {
        void saveAll(engine);
      } else if (e.shiftKey && key.toLowerCase() === "w") {
        void closeAllEditors();
      } else if (!e.shiftKey && key.toLowerCase() === "n") {
        void newFile(engine);
      } else if (!e.shiftKey && key.toLowerCase() === "b") {
        s.setSidebarOpen(!s.sidebarOpen);
      } else if (!e.shiftKey && key.toLowerCase() === "j") {
        s.setTerminalOpen(!s.terminalOpen);
      } else if (key === "`" || key === "º") {
        if (e.shiftKey) s.requestTerminal();
        else s.setTerminalOpen(!s.terminalOpen);
      } else if (!e.shiftKey && key.toLowerCase() === "w" && s.activeFile) {
        void closeEditor(s.activeFile);
      } else if (key === "=" || key === "+") {
        zoomBy(10);
      } else if (key === "-" || key === "_") {
        zoomBy(-10);
      } else if (key === "0" && !e.shiftKey) {
        s.setZoom(DEFAULT_ZOOM);
      } else {
        return;
      }
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [engine]);

  const projectName = workspace?.name ?? "HardKas IDE";
  useEffect(() => {
    const file = isTextFile(activeFile) ? `${activeFile.split("/").pop()}${isDirty(activeFile) ? " ●" : ""} — ` : "";
    document.title = `${file}${projectName} — HardKas IDE`;
  }, [activeFile, projectName, openFiles]);

  const headerRef = useRef<HTMLElement>(null);
  const leftRef = useRef<HTMLDivElement>(null);
  const rightRef = useRef<HTMLDivElement>(null);
  const searchWrapRef = useRef<HTMLDivElement>(null);

  // Align the search bar with the center of the active main workspace while clamping cleanly inside titlebar controls.
  useLayoutEffect(() => {
    const header = headerRef.current;
    const left = leftRef.current;
    const right = rightRef.current;
    const searchWrap = searchWrapRef.current;
    if (!header || !left || !right || !searchWrap) return;

    let rafId = 0;
    const update = () => {
      const hRect = header.getBoundingClientRect();
      if (hRect.width <= 0) return;
      const lRect = left.getBoundingClientRect();
      const rRect = right.getBoundingClientRect();
      const mEl = mainRef?.current ?? null;
      const mRect = mEl ? mEl.getBoundingClientRect() : null;
      const rootPx = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
      const rightSpan =
        right.childElementCount > 0
          ? { left: rRect.left, width: rRect.width }
          : { left: hRect.right, width: 0 };
      const frame = computeSearchBarFrame({
        header: { left: hRect.left, width: hRect.width },
        left: { left: lRect.left, width: lRect.width },
        right: rightSpan,
        main: mRect ? { left: mRect.left, width: mRect.width } : null,
        maxWidth: SEARCH_MAX_REM * rootPx
      });
      searchWrap.style.left = `${frame.left}px`;
      searchWrap.style.width = `${frame.width}px`;
    };

    const schedule = () => {
      update();
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(update);
    };

    update();
    const ro = new ResizeObserver(update);
    ro.observe(header);
    ro.observe(left);
    ro.observe(right);
    const mainEl = mainRef?.current ?? null;
    const panelGroup = mainEl?.parentElement?.parentElement ?? null;
    if (mainEl) ro.observe(mainEl);
    if (panelGroup) ro.observe(panelGroup);

    const mo = new MutationObserver(schedule);
    mo.observe(right, { childList: true, subtree: true, characterData: true });
    if (panelGroup) {
      mo.observe(panelGroup, { childList: true, subtree: true, attributes: true, attributeFilter: ["style"] });
    }
    window.addEventListener("resize", update);

    return () => {
      cancelAnimationFrame(rafId);
      ro.disconnect();
      mo.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [mainRef, sidebarOpen, outlineOpen, zoom]);

  return (
    <>
      <header ref={headerRef} data-tauri-drag-region className="titlebar relative z-40 h-8 shrink-0 flex items-center justify-between bg-bg-panel select-none">
        <div ref={leftRef} data-tauri-drag-region className="flex items-center gap-0.5 h-full shrink-0">
          <button
            type="button"
            onClick={onHome}
            title="Home (Switch workspace)"
            aria-label="Home (Switch workspace)"
            className="w-10 h-full pr-px grid place-items-center shrink-0 hover:bg-bg-hover cursor-pointer transition-colors"
          >
            <HardKasMark size={22} />
          </button>
          <MenuBar menus={menus} />
        </div>
        <div
          ref={searchWrapRef}
          data-tauri-drag-region
          className="absolute inset-y-0 flex items-center justify-center min-w-0 overflow-hidden"
        >
          <button
            type="button"
            onClick={openPalette}
            title="Search files, commands (>), symbols (@), or line (:) · Ctrl+P"
            aria-label="Search commands and files"
            className="w-full h-[1.35rem] flex items-center justify-center gap-1.5 rounded border border-border bg-bg/60 hover:bg-bg-hover text-[12px] text-fg-muted cursor-pointer transition-colors min-w-0 px-2.5"
          >
            <Search size={11} className="shrink-0" />
            <span className="truncate">{projectName}</span>
            {isTextFile(activeFile) && <span className="truncate text-fg-muted/70 hidden md:inline">· {activeFile.split("/").pop()}</span>}
          </button>
        </div>
        <div ref={rightRef} data-tauri-drag-region className="flex items-center justify-end gap-1.5 h-full pr-2 shrink-0">
          <UpdateButton />
          {isDesktopApp() && <WindowControls />}
        </div>
      </header>
      {about && <AboutDialog onClose={() => setAbout(false)} />}
      {propertiesOpen && <PropertiesDialog onClose={() => setPropertiesOpen(false)} />}
    </>
  );
}

/** Menu bar with the usual behaviour: click opens, hovering another title switches while one is open, arrows and Escape work. */
function MenuBar({ menus }: { menus: Menu[] }) {
  const engine = useEngine();
  const [openIdx, setOpenIdx] = useState<number | null>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const buttonRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const popupRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (openIdx === null) return;
    const onDown = (e: MouseEvent) => {
      if (!barRef.current?.contains(e.target as Node)) setOpenIdx(null);
    };
    const onBlurWindow = () => setOpenIdx(null);
    document.addEventListener("mousedown", onDown, true);
    window.addEventListener("blur", onBlurWindow);
    return () => {
      document.removeEventListener("mousedown", onDown, true);
      window.removeEventListener("blur", onBlurWindow);
    };
  }, [openIdx]);

  useEffect(() => {
    if (openIdx !== null) popupRef.current?.focus();
  }, [openIdx]);

  const run = (entry: Entry & { type: "item" }) => {
    setOpenIdx(null);
    void Promise.resolve()
      .then(() => entry.run())
      .catch((e: unknown) => engine.call("console", "error", e instanceof Error ? e.message : String(e)));
  };

  const onPopupKey = (e: React.KeyboardEvent) => {
    const items = Array.from(popupRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not([aria-disabled="true"])') ?? []);
    const at = items.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === "ArrowDown") {
      items[(at + 1) % items.length]?.focus();
    } else if (e.key === "ArrowUp") {
      items[(at <= 0 ? items.length : at) - 1]?.focus();
    } else if (e.key === "Home") {
      items[0]?.focus();
    } else if (e.key === "End") {
      items.at(-1)?.focus();
    } else if (e.key === "ArrowRight" && openIdx !== null) {
      setOpenIdx((openIdx + 1) % menus.length);
    } else if (e.key === "ArrowLeft" && openIdx !== null) {
      setOpenIdx((openIdx - 1 + menus.length) % menus.length);
    } else if (e.key === "Escape") {
      const idx = openIdx;
      setOpenIdx(null);
      if (idx !== null) buttonRefs.current[idx]?.focus();
    } else if (e.key === "Tab") {
      setOpenIdx(null);
      return;
    } else {
      return;
    }
    e.preventDefault();
    e.stopPropagation();
  };

  return (
    <div ref={barRef} role="menubar" aria-label="Application menu" className="flex items-center shrink-0">
      {menus.map((m, i) => (
        <div key={m.label} className="relative">
          <button
            ref={(el) => {
              buttonRefs.current[i] = el;
            }}
            type="button"
            role="menuitem"
            aria-haspopup="menu"
            aria-expanded={openIdx === i}
            onClick={() => setOpenIdx(openIdx === i ? null : i)}
            onMouseEnter={() => openIdx !== null && setOpenIdx(i)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                setOpenIdx(i);
              } else if (e.key === "ArrowRight") {
                buttonRefs.current[(i + 1) % menus.length]?.focus();
              } else if (e.key === "ArrowLeft") {
                buttonRefs.current[(i - 1 + menus.length) % menus.length]?.focus();
              }
            }}
            className={clsx("h-[1.35rem] inline-flex items-center px-1.5 rounded text-[12px] cursor-pointer transition-colors", openIdx === i ? "bg-bg-hover text-fg" : "text-fg-muted hover:text-fg hover:bg-bg-hover")}
          >
            {m.label}
          </button>
          {openIdx === i && (
            <div
              ref={popupRef}
              role="menu"
              aria-label={m.label}
              tabIndex={-1}
              onKeyDown={onPopupKey}
              className="absolute left-0 top-full mt-0.5 z-50 min-w-64 py-1 rounded-md border border-border bg-bg-elev shadow-2xl outline-none"
            >
              {m.entries.map((entry, k) => {
                if (entry.type === "sep") return <div key={k} role="separator" className="my-1 border-t border-border" />;
                if (entry.type === "heading")
                  return (
                    <div key={k} className="px-3 pt-1.5 pb-0.5 text-[12px] uppercase tracking-wider text-fg-muted/80">
                      {entry.label}
                    </div>
                  );
                if (entry.type === "submenu") {
                  return (
                    <div key={k} className="relative group/sub">
                      <button
                        type="button"
                        role="menuitem"
                        aria-haspopup="menu"
                        tabIndex={-1}
                        className="w-full flex items-center gap-2 px-3 py-1 text-xs text-left text-fg cursor-pointer hover:bg-bg-hover focus:bg-bg-hover outline-none"
                      >
                        <span className="w-4 shrink-0 flex items-center justify-center">{entry.icon ?? null}</span>
                        <span className="flex-1 truncate">{entry.label}</span>
                        {entry.keys && <kbd className="text-[12px] text-fg-muted ml-4 font-sans">{entry.keys}</kbd>}
                        <ChevronRight size={12} className="text-fg-muted ml-1 shrink-0" />
                      </button>
                      <div
                        role="menu"
                        className="hidden group-hover/sub:block absolute left-full top-0 -mt-1 z-50 min-w-60 max-h-[75vh] overflow-y-auto py-1 rounded-md border border-border bg-bg-elev shadow-2xl"
                      >
                        {entry.entries.map((sub, sk) => {
                          if (sub.type === "sep") return <div key={sk} role="separator" className="my-1 border-t border-border" />;
                          if (sub.type !== "item") return null;
                          return (
                            <button
                              key={sk}
                              type="button"
                              role="menuitem"
                              aria-disabled={sub.disabled || undefined}
                              onClick={() => !sub.disabled && run(sub)}
                              className={clsx(
                                "w-full flex items-center gap-2 px-3 py-1 text-xs text-left outline-none",
                                sub.disabled ? "text-fg-muted/40 cursor-default" : "text-fg cursor-pointer hover:bg-bg-hover"
                              )}
                            >
                              <span className="w-4 shrink-0 flex items-center justify-center">
                                {sub.checked ? <Check size={12} className="text-accent" /> : (sub.icon ?? null)}
                              </span>
                              <span className="flex-1 truncate">{sub.label}</span>
                              {sub.keys && <kbd className="text-[12px] text-fg-muted ml-4 font-sans">{sub.keys}</kbd>}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                }
                const checkable = entry.checked !== undefined;
                return (
                  <button
                    key={k}
                    type="button"
                    role={checkable ? "menuitemcheckbox" : "menuitem"}
                    aria-checked={checkable ? entry.checked : undefined}
                    aria-disabled={entry.disabled || undefined}
                    tabIndex={-1}
                    onClick={() => !entry.disabled && run(entry)}
                    className={clsx(
                      "w-full flex items-center gap-2 px-3 py-1 text-xs text-left outline-none",
                      entry.disabled ? "text-fg-muted/40 cursor-default" : "text-fg cursor-pointer hover:bg-bg-hover focus:bg-bg-hover"
                    )}
                  >
                    <span className="w-4 shrink-0 flex items-center justify-center">
                      {entry.checked ? <Check size={12} className="text-accent" /> : (entry.icon ?? null)}
                    </span>
                    <span className="flex-1 truncate">{entry.label}</span>
                    {entry.keys && <kbd className="text-[12px] text-fg-muted ml-6 font-sans">{entry.keys}</kbd>}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

/** Eclipse-style Resource & Project Properties Dialog (Alt+Enter). */
function PropertiesDialog({ onClose }: { onClose: () => void }) {
  const workspace = useIde((s) => s.workspace);
  const activeFile = useIde((s) => s.activeFile);
  const openFiles = useIde((s) => s.openFiles);
  const target = useIde((s) => s.target);
  const cli = useEnv((s) => s.cli);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const currentOpen = openFiles.find((f) => f.path === activeFile && f.kind !== "view");
  const content = currentOpen?.content ?? "";
  const byteSize = new Blob([content]).size;
  const lineCount = content ? content.split(/\r?\n/).length : 0;
  const lineDelimiter = content.includes("\r\n") ? "Windows (CRLF)" : "Unix (LF)";

  return (
    <div role="presentation" className="titlebar-nodrag fixed inset-0 z-50 bg-black/60 grid place-items-center p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Properties"
        className="w-full max-w-lg rounded-md border border-border bg-bg-elev shadow-2xl overflow-hidden text-xs"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-2 bg-bg-panel border-b border-border">
          <span className="font-semibold text-fg">
            Properties for {currentOpen ? currentOpen.path.split("/").pop() : (workspace?.name ?? "Workspace")}
          </span>
          <button type="button" onClick={onClose} className="p-0.5 rounded text-fg-muted hover:text-fg hover:bg-bg-hover cursor-pointer">
            <X size={14} />
          </button>
        </div>

        <div className="p-4 space-y-3">
          <fieldset className="border border-border rounded p-3 space-y-1.5 bg-bg/60">
            <legend className="px-1.5 font-semibold text-fg text-[12px]">Resource Information</legend>
            <div className="grid grid-cols-3 gap-1 font-mono text-[12px]">
              <span className="text-fg-muted">Path:</span>
              <span className="col-span-2 text-fg break-all select-text">{currentOpen ? `/${currentOpen.path}` : "/"}</span>
              <span className="text-fg-muted">Type:</span>
              <span className="col-span-2 text-fg">{currentOpen ? `File (${currentOpen.language})` : "HardKas Project"}</span>
              <span className="text-fg-muted">Location:</span>
              <span className="col-span-2 text-fg break-all select-text">
                {workspace?.root ? `${workspace.root}${currentOpen ? `/${currentOpen.path}` : ""}` : "—"}
              </span>
              {currentOpen && (
                <>
                  <span className="text-fg-muted">Size:</span>
                  <span className="col-span-2 text-fg">
                    {byteSize.toLocaleString()} bytes ({lineCount} lines)
                  </span>
                  <span className="text-fg-muted">Line delimiter:</span>
                  <span className="col-span-2 text-fg">{lineDelimiter}</span>
                </>
              )}
              <span className="text-fg-muted">Encoding:</span>
              <span className="col-span-2 text-fg">UTF-8</span>
            </div>
          </fieldset>

          <fieldset className="border border-border rounded p-3 space-y-1.5 bg-bg/60">
            <legend className="px-1.5 font-semibold text-fg text-[12px]">HardKas &amp; SilverScript Toolchain</legend>
            <div className="grid grid-cols-3 gap-1 font-mono text-[12px]">
              <span className="text-fg-muted">Active Target:</span>
              <span className="col-span-2 text-accent">{envOf(target).label}</span>
              <span className="text-fg-muted">HardKas CLI:</span>
              <span className="col-span-2 text-fg">{cli?.version ?? "0.13.0-rc.1"}</span>
              <span className="text-fg-muted">SilverScript:</span>
              <span className="col-span-2 text-fg">silverc v1.0.0 · pragma ^0.1.0 · TX v1</span>
            </div>
          </fieldset>
        </div>

        <footer className="flex items-center justify-end px-4 py-2.5 bg-bg-panel border-t border-border">
          <button type="button" onClick={onClose} className="btn-primary px-4 py-1 text-xs">
            Apply and Close
          </button>
        </footer>
      </div>
    </div>
  );
}

function AboutDialog({ onClose }: { onClose: () => void }) {
  const cli = useEnv((s) => s.cli);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div role="presentation" className="titlebar-nodrag fixed inset-0 z-50 bg-black/50 grid place-items-center" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label="About HardKas IDE" className="w-full max-w-sm rounded-lg border border-border bg-bg-elev p-5 shadow-2xl space-y-3 text-xs" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3">
          <HardKasMark size={36} />
          <div>
            <div className="text-sm font-semibold text-fg">HardKas IDE</div>
            <div className="text-fg-muted">
              Version {__APP_VERSION__} · HardKas CLI {cli?.version ?? "not found"}
              {cli && cli.version !== cli.pinned ? ` (tested with ${cli.pinned})` : ""}
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="ml-auto p-1 rounded text-fg-muted hover:text-fg hover:bg-bg-hover cursor-pointer">
            <X size={14} />
          </button>
        </div>
        <p className="text-fg-muted leading-relaxed">
          A workbench for Kaspa: editor, SilverScript compiler, Deploy &amp; Run, artifacts and terminals on top of the HardKas toolkit. Project flow shaped after Visual Studio, views after Eclipse.
        </p>
        <div className="flex items-center justify-between gap-2 pt-1">
          <a className="text-accent hover:underline" href={REPO_URL} target="_blank" rel="noopener noreferrer">
            github.com/KasLabDevs/HardKasIDE
          </a>
          <button
            type="button"
            onClick={() => {
              onClose();
              useUpdates.getState().openPopover();
              void useUpdates.getState().check(true);
            }}
            className="btn-ghost px-2.5 py-1 text-[12px]"
          >
            Check for Updates
          </button>
        </div>
      </div>
    </div>
  );
}
