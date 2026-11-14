import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { revealDevAccountKey } from "./devkeys.js";
import { readIdeSettings } from "./ideSettings.js";
import { PREPARE_SCRIPT } from "./silverDebugPrepare.js";
import { getRoot, requireTrusted, WorkspaceError } from "./workspace.js";

/**
 * SilverScript step debugger: one interactive session of the SilverScript runner (`cli-debugger` of
 * kaspanet/silverscript), which executes the contract on the Kaspa script engine (kaspa-txscript) line by line.
 *
 * Upstream publishes no cli-debugger binary: the runner is a local build (HARDKAS_SILVER_RUNNER, else
 * <HARDKAS_HOME>/toolchains/cli-debugger/1.0.0). HardKAS calls every such runner UNVERIFIED, so the IDE runs one only
 * after the user approved that exact build (its SHA-256, kept in ~/.hardkas-ide/settings.json); a changed binary
 * needs a new approval. Signatures are made by the project's own @hardkas/core, as `hardkas silver test` makes them,
 * with the simnet dev accounts only. What a session shows is the script engine on the runner's scenario transaction:
 * contract execution, not transaction validity and not a node's acceptance.
 */

const RUNNER_VERSION = "1.0.0";
const PROMPT = "(sdb)";
const COMMAND_TIMEOUT_MS = 15_000;
const PREPARE_TIMEOUT_MS = 90_000;

export class SilverDebugError extends WorkspaceError {}

export interface RunnerInfo {
  available: boolean;
  path: string | null;
  sha256: string | null;
  /** UNVERIFIED: no official binary exists to check it against. */
  trust: "UNVERIFIED";
  /** True when the user approved this exact build (same SHA-256). */
  approved: boolean;
  message: string;
}

export interface DebugVariable {
  section: string;
  name: string;
  type: string;
  value: string;
}

export interface SilverDebugView {
  state: "idle" | "paused" | "finished" | "failed" | "stopped";
  file: string | null;
  entry: string | null;
  line: number | null;
  variables: DebugVariable[];
  stack: string[];
  error: { message: string; line: number | null; column: number | null } | null;
  /** The runner's own text for the last command (eval results, breakpoint replies…). */
  output: string;
  runner: { path: string; sha256: string; trust: "UNVERIFIED" } | null;
}

function hardkasHome(): string {
  return process.env.HARDKAS_HOME?.trim() || path.join(os.homedir(), ".hardkas");
}

export function runnerPath(): string {
  const configured = process.env.HARDKAS_SILVER_RUNNER?.trim();
  if (configured) return path.resolve(configured);
  return path.join(hardkasHome(), "toolchains", "cli-debugger", RUNNER_VERSION, process.platform === "win32" ? "cli-debugger.exe" : "cli-debugger");
}

async function digest(file: string): Promise<string | null> {
  try {
    return createHash("sha256").update(await fs.readFile(file)).digest("hex");
  } catch {
    return null;
  }
}

export async function runnerInfo(): Promise<RunnerInfo> {
  const file = runnerPath();
  const sha256 = await digest(file);
  if (!sha256) {
    return {
      available: false,
      path: null,
      sha256: null,
      trust: "UNVERIFIED",
      approved: false,
      message: `No SilverScript runner found at ${file}. Upstream publishes no binary: build it from kaspanet/silverscript v${RUNNER_VERSION} (cargo build --release -p cli-debugger) and put it there, or set HARDKAS_SILVER_RUNNER to it.`
    };
  }
  const settings = await readIdeSettings();
  const approved = settings.approvedSilverRunnerSha256 === sha256;
  return {
    available: true,
    path: file,
    sha256,
    trust: "UNVERIFIED",
    approved,
    message: approved ? "Local build approved by you." : "Local build of cli-debugger: not an official binary. Approve this build to run it."
  };
}

// ------------------------------------------------------------------ output parsing

/** Reads one reply of the runner (the text printed before the next prompt). */
export function parseReply(text: string): Pick<SilverDebugView, "line" | "variables" | "stack" | "error"> & { done: boolean } {
  const lines = text.replace(/\r/g, "").split("\n");
  let line: number | null = null;
  const variables: DebugVariable[] = [];
  const stack: string[] = [];
  let section: string | null = null;
  let inStack = false;
  let errorMessage: string | null = null;
  let errorLine: number | null = null;
  let errorColumn: number | null = null;
  let done = false;
  for (const raw of lines) {
    const active = /^→\s*(\d+)\s*\|/.exec(raw);
    if (active) {
      line = Number(active[1]);
      continue;
    }
    const header = /^(Constructor Args|Call Arguments|Locals|Constants|Contract State):\s*$/.exec(raw.trim());
    if (header) {
      section = header[1];
      inStack = false;
      continue;
    }
    if (raw.trim() === "Stack:") {
      inStack = true;
      section = null;
      continue;
    }
    if (section) {
      const v = /^\s{2}([A-Za-z_][\w.]*)\s+\(([^)]*)\)\s+=\s+(.*)$/.exec(raw);
      if (v) {
        variables.push({ section, name: v[1], type: v[2], value: v[3].trim() });
        continue;
      }
      if (raw.trim() !== "") section = null;
    }
    if (inStack) {
      const s = /^\[(\d+)\]\s*(.*)$/.exec(raw.trim());
      if (s) {
        stack.push(s[2]);
        continue;
      }
      if (raw.trim() !== "") inStack = false;
    }
    const err = /^error:\s*(.+)$/.exec(raw.trim());
    if (err && !errorMessage) errorMessage = err[1];
    const at = /^-->\s*(\d+):(\d+)/.exec(raw.trim());
    if (at && errorLine === null) {
      errorLine = Number(at[1]);
      errorColumn = Number(at[2]);
    }
    if (/^Done\.?$/.test(raw.trim())) done = true;
  }
  return {
    line,
    variables,
    stack,
    error: errorMessage ? { message: errorMessage, line: errorLine, column: errorColumn } : null,
    done
  };
}

// ------------------------------------------------------------------ the session

class Session {
  view: SilverDebugView;
  private buffer = "";
  private waiter: { resolve: (text: string) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> } | null = null;
  private exited = false;

  constructor(
    private readonly proc: ChildProcessWithoutNullStreams,
    private readonly tmpDir: string,
    base: Pick<SilverDebugView, "file" | "entry" | "runner">
  ) {
    this.view = { state: "paused", line: null, variables: [], stack: [], error: null, output: "", ...base };
    const onData = (d: Buffer) => {
      this.buffer += d.toString("utf8");
      this.flush();
    };
    proc.stdout.on("data", onData);
    proc.stderr.on("data", onData);
    proc.on("exit", () => {
      this.exited = true;
      this.flush(true);
    });
    proc.on("error", (e) => this.waiter?.reject(e));
  }

  private flush(ended = false) {
    if (!this.waiter) return;
    const i = this.buffer.indexOf(PROMPT);
    if (i >= 0 || ended) {
      const text = i >= 0 ? this.buffer.slice(0, i) : this.buffer;
      this.buffer = i >= 0 ? this.buffer.slice(i + PROMPT.length) : "";
      const w = this.waiter;
      this.waiter = null;
      clearTimeout(w.timer);
      w.resolve(text);
    }
  }

  /** The text up to the next prompt (or to the runner's exit). */
  private next(): Promise<string> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiter = null;
        reject(new SilverDebugError(504, "RUNNER_TIMEOUT", "The SilverScript runner did not answer in time."));
      }, COMMAND_TIMEOUT_MS);
      this.waiter = { resolve, reject, timer };
      this.flush(this.exited);
    });
  }

  async send(command: string): Promise<string> {
    if (this.exited) throw new SilverDebugError(409, "SESSION_ENDED", "The debug session has ended. Start it again.");
    const reply = this.next();
    this.proc.stdin.write(`${command}\n`);
    return reply;
  }

  /** Applies a reply to the view. Movement replies replace the variables; others only set `output`. */
  apply(text: string, movement: boolean) {
    const r = parseReply(text);
    this.view.output = text.replace(/^\s+|\s+$/g, "");
    if (r.error) {
      this.view.error = r.error;
      this.view.state = "failed";
      if (r.error.line) this.view.line = r.error.line;
    }
    if (r.done) this.view.state = "finished";
    if (movement && r.line !== null && !r.error) this.view.line = r.line;
    if (r.variables.length > 0) this.view.variables = r.variables;
    if (r.stack.length > 0 || /Stack:/.test(text)) this.view.stack = r.stack;
    if (this.exited && this.view.state === "paused") this.view.state = "finished";
  }

  async readFirst() {
    const first = await this.next();
    this.apply(first, true);
  }

  async stop() {
    if (!this.exited) {
      try {
        this.proc.stdin.write("q\n");
      } catch {
        // already closed
      }
      setTimeout(() => {
        if (!this.exited) this.proc.kill();
      }, 1000).unref();
    }
    this.view.state = "stopped";
    await fs.rm(this.tmpDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

let session: Session | null = null;

export function currentView(): SilverDebugView {
  return session?.view ?? { state: "idle", file: null, entry: null, line: null, variables: [], stack: [], error: null, output: "", runner: null };
}

export interface StartRequest {
  file: string;
  entry: string;
  constructorArgs: unknown[];
  args: unknown[];
  breakpoints?: number[];
}

/** The project-local `node` script that compiles and signs (see silverDebugPrepare.ts). */
async function prepare(root: string, input: unknown): Promise<{ runnerTestFile: string; testName: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--input-type=module", "-e", PREPARE_SCRIPT], { cwd: root, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    let out = "";
    let err = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new SilverDebugError(504, "PREPARE_TIMEOUT", "Compiling and signing the debug scenario took too long."));
    }, PREPARE_TIMEOUT_MS);
    child.stdout.on("data", (d: Buffer) => (out += d.toString("utf8")));
    child.stderr.on("data", (d: Buffer) => (err += d.toString("utf8")));
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", () => {
      clearTimeout(timer);
      try {
        const r = JSON.parse(out) as { ok: boolean; code?: string; message?: string; runnerTestFile?: string; testName?: string };
        if (!r.ok || !r.runnerTestFile || !r.testName) return reject(new SilverDebugError(400, r.code ?? "PREPARE_FAILED", r.message ?? "the debug scenario could not be prepared"));
        resolve({ runnerTestFile: r.runnerTestFile, testName: r.testName });
      } catch {
        reject(new SilverDebugError(500, "PREPARE_FAILED", (err || out).trim().split("\n").slice(-3).join(" ") || "the prepare script printed nothing"));
      }
    });
    child.stdin.end(JSON.stringify(input));
  });
}

function sigAccounts(args: unknown[]): string[] {
  const names = new Set<string>();
  for (const a of args) {
    const v = a as { kind?: unknown; type?: unknown; account?: unknown } | null;
    if (v && (v.kind === "sig" || v.type === "sig") && typeof v.account === "string") names.add(v.account);
  }
  return [...names];
}

export async function startSession(req: StartRequest): Promise<SilverDebugView> {
  const root = getRoot();
  if (!root) throw new SilverDebugError(409, "NO_WORKSPACE", "No workspace is open");
  await requireTrusted(root);
  if (typeof req.file !== "string" || !req.file.endsWith(".sil")) throw new SilverDebugError(400, "BAD_REQUEST", "file must be a .sil file of the workspace");
  if (typeof req.entry !== "string" || !/^[A-Za-z_]\w*$/.test(req.entry)) throw new SilverDebugError(400, "BAD_REQUEST", "entry must be the name of an entry");
  const sourcePath = path.resolve(root, req.file);
  const rel = path.relative(root, sourcePath);
  if (rel.startsWith("..") || path.isAbsolute(rel)) throw new SilverDebugError(400, "OUTSIDE_WORKSPACE", "the file is outside the workspace");

  const info = await runnerInfo();
  if (!info.available || !info.path || !info.sha256) throw new SilverDebugError(409, "RUNNER_NOT_FOUND", info.message);
  if (!info.approved) throw new SilverDebugError(409, "RUNNER_NOT_APPROVED", info.message);

  if (session) await session.stop();
  session = null;

  const source = (await fs.readFile(sourcePath, "utf8")).replace(/^﻿/, "");
  // Signatures only with the simnet dev accounts (their fixed dev password), never testnet or other keys.
  const keys: Record<string, string> = {};
  for (const account of sigAccounts(req.args ?? [])) keys[account] = (await revealDevAccountKey(account, root)).privateKey;
  const prepared = await prepare(root, { source, constructorArgs: req.constructorArgs ?? [], entry: req.entry, args: req.args ?? [], keys });

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "hardkas-ide-sildbg-"));
  const sourceCopy = path.join(tmpDir, path.basename(req.file));
  const testFile = path.join(tmpDir, "debug.test.json");
  await fs.writeFile(sourceCopy, source, "utf8");
  await fs.writeFile(testFile, prepared.runnerTestFile, "utf8");

  // The approved bytes, checked again right before the start.
  if ((await digest(info.path)) !== info.sha256) {
    await fs.rm(tmpDir, { recursive: true, force: true });
    throw new SilverDebugError(409, "RUNNER_CHANGED", "The SilverScript runner changed since it was approved. Approve it again.");
  }
  const proc = spawn(info.path, [`--test-file=${testFile}`, `--test-name=${prepared.testName}`, sourceCopy], {
    cwd: tmpDir,
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"]
  });
  const s = new Session(proc, tmpDir, { file: req.file, entry: req.entry, runner: { path: info.path, sha256: info.sha256, trust: "UNVERIFIED" } });
  session = s;
  try {
    await s.readFirst();
    for (const line of req.breakpoints ?? []) {
      if (Number.isInteger(line) && line > 0) await s.send(`b ${line}`);
    }
    s.view.output = "";
  } catch (e) {
    await s.stop();
    session = null;
    throw e;
  }
  return s.view;
}

export type DebugCommand = "next" | "step" | "stepOpcode" | "finish" | "continue" | "break" | "eval" | "stack";

const COMMANDS: Record<Exclude<DebugCommand, "break" | "eval">, string> = {
  next: "n",
  step: "s",
  stepOpcode: "si",
  finish: "finish",
  continue: "c",
  stack: "stack"
};

export async function sendCommand(cmd: DebugCommand, arg?: string | number): Promise<SilverDebugView> {
  if (!session) throw new SilverDebugError(409, "NO_SESSION", "No SilverScript debug session is running.");
  const s = session;
  if (s.view.state === "finished" || s.view.state === "stopped") throw new SilverDebugError(409, "SESSION_ENDED", "The debug session has ended. Start it again.");
  if (cmd === "break") {
    const line = Number(arg);
    if (!Number.isInteger(line) || line <= 0) throw new SilverDebugError(400, "BAD_REQUEST", "break needs a line number");
    s.apply(await s.send(`b ${line}`), false);
    return s.view;
  }
  if (cmd === "eval") {
    const expr = String(arg ?? "").trim();
    // One line, no control characters: the expression is typed into the runner's prompt.
    if (!expr || /[\r\n\u0000-\u001f]/.test(expr) || expr.length > 500) throw new SilverDebugError(400, "BAD_REQUEST", "eval needs a one-line expression");
    s.apply(await s.send(`e ${expr}`), false);
    return s.view;
  }
  const raw = COMMANDS[cmd];
  if (!raw) throw new SilverDebugError(400, "BAD_REQUEST", `unknown command ${String(cmd)}`);
  const movement = cmd !== "stack";
  s.apply(await s.send(raw), movement);
  if (movement && s.view.state === "paused") s.apply(await s.send("stack"), false);
  return s.view;
}

export async function stopSession(): Promise<SilverDebugView> {
  if (session) await session.stop();
  const view = currentView();
  session = null;
  return { ...view, state: "stopped" };
}
