import { spawn, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { existsSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { GREATEST_LOWER_BOUND, LEAST_UPPER_BOUND, TraceMap, generatedPositionFor, originalPositionFor } from "@jridgewell/trace-mapping";
import { getRoot } from "./workspace.js";

/**
 * Test debugger: runs the project's vitest with the Node inspector open (paused before the first line), attaches over the
 * Chrome DevTools Protocol, and turns what V8 says into project terms: breakpoints and stack frames are expressed in the
 * user's original source files (the transformed code vitest runs is mapped back through its inline source maps).
 *
 *   start      spawn vitest --inspect-brk, attach, apply breakpoints as each script is loaded
 *   events     "status" | "output" | "paused" | "resumed" | "breakpoints" | "exit", streamed to the IDE over SSE
 *   commands   setBreakpoints, resume, stepOver, stepInto, stepOut, pause, evaluate, properties, setPauseOnExceptions, stop
 */

export type DebugState = "idle" | "starting" | "running" | "paused" | "finished" | "error";

export interface DebugFrame {
  id: string;
  name: string;
  /** Project-relative path with forward slashes, or null for code outside the project (node_modules, node internals). */
  file: string | null;
  /** Where the frame is when `file` is null: the script URL. */
  url: string;
  line: number; // 1-based
  column: number; // 1-based
  scopes: Array<{ type: string; name?: string; objectId?: string }>;
}

export type DebugEvent =
  | { type: "status"; state: DebugState; message?: string }
  | { type: "output"; stream: "stdout" | "stderr" | "debug"; text: string }
  | { type: "paused"; reason: string; frames: DebugFrame[]; detail?: string }
  | { type: "resumed" }
  | { type: "breakpoints"; file: string; breakpoints: Array<{ line: number; verified: boolean; actual?: number }> }
  | { type: "exit"; code: number | null };

export interface DebugVariable {
  name: string;
  value: string;
  type: string;
  /** Present when the value can be expanded. */
  objectId?: string;
}

interface ScriptInfo {
  scriptId: string;
  url: string;
  map: TraceMap | null;
  /** project-relative file → the name under which the source map lists it */
  userSources: Map<string, string>;
}

const norm = (p: string) => p.replace(/\\/g, "/");
const key = (p: string) => (process.platform === "win32" ? norm(p).toLowerCase() : norm(p));

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const port = (srv.address() as net.AddressInfo).port;
      srv.close(() => resolve(port));
    });
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function describe(o: { type?: string; subtype?: string; value?: unknown; description?: string; unserializableValue?: string; className?: string; preview?: { properties?: Array<{ name: string; value?: string; type: string }>; overflow?: boolean } } | undefined): string {
  if (!o) return "undefined";
  if (o.type === "string") return JSON.stringify(o.value);
  if (o.unserializableValue) return o.unserializableValue;
  if (o.type === "bigint") return o.description ?? String(o.value);
  if (o.subtype === "null") return "null";
  if (o.type === "undefined") return "undefined";
  if ("value" in o && o.value !== undefined && o.type !== "object") return String(o.value);
  const base = o.description ?? o.className ?? o.type ?? "?";
  const props = o.preview?.properties;
  if (props && props.length > 0 && (o.subtype === undefined || o.subtype === "array" || o.subtype === "map")) {
    const shown = props.slice(0, 4).map((p) => `${o.subtype === "array" ? "" : `${p.name}: `}${p.type === "string" ? JSON.stringify(p.value) : (p.value ?? p.type)}`);
    return `${base} { ${shown.join(", ")}${o.preview?.overflow || props.length > 4 ? ", …" : ""} }`;
  }
  return base;
}

export class DebugSession extends EventEmitter {
  state: DebugState = "idle";
  private lastMessage: string | undefined;
  private child: ChildProcess | null = null;
  private ws: WebSocket | null = null;
  private seq = 0;
  private pending = new Map<number, (m: { result?: any; error?: { message: string } }) => void>();
  private scripts = new Map<string, ScriptInfo>();
  /** project-relative file → lines (1-based) the user wants a breakpoint on */
  private wanted = new Map<string, number[]>();
  private placed = new Map<string, string[]>(); // file → V8 breakpoint ids
  private ready = false;
  private pauseOnExceptions: "none" | "uncaught" | "all" = "none";
  private lastPaused: DebugEvent | null = null;
  private outputLog: Array<DebugEvent & { type: "output" }> = [];
  private stopping = false;
  private root = "";

  /** What a client that connects mid-session needs to catch up. */
  snapshot(): DebugEvent[] {
    const events: DebugEvent[] = [{ type: "status", state: this.state, message: this.lastMessage }];
    events.push(...this.outputLog);
    if (this.state === "paused" && this.lastPaused) events.push(this.lastPaused);
    return events;
  }

  private emitEvent(e: DebugEvent) {
    if (e.type === "output") {
      this.outputLog.push(e);
      if (this.outputLog.length > 400) this.outputLog.shift();
    }
    this.emit("event", e);
  }

  private setState(state: DebugState, message?: string) {
    this.state = state;
    this.lastMessage = message;
    this.emitEvent({ type: "status", state, message });
  }

  private log(text: string) {
    this.emitEvent({ type: "output", stream: "debug", text });
  }

  async start(options: { file?: string; testName?: string; breakpoints?: Record<string, number[]>; pauseOnExceptions?: "none" | "uncaught" | "all" }): Promise<void> {
    if (this.state === "starting" || this.state === "running" || this.state === "paused") throw new Error("A debug session is already running. Stop it first.");
    const root = getRoot();
    if (!root) throw new Error("No workspace is open");
    this.root = root;
    const entry = path.join(root, "node_modules", "vitest", "vitest.mjs");
    if (!existsSync(entry)) throw new Error("vitest is not installed in this project (run npm install in the project folder).");

    this.scripts.clear();
    this.placed.clear();
    this.wanted = new Map(Object.entries(options.breakpoints ?? {}).map(([f, ls]) => [norm(f), [...ls]]));
    this.outputLog = [];
    this.ready = false;
    this.stopping = false;
    this.lastPaused = null;
    this.pauseOnExceptions = options.pauseOnExceptions ?? "none";
    this.setState("starting", "Starting vitest with the inspector…");

    const port = await freePort();
    const args = [entry, "run", ...(options.file ? [options.file] : []), `--inspect-brk=127.0.0.1:${port}`, "--pool=forks", "--poolOptions.forks.singleFork", "--no-file-parallelism", "--reporter=verbose", "--testTimeout=0", "--hookTimeout=0"];
    // (a test paused at a breakpoint would otherwise time out while you look at it, so the limits are off while debugging)
    if (options.testName) args.push("-t", options.testName);
    this.log(`node vitest ${args.slice(1).join(" ")}`);
    const child = spawn(process.execPath, args, { cwd: root, env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1", HARDKAS_ROOT: root }, windowsHide: true });
    this.child = child;
    child.stdout.on("data", (b: Buffer) => this.emitEvent({ type: "output", stream: "stdout", text: b.toString("utf8") }));
    child.stderr.on("data", (b: Buffer) => this.emitEvent({ type: "output", stream: "stderr", text: b.toString("utf8") }));
    child.on("error", (e) => this.finish("error", e.message));
    child.on("close", (code) => {
      this.closeSocket();
      this.emitEvent({ type: "exit", code });
      if (this.state !== "error") this.setState("finished", this.stopping ? "Stopped" : `vitest exited with code ${code}`);
      this.child = null;
    });

    void this.attach(port).catch((e) => this.finish("error", e instanceof Error ? e.message : String(e)));
  }

  private finish(state: "error" | "finished", message: string) {
    this.setState(state, message);
    this.kill();
  }

  private async attach(port: number): Promise<void> {
    // vitest needs a while to collect and fork its worker, which is the one that opens the inspector.
    let target: { webSocketDebuggerUrl: string } | undefined;
    for (let i = 0; i < 400 && !target; i++) {
      if (!this.child) return;
      try {
        const list = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()) as Array<{ webSocketDebuggerUrl: string }>;
        target = list[0];
      } catch {
        await sleep(250);
      }
    }
    if (!target) throw new Error("The test worker never opened its inspector (vitest may have failed to start: see the output).");

    const ws = new WebSocket(target.webSocketDebuggerUrl);
    this.ws = ws;
    ws.onmessage = (m) => this.onMessage(JSON.parse(String(m.data)));
    ws.onclose = () => {
      this.ws = null;
    };
    await new Promise<void>((resolve, reject) => {
      ws.onopen = () => resolve();
      ws.onerror = () => reject(new Error("Could not attach to the test worker's inspector"));
    });

    // The first pause (--inspect-brk) arrives as soon as the debugger is enabled; it is handled in onPaused via `ready`.
    await this.send("Debugger.enable");
    await this.send("Runtime.enable");
    await this.send("Debugger.setPauseOnExceptions", { state: this.pauseOnExceptions });
    // Skip library code when stepping.
    await this.send("Debugger.setBlackboxPatterns", { patterns: ["node_modules", "^node:", "^file:///.*/node_modules/"] }).catch(() => undefined);
    // Pause before each script runs, so a breakpoint on its top-level code is placed before that code executes.
    await this.send("Debugger.setInstrumentationBreakpoint", { instrumentation: "beforeScriptExecution" }).catch(() => undefined);
    await this.send("Runtime.runIfWaitingForDebugger");
  }

  // ------------------------------------------------------------------ protocol plumbing

  private send(method: string, params: Record<string, unknown> = {}): Promise<any> {
    return new Promise((resolve, reject) => {
      const ws = this.ws;
      if (!ws || ws.readyState !== WebSocket.OPEN) return reject(new Error("The debugger is not attached"));
      const id = ++this.seq;
      this.pending.set(id, (m) => (m.error ? reject(new Error(m.error.message)) : resolve(m.result ?? {})));
      ws.send(JSON.stringify({ id, method, params }));
    });
  }

  private onMessage(msg: { id?: number; method?: string; params?: any; result?: any; error?: { message: string } }) {
    if (msg.id !== undefined) {
      const done = this.pending.get(msg.id);
      this.pending.delete(msg.id);
      done?.(msg);
      return;
    }
    if (msg.method === "Debugger.scriptParsed") this.onScript(msg.params);
    else if (msg.method === "Debugger.paused") void this.onPaused(msg.params).catch((e) => this.log(`debugger error: ${e instanceof Error ? e.message : e}`));
    else if (msg.method === "Debugger.resumed" && this.state === "paused") {
      this.setState("running");
      this.emitEvent({ type: "resumed" });
    }
  }

  private closeSocket() {
    try {
      this.ws?.close();
    } catch {
      // ignore
    }
    this.ws = null;
    for (const done of this.pending.values()) done({ error: { message: "The debugger was closed" } });
    this.pending.clear();
  }

  private kill() {
    const child = this.child;
    if (!child || child.killed) return;
    if (process.platform === "win32" && child.pid) {
      spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
    } else {
      child.kill("SIGKILL");
    }
  }

  async stop(): Promise<void> {
    this.stopping = true;
    this.kill();
    this.closeSocket();
    if (this.state === "starting" || this.state === "running" || this.state === "paused") this.setState("finished", "Stopped");
  }

  // ------------------------------------------------------------------ scripts and source maps

  private onScript(p: { scriptId: string; url: string; sourceMapURL?: string }) {
    const info: ScriptInfo = { scriptId: p.scriptId, url: p.url, map: null, userSources: new Map() };
    this.scripts.set(p.scriptId, info);
    if (!p.url.startsWith("file:")) return;
    let scriptPath: string;
    try {
      scriptPath = fileURLToPath(p.url);
    } catch {
      return;
    }
    if (key(scriptPath).includes("/node_modules/")) return;
    const rel = this.relative(scriptPath);
    if (!rel) return;

    const m = /^data:application\/json[^,]*;base64,(.+)$/.exec(p.sourceMapURL ?? "");
    if (m) {
      try {
        const raw = JSON.parse(Buffer.from(m[1], "base64").toString("utf8")) as { sources?: string[]; sourceRoot?: string };
        info.map = new TraceMap(raw as ConstructorParameters<typeof TraceMap>[0]);
        for (const source of raw.sources ?? []) {
          const abs = /^file:/.test(source) ? fileURLToPath(source) : path.isAbsolute(source) ? source : path.resolve(path.dirname(scriptPath), raw.sourceRoot ?? "", source);
          const r = this.relative(abs);
          if (r) info.userSources.set(r, source);
        }
      } catch {
        info.map = null;
      }
    }
    if (info.userSources.size === 0) info.userSources.set(rel, rel); // no map: the script is the source
  }

  /** Path relative to the project for files inside it (outside node_modules), else null. */
  private relative(abs: string): string | null {
    const rel = path.relative(this.root, abs);
    if (rel.startsWith("..") || path.isAbsolute(rel)) return null;
    const n = norm(rel);
    return n.split("/").includes("node_modules") ? null : n;
  }

  // ------------------------------------------------------------------ breakpoints

  async setBreakpoints(file: string, lines: number[]): Promise<void> {
    const f = norm(file);
    this.wanted.set(f, [...lines]);
    if (!this.ws) return; // applied when the scripts load
    for (const id of this.placed.get(f) ?? []) await this.send("Debugger.removeBreakpoint", { breakpointId: id }).catch(() => undefined);
    this.placed.set(f, []);
    const results: Array<{ line: number; verified: boolean; actual?: number }> = [];
    for (const script of this.scripts.values()) {
      if (!script.userSources.has(f)) continue;
      results.push(...(await this.placeInScript(script, f, lines)));
    }
    this.reportBreakpoints(f, lines, results);
  }

  private reportBreakpoints(file: string, lines: number[], results: Array<{ line: number; verified: boolean; actual?: number }>) {
    const merged = lines.map((line) => results.find((r) => r.line === line && r.verified) ?? { line, verified: false });
    this.emitEvent({ type: "breakpoints", file, breakpoints: merged });
  }

  private async placeInScript(script: ScriptInfo, file: string, lines: number[]): Promise<Array<{ line: number; verified: boolean; actual?: number }>> {
    const out: Array<{ line: number; verified: boolean; actual?: number }> = [];
    const source = script.userSources.get(file)!;
    for (const line of lines) {
      let location: { lineNumber: number; columnNumber: number } | null = null;
      if (script.map) {
        // A click on a blank or comment line lands on the next line that has code.
        for (let l = line; l <= line + 8 && !location; l++) {
          const g = generatedPositionFor(script.map, { source, line: l, column: 0, bias: LEAST_UPPER_BOUND });
          if (g.line !== null) location = { lineNumber: g.line - 1, columnNumber: g.column };
        }
      } else {
        location = { lineNumber: line - 1, columnNumber: 0 };
      }
      if (!location) {
        out.push({ line, verified: false });
        continue;
      }
      try {
        const r = await this.send("Debugger.setBreakpoint", { location: { scriptId: script.scriptId, ...location } });
        const list = this.placed.get(file) ?? [];
        list.push(r.breakpointId);
        this.placed.set(file, list);
        const actual = this.toOriginal(script, r.actualLocation?.lineNumber ?? location.lineNumber, r.actualLocation?.columnNumber ?? location.columnNumber);
        out.push({ line, verified: true, actual: actual?.line });
      } catch (e) {
        // Two breakpoints that resolve to the same place (one on a comment above the code, one on the code): V8 refuses
        // the second, but the line is fine.
        if (/already exists/i.test(e instanceof Error ? e.message : String(e))) {
          const actual = this.toOriginal(script, location.lineNumber, location.columnNumber);
          out.push({ line, verified: true, actual: actual?.line });
        } else out.push({ line, verified: false });
      }
    }
    return out;
  }

  /** Called while a script is paused before it runs (instrumentation) or right after it is parsed during a pause. */
  private async placeForScript(scriptId: string) {
    const script = this.scripts.get(scriptId);
    if (!script) return;
    for (const [file] of script.userSources) {
      const lines = this.wanted.get(file);
      if (!lines || lines.length === 0) continue;
      const results = await this.placeInScript(script, file, lines);
      this.reportBreakpoints(file, lines, results);
    }
  }

  private toOriginal(script: ScriptInfo, line0: number, column0: number): { file: string | null; line: number; column: number } | null {
    if (script.map) {
      const o = originalPositionFor(script.map, { line: line0 + 1, column: column0 });
      let o2 = o;
      if (o.line === null) o2 = originalPositionFor(script.map, { line: line0 + 1, column: column0, bias: GREATEST_LOWER_BOUND });
      if (o2.line !== null && o2.source) {
        const abs = /^file:/.test(o2.source) ? fileURLToPath(o2.source) : path.isAbsolute(o2.source) ? o2.source : path.resolve(path.dirname(fileURLToPath(script.url)), o2.source);
        return { file: this.relative(abs), line: o2.line, column: (o2.column ?? 0) + 1 };
      }
    }
    let file: string | null = null;
    try {
      file = script.url.startsWith("file:") ? this.relative(fileURLToPath(script.url)) : null;
    } catch {
      file = null;
    }
    return { file, line: line0 + 1, column: column0 + 1 };
  }

  // ------------------------------------------------------------------ pauses

  private async onPaused(p: { reason: string; callFrames: any[]; data?: { scriptId?: string; uncaught?: boolean; description?: string } }) {
    if (p.reason === "instrumentation") {
      const scriptId = p.callFrames[0]?.location?.scriptId ?? p.data?.scriptId;
      if (scriptId) await this.placeForScript(scriptId);
      await this.send("Debugger.resume").catch(() => undefined);
      return;
    }
    if (!this.ready && (p.reason === "exception" || p.reason === "promiseRejection")) {
      // Exceptions the runtime throws and catches while starting are not the initial pause and are not ours.
      await this.send("Debugger.resume").catch(() => undefined);
      return;
    }
    if (!this.ready) {
      // The pause --inspect-brk causes before the first line: the session is wired, let the tests run.
      this.ready = true;
      this.setState("running", "Running tests…");
      await this.send("Debugger.resume").catch(() => undefined);
      return;
    }
    const frames: DebugFrame[] = p.callFrames.map((f: any) => {
      const script = this.scripts.get(f.location.scriptId);
      const o = script ? this.toOriginal(script, f.location.lineNumber, f.location.columnNumber) : null;
      return {
        id: f.callFrameId,
        name: f.functionName || "(anonymous)",
        file: o?.file ?? null,
        url: script?.url ?? "",
        line: o?.line ?? f.location.lineNumber + 1,
        column: o?.column ?? f.location.columnNumber + 1,
        scopes: (f.scopeChain as any[]).filter((s) => s.type !== "global").map((s) => ({ type: s.type, name: s.name, objectId: s.object?.objectId }))
      };
    });
    // "Pause on exceptions" would stop on every exception the libraries throw and catch themselves: only stop when the
    // code that threw is in the project, or when nothing will catch it and the project is somewhere in the stack.
    if (p.reason === "exception" || p.reason === "promiseRejection") {
      const uncaught = (p.data as { uncaught?: boolean } | undefined)?.uncaught === true;
      const inProject = frames[0]?.file !== null && frames[0] !== undefined;
      if (!inProject && !(uncaught && frames.some((f) => f.file !== null))) {
        await this.send("Debugger.resume").catch(() => undefined);
        return;
      }
    }
    const detail = typeof (p.data as { description?: string } | undefined)?.description === "string" ? (p.data as { description: string }).description.split("\n")[0] : undefined;
    const event: DebugEvent = { type: "paused", reason: p.reason, frames, detail };
    this.lastPaused = event;
    this.setState("paused");
    this.emitEvent(event);
  }

  // ------------------------------------------------------------------ commands

  async resume() {
    await this.send("Debugger.resume");
  }
  async stepOver() {
    await this.send("Debugger.stepOver");
  }
  async stepInto() {
    await this.send("Debugger.stepInto");
  }
  async stepOut() {
    await this.send("Debugger.stepOut");
  }
  async pause() {
    await this.send("Debugger.pause");
  }

  async setPauseOnExceptions(state: "none" | "uncaught" | "all") {
    this.pauseOnExceptions = state;
    if (this.ws) await this.send("Debugger.setPauseOnExceptions", { state });
  }

  async properties(objectId: string): Promise<DebugVariable[]> {
    const r = await this.send("Runtime.getProperties", { objectId, ownProperties: true, generatePreview: true });
    const list = (r.result as any[]).filter((x) => x.name !== "__proto__");
    return list.map((x) => ({
      name: x.name,
      value: x.value ? describe(x.value) : x.get ? "(getter)" : "undefined",
      type: x.value?.subtype ?? x.value?.type ?? "accessor",
      objectId: x.value?.objectId
    }));
  }

  async evaluate(frameId: string, expression: string): Promise<{ value: string; type: string; objectId?: string; error?: string }> {
    const r = await this.send("Debugger.evaluateOnCallFrame", { callFrameId: frameId, expression, generatePreview: true, silent: true });
    if (r.exceptionDetails) {
      // "ReferenceError: x is not defined" without the stack that follows it.
      const text: string = r.exceptionDetails.exception?.description ?? r.exceptionDetails.text ?? "evaluation failed";
      return { value: "", type: "error", error: text.split("\n")[0] };
    }
    return { value: describe(r.result), type: r.result?.subtype ?? r.result?.type ?? "undefined", objectId: r.result?.objectId };
  }
}

export const debugSession = new DebugSession();
