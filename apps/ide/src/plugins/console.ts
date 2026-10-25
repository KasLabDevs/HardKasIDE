import { api, type JobSummary } from "@/api/client";
import { Plugin } from "@/engine/engine";
import { useIde } from "@/store/ide";

/**
 * Terminal service: the journal of what happened, plus the one place that runs
 * `hardkas` commands and streams their output.
 */

export interface RunResult {
  status: JobSummary["status"];
  exitCode: number | null;
  result: unknown;
  job: JobSummary;
}

export class ConsolePlugin extends Plugin {
  constructor() {
    super({
      name: "console",
      displayName: "Console",
      location: "none",
      methods: ["log", "info", "warn", "error", "logJson", "clear", "run", "runHardkas"],
      events: ["jobStarted", "jobFinished"]
    });
  }

  log(text: string): void {
    useIde.getState().log("log", text);
  }
  info(text: string): void {
    useIde.getState().log("info", text);
  }
  warn(text: string): void {
    useIde.getState().log("warn", text);
  }
  error(text: string): void {
    useIde.getState().log("error", text);
  }
  logJson(title: string, data: unknown): void {
    useIde.getState().log("json", title, data);
  }
  clear(): void {
    useIde.getState().clearJournal();
  }

  /** Runs `hardkas <args>` in the workspace, streaming stdout/stderr into the journal. */
  async runHardkas(args: string[], options?: { cwd?: string; quiet?: boolean }): Promise<RunResult> {
    return this.run(args, { ...options, command: "hardkas" });
  }

  async run(args: string[], options?: { cwd?: string; command?: string; quiet?: boolean }): Promise<RunResult> {
    const state = useIde.getState();
    const label = `${options?.command ?? "hardkas"} ${args.join(" ")}`;
    const quiet = Boolean(options?.quiet); // background polling: no echo, no result block
    if (!quiet) state.log("command", label);
    state.setStatus(`Running: ${label}`);
    const job = await api.jobs.run(args, { cwd: options?.cwd, command: options?.command });
    this.emit("jobStarted", job);
    let stdoutBuffer = "";
    const done = await api.jobs.follow(job.id, (type, data) => {
      if (type === "stdout") {
        // --json output is one document; keep it for the structured block, don't spam lines.
        stdoutBuffer += data;
        if (!args.includes("--json")) state.log("log", data.trimEnd());
      } else if (type === "stderr") {
        if (!options?.quiet) state.log(data.toLowerCase().includes("error") ? "error" : "log", data.trimEnd());
      } else {
        state.log("error", data);
      }
    });
    const result: RunResult = { ...done, job: { ...job, status: done.status, exitCode: done.exitCode, result: done.result } };
    if (!quiet) {
      if (done.result !== null && done.result !== undefined) {
        state.log("json", `${label} → ${done.status}`, done.result);
      } else if (args.includes("--json") && stdoutBuffer.trim()) {
        state.log("log", stdoutBuffer.trimEnd());
      }
    }
    if (done.status === "failed" && !quiet) {
      state.log("error", `exit code ${done.exitCode}`);
    }
    state.setStatus(done.status === "succeeded" ? `Done: ${label}` : `Failed: ${label}`);
    this.emit("jobFinished", result);
    return result;
  }
}
