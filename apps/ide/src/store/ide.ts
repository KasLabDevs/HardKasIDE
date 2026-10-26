import { create } from "zustand";
import type { TreeNode, WorkspaceInfo } from "@/api/client";

/**
 * UI state shared by shell and panels. Plugins do the work; this store holds
 * what the React views need to render.
 */

export type ExecutionTarget = "simulator" | "localnet" | "rpc";

/**
 * Default environment: the Local node (Docker rusty-kaspad). It is a real node, so it is the most
 * faithful place to try transactions and contracts. The choice is remembered once the user makes it;
 * until then the environment plugin falls back to the Simulator when Docker is not available
 * (see EnvironmentPlugin.applyDockerFallback).
 */
const TARGET_KEY = "hardkas-ide.target";
const DEFAULT_TARGET: ExecutionTarget = "localnet";

function loadTarget(): ExecutionTarget {
  try {
    const saved = JSON.parse(localStorage.getItem(TARGET_KEY) ?? "null") as { target?: ExecutionTarget } | null;
    if (saved?.target === "simulator" || saved?.target === "localnet" || saved?.target === "rpc") return saved.target;
  } catch {
    // storage unavailable: use the default
  }
  return DEFAULT_TARGET;
}

/** Whether the user ever picked an environment by hand (as opposed to the default or an automatic fallback). */
export function userChoseTarget(): boolean {
  try {
    return (JSON.parse(localStorage.getItem(TARGET_KEY) ?? "null") as { by?: string } | null)?.by === "user";
  } catch {
    return false;
  }
}

function saveTarget(target: ExecutionTarget, by: "user" | "auto"): void {
  try {
    localStorage.setItem(TARGET_KEY, JSON.stringify({ target, by }));
  } catch {
    // ignore
  }
}

/**
 * The three places a transaction can go. One definition, used by every panel,
 * so the names match everywhere (HardKas itself says `--target simulator|localnet`
 * and `--network simulated|simnet|testnet-10`; both are shown).
 */
export interface EnvironmentDef {
  id: ExecutionTarget;
  label: string; // human name
  short: string; // for tight spaces
  networkId: string; // HardKas network name
  description: string;
  needsDocker: boolean;
  needsNode: boolean;
}

export const ENVIRONMENTS: EnvironmentDef[] = [
  {
    id: "simulator",
    label: "Simulator (in-memory)",
    short: "Simulator",
    networkId: "simulated",
    description: "No node, no Docker: HardKas simulates Kaspa in memory with synthetic accounts (alice…erin, 1000 KAS each). Fast and deterministic; the default for development.",
    needsDocker: false,
    needsNode: false
  },
  {
    id: "localnet",
    label: "Local node (Docker, simnet)",
    short: "Local node",
    networkId: "simnet",
    description: "A real rusty-kaspad running in Docker on the private simnet network, with a CPU miner to fund accounts. Needs Docker Desktop installed and running.",
    needsDocker: true,
    needsNode: true
  },
  {
    id: "rpc",
    label: "Public testnet (RPC)",
    short: "Testnet",
    networkId: "testnet-10",
    description: "A remote Kaspa testnet-10 node from hardkas.config.ts. Real network, test coins. Mainnet is blocked by HardKas policy.",
    needsDocker: false,
    needsNode: false
  }
];

export function envOf(target: ExecutionTarget): EnvironmentDef {
  return ENVIRONMENTS.find((e) => e.id === target) ?? ENVIRONMENTS[0];
}

export interface OpenFile {
  path: string;
  content: string;
  savedContent: string;
  language: string;
  /** "view" tabs render a main-panel plugin view instead of the editor; path is "view:<pluginName>". */
  kind?: "file" | "view";
  title?: string;
}

export const VIEW_PREFIX = "view:";

/** Where a side-panel plugin is docked (Eclipse-style movable views). */
export type Dock = "left" | "leftBottom" | "right" | "main";
const DOCKS_KEY = "hardkas-ide.docks";
/** Out-of-the-box placement: the Assistant chat lives on the right, like an editor's side panels. */
const DEFAULT_DOCKS: Record<string, Dock> = { assistant: "right" };

function loadDocks(): Record<string, Dock> {
  try {
    return { ...DEFAULT_DOCKS, ...(JSON.parse(localStorage.getItem(DOCKS_KEY) ?? "{}") as Record<string, Dock>) };
  } catch {
    return { ...DEFAULT_DOCKS };
  }
}

export type JournalKind = "log" | "info" | "warn" | "error" | "command" | "json";

export interface JournalBlock {
  id: number;
  kind: JournalKind;
  text: string;
  at: string;
  /** Optional structured payload (shown collapsible). */
  data?: unknown;
}

interface IdeState {
  workspace: WorkspaceInfo | null;
  tree: TreeNode[];
  openFiles: OpenFile[];
  activeFile: string | null;
  activeSidePlugin: string;
  target: ExecutionTarget;
  journal: JournalBlock[];
  terminalOpen: boolean;
  outlineOpen: boolean;
  /** Primary side bar (the left column: Explorer, Run, Servers…). */
  sidebarOpen: boolean;
  setSidebarOpen(open: boolean): void;
  /** UI scale in percent (default 110), like the browser/VS Code zoom but remembered. */
  zoom: number;
  setZoom(percent: number): void;
  /** Set by File/Terminal menus: the bottom panel opens a new terminal as soon as it is mounted. */
  pendingTerminal: boolean;
  requestTerminal(): void;
  clearTerminalRequest(): void;
  statusMessage: string;
  docks: Record<string, Dock>;
  setDock(pluginName: string, dock: Dock): void;

  setWorkspace(ws: WorkspaceInfo | null): void;
  setTree(tree: TreeNode[]): void;
  upsertOpenFile(file: OpenFile): void;
  updateContent(path: string, content: string): void;
  markSaved(path: string): void;
  closeFile(path: string): void;
  setActiveFile(path: string | null): void;
  /** Opens (or focuses) a main-panel plugin view as a tab. */
  openView(pluginName: string, title: string): void;
  setActiveSidePlugin(name: string): void;
  /** Puts every panel back where it starts (Assistant on the right, the rest on the left) and shows outline and console. */
  resetLayout(): void;
  /** Shows a plugin wherever it is docked (left column, stacked, right column or editor tab). */
  revealPlugin(name: string, title?: string): void;
  /** Last plugin revealed in a column that is always visible (lets a view focus itself). */
  revealed: string | null;
  setTarget(target: ExecutionTarget): void;
  log(kind: JournalKind, text: string, data?: unknown): void;
  clearJournal(): void;
  setTerminalOpen(open: boolean): void;
  setOutlineOpen(open: boolean): void;
  setStatus(message: string): void;
}

let journalSeq = 0;

const ZOOM_KEY = "hardkas-ide.zoom";
export const DEFAULT_ZOOM = 110;
export const MIN_ZOOM = 70;
export const MAX_ZOOM = 200;

function loadZoom(): number {
  try {
    const n = Number(localStorage.getItem(ZOOM_KEY));
    if (Number.isFinite(n) && n >= MIN_ZOOM && n <= MAX_ZOOM) return Math.round(n);
  } catch {
    // storage unavailable: default
  }
  return DEFAULT_ZOOM;
}

/** rem-based sizes follow <html>; the body's px size is the 13px origin scaled the same way. */
function applyZoom(percent: number): void {
  if (typeof document === "undefined") return;
  document.documentElement.style.fontSize = `${percent}%`;
  document.body.style.fontSize = `${((13 * percent) / 100).toFixed(1)}px`;
}

const initialZoom = loadZoom();
applyZoom(initialZoom);

export const useIde = create<IdeState>((set, get) => ({
  sidebarOpen: true,
  setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
  zoom: initialZoom,
  setZoom: (percent) => {
    const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(percent)));
    applyZoom(zoom);
    try {
      localStorage.setItem(ZOOM_KEY, String(zoom));
    } catch {
      // ignore
    }
    set({ zoom });
  },
  pendingTerminal: false,
  requestTerminal: () => set({ terminalOpen: true, pendingTerminal: true }),
  clearTerminalRequest: () => set({ pendingTerminal: false }),
  workspace: null,
  tree: [],
  openFiles: [],
  activeFile: null,
  activeSidePlugin: "files",
  target: loadTarget(),
  journal: [],
  terminalOpen: true,
  outlineOpen: true,
  statusMessage: "",
  docks: loadDocks(),
  setDock: (pluginName, dock) =>
    set((s) => {
      const docks = { ...s.docks, [pluginName]: dock };
      try {
        localStorage.setItem(DOCKS_KEY, JSON.stringify(docks));
      } catch {
        // ignore
      }
      // A plugin moved to the right/main should not stay selected on the left.
      // A plugin moved out of the left column must not stay "active" there; selecting a docked-elsewhere
      // plugin from the palette also moves it back to the left so it actually shows.
      const activeSidePlugin = s.activeSidePlugin === pluginName && dock !== "left" ? "files" : s.activeSidePlugin;
      if (dock === "leftBottom" && pluginName === "files") return s; // the Explorer anchors the left column
      return { docks, activeSidePlugin, outlineOpen: dock === "right" ? true : s.outlineOpen };
    }),

  resetLayout: () => {
    try {
      localStorage.removeItem(DOCKS_KEY);
    } catch {
      // ignore
    }
    set({ docks: { ...DEFAULT_DOCKS }, activeSidePlugin: "files", outlineOpen: true, terminalOpen: true, sidebarOpen: true });
  },

  setWorkspace: (workspace) => set({ workspace }),
  setTree: (tree) => set({ tree }),
  upsertOpenFile: (file) =>
    set((s) => {
      const exists = s.openFiles.some((f) => f.path === file.path);
      return {
        openFiles: exists ? s.openFiles.map((f) => (f.path === file.path ? file : f)) : [...s.openFiles, file],
        activeFile: file.path
      };
    }),
  updateContent: (path, content) =>
    set((s) => ({ openFiles: s.openFiles.map((f) => (f.path === path ? { ...f, content } : f)) })),
  markSaved: (path) =>
    set((s) => ({ openFiles: s.openFiles.map((f) => (f.path === path ? { ...f, savedContent: f.content } : f)) })),
  closeFile: (path) =>
    set((s) => {
      const remaining = s.openFiles.filter((f) => f.path !== path);
      const activeFile = s.activeFile === path ? (remaining.at(-1)?.path ?? null) : s.activeFile;
      return { openFiles: remaining, activeFile };
    }),
  setActiveFile: (activeFile) => set({ activeFile }),
  openView: (pluginName, title) =>
    set((s) => {
      const path = VIEW_PREFIX + pluginName;
      const exists = s.openFiles.some((f) => f.path === path);
      return {
        openFiles: exists ? s.openFiles : [...s.openFiles, { path, content: "", savedContent: "", language: "view", kind: "view", title }],
        activeFile: path
      };
    }),
  setActiveSidePlugin: (activeSidePlugin) => set({ activeSidePlugin, sidebarOpen: true }),
  revealPlugin: (name, title) => {
    const dock = get().docks[name] ?? "left";
    if (dock === "left") set({ activeSidePlugin: name, sidebarOpen: true });
    else if (dock === "main") get().openView(name, title ?? name);
    // "leftBottom" and "right" panels are already visible in their column; flag it so the UI can focus them.
    else set({ revealed: name, sidebarOpen: dock === "leftBottom" ? true : get().sidebarOpen });
  },
  revealed: null,
  setTarget: (target) => {
    saveTarget(target, "user");
    set({ target });
  },
  log: (kind, text, data) =>
    set((s) => ({
      journal: [...s.journal.slice(-999), { id: ++journalSeq, kind, text, at: new Date().toISOString(), data }]
    })),
  clearJournal: () => set({ journal: [] }),
  setTerminalOpen: (terminalOpen) => set({ terminalOpen }),
  setOutlineOpen: (outlineOpen) => set({ outlineOpen }),
  setStatus: (statusMessage) => set({ statusMessage })
}));

/** Extra extension → language ids contributed by installed VS Code extensions (set by the vsx plugin). */
export const extraLanguages: Record<string, string> = {};

export function languageForPath(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  const extra = extraLanguages["." + ext];
  if (extra) return extra;
  switch (ext) {
    case "sil":
      return "silverscript";
    case "ts":
    case "mts":
      return "typescript";
    case "tsx":
      return "typescript";
    case "js":
    case "mjs":
    case "cjs":
      return "javascript";
    case "json":
      return "json";
    case "md":
      return "markdown";
    case "yaml":
    case "yml":
      return "yaml";
    case "toml":
      return "ini";
    case "sh":
      return "shell";
    default:
      return "plaintext";
  }
}
