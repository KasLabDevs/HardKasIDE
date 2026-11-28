import { create } from "zustand";
import { api, type PackageManager, type PackageScriptEntry, type WorkspacePackageScripts } from "@/api/client";
import { useIde } from "@/store/ide";
import { extractLocalUrls, stripAnsi } from "@/utils/scriptUrls";

export type BottomTab = { kind: "console" } | { kind: "problems" } | { kind: "search" } | { kind: "terminal"; id: string };

export interface ScriptRunMeta {
  key: string;
  pkgRelDir: string;
  pkgName: string;
  scriptName: string;
  manager: PackageManager;
  commandLine: string;
  runSeq: number;
}

export interface TerminalTab {
  id: string;
  title: string;
  cwd?: string;
  scriptRun?: ScriptRunMeta;
  status: "running" | "succeeded" | "failed" | "stopped";
  exitCode: number | null;
  sessionId: string | null;
  urls: string[];
  /** Buffered ANSI-stripped partial line across WebSocket frames so split URLs are scanned intact. */
  lineBuffer: string;
}

const MAX_URLS_PER_TAB = 6;
let shellSeq = 0;

export function scriptKeyOf(pkgRelDir: string, scriptName: string): string {
  return `${pkgRelDir || "."}::${scriptName}`;
}

function appendUniqueUrls(existing: string[], incoming: string[]): string[] {
  if (incoming.length === 0) return existing;
  const next = [...existing];
  for (const url of incoming) {
    if (next.includes(url)) continue;
    if (next.length >= MAX_URLS_PER_TAB) break;
    next.push(url);
  }
  return next.length === existing.length ? existing : next;
}

interface ScriptsState {
  packages: WorkspacePackageScripts[];
  loading: boolean;
  error: string | null;
  terminals: TerminalTab[];
  activeBottomTab: BottomTab;

  setPackages(packages: WorkspacePackageScripts[]): void;
  setLoading(loading: boolean): void;
  setError(error: string | null): void;
  setActiveBottomTab(tab: BottomTab): void;

  openShellTerminal(cwd?: string): string;
  launchScript(pkg: WorkspacePackageScripts, script: PackageScriptEntry): string;
  restartTerminal(id: string): Promise<void>;
  stopTerminal(id: string): Promise<void>;
  stopAllScripts(): Promise<void>;
  closeTerminalTab(id: string): void;
  renameTerminalTab(id: string, title: string): void;

  setSessionId(id: string, sessionId: string): void;
  appendTerminalOutput(id: string, chunk: string): void;
  markExited(id: string, exitCode: number | null, stopped: boolean): void;
  resetWorkspace(): void;
}

export const useScripts = create<ScriptsState>((set, get) => ({
  packages: [],
  loading: false,
  error: null,
  terminals: [],
  activeBottomTab: { kind: "console" },

  setPackages: (packages) => set({ packages }),
  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error }),
  setActiveBottomTab: (activeBottomTab) => set({ activeBottomTab }),

  openShellTerminal: (cwd) => {
    shellSeq += 1;
    const id = `t${shellSeq}-${Date.now().toString(36)}`;
    const tab: TerminalTab = {
      id,
      title: `shell ${shellSeq}`,
      cwd,
      status: "running",
      exitCode: null,
      sessionId: null,
      urls: [],
      lineBuffer: ""
    };
    set((s) => ({
      terminals: [...s.terminals, tab],
      activeBottomTab: { kind: "terminal", id }
    }));
    useIde.getState().setTerminalOpen(true);
    return id;
  },

  launchScript: (pkg, script) => {
    const key = scriptKeyOf(pkg.relDir, script.name);
    const existing = get().terminals.find((t) => t.scriptRun?.key === key);
    useIde.getState().setTerminalOpen(true);

    if (existing) {
      if (existing.status === "running") {
        // Already live: bring its terminal tab to the front instead of killing an active dev server.
        set({ activeBottomTab: { kind: "terminal", id: existing.id } });
        return existing.id;
      }
      set((s) => ({
        terminals: s.terminals.map((t) =>
          t.id === existing.id
            ? {
                ...t,
                status: "running",
                exitCode: null,
                sessionId: null,
                urls: [],
                lineBuffer: "",
                scriptRun: t.scriptRun ? { ...t.scriptRun, manager: script.manager, commandLine: script.cliPreview, runSeq: t.scriptRun.runSeq + 1 } : t.scriptRun
              }
            : t
        ),
        activeBottomTab: { kind: "terminal", id: existing.id }
      }));
      return existing.id;
    }

    const id = `scr-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const shortPkg = pkg.relDir === "." ? "" : `${pkg.relDir} · `;
    const tab: TerminalTab = {
      id,
      title: `${shortPkg}${script.name}`,
      scriptRun: {
        key,
        pkgRelDir: pkg.relDir,
        pkgName: pkg.name,
        scriptName: script.name,
        manager: script.manager,
        commandLine: script.cliPreview,
        runSeq: 1
      },
      status: "running",
      exitCode: null,
      sessionId: null,
      urls: [],
      lineBuffer: ""
    };
    set((s) => ({
      terminals: [...s.terminals, tab],
      activeBottomTab: { kind: "terminal", id }
    }));
    return id;
  },

  restartTerminal: async (id) => {
    const current = get().terminals.find((t) => t.id === id);
    if (!current?.scriptRun) return;
    if (current.status === "running" && current.sessionId) {
      await api.terminal.stop(current.sessionId).catch(() => {});
    }
    set((s) => ({
      terminals: s.terminals.map((t) =>
        t.id === id && t.scriptRun
          ? {
              ...t,
              status: "running",
              exitCode: null,
              sessionId: null,
              urls: [],
              lineBuffer: "",
              scriptRun: { ...t.scriptRun, runSeq: t.scriptRun.runSeq + 1 }
            }
          : t
      ),
      activeBottomTab: { kind: "terminal", id }
    }));
    useIde.getState().setTerminalOpen(true);
  },

  stopTerminal: async (id) => {
    const tab = get().terminals.find((t) => t.id === id);
    if (!tab || tab.status !== "running") return;
    if (tab.sessionId) {
      const res = await api.terminal.stop(tab.sessionId).catch(() => ({ stopped: false }));
      if (!res.stopped) {
        set((s) => ({
          terminals: s.terminals.map((t) => (t.id === id ? { ...t, status: "stopped", sessionId: null } : t))
        }));
      }
      return;
    }
    set((s) => ({
      terminals: s.terminals.map((t) => (t.id === id ? { ...t, status: "stopped", sessionId: null } : t))
    }));
  },

  stopAllScripts: async () => {
    const running = get().terminals.filter((t) => t.scriptRun && t.status === "running");
    await Promise.all(running.map((t) => get().stopTerminal(t.id)));
  },

  closeTerminalTab: (id) => {
    const target = get().terminals.find((t) => t.id === id);
    if (target?.status === "running" && target.sessionId) {
      void api.terminal.stop(target.sessionId).catch(() => {});
    }
    set((s) => {
      const next = s.terminals.filter((t) => t.id !== id);
      let activeBottomTab = s.activeBottomTab;
      if (activeBottomTab.kind === "terminal" && activeBottomTab.id === id) {
        const last = next.at(-1);
        activeBottomTab = last ? { kind: "terminal", id: last.id } : { kind: "console" };
      }
      return { terminals: next, activeBottomTab };
    });
  },

  renameTerminalTab: (id, title) =>
    set((s) => ({
      terminals: s.terminals.map((t) => (t.id === id ? { ...t, title: title.trim() || t.title } : t))
    })),

  setSessionId: (id, sessionId) =>
    set((s) => ({
      terminals: s.terminals.map((t) => (t.id === id ? { ...t, sessionId } : t))
    })),

  appendTerminalOutput: (id, chunk) =>
    set((s) => {
      const tab = s.terminals.find((t) => t.id === id);
      if (!tab) return s;
      const combined = tab.lineBuffer + stripAnsi(chunk);
      const lastBoundary = Math.max(combined.lastIndexOf("\n"), combined.lastIndexOf("\r"), combined.lastIndexOf(" "));
      if (lastBoundary < 0) {
        return {
          terminals: s.terminals.map((t) => (t.id === id ? { ...t, lineBuffer: combined.slice(-300) } : t))
        };
      }
      const complete = combined.slice(0, lastBoundary + 1);
      const tail = combined.slice(lastBoundary + 1).slice(-300);
      const urls = appendUniqueUrls(tab.urls, extractLocalUrls(complete));
      return {
        terminals: s.terminals.map((t) => (t.id === id ? { ...t, lineBuffer: tail, urls } : t))
      };
    }),

  markExited: (id, exitCode, stopped) => {
    const tab = get().terminals.find((t) => t.id === id);
    if (!tab) return;
    if (!tab.scriptRun) {
      // Plain interactive shell: mirror classic VS Code behavior and remove the closed tab.
      get().closeTerminalTab(id);
      return;
    }
    set((s) => ({
      terminals: s.terminals.map((t) => {
        if (t.id !== id) return t;
        const flushedUrls = appendUniqueUrls(t.urls, extractLocalUrls(t.lineBuffer));
        return {
          ...t,
          sessionId: null,
          exitCode,
          urls: flushedUrls,
          lineBuffer: "",
          status: stopped ? "stopped" : exitCode === 0 ? "succeeded" : "failed"
        };
      })
    }));
  },

  resetWorkspace: () => {
    void get().stopAllScripts();
    set({
      packages: [],
      loading: false,
      error: null,
      terminals: [],
      activeBottomTab: { kind: "console" }
    });
  }
}));
