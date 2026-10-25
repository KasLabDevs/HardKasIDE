import { create } from "zustand";
import type { TreeNode, WorkspaceInfo } from "@/api/client";

/**
 * UI state shared by shell and panels. Plugins do the work; this store holds
 * what the React views need to render.
 */

export type ExecutionTarget = "simulator" | "localnet" | "rpc";

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
function loadDocks(): Record<string, Dock> {
  try {
    return JSON.parse(localStorage.getItem(DOCKS_KEY) ?? "{}") as Record<string, Dock>;
  } catch {
    return {};
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
  setTarget(target: ExecutionTarget): void;
  log(kind: JournalKind, text: string, data?: unknown): void;
  clearJournal(): void;
  setTerminalOpen(open: boolean): void;
  setOutlineOpen(open: boolean): void;
  setStatus(message: string): void;
}

let journalSeq = 0;

export const useIde = create<IdeState>((set) => ({
  workspace: null,
  tree: [],
  openFiles: [],
  activeFile: null,
  activeSidePlugin: "files",
  target: "simulator",
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
      const activeSidePlugin = s.activeSidePlugin === pluginName && dock !== "left" ? "files" : s.activeSidePlugin;
      if (dock === "leftBottom" && pluginName === "files") return s; // the Explorer anchors the left column
      return { docks, activeSidePlugin, outlineOpen: dock === "right" ? true : s.outlineOpen };
    }),

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
  setActiveSidePlugin: (activeSidePlugin) => set({ activeSidePlugin }),
  setTarget: (target) => set({ target }),
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
