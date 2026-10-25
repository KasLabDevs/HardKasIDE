import * as pty from "@lydell/node-pty";
import type { IPty } from "@lydell/node-pty";
import { getRoot } from "./workspace.js";

/**
 * Real shell terminals (VS Code style) for the IDE, one PTY per WebSocket.
 *
 * Client → server messages (JSON):  { type: "input", data } | { type: "resize", cols, rows }
 * Server → client: raw text from the shell.
 */

export interface TerminalSession {
  id: string;
  pty: IPty;
  shell: string;
  cwd: string;
  startedAt: string;
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

export function openTerminal(options: { cwd?: string; cols?: number; rows?: number }): TerminalSession {
  const cwd = options.cwd ?? getRoot() ?? process.cwd();
  const { file, args } = defaultShell();
  const id = `term_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
  const proc = pty.spawn(file, args, {
    name: "xterm-256color",
    cols: options.cols ?? 100,
    rows: options.rows ?? 30,
    cwd,
    env: {
      ...process.env,
      TERM: "xterm-256color",
      COLORTERM: "truecolor",
      HARDKAS_ROOT: cwd,
      HARDKAS_IDE: "1",
      // Put the project's own CLI first so `hardkas` works without npx when installed locally.
      PATH: `${cwd}${process.platform === "win32" ? "\\node_modules\\.bin;" : "/node_modules/.bin:"}${process.env.PATH ?? ""}`
    } as Record<string, string>
  });
  const session: TerminalSession = { id, pty: proc, shell: file, cwd, startedAt: new Date().toISOString() };
  sessions.set(id, session);
  proc.onExit(() => sessions.delete(id));
  return session;
}

export function closeTerminal(id: string): void {
  const s = sessions.get(id);
  if (!s) return;
  try {
    s.pty.kill();
  } catch {
    // already gone
  }
  sessions.delete(id);
}

export function listTerminals(): Array<Omit<TerminalSession, "pty">> {
  return [...sessions.values()].map(({ pty: _pty, ...rest }) => rest);
}
