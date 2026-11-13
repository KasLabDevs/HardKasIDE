import { create } from "zustand";
import { api, type SearchFileResult } from "@/api/client";
import { useIde } from "./ide";

export type SearchDialogMode = "closed" | "eclipse-search" | "quick-search";
export type SearchDialogTab = "file" | "silver" | "symbol";
export type SearchScope = "workspace" | "open-files" | "current-file" | "directory";

interface SearchState {
  dialogMode: SearchDialogMode;
  dialogTab: SearchDialogTab;
  query: string;
  replacement: string;
  showReplace: boolean;
  caseSensitive: boolean;
  regex: boolean;
  wholeWord: boolean;
  filePatterns: string;
  scope: SearchScope;
  scopeDir: string;
  busy: boolean;
  error: string | null;
  results: SearchFileResult[];
  totalMatches: number;
  totalFiles: number;
  truncated: boolean;
  lastSummary: string;
  selectedMatch: { path: string; line: number; column: number } | null;
  history: string[];
  bottomSearchOpen: boolean;
  revealBottomSeq: number;

  openSearchDialog(opts?: {
    mode?: "eclipse-search" | "quick-search";
    tab?: SearchDialogTab;
    scope?: SearchScope;
    scopeDir?: string;
    query?: string;
    filePatterns?: string;
    showReplace?: boolean;
  }): void;
  closeDialog(): void;
  setQuery(q: string): void;
  setReplacement(r: string): void;
  setShowReplace(v: boolean): void;
  setOptions(opts: Partial<Pick<SearchState, "caseSensitive" | "regex" | "wholeWord" | "filePatterns" | "scope" | "scopeDir" | "dialogTab">>): void;
  setSelectedMatch(m: { path: string; line: number; column: number } | null): void;
  removeFileFromResults(path: string): void;
  clearResults(): void;
  revealBottomSearch(): void;
  closeBottomSearch(): void;
  runSearch(override?: {
    query?: string;
    scope?: SearchScope;
    scopeDir?: string;
    filePatterns?: string;
    regex?: boolean;
    caseSensitive?: boolean;
    wholeWord?: boolean;
    revealInBottom?: boolean;
  }): Promise<void>;
  runReplaceAll(targetFiles?: string[]): Promise<{ replacedFiles: number; replacedMatches: number }>;
}

export const useSearch = create<SearchState>((set, get) => ({
  dialogMode: "closed",
  dialogTab: "file",
  query: "",
  replacement: "",
  showReplace: false,
  caseSensitive: false,
  regex: false,
  wholeWord: false,
  filePatterns: "*",
  scope: "workspace",
  scopeDir: "",
  busy: false,
  error: null,
  results: [],
  totalMatches: 0,
  totalFiles: 0,
  truncated: false,
  lastSummary: "",
  selectedMatch: null,
  history: [],
  bottomSearchOpen: false,
  revealBottomSeq: 0,

  openSearchDialog: (opts) => {
    const s = get();
    set({
      dialogMode: opts?.mode ?? "eclipse-search",
      dialogTab: opts?.tab ?? s.dialogTab,
      scope: opts?.scope ?? s.scope,
      scopeDir: opts?.scopeDir ?? s.scopeDir,
      query: opts?.query !== undefined ? opts.query : s.query,
      filePatterns: opts?.filePatterns !== undefined ? opts.filePatterns : s.filePatterns,
      showReplace: opts?.showReplace ?? false,
      error: null
    });
  },

  closeDialog: () => set({ dialogMode: "closed" }),

  setQuery: (query) => set({ query }),
  setReplacement: (replacement) => set({ replacement }),
  setShowReplace: (showReplace) => set({ showReplace }),
  setOptions: (opts) => set((s) => ({ ...s, ...opts })),
  setSelectedMatch: (selectedMatch) => set({ selectedMatch }),

  removeFileFromResults: (path) =>
    set((s) => {
      const target = s.results.find((f) => f.path === path);
      const removedCount = target?.matches.length ?? 0;
      const next = s.results.filter((f) => f.path !== path);
      return {
        results: next,
        totalFiles: next.length,
        totalMatches: Math.max(0, s.totalMatches - removedCount)
      };
    }),

  clearResults: () =>
    set({
      results: [],
      totalMatches: 0,
      totalFiles: 0,
      truncated: false,
      lastSummary: "",
      selectedMatch: null,
      error: null
    }),

  revealBottomSearch: () => {
    useIde.getState().setTerminalOpen(true);
    set((s) => ({ bottomSearchOpen: true, revealBottomSeq: s.revealBottomSeq + 1 }));
  },

  closeBottomSearch: () => set({ bottomSearchOpen: false }),

  runSearch: async (override) => {
    const s = get();
    const q = (override?.query ?? s.query).trim();
    if (!q) return;

    const scope = override?.scope ?? s.scope;
    const scopeDir = override?.scopeDir ?? s.scopeDir;
    const filePatterns = override?.filePatterns ?? s.filePatterns;
    const caseSensitive = override?.caseSensitive ?? s.caseSensitive;
    const regex = override?.regex ?? s.regex;
    const wholeWord = override?.wholeWord ?? s.wholeWord;
    const revealInBottom = override?.revealInBottom ?? true;

    const ide = useIde.getState();
    let includeFiles: string[] | undefined;
    if (scope === "open-files") {
      includeFiles = ide.openFiles.filter((f) => f.kind !== "view").map((f) => f.path);
    } else if (scope === "current-file") {
      includeFiles = ide.activeFile && !ide.activeFile.startsWith("view:") ? [ide.activeFile] : [];
    }

    set({
      busy: true,
      error: null,
      query: q,
      scope,
      scopeDir,
      filePatterns,
      caseSensitive,
      regex,
      wholeWord,
      history: [q, ...s.history.filter((x) => x !== q)].slice(0, 12)
    });

    if (revealInBottom) {
      get().revealBottomSearch();
    }

    try {
      const res = await api.fs.search({
        query: q,
        caseSensitive,
        regex,
        wholeWord,
        filePatterns,
        scopeDir: scope === "directory" ? scopeDir : "",
        includeFiles
      });

      const scopeLabel =
        scope === "workspace"
          ? "Workspace"
          : scope === "open-files"
            ? "Open files"
            : scope === "current-file"
              ? ide.activeFile || "Current file"
              : `Folder: ${scopeDir || "/"}`;

      const firstMatch = res.files[0]?.matches[0]
        ? { path: res.files[0].path, line: res.files[0].matches[0].line, column: res.files[0].matches[0].column }
        : null;

      set({
        busy: false,
        results: res.files,
        totalMatches: res.totalMatches,
        totalFiles: res.totalFiles,
        truncated: res.truncated,
        selectedMatch: firstMatch,
        lastSummary: `'${q}' — ${res.totalMatches} match${res.totalMatches === 1 ? "" : "es"} in ${res.totalFiles} file${res.totalFiles === 1 ? "" : "s"} (${scopeLabel} · ${filePatterns || "*"})`
      });
    } catch (e) {
      set({
        busy: false,
        error: e instanceof Error ? e.message : String(e)
      });
    }
  },

  runReplaceAll: async (targetFiles) => {
    const s = get();
    const ide = useIde.getState();
    let includeFiles: string[] | undefined;
    if (s.scope === "open-files") {
      includeFiles = ide.openFiles.filter((f) => f.kind !== "view").map((f) => f.path);
    } else if (s.scope === "current-file" && ide.activeFile) {
      includeFiles = [ide.activeFile];
    }

    set({ busy: true, error: null });
    try {
      const res = await api.fs.replace({
        query: s.query,
        replacement: s.replacement,
        caseSensitive: s.caseSensitive,
        regex: s.regex,
        wholeWord: s.wholeWord,
        filePatterns: s.filePatterns,
        scopeDir: s.scope === "directory" ? s.scopeDir : "",
        includeFiles,
        targetFiles
      });
      await get().runSearch({ revealInBottom: true });
      return res;
    } catch (e) {
      set({ busy: false, error: e instanceof Error ? e.message : String(e) });
      throw e;
    }
  }
}));
