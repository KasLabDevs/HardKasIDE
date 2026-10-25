import { create } from "zustand";
import type { TreeNode, WorkspaceInfo } from "@/api/client";

/**
 * UI state shared by shell and panels. Plugins do the work; this store holds
 * what the React views need to render.
 */

export type ExecutionTarget = "simulator" | "localnet" | "rpc";

export interface OpenFile {
  path: string;
  content: string;
  savedContent: string;
  language: string;
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
  statusMessage: string;

  setWorkspace(ws: WorkspaceInfo | null): void;
  setTree(tree: TreeNode[]): void;
  upsertOpenFile(file: OpenFile): void;
  updateContent(path: string, content: string): void;
  markSaved(path: string): void;
  closeFile(path: string): void;
  setActiveFile(path: string | null): void;
  setActiveSidePlugin(name: string): void;
  setTarget(target: ExecutionTarget): void;
  log(kind: JournalKind, text: string, data?: unknown): void;
  clearJournal(): void;
  setTerminalOpen(open: boolean): void;
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
  statusMessage: "",

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
  setActiveSidePlugin: (activeSidePlugin) => set({ activeSidePlugin }),
  setTarget: (target) => set({ target }),
  log: (kind, text, data) =>
    set((s) => ({
      journal: [...s.journal.slice(-999), { id: ++journalSeq, kind, text, at: new Date().toISOString(), data }]
    })),
  clearJournal: () => set({ journal: [] }),
  setTerminalOpen: (terminalOpen) => set({ terminalOpen }),
  setStatus: (statusMessage) => set({ statusMessage })
}));

export function languageForPath(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
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
