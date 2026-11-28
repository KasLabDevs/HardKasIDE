import { execFile } from "node:child_process";
import path from "node:path";
import * as pty from "@lydell/node-pty";
import type { IPty } from "@lydell/node-pty";
import { resolvePackageScript, type PackageManager } from "./scripts.js";
import { getRoot, requireTrusted, WorkspaceError } from "./workspace.js";

/**
 * Real shell terminals (VS Code style) and tracked package.json script runners, one PTY per WebSocket.
 *
 * Interactive stream: Client → server JSON ({ type: "input" | "resize" | "stop" }), server → raw text.
 * Structured mode (`events=json`): server → JSON frames ({ type: "ready" | "data" | "exit" | "error" }).
 */

export interface TerminalSession {
  id: string;
  pty: IPty;
  shell: string;
  cwd: string;
  startedAt: string;
  commandLine?: string;
  manager?: PackageManager;
  script?: string;
  stopped: boolean;
}

const sessions = new Map<string, TerminalSession>();

export function defaultShell(): { file: string; args: string[] } {
  if (process.platform === "win32") {
    const pwsh = process.env.HARDKAS_IDE_SHELL;
    if (pwsh) return { file: pwsh, args: [] };
    return { file: "powershell.exe", args: ["-NoLogo", "-ExecutionPolicy", "Bypass"] };
  }
  const shell = process.env.HARDKAS_IDE_SHELL ?? process.env.SHELL ?? "/bin/bash";
  return { file: shell, args: ["-l"] };
}

function buildTerminalEnv(root: string, cwd: string): Record<string, string> {
  const sep = process.platform === "win32" ? ";" : ":";
  const binParts = [path.join(cwd, "node_modules", ".bin")];
  if (path.resolve(root) !== path.resolve(cwd)) {
    binParts.push(path.join(root, "node_modules", ".bin"));
  }
  return {
    ...process.env,
    TERM: "xterm-256color",
    COLORTERM: "truecolor",
    HARDKAS_ROOT: root,
    HARDKAS_IDE: "1",
    PATH: `${binParts.join(sep)}${sep}${process.env.PATH ?? ""}`
  } as Record<string, string>;
}

function newSessionId(): string {
  return `term_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

export function openTerminal(options: { cwd?: string; cols?: number; rows?: number }): TerminalSession {
  const root = getRoot() ?? options.cwd ?? process.cwd();
  const cwd = options.cwd ?? root;
  const { file, args } = defaultShell();
  const id = newSessionId();
  const proc = pty.spawn(file, args, {
    name: "xterm-256color",
    cols: options.cols ?? 100,
    rows: options.rows ?? 30,
    cwd,
    env: buildTerminalEnv(root, cwd)
  });
  const session: TerminalSession = { id, pty: proc, shell: file, cwd, startedAt: new Date().toISOString(), stopped: false };
  sessions.set(id, session);
  proc.onExit(() => sessions.delete(id));
  return session;
}

export async function openScriptTerminal(options: {
  pkgDir?: string;
  script: string;
  cols?: number;
  rows?: number;
}): Promise<TerminalSession> {
  const root = getRoot();
  if (!root) throw new WorkspaceError(409, "NO_WORKSPACE", "No workspace is open");
  const resolved = await resolvePackageScript(root, options.pkgDir, options.script);
  await requireTrusted(resolved.cwd);

  const isWin = process.platform === "win32";
  const file = isWin ? process.env.ComSpec || "cmd.exe" : resolved.manager;
  const args = isWin ? ["/d", "/c", resolved.manager, "run", resolved.script] : ["run", resolved.script];

  const id = newSessionId();
  const proc = pty.spawn(file, args, {
    name: "xterm-256color",
    cols: options.cols ?? 100,
    rows: options.rows ?? 30,
    cwd: resolved.cwd,
    env: buildTerminalEnv(root, resolved.cwd)
  });
  const session: TerminalSession = {
    id,
    pty: proc,
    shell: resolved.cliPreview,
    cwd: resolved.cwd,
    startedAt: new Date().toISOString(),
    commandLine: resolved.cliPreview,
    manager: resolved.manager,
    script: resolved.script,
    stopped: false
  };
  sessions.set(id, session);
  proc.onExit(() => sessions.delete(id));
  return session;
}

export function stopTerminal(id: string, markStopped = true): boolean {
  const s = sessions.get(id);
  if (!s) return false;
  if (markStopped) s.stopped = true;
  if (process.platform === "win32" && typeof s.pty.pid === "number" && s.pty.pid > 0) {
    // Kill the process tree first so child dev servers (vite, next, node) do not stay orphaned on Windows.
    execFile("taskkill", ["/pid", String(s.pty.pid), "/T", "/F"], { windowsHide: true }, () => {
      try {
        s.pty.kill();
      } catch {
        // already gone
      }
    });
    return true;
  }
  try {
    s.pty.kill();
  } catch {
    // already gone
  }
  return true;
}

export function closeTerminal(id: string): void {
  stopTerminal(id, false);
  sessions.delete(id);
}

export function listTerminals(): Array<Omit<TerminalSession, "pty">> {
  return [...sessions.values()].map(({ pty: _pty, ...rest }) => rest);
}
