import { Plugin } from "@/engine/engine";
import { currentLocation, useDebug, type DebugFrame, type DebugVariable, type OutputLine } from "@/store/debug";
import { useIde } from "@/store/ide";

/**
 * Test debugger service (Eclipse "Debug As → JUnit Test"); its screen is the Tests view. Breakpoints in the gutter, a session that runs vitest under the Node
 * inspector (see ide-server debug.ts), and the usual controls: continue, step over / into / out, variables, watches.
 */

const BP_KEY = "hardkas-ide.breakpoints:";

type ServerEvent =
  | { type: "status"; state: "idle" | "starting" | "running" | "paused" | "finished" | "error"; message?: string }
  | { type: "output"; stream: OutputLine["stream"]; text: string }
  | { type: "paused"; reason: string; frames: DebugFrame[]; detail?: string }
  | { type: "resumed" }
  | { type: "breakpoints"; file: string; breakpoints: Array<{ line: number; verified: boolean; actual?: number }> }
  | { type: "exit"; code: number | null };

export class DebugPlugin extends Plugin {
  private source: EventSource | null = null;
  private retry: ReturnType<typeof setTimeout> | null = null;
  private watchdog: ReturnType<typeof setInterval> | null = null;
  private lastBeat = 0;
  private root = "";

  constructor() {
    super({
      name: "debug",
      displayName: "Debug",
      description: "Breakpoints and stepping for the project's tests",
      location: "none",
      methods: ["toggleBreakpoint", "start", "debugFile", "debugTest", "debugAll", "resume", "stepOver", "stepInto", "stepOut", "stop", "restart", "loadVariables", "selectFrame", "addWatch", "removeWatch", "clearBreakpoints", "replaceBreakpoints", "setPauseOnExceptions", "evaluate", "isBreakpoint"],
      events: ["paused", "finished"]
    });
  }

  onActivation(): void {
    this.root = useIde.getState().workspace?.root ?? "";
    try {
      useDebug.getState().set({ breakpoints: JSON.parse(localStorage.getItem(BP_KEY + this.root) ?? "{}") as Record<string, number[]> });
    } catch {
      useDebug.getState().set({ breakpoints: {} });
    }
    this.connect();
    // The server pings every 10 s; a stream that goes quiet for 35 s (a proxy or the server restarted) is replaced.
    this.watchdog = setInterval(() => {
      if (Date.now() - this.lastBeat > 35_000) this.connect();
    }, 10_000);
  }

  onDeactivation(): void {
    if (this.watchdog) clearInterval(this.watchdog);
    this.watchdog = null;
    if (this.retry) clearTimeout(this.retry);
    this.source?.close();
    this.source = null;
    useDebug.getState().set({ state: "idle", frames: [], vars: {}, status: {}, output: [], message: "" });
  }

  // ------------------------------------------------------------------ server stream

  private connect(): void {
    this.source?.close();
    const es = new EventSource("/api/debug/events");
    this.lastBeat = Date.now();
    es.addEventListener("ping", () => {
      this.lastBeat = Date.now();
    });
    es.addEventListener("debug", (e) => {
      this.lastBeat = Date.now();
      this.onEvent(JSON.parse((e as MessageEvent).data as string) as ServerEvent);
    });
    // The browser retries a dropped stream by itself, but gives up for good when the server answers with an error
    // while it restarts: reconnect by hand in that case.
    es.onerror = () => {
      if (es.readyState !== EventSource.CLOSED || this.source !== es) return;
      this.retry = setTimeout(() => this.source === es && this.connect(), 2000);
    };
    this.source = es;
  }

  private onEvent(e: ServerEvent): void {
    const s = useDebug.getState();
    switch (e.type) {
      case "status":
        s.set({ state: e.state, message: e.message ?? "", ...(e.state === "starting" ? { output: [], frames: [], vars: {}, status: {} } : {}) });
        if (e.state === "finished" || e.state === "error") {
          s.set({ frames: [], vars: {} });
          this.emit("finished", e.state);
        }
        break;
      case "output":
        s.set({ output: [...s.output, { stream: e.stream, text: e.text }].slice(-600) });
        break;
      case "paused":
        s.set({ state: "paused", reason: e.reason, detail: e.detail ?? "", frames: e.frames, frame: Math.max(0, e.frames.findIndex((f) => f.file !== null)), vars: {} });
        void this.onPaused();
        break;
      case "resumed":
        s.set({ frames: [], vars: {}, watchResults: {} });
        break;
      case "breakpoints":
        s.set({ status: { ...s.status, [e.file]: Object.fromEntries(e.breakpoints.map((b) => [b.line, { verified: b.verified, actual: b.actual }])) } });
        break;
      case "exit":
        break;
    }
  }

  /** Shows the stop: opens the file at the line, brings the Debug view forward, refreshes the watches. */
  private async onPaused(): Promise<void> {
    const s = useDebug.getState();
    const loc = currentLocation(s);
    useIde.getState().revealPlugin("tests", "Tests");
    if (loc) {
      await this.call("fileManager", "open", loc.file).catch(() => undefined);
      this.call("editor", "gotoLine", loc.line).catch(() => undefined);
    }
    this.emit("paused", loc);
    await this.refreshWatches();
  }

  private async command(body: Record<string, unknown>): Promise<Record<string, any>> {
    const res = await fetch("/api/debug/command", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const json = (await res.json()) as Record<string, any>;
    if (!json.ok) throw new Error(String(json.message ?? "debugger command failed"));
    return json;
  }

  // ------------------------------------------------------------------ breakpoints

  isBreakpoint(file: string, line: number): boolean {
    return (useDebug.getState().breakpoints[file] ?? []).includes(line);
  }

  async toggleBreakpoint(file: string, line: number): Promise<void> {
    const s = useDebug.getState();
    const lines = new Set(s.breakpoints[file] ?? []);
    if (lines.has(line)) lines.delete(line);
    else lines.add(line);
    await this.replaceBreakpoints(file, [...lines].sort((a, b) => a - b));
  }

  /** Sets the exact breakpoint lines of one file (also used when edits move the lines). */
  async replaceBreakpoints(file: string, lines: number[]): Promise<void> {
    const s = useDebug.getState();
    const next = { ...s.breakpoints };
    if (lines.length === 0) delete next[file];
    else next[file] = lines;
    s.set({ breakpoints: next });
    try {
      localStorage.setItem(BP_KEY + this.root, JSON.stringify(next));
    } catch {
      // storage unavailable: breakpoints just do not persist
    }
    if (s.state === "starting" || s.state === "running" || s.state === "paused") await this.command({ cmd: "setBreakpoints", file, lines }).catch(() => undefined);
  }

  async clearBreakpoints(): Promise<void> {
    const files = Object.keys(useDebug.getState().breakpoints);
    for (const f of files) await this.replaceBreakpoints(f, []);
  }

  // ------------------------------------------------------------------ sessions

  async start(target: { file?: string; testName?: string } = {}): Promise<void> {
    const s = useDebug.getState();
    if (s.state === "starting" || s.state === "running" || s.state === "paused") throw new Error("A debug session is already running.");
    s.set({ target, output: [], frames: [], vars: {}, status: {}, watchResults: {} });
    useIde.getState().revealPlugin("tests", "Tests");
    const res = await fetch("/api/debug/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...target, breakpoints: s.breakpoints, pauseOnExceptions: s.pauseOnExceptions })
    });
    const json = (await res.json()) as { ok: boolean; message?: string };
    if (!json.ok) {
      useDebug.getState().set({ state: "error", message: json.message ?? "could not start the debugger" });
      throw new Error(json.message ?? "could not start the debugger");
    }
  }

  debugFile(file: string): Promise<void> {
    return this.start({ file });
  }

  debugTest(file: string, testName: string): Promise<void> {
    // vitest -t takes a regular expression
    return this.start({ file, testName: testName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") });
  }

  debugAll(): Promise<void> {
    return this.start({});
  }

  async restart(): Promise<void> {
    const target = useDebug.getState().target ?? {};
    await this.stop();
    await new Promise((r) => setTimeout(r, 400));
    await this.start(target);
  }

  async resume(): Promise<void> {
    await this.command({ cmd: "resume" });
  }
  async stepOver(): Promise<void> {
    await this.command({ cmd: "stepOver" });
  }
  async stepInto(): Promise<void> {
    await this.command({ cmd: "stepInto" });
  }
  async stepOut(): Promise<void> {
    await this.command({ cmd: "stepOut" });
  }
  async stop(): Promise<void> {
    await this.command({ cmd: "stop" }).catch(() => undefined);
  }

  async setPauseOnExceptions(state: "none" | "uncaught" | "all"): Promise<void> {
    useDebug.getState().set({ pauseOnExceptions: state });
    const s = useDebug.getState().state;
    if (s === "starting" || s === "running" || s === "paused") await this.command({ cmd: "setPauseOnExceptions", state }).catch(() => undefined);
  }

  // ------------------------------------------------------------------ inspecting

  selectFrame(index: number): void {
    const s = useDebug.getState();
    s.set({ frame: index });
    const f = s.frames[index];
    if (f?.file) {
      void this.call("fileManager", "open", f.file).then(() => this.call("editor", "gotoLine", f.line)).catch(() => undefined);
    }
    void this.refreshWatches();
  }

  async loadVariables(objectId: string): Promise<DebugVariable[]> {
    const cached = useDebug.getState().vars[objectId];
    if (cached) return cached;
    const json = await this.command({ cmd: "properties", objectId });
    const variables = json.variables as DebugVariable[];
    useDebug.getState().set({ vars: { ...useDebug.getState().vars, [objectId]: variables } });
    return variables;
  }

  async evaluate(expression: string): Promise<{ value: string; type: string; error?: string; objectId?: string }> {
    const s = useDebug.getState();
    const frame = s.frames[s.frame];
    if (!frame) return { value: "", type: "error", error: "Not paused" };
    const json = await this.command({ cmd: "evaluate", frameId: frame.id, expression });
    return json.result as { value: string; type: string; error?: string; objectId?: string };
  }

  addWatch(expression: string): void {
    const s = useDebug.getState();
    const e = expression.trim();
    if (!e || s.watches.includes(e)) return;
    s.set({ watches: [...s.watches, e] });
    void this.refreshWatches();
  }

  removeWatch(expression: string): void {
    const s = useDebug.getState();
    const { [expression]: _gone, ...rest } = s.watchResults;
    s.set({ watches: s.watches.filter((w) => w !== expression), watchResults: rest });
  }

  private async refreshWatches(): Promise<void> {
    const s = useDebug.getState();
    if (s.state !== "paused") return;
    const results: Record<string, { value: string; type: string; error?: string; objectId?: string }> = {};
    for (const w of s.watches) {
      try {
        results[w] = await this.evaluate(w);
      } catch (e) {
        results[w] = { value: "", type: "error", error: e instanceof Error ? e.message : String(e) };
      }
    }
    useDebug.getState().set({ watchResults: results });
  }
}
