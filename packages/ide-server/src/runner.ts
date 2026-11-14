import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ensureHardkasConfig, ensureWorkspaceBase, FRONTEND_STACKS, scaffoldFrontend, type FrontendStackId, type StarterContractSpec } from "./frontendScaffold.js";
import { getRoot, exists, isTrusted, requireTrusted, trustFolder, WorkspaceError } from "./workspace.js";

const IDE_REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

/**
 * Runs `hardkas <args>` as a background job and streams its output.
 *
 * The HardKas CLI prints pure JSON to stdout when `--json` is passed and human
 * text to stderr, so stdout is parsed as JSON at the end when possible.
 */

/** The CLI version the IDE was built and tested against; the npx fallback pins it. */
export const HARDKAS_CLI_VERSION = "0.13.0-rc.1";

export interface CliInfo {
  /** What `hardkas --version` printed, or null when it could not run. */
  version: string | null;
  /** The version this IDE was tested with. */
  pinned: string;
  /** Where the binary came from. */
  source: "project" | "env" | "repo" | "npx";
  command: string;
  error: string | null;
}

const cliInfoCache = new Map<string, Promise<CliInfo>>();

/**
 * Which hardkas the IDE actually runs for `cwd` (the open workspace, or the server's folder before one is
 * open) and its version. Cached per folder: resolving means spawning the CLI once.
 */
export function cliInfo(cwd: string, force = false): Promise<CliInfo> {
  const cached = cliInfoCache.get(cwd);
  if (cached && !force) return cached;
  const p = (async (): Promise<CliInfo> => {
    const resolved = await resolveHardkas(cwd);
    // `hardkas --version` loads the project's hardkas.config.ts, which is code: not in a folder the user has not trusted.
    if (getRoot() && isInsideDir(cwd, getRoot()!) && !(await isTrusted(cwd))) {
      return { version: null, pinned: HARDKAS_CLI_VERSION, source: resolved.source ?? "project", command: resolved.command, error: "not run: this folder is not trusted yet" };
    }
    const source: CliInfo["source"] =
      resolved.source ??
      (resolved.prefix.length > 0 ? "npx" : process.env.HARDKAS_BIN === resolved.command ? "env" : resolved.command.startsWith(cwd) ? "project" : "repo");
    return new Promise((resolve) => {
      let out = "";
      let err = "";
      const child = spawn(resolved.command, [...resolved.prefix, "--version"], { cwd, shell: resolved.shell, env: { ...process.env, NO_COLOR: "1" }, windowsHide: true });
      const timer = setTimeout(() => child.kill(), 60_000); // npx may download the package the first time
      child.stdout.on("data", (c: Buffer) => (out += c.toString("utf8")));
      child.stderr.on("data", (c: Buffer) => (err += c.toString("utf8")));
      child.on("error", (e) => {
        clearTimeout(timer);
        resolve({ version: null, pinned: HARDKAS_CLI_VERSION, source, command: resolved.command, error: e.message });
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        const version = /\d+\.\d+\.\d+[-\w.]*/.exec(out)?.[0] ?? null;
        resolve({ version, pinned: HARDKAS_CLI_VERSION, source, command: resolved.command, error: version ? null : err.trim().split("\n")[0] || `exit code ${code}` });
      });
    });
  })();
  cliInfoCache.set(cwd, p);
  return p;
}

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
  source?: CliInfo["source"];
}

function isInsideDir(child: string, parent: string): boolean {
  const norm = (p: string) => (process.platform === "win32" ? path.resolve(p).toLowerCase() : path.resolve(p));
  const rel = path.relative(norm(parent), norm(child));
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

/**
 * Which `hardkas` runs, in this order:
 *   1. HARDKAS_BIN, when set;
 *   2. the project's own CLI (`node_modules/.bin/hardkas`), whatever its version: the status bar warns when it is
 *      not the version the IDE was tested with;
 *   3. `npx @hardkas/cli@<pinned>`.
 * HARDKAS_IDE_CLI_FROM_REPO=1 (development of HardKAS itself) puts a sibling HardKas-repo build, then the IDE repo's
 * demo-workspace CLI, before step 2. It is off by default so the IDE runs the CLI its users get.
 */
async function resolveHardkas(cwd: string): Promise<Resolved> {
  const isWin = process.platform === "win32";
  if (process.env.HARDKAS_BIN) {
    const bin = process.env.HARDKAS_BIN;
    if (/\.(?:mjs|cjs|js)$/i.test(bin)) {
      return { command: process.execPath, prefix: [bin], shell: false, source: "env" };
    }
    return { command: bin, prefix: [], shell: isWin, source: "env" };
  }
  if (process.env.HARDKAS_IDE_CLI_FROM_REPO === "1") {
    const siblingCli = path.resolve(IDE_REPO_ROOT, "..", "HardKas-repo", "packages", "cli", "dist", "index.js");
    if (await exists(siblingCli)) return { command: process.execPath, prefix: [siblingCli], shell: false, source: "repo" };
    const repoFallback = path.join(IDE_REPO_ROOT, "examples", "demo-workspace", "node_modules", ".bin", isWin ? "hardkas.cmd" : "hardkas");
    if (await exists(repoFallback)) return { command: repoFallback, prefix: [], shell: isWin, source: "repo" };
  }
  const local = path.join(cwd, "node_modules", ".bin", isWin ? "hardkas.cmd" : "hardkas");
  if (await exists(local)) return { command: local, prefix: [], shell: isWin, source: "project" };
  return { command: isWin ? "npx.cmd" : "npx", prefix: ["-y", `@hardkas/cli@${HARDKAS_CLI_VERSION}`], shell: isWin, source: "npx" };
}

const ALLOWED_COMMANDS = new Set(["hardkas", "npx", "npm"]);

/**
 * npm subcommands the IDE runs. `npm exec`/`npx` (except vitest), `explore`, `config` and `publish` are not among
 * them: they run or change things the IDE never needs. Project scripts (`npm run`, `npm test`) only run in a folder
 * the user trusts, like everything else of the project.
 */
const NPM_SUBCOMMANDS = new Set(["install", "i", "ci", "uninstall", "test", "t", "run", "run-script", "ls", "list", "outdated", "audit", "view", "info"]);
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
  if (!cwd) throw new WorkspaceError(409, "NO_WORKSPACE", "No workspace is open and no cwd was given");
  if (!(await exists(cwd))) throw new WorkspaceError(400, "BAD_CWD", `cwd does not exist: ${cwd}`);

  const requestedCmd = options.command ?? "hardkas";
  if (!ALLOWED_COMMANDS.has(requestedCmd)) {
    throw new WorkspaceError(400, "COMMAND_NOT_ALLOWED", `Disallowed command: ${requestedCmd}`);
  }
  if (requestedCmd === "npx" && options.args[0] !== "vitest") {
    throw new WorkspaceError(400, "COMMAND_NOT_ALLOWED", "npx is only permitted for running vitest");
  }
  if (requestedCmd === "npm" && !NPM_SUBCOMMANDS.has(String(options.args[0] ?? ""))) {
    throw new WorkspaceError(400, "COMMAND_NOT_ALLOWED", `npm ${String(options.args[0] ?? "")} is not one of the npm commands the IDE runs`);
  }
  // Every command here runs project code (hardkas.config.ts, npm scripts, tests).
  await requireTrusted(cwd);

  let command: string;
  let args: string[];
  let shell = false;
  if (requestedCmd === "hardkas") {
    if (options.args[0] === "node" || options.args[0] === "localnet") {
      await ensureHardkasConfig(cwd).catch(() => {});
    }
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
      throw new WorkspaceError(400, "BAD_ARGUMENT", "Invalid control characters in job arguments");
    }
    if (shell && WIN_SHELL_UNSAFE.test(arg)) {
      throw new WorkspaceError(400, "BAD_ARGUMENT", `Unsafe shell character in argument: ${arg}`);
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

export function waitForJob(job: Job, timeoutMs = 120_000): Promise<Job> {
  if (job.status !== "running") return Promise.resolve(job);
  return new Promise((resolve) => {
    let done = false;
    const timer = setTimeout(() => {
      if (!done) {
        done = true;
        unsub();
        resolve(getJob(job.id) ?? job);
      }
    }, timeoutMs);
    const unsub = subscribe(
      job.id,
      () => {},
      () => {
        if (!done) {
          done = true;
          clearTimeout(timer);
          unsub();
          resolve(getJob(job.id) ?? job);
        }
      }
    );
  });
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
  frontend?: FrontendStackId;
  starterContract?: StarterContractSpec;
}

function runSubprocessToJob(
  command: string,
  args: string[],
  cwd: string,
  shell: boolean,
  push: (type: JobEvent["type"], data: string) => void
): Promise<number> {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(command, args, {
        cwd,
        shell,
        env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1", HARDKAS_ROOT: cwd },
        windowsHide: true
      });
    } catch (error) {
      push("error", String(error));
      resolve(1);
      return;
    }
    child.stdout.on("data", (chunk: Buffer) => push("stdout", chunk.toString("utf8")));
    child.stderr.on("data", (chunk: Buffer) => push("stderr", chunk.toString("utf8")));
    child.on("error", (error) => {
      push("error", error.message);
      resolve(1);
    });
    child.on("close", (code) => resolve(code ?? 1));
  });
}

/**
 * Creates a project folder through the HardKas CLI, scaffolds the optional frontend in `dapp/`,
 * and installs workspace + frontend dependencies while streaming progress over the job SSE channel.
 */
export async function createProject(options: CreateProjectOptions): Promise<{ job: Job; dest: string }> {
  const template = PROJECT_TEMPLATES.find((t) => t.id === options.template);
  if (!template) throw new WorkspaceError(400, "BAD_PROJECT", `Unknown template: ${options.template}`);
  if (!/^[A-Za-z0-9._-]+$/.test(options.name)) throw new WorkspaceError(400, "BAD_PROJECT", "Project name may only contain letters, digits, dot, dash and underscore");
  const frontendId: FrontendStackId =
    options.frontend && FRONTEND_STACKS.some((f) => f.id === options.frontend) ? options.frontend : "none";
  const shouldInstall = options.install !== false;
  const parent = path.resolve(options.parentDir);
  // The wizard proposes ~/hardkas-projects/<name>: create that default folder on first use. Any other parent
  // must exist, so a typo does not silently create folders elsewhere.
  if (!(await exists(parent))) {
    if (path.resolve(parent) === path.join(os.homedir(), "hardkas-projects")) await fs.mkdir(parent, { recursive: true });
    else throw new WorkspaceError(400, "NO_PARENT_FOLDER", `Parent folder does not exist: ${parent}`);
  }
  const dest = path.join(parent, options.name);
  if (await exists(dest)) throw new WorkspaceError(409, "ALREADY_EXISTS", `Destination already exists: ${dest}`);

  const cliArgs = template.command === "init" ? ["init", "--json"] : ["create", template.id, dest, "--json"];
  const id = `job_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const job: Job = {
    id,
    command: "hardkas",
    args: cliArgs,
    cwd: parent,
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
    if (type === "stdout") job.stdout += data;
    else if (type === "stderr") job.stderr += data;
    const event: JobEvent = { type, data, at: new Date().toISOString() };
    job.events.push(event);
    emitter.emit("event", event);
  };

  void (async () => {
    try {
      const isWin = process.platform === "win32";
      const npmCmd = isWin ? "npm.cmd" : "npm";

      // Step 1: Scaffold HardKas workspace
      push("stdout", `[step 1/4] Scaffolding HardKas project (${template.label})...\n`);
      if (template.command === "init") {
        await fs.mkdir(dest, { recursive: true });
      }
      const resolved = await resolveHardkas(template.command === "init" ? dest : parent);
      const step1Code = await runSubprocessToJob(
        resolved.command,
        [...resolved.prefix, ...cliArgs],
        template.command === "init" ? dest : parent,
        resolved.shell,
        push
      );
      if (step1Code !== 0) {
        finish(job, emitter, step1Code, `HardKas scaffold exited with code ${step1Code}`);
        return;
      }
      // The IDE made this folder from a HardKas template: it is trusted, so its CLI, scripts and tests may run.
      await trustFolder(dest);

      // Step 2: Ensure starter contract + package.json + optional frontend stack
      push("stdout", `\n[step 2/4] Configuring workspace & frontend (${frontendId})...\n`);
      await ensureWorkspaceBase(dest, options.name, frontendId, (msg) => push("stdout", `  • ${msg}\n`), options.starterContract);
      const fe = await scaffoldFrontend(dest, options.name, frontendId, (msg) => push("stdout", `  • ${msg}\n`));

      // Step 3: Install root HardKas dependencies
      if (shouldInstall) {
        push("stdout", `\n[step 3/4] Installing HardKas & TypeScript dependencies in ${dest}...\n`);
        const rootInstallCode = await runSubprocessToJob(
          npmCmd,
          ["install", "--no-audit", "--no-fund", "--loglevel=info"],
          dest,
          isWin,
          push
        );
        if (rootInstallCode !== 0) {
          finish(job, emitter, rootInstallCode, `npm install failed in root workspace (exit ${rootInstallCode})`);
          return;
        }
        // The SilverScript compiler is a separate download; without it the first Compile fails. Best effort: a
        // project without network still opens, and the compile panel offers the same install.
        push("stdout", `\nInstalling the SilverScript compiler (hardkas toolchain install silverc)...\n`);
        const cli = await resolveHardkas(dest);
        const silvercCode = await runSubprocessToJob(cli.command, [...cli.prefix, "toolchain", "install", "silverc", "--json"], dest, cli.shell, push);
        if (silvercCode !== 0) push("stderr", `  ! silverc was not installed (exit ${silvercCode}); install it later from the compiler panel.\n`);
      } else {
        push("stdout", `\n[step 3/4] Skipping root npm install (unchecked).\n`);
      }

      // Step 4: Install frontend dependencies in dapp/ if applicable
      if (shouldInstall && fe.needsInstall && fe.dappDir) {
        push("stdout", `\n[step 4/4] Installing frontend (${frontendId}) dependencies in dapp/...\n`);
        const feInstallCode = await runSubprocessToJob(
          npmCmd,
          ["install", "--no-audit", "--no-fund", "--loglevel=info"],
          fe.dappDir,
          isWin,
          push
        );
        if (feInstallCode !== 0) {
          finish(job, emitter, feInstallCode, `npm install failed in dapp/ (exit ${feInstallCode})`);
          return;
        }
      } else {
        push("stdout", `\n[step 4/4] Frontend ready.\n`);
      }

      push("stdout", `\n✓ Project ${options.name} is ready!\n`);
      finish(job, emitter, 0, null);
    } catch (error) {
      finish(job, emitter, 1, error instanceof Error ? error.message : String(error));
    }
  })();

  return { job, dest };
}

export interface SilverCheckOptions {
  cwd?: string;
  filePath: string;
  content?: string;
  constructorArgs?: string;
}

export interface SilverCheckResult {
  ok: boolean;
  code?: string;
  message: string;
  contracts?: unknown[];
  raw?: unknown;
}

function stripSilComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, "");
}

function dummyValueForSilType(silType: string): { kind: string; value: unknown } {
  const t = silType.trim().toLowerCase();
  if (t === "int") return { kind: "int", value: 1 };
  if (t === "bool") return { kind: "bool", value: true };
  if (t === "byte") return { kind: "byte", value: 1 };
  if (t === "string") return { kind: "text", value: "test" };
  if (t === "pubkey" || t === "bytes32") {
    return { kind: "bytes", value: Array.from({ length: 32 }, (_, i) => (i === 0 ? 2 : 17)) };
  }
  const fixedBytes = /^bytes(\d+)$/.exec(t);
  if (fixedBytes) {
    const len = Math.max(1, Math.min(64, Number(fixedBytes[1]) || 32));
    return { kind: "bytes", value: Array.from({ length: len }, () => 17) };
  }
  if (t === "bytes") return { kind: "bytes", value: Array.from({ length: 32 }, () => 17) };
  return { kind: "int", value: 1 };
}

function synthesizeDummyConstructorArgs(source: string): string | null {
  const clean = stripSilComments(source);
  const match = /\bcontract\s+[A-Za-z_]\w*\s*\(([^)]*)\)\s*\{/.exec(clean);
  if (!match) return null;
  const rawParams = match[1]
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  if (rawParams.length === 0) return null;
  const values = rawParams.map((param) => {
    const parts = param.split(/\s+/);
    parts.pop(); // identifier name
    return dummyValueForSilType(parts.join(" ") || "int");
  });
  return JSON.stringify(values);
}

/**
 * Runs `hardkas silver compile --out <tmp> --json` against an in-memory or workspace `.sil` file
 * without writing any artifact into `.hardkas/artifacts/silver/`.
 */
export async function checkSilverSource(options: SilverCheckOptions): Promise<SilverCheckResult> {
  const cwd = options.cwd ?? getRoot();
  if (!cwd) throw new WorkspaceError(409, "NO_WORKSPACE", "No workspace is open");
  await requireTrusted(cwd);

  const resolvedTarget = path.resolve(cwd, options.filePath);
  const rel = path.relative(cwd, resolvedTarget);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new WorkspaceError(400, "OUTSIDE_WORKSPACE", `Path escapes workspace: ${options.filePath}`);
  }

  const sourceText = options.content !== undefined ? options.content : await fs.readFile(resolvedTarget, "utf8");
  const resolved = await resolveHardkas(cwd);
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "hardkas-silver-check-"));

  try {
    const tmpSil = path.join(tmpDir, path.basename(resolvedTarget) || "Contract.sil");
    const tmpOut = path.join(tmpDir, "compile.json");
    await fs.writeFile(tmpSil, sourceText, "utf8");

    let argsText = options.constructorArgs?.trim() || "";
    if (!argsText) {
      const siblingArgs = `${resolvedTarget.replace(/\.sil$/i, "")}.constructor-args.json`;
      try {
        argsText = (await fs.readFile(siblingArgs, "utf8")).trim();
      } catch {
        // No sibling constructor-args.json; synthesize dummy typed values so parameterized contracts compile.
      }
    }
    if (!argsText) {
      argsText = synthesizeDummyConstructorArgs(sourceText) ?? "";
    }

    const cliArgs = [...resolved.prefix, "silver", "compile", tmpSil, "--out", tmpOut];
    if (argsText) {
      const tmpArgs = path.join(tmpDir, "args.json");
      await fs.writeFile(tmpArgs, argsText, "utf8");
      cliArgs.push("--args", tmpArgs);
    }
    cliArgs.push("--json");

    return await new Promise<SilverCheckResult>((resolve) => {
      let stdout = "";
      let stderr = "";
      let settled = false;
      const child = spawn(resolved.command, cliArgs, {
        cwd,
        shell: resolved.shell,
        env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1", HARDKAS_ROOT: cwd },
        windowsHide: true
      });
      const finishCheck = (res: SilverCheckResult) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(res);
      };
      const timer = setTimeout(() => {
        child.kill();
        finishCheck({ ok: false, code: "CHECK_TIMEOUT", message: "silverc compile check timed out" });
      }, 15_000);

      child.stdout.on("data", (chunk: Buffer) => {
        stdout += chunk.toString("utf8");
      });
      child.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString("utf8");
      });
      child.on("error", (err) => {
        finishCheck({ ok: false, code: "SPAWN_ERROR", message: err.message });
      });
      child.on("close", (code) => {
        const parsed = parseJsonLoose(stdout) as Record<string, unknown> | null;
        if (code === 0 && parsed && parsed.ok !== false) {
          finishCheck({
            ok: true,
            message: "Compiled cleanly with silverc",
            contracts: Array.isArray(parsed.contracts) ? parsed.contracts : undefined,
            raw: parsed
          });
          return;
        }
        const msg =
          (parsed && typeof parsed.message === "string" && parsed.message) ||
          stderr.trim() ||
          stdout.trim() ||
          `silverc failed with exit ${code ?? 1}`;
        finishCheck({
          ok: false,
          code: parsed && typeof parsed.code === "string" ? parsed.code : "SILVERC_COMPILE_FAILED",
          message: msg,
          raw: parsed ?? (stderr.trim() || stdout.trim())
        });
      });
    });
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}
