import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { promises as fs } from "node:fs";
import path from "node:path";
import { getRoot, exists } from "./workspace.js";

/**
 * Runs `hardkas <args>` as a background job and streams its output.
 *
 * The HardKas CLI prints pure JSON to stdout when `--json` is passed and human
 * text to stderr, so stdout is parsed as JSON at the end when possible.
 */

export const HARDKAS_CLI_VERSION = "0.12.0-rc.29";

export type JobStatus = "running" | "succeeded" | "failed";

export interface JobEvent {
  type: "stdout" | "stderr" | "exit" | "error";
  data: string;
  at: string;
}

export interface Job {
  id: string;
  command: string;
  args: string[];
  cwd: string;
  status: JobStatus;
  exitCode: number | null;
  startedAt: string;
  endedAt: string | null;
  events: JobEvent[];
  stdout: string;
  stderr: string;
  result: unknown;
}

const jobs = new Map<string, Job>();
const emitters = new Map<string, EventEmitter>();
const MAX_JOBS = 200;

interface Resolved {
  command: string;
  prefix: string[];
  shell: boolean;
}

/** Prefers the project's own hardkas binary, then a global one, then npx. */
async function resolveHardkas(cwd: string): Promise<Resolved> {
  const isWin = process.platform === "win32";
  const local = path.join(cwd, "node_modules", ".bin", isWin ? "hardkas.cmd" : "hardkas");
  if (await exists(local)) {
    return { command: local, prefix: [], shell: isWin };
  }
  if (process.env.HARDKAS_BIN) {
    return { command: process.env.HARDKAS_BIN, prefix: [], shell: isWin };
  }
  return { command: isWin ? "npx.cmd" : "npx", prefix: ["-y", `@hardkas/cli@${HARDKAS_CLI_VERSION}`], shell: isWin };
}

const ALLOWED_COMMANDS = new Set(["hardkas", "npx", "npm"]);
const WIN_SHELL_UNSAFE = /[\0\r\n&|<>^%!]/;

export interface RunOptions {
  /** Arguments after `hardkas`, e.g. ["silver", "compile", "contract.sil", "--json"]. */
  args: string[];
  /** Working directory; defaults to the open workspace. */
  cwd?: string;
  /** Run `hardkas` (default) or an allowlisted executable ("npx" | "npm"). */
  command?: "hardkas" | string;
}

export async function startJob(options: RunOptions): Promise<Job> {
  const cwd = options.cwd ?? getRoot();
  if (!cwd) throw new Error("No workspace is open and no cwd was given");
  if (!(await exists(cwd))) throw new Error(`cwd does not exist: ${cwd}`);

  const requestedCmd = options.command ?? "hardkas";
  if (!ALLOWED_COMMANDS.has(requestedCmd)) {
    throw new Error(`Disallowed command: ${requestedCmd}`);
  }
  if (requestedCmd === "npx" && options.args[0] !== "vitest") {
    throw new Error("npx is only permitted for running vitest");
  }

  let command: string;
  let args: string[];
  let shell = false;
  if (requestedCmd === "hardkas") {
    const resolved = await resolveHardkas(cwd);
    command = resolved.command;
    args = [...resolved.prefix, ...options.args];
    shell = resolved.shell;
  } else {
    const isWin = process.platform === "win32";
    command = isWin ? `${requestedCmd}.cmd` : requestedCmd;
    args = options.args;
    shell = isWin;
  }

  for (const arg of args) {
    if (typeof arg !== "string" || arg.includes("\0") || arg.includes("\r") || arg.includes("\n")) {
      throw new Error("Invalid control characters in job arguments");
    }
    if (shell && WIN_SHELL_UNSAFE.test(arg)) {
      throw new Error(`Unsafe shell character in argument: ${arg}`);
    }
  }

  const id = `job_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const job: Job = {
    id,
    command: options.command ?? "hardkas",
    args: options.args,
    cwd,
    status: "running",
    exitCode: null,
    startedAt: new Date().toISOString(),
    endedAt: null,
    events: [],
    stdout: "",
    stderr: "",
    result: null
  };
  const emitter = new EventEmitter();
  jobs.set(id, job);
  emitters.set(id, emitter);
  trimJobs();

  const push = (type: JobEvent["type"], data: string) => {
    const event: JobEvent = { type, data, at: new Date().toISOString() };
    job.events.push(event);
    emitter.emit("event", event);
  };

  let child;
  try {
    child = spawn(command, args, {
      cwd,
      shell,
      env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1", HARDKAS_ROOT: cwd },
      windowsHide: true
    });
  } catch (error) {
    finish(job, emitter, 1, String(error));
    return job;
  }

  child.stdout.on("data", (chunk: Buffer) => {
    const text = chunk.toString("utf8");
    job.stdout += text;
    push("stdout", text);
  });
  child.stderr.on("data", (chunk: Buffer) => {
    const text = chunk.toString("utf8");
    job.stderr += text;
    push("stderr", text);
  });
  child.on("error", (error) => {
    push("error", error.message);
    finish(job, emitter, 1, null);
  });
  child.on("close", (code) => {
    finish(job, emitter, code ?? 1, null);
  });

  return job;
}

function finish(job: Job, emitter: EventEmitter, code: number, errorText: string | null): void {
  if (job.status !== "running") return;
  job.exitCode = code;
  job.endedAt = new Date().toISOString();
  job.status = code === 0 ? "succeeded" : "failed";
  job.result = parseJsonLoose(job.stdout);
  if (errorText) {
    job.stderr += errorText;
    job.events.push({ type: "error", data: errorText, at: job.endedAt });
  }
  const exitEvent: JobEvent = { type: "exit", data: String(code), at: job.endedAt };
  job.events.push(exitEvent);
  emitter.emit("event", exitEvent);
  emitter.emit("end");
}

/** The CLI prints one JSON document on stdout in --json mode; tolerate noise around it. */
function parseJsonLoose(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(trimmed.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

function trimJobs(): void {
  if (jobs.size <= MAX_JOBS) return;
  const oldest = [...jobs.values()].sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  for (const job of oldest.slice(0, jobs.size - MAX_JOBS)) {
    if (job.status === "running") continue;
    jobs.delete(job.id);
    emitters.delete(job.id);
  }
}

export function getJob(id: string): Job | undefined {
  return jobs.get(id);
}

export function listJobs(): Job[] {
  return [...jobs.values()].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

export function subscribe(id: string, onEvent: (e: JobEvent) => void, onEnd: () => void): () => void {
  const emitter = emitters.get(id);
  if (!emitter) {
    onEnd();
    return () => {};
  }
  emitter.on("event", onEvent);
  emitter.once("end", onEnd);
  return () => {
    emitter.off("event", onEvent);
    emitter.off("end", onEnd);
  };
}

/** Project templates reachable through `hardkas create <template> <dest>`, plus `hardkas init`. */
export const PROJECT_TEMPLATES = [
  { id: "init", label: "Basic project (hardkas init)", description: "hardkas.config.ts, a payment test and the simulator target. The smallest HardKas project.", command: "init" },
  { id: "payment-app", label: "Payment app", description: "Plan, sign and simulate a Kaspa payment end to end.", command: "create" },
  { id: "payment-service", label: "Payment service", description: "A backend service that accepts and tracks payments.", command: "create" },
  { id: "merchant-checkout", label: "Merchant checkout", description: "Checkout flow with receipts and replay.", command: "create" },
  { id: "batch-payments", label: "Batch payments", description: "Many payments planned and signed as one workflow.", command: "create" },
  { id: "wallet-backend", label: "Wallet backend", description: "Account management and balances behind an API.", command: "create" },
  { id: "local-indexer", label: "Local indexer", description: "Index artifacts and events into a local store.", command: "create" },
  { id: "full-stack-demo", label: "Full-stack demo", description: "Backend plus a React dApp wired to the dev-server.", command: "create" }
] as const;

export interface CreateProjectOptions {
  template: string;
  name: string;
  parentDir: string;
  install?: boolean;
}

/** Creates a project folder through the HardKas CLI and returns the job plus the destination. */
export async function createProject(options: CreateProjectOptions): Promise<{ job: Job; dest: string }> {
  const template = PROJECT_TEMPLATES.find((t) => t.id === options.template);
  if (!template) throw new Error(`Unknown template: ${options.template}`);
  if (!/^[A-Za-z0-9._-]+$/.test(options.name)) throw new Error("Project name may only contain letters, digits, dot, dash and underscore");
  const parent = path.resolve(options.parentDir);
  if (!(await exists(parent))) throw new Error(`Parent folder does not exist: ${parent}`);
  const dest = path.join(parent, options.name);
  if (await exists(dest)) throw new Error(`Destination already exists: ${dest}`);

  let args: string[];
  if (template.command === "init") {
    await fs.mkdir(dest, { recursive: true });
    args = ["init", "--json"];
    const job = await startJob({ args, cwd: dest });
    return { job, dest };
  }
  args = ["create", template.id, dest, "--json"];
  if (options.install) args.push("--install");
  const job = await startJob({ args, cwd: parent });
  return { job, dest };
}
