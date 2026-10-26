import clsx from "clsx";
import { Check, PanelBottom, PanelLeft, PanelRight, Search, Settings, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useEngine } from "@/engine/context";
import type { CompilerPlugin } from "@/plugins/compiler";
import type { EnvironmentPlugin } from "@/plugins/environment";
import type { LineagePlugin } from "@/plugins/lineage";
import { DEFAULT_ZOOM, MAX_ZOOM, MIN_ZOOM, envOf, useIde, type ExecutionTarget } from "@/store/ide";
import { closeAllEditors, closeEditor, confirmAndResetNode, editorCommand, isDirty, isTextFile, newFile, openPalette, saveAll, zoomBy } from "./actions";
import { HardKasMark } from "./Logo";

type Entry =
  | { type: "item"; label: string; keys?: string; run: () => unknown; disabled?: boolean; checked?: boolean }
  | { type: "sep" }
  | { type: "heading"; label: string };

interface Menu {
  label: string;
  entries: Entry[];
}

const item = (label: string, run: () => unknown, opts: { keys?: string; disabled?: boolean; checked?: boolean } = {}): Entry => ({ type: "item", label, run, ...opts });
const sep: Entry = { type: "sep" };
const heading = (label: string): Entry => ({ type: "heading", label });

const REPO_URL = "https://github.com/KasLabDevs/HardKasIDE";

interface Props {
  onHome: () => void;
}

/**
 * VS Code-style top strip: logo and menu bar on the left, the command centre in the middle
 * (project name, opens the palette) and the layout toggles on the right. It is also the drag
 * region when the IDE is wrapped in a desktop shell (Electron/Tauri/installed PWA).
 */
export function TitleBar({ onHome }: Props) {
  const engine = useEngine();
  const workspace = useIde((s) => s.workspace);
  const activeFile = useIde((s) => s.activeFile);
  const openFiles = useIde((s) => s.openFiles);
  const sidebarOpen = useIde((s) => s.sidebarOpen);
  const outlineOpen = useIde((s) => s.outlineOpen);
  const terminalOpen = useIde((s) => s.terminalOpen);
  const target = useIde((s) => s.target);
  const zoom = useIde((s) => s.zoom);
  const [about, setAbout] = useState(false);

  const textFile = isTextFile(activeFile);
  const isSil = textFile && activeFile.endsWith(".sil");
  const isTest = textFile && /\.(test|spec)\.[cm]?[jt]sx?$/.test(activeFile);
  const anyDirty = openFiles.some((f) => f.kind !== "view" && f.content !== f.savedContent);
  const env = () => engine.get<EnvironmentPlugin>("environment");
  const ide = useIde.getState;

  const menus = useMemo<Menu[]>(() => {
    const reveal = (name: string, title: string) => () => ide().revealPlugin(name, title);
    const editor = (commandId: string) => () => editorCommand(engine, commandId);
    const external = (url: string) => () => void window.open(url, "_blank", "noopener,noreferrer");
    const setEnv = (t: ExecutionTarget) => () => ide().setTarget(t);
    return [
      {
        label: "File",
        entries: [
          item("New project…", onHome),
          item("Open folder…", onHome),
          sep,
          item("New file…", () => newFile(engine)),
          sep,
          item("Save", () => engine.call("fileManager", "saveCurrentFile"), { keys: "Ctrl+S", disabled: !textFile }),
          item("Save all", () => saveAll(engine), { disabled: !anyDirty }),
          sep,
          item("Close editor", () => activeFile && closeEditor(activeFile), { keys: "Ctrl+W", disabled: !activeFile }),
          item("Close all editors", closeAllEditors, { disabled: openFiles.length === 0 }),
          sep,
          item("Close workspace", onHome)
        ]
      },
      {
        label: "Edit",
        entries: [
          item("Undo", editor("undo"), { keys: "Ctrl+Z", disabled: !textFile }),
          item("Redo", editor("redo"), { keys: "Ctrl+Y", disabled: !textFile }),
          sep,
          item("Find", editor("actions.find"), { keys: "Ctrl+F", disabled: !textFile }),
          item("Replace", editor("editor.action.startFindReplace"), { keys: "Ctrl+H", disabled: !textFile }),
          sep,
          item("Select all", editor("editor.action.selectAll"), { keys: "Ctrl+A", disabled: !textFile }),
          item("Toggle line comment", editor("editor.action.commentLine"), { keys: "Ctrl+/", disabled: !textFile }),
          item("Format document", editor("editor.action.formatDocument"), { keys: "Shift+Alt+F", disabled: !textFile })
        ]
      },
      {
        label: "Go",
        entries: [
          item("Go to file…", openPalette, { keys: "Ctrl+P" }),
          item("Go to line…", editor("editor.action.gotoLine"), { keys: "Ctrl+G", disabled: !textFile }),
          item("Go to symbol…", editor("editor.action.quickOutline"), { keys: "Ctrl+Shift+O", disabled: !textFile })
        ]
      },
      {
        label: "View",
        entries: [
          item("Command palette…", openPalette, { keys: "Ctrl+Shift+P" }),
          sep,
          heading("Views"),
          item("Explorer", reveal("files", "Explorer")),
          item("Deploy & Run", reveal("deployRun", "Deploy & Run")),
          item("Servers (node)", reveal("environment", "Servers")),
          item("Accounts", reveal("accounts", "Accounts")),
          item("Artifacts", reveal("artifacts", "Artifacts")),
          item("Assistant", reveal("assistant", "Assistant")),
          item("Tests", () => engine.call("tests", "open")),
          item("Lineage graph", () => engine.get<LineagePlugin>("lineage").open()),
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
          item("About HardKas IDE", () => setAbout(true))
        ]
      }
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, onHome, textFile, isSil, isTest, activeFile, anyDirty, openFiles.length, sidebarOpen, outlineOpen, terminalOpen, target, zoom]);

  // Global shortcuts that live in the shell (editor ones stay with Monaco, the palette owns Ctrl+P / Ctrl+Shift+P).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod || e.altKey) return;
      // Inside a real terminal these chords belong to the shell (Ctrl+W deletes a word, Ctrl+B moves back…).
      if ((e.target as HTMLElement | null)?.closest?.(".xterm")) return;
      const key = e.key;
      const s = useIde.getState();
      if (!e.shiftKey && key.toLowerCase() === "b") {
        s.setSidebarOpen(!s.sidebarOpen);
      } else if (!e.shiftKey && key.toLowerCase() === "j") {
        s.setTerminalOpen(!s.terminalOpen);
      } else if (key === "`" || key === "º") {
        if (e.shiftKey) s.requestTerminal();
        else s.setTerminalOpen(!s.terminalOpen);
      } else if (!e.shiftKey && key.toLowerCase() === "w" && s.activeFile) {
        closeEditor(s.activeFile);
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
  }, []);

  const projectName = workspace?.name ?? "HardKas IDE";
  useEffect(() => {
    const file = isTextFile(activeFile) ? `${activeFile.split("/").pop()}${isDirty(activeFile) ? " ●" : ""} — ` : "";
    document.title = `${file}${projectName} — HardKas IDE`;
  }, [activeFile, projectName, openFiles]);

  return (
    <header className="titlebar relative z-40 h-9 shrink-0 flex items-center gap-1 pl-2 pr-2 border-b border-border bg-bg-panel select-none">
      <span className="w-7 h-7 grid place-items-center shrink-0" title="HardKas IDE">
        <HardKasMark size={20} />
      </span>
      <MenuBar menus={menus} />
      <div className="flex-1 min-w-0 flex justify-center px-2">
        <button
          type="button"
          onClick={openPalette}
          title="Search commands and files (Ctrl+P)"
          aria-label="Search commands and files"
          className="w-full max-w-md h-6 flex items-center justify-center gap-2 rounded-md border border-border bg-bg/60 hover:bg-bg-hover text-[11px] text-fg-muted cursor-pointer transition-colors min-w-0 px-3"
        >
          <Search size={12} className="shrink-0" />
          <span className="truncate">{projectName}</span>
          {isTextFile(activeFile) && <span className="truncate text-fg-muted/70 hidden md:inline">· {activeFile.split("/").pop()}</span>}
        </button>
      </div>
      <div className="flex items-center gap-0.5 shrink-0">
        <LayoutToggle on={sidebarOpen} onClick={() => ide().setSidebarOpen(!sidebarOpen)} onLabel="Hide primary side bar" offLabel="Show primary side bar" keys="Ctrl+B" icon={<PanelLeft size={15} />} />
        <LayoutToggle on={terminalOpen} onClick={() => ide().setTerminalOpen(!terminalOpen)} onLabel="Hide console / terminal" offLabel="Show console / terminal" keys="Ctrl+J" icon={<PanelBottom size={15} />} />
        <LayoutToggle on={outlineOpen} onClick={() => ide().setOutlineOpen(!outlineOpen)} onLabel="Hide Outline" offLabel="Show Outline" icon={<PanelRight size={15} />} />
        <button
          type="button"
          onClick={() => ide().revealPlugin("settings", "Settings")}
          title="Settings"
          aria-label="Settings"
          className="w-7 h-7 grid place-items-center rounded text-fg-muted hover:text-fg hover:bg-bg-hover cursor-pointer transition-colors ml-1"
        >
          <Settings size={15} />
        </button>
      </div>
      {about && <AboutDialog onClose={() => setAbout(false)} />}
    </header>
  );
}

function LayoutToggle({ on, onClick, onLabel, offLabel, keys, icon }: { on: boolean; onClick: () => void; onLabel: string; offLabel: string; keys?: string; icon: React.ReactNode }) {
  const label = on ? onLabel : offLabel;
  return (
    <button
      type="button"
      onClick={onClick}
      title={keys ? `${label} (${keys})` : label}
      aria-label={label}
      aria-pressed={on}
      className={clsx("w-7 h-7 grid place-items-center rounded cursor-pointer transition-colors", on ? "text-accent hover:bg-bg-hover" : "text-fg-muted hover:text-fg hover:bg-bg-hover")}
    >
      {icon}
    </button>
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
            className={clsx("h-6 px-2 rounded text-xs cursor-pointer transition-colors", openIdx === i ? "bg-bg-hover text-fg" : "text-fg-muted hover:text-fg hover:bg-bg-hover")}
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
              className="absolute left-0 top-full mt-0.5 z-50 min-w-60 max-h-[75vh] overflow-auto py-1 rounded-md border border-border bg-bg-elev shadow-2xl outline-none"
            >
              {m.entries.map((entry, k) => {
                if (entry.type === "sep") return <div key={k} role="separator" className="my-1 border-t border-border" />;
                if (entry.type === "heading")
                  return (
                    <div key={k} className="px-3 pt-1.5 pb-0.5 text-[10px] uppercase tracking-wider text-fg-muted/80">
                      {entry.label}
                    </div>
                  );
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
                    <span className="w-3.5 shrink-0">{entry.checked ? <Check size={12} className="text-accent" /> : null}</span>
                    <span className="flex-1 truncate">{entry.label}</span>
                    {entry.keys && <kbd className="text-[10px] text-fg-muted ml-6 font-sans">{entry.keys}</kbd>}
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

function AboutDialog({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="titlebar-nodrag fixed inset-0 z-50 bg-black/50 grid place-items-center" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label="About HardKas IDE" className="w-full max-w-sm rounded-lg border border-border bg-bg-elev p-5 shadow-2xl space-y-3 text-xs" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3">
          <HardKasMark size={36} />
          <div>
            <div className="text-sm font-semibold text-fg">HardKas IDE</div>
            <div className="text-fg-muted">Version 0.1 · HardKas CLI 0.12.0-rc.29</div>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="ml-auto p-1 rounded text-fg-muted hover:text-fg hover:bg-bg-hover cursor-pointer">
            <X size={14} />
          </button>
        </div>
        <p className="text-fg-muted leading-relaxed">
          A Remix-style workbench for Kaspa: editor, SilverScript compiler, Deploy &amp; Run, artifacts and terminals on top of the HardKas toolkit. Shaped after Remix IDE (Apache-2.0) and the Visual Studio project flow.
        </p>
        <a className="text-accent hover:underline" href={REPO_URL} target="_blank" rel="noopener noreferrer">
          github.com/KasLabDevs/HardKasIDE
        </a>
      </div>
    </div>
  );
}
