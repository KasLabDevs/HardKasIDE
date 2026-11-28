import { api } from "@/api/client";
import { useEnv } from "@/store/env";
import { useIde, type JournalBlock } from "@/store/ide";
import { copyText } from "@/utils/clipboard";

/** Everything a bug report needs, gathered from the stores and the server. Each part may be missing. */
export interface DiagnosticsInput {
  ideVersion: string;
  userAgent: string;
  server?: { version?: string; port?: number } | null;
  system?: { node: string; platform: string; docker: { installed: boolean; running: boolean; serverVersion: string | null; error: string | null } } | null;
  cli?: { version: string | null; pinned: string; source: string; error: string | null } | null;
  workspace?: { name: string; trusted?: boolean } | null;
  target: string;
  node?: { status: string; running: boolean; rpcReady: boolean; serverVersion?: string; network?: string; lastError?: string | null } | null;
  journal: Pick<JournalBlock, "kind" | "text" | "at">[];
  errors: string[];
}

const MAX_JOURNAL_LINES = 40;

/**
 * Removes what should not leave the machine in a pasted report: the user's home folder (it holds their user
 * name) and any 64-hex string (keys look like that; so do tx ids, which lose nothing by being masked).
 */
export function redact(text: string): string {
  return text
    .replace(/[A-Za-z]:[\\/]+Users[\\/]+[^\\/\s"'`]+/gi, "~")
    .replace(/\/(?:Users|home)\/[^/\s"'`]+/g, "~")
    .replace(/\b[0-9a-fA-F]{64}\b/g, "<hex64>");
}

export function formatDiagnostics(d: DiagnosticsInput): string {
  const yes = (b: boolean | undefined) => (b ? "yes" : "no");
  const lines: string[] = [
    "## HardKas IDE diagnostics",
    "",
    `- IDE: ${d.ideVersion}${d.server?.version && d.server.version !== d.ideVersion ? ` (server ${d.server.version})` : ""}`,
    `- Browser: ${d.userAgent}`
  ];
  if (d.system) {
    lines.push(`- OS: ${d.system.platform} · Node ${d.system.node}`);
    const dk = d.system.docker;
    lines.push(`- Docker: ${dk.installed ? (dk.running ? `running${dk.serverVersion ? ` (${dk.serverVersion})` : ""}` : "installed, not running") : "not installed"}${dk.error ? ` · ${dk.error}` : ""}`);
  }
  if (d.cli) lines.push(`- HardKas CLI: ${d.cli.version ?? "not found"} (tested with ${d.cli.pinned}, from ${d.cli.source})${d.cli.error ? ` · ${d.cli.error}` : ""}`);
  lines.push(`- Project: ${d.workspace ? `${d.workspace.name}${d.workspace.trusted === undefined ? "" : ` · trusted: ${yes(d.workspace.trusted)}`}` : "none open"}`);
  lines.push(`- Target: ${d.target}`);
  if (d.node) {
    lines.push(`- Local node: ${d.node.status} · running: ${yes(d.node.running)} · RPC ready: ${yes(d.node.rpcReady)}${d.node.serverVersion ? ` · kaspad ${d.node.serverVersion}` : ""}${d.node.network ? ` · ${d.node.network}` : ""}`);
    if (d.node.lastError) lines.push(`- Node error: ${d.node.lastError}`);
  }
  if (d.errors.length) lines.push(`- Could not read: ${d.errors.join("; ")}`);
  const recent = d.journal.filter((j) => j.kind !== "json").slice(-MAX_JOURNAL_LINES);
  if (recent.length) {
    lines.push("", `### Console (last ${recent.length} lines)`, "", "```");
    for (const j of recent) lines.push(`${j.at.slice(11, 19)} ${j.kind.padEnd(7)} ${j.text.split("\n")[0].slice(0, 300)}`);
    lines.push("```");
  }
  return redact(lines.join("\n"));
}

/** Gathers the report from the stores and the server (never throws: what fails is listed in the report). */
export async function collectDiagnostics(): Promise<string> {
  const errors: string[] = [];
  const attempt = async <T,>(label: string, fn: () => Promise<T>): Promise<T | null> => {
    try {
      return await fn();
    } catch (e) {
      errors.push(`${label} (${e instanceof Error ? e.message.slice(0, 80) : String(e)})`);
      return null;
    }
  };
  const [server, system, cli] = await Promise.all([
    attempt("server info", async () => {
      const res = await fetch("/api/info");
      return (await res.json()) as { version?: string; port?: number };
    }),
    attempt("system", () => api.system()),
    attempt("CLI", () => api.cli())
  ]);
  const ide = useIde.getState();
  const env = useEnv.getState();
  const ws = ide.workspace;
  return formatDiagnostics({
    ideVersion: typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "unknown",
    userAgent: typeof navigator === "undefined" ? "unknown" : navigator.userAgent,
    server,
    system,
    cli,
    workspace: ws?.root ? { name: ws.name ?? ws.root.split(/[\\/]/).pop() ?? "project", trusted: ws.trusted } : null,
    target: ide.target,
    node: env.node,
    journal: ide.journal,
    errors
  });
}

/** Copies the report and says so in the status bar. */
export async function copyDiagnostics(): Promise<boolean> {
  const report = await collectDiagnostics();
  const ok = await copyText(report);
  useIde.getState().setStatus(ok ? "Diagnostics copied: paste them into a GitHub issue." : "Could not copy the diagnostics.");
  return ok;
}
