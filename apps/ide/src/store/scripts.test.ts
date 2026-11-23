import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkspacePackageScripts } from "@/api/client";

vi.mock("@/api/client", () => ({
  api: {
    terminal: {
      stop: vi.fn(async () => ({ stopped: true }))
    }
  }
}));

const { api } = await import("@/api/client");
const { useScripts, scriptKeyOf } = await import("./scripts");
const { useIde } = await import("./ide");

const SAMPLE_PKG: WorkspacePackageScripts = {
  id: "apps/web",
  name: "@app/web",
  relDir: "apps/web",
  manifestPath: "apps/web/package.json",
  manager: "pnpm",
  scripts: [
    { name: "dev", command: "vite --port 5173", kind: "launch", manager: "pnpm", cliPreview: "pnpm run dev" },
    { name: "build", command: "vite build", kind: "build", manager: "pnpm", cliPreview: "pnpm run build" }
  ]
};

beforeEach(() => {
  useScripts.setState({
    packages: [],
    loading: false,
    error: null,
    terminals: [],
    activeBottomTab: { kind: "console" }
  });
  useIde.setState({ terminalOpen: false });
  vi.clearAllMocks();
});

describe("useScripts store", () => {
  it("opens bottom panel & creates a terminal tab when launching a script, and focuses if already running", () => {
    const id1 = useScripts.getState().launchScript(SAMPLE_PKG, SAMPLE_PKG.scripts[0]);
    expect(useIde.getState().terminalOpen).toBe(true);
    expect(useScripts.getState().activeBottomTab).toEqual({ kind: "terminal", id: id1 });

    const tab1 = useScripts.getState().terminals[0];
    expect(tab1.scriptRun?.key).toBe(scriptKeyOf("apps/web", "dev"));
    expect(tab1.scriptRun?.runSeq).toBe(1);
    expect(tab1.status).toBe("running");

    // Launching again while running focuses the existing tab without duplicating or incrementing runSeq.
    useScripts.getState().setActiveBottomTab({ kind: "console" });
    const id2 = useScripts.getState().launchScript(SAMPLE_PKG, SAMPLE_PKG.scripts[0]);
    expect(id2).toBe(id1);
    expect(useScripts.getState().terminals).toHaveLength(1);
    expect(useScripts.getState().terminals[0].scriptRun?.runSeq).toBe(1);
    expect(useScripts.getState().activeBottomTab).toEqual({ kind: "terminal", id: id1 });
  });

  it("extracts split localhost URLs cleanly across terminal chunks and flushes on exit", () => {
    const id = useScripts.getState().launchScript(SAMPLE_PKG, SAMPLE_PKG.scripts[0]);
    useScripts.getState().appendTerminalOutput(id, "\x1b[32mLocal:\x1b[0m http://localh");
    expect(useScripts.getState().terminals[0].urls).toEqual([]);

    useScripts.getState().appendTerminalOutput(id, "ost:5173/\r\n");
    expect(useScripts.getState().terminals[0].urls).toEqual(["http://localhost:5173/"]);

    // Trailing URL without newline still flushes on exit, keeping tab visible after exit.
    useScripts.getState().appendTerminalOutput(id, "API: http://127.0.0.1:7421");
    useScripts.getState().markExited(id, 0, false);
    const finished = useScripts.getState().terminals[0];
    expect(finished.status).toBe("succeeded");
    expect(finished.exitCode).toBe(0);
    expect(finished.urls).toEqual(["http://localhost:5173/", "http://127.0.0.1:7421/"]);

    // Launching after finish reuses the tab and increments runSeq.
    useScripts.getState().launchScript(SAMPLE_PKG, SAMPLE_PKG.scripts[0]);
    expect(useScripts.getState().terminals[0].scriptRun?.runSeq).toBe(2);
    expect(useScripts.getState().terminals[0].urls).toEqual([]);
    expect(useScripts.getState().terminals[0].status).toBe("running");
  });

  it("calls api.terminal.stop when stopping a script and removes exited interactive shells", async () => {
    const scriptId = useScripts.getState().launchScript(SAMPLE_PKG, SAMPLE_PKG.scripts[0]);
    useScripts.getState().setSessionId(scriptId, "term_abc");
    await useScripts.getState().stopTerminal(scriptId);
    expect(api.terminal.stop).toHaveBeenCalledWith("term_abc");
    useScripts.getState().markExited(scriptId, 1, true);
    expect(useScripts.getState().terminals[0].status).toBe("stopped");

    const shellId = useScripts.getState().openShellTerminal();
    expect(useScripts.getState().terminals).toHaveLength(2);
    useScripts.getState().markExited(shellId, 0, false);
    expect(useScripts.getState().terminals).toHaveLength(1);
    expect(useScripts.getState().terminals[0].id).toBe(scriptId);
  });
});
