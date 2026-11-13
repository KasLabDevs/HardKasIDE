import { spawn } from "node:child_process";
import { existsSync, promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable, Writable } from "node:stream";
import { fileURLToPath } from "node:url";
import { client, ndJsonStream } from "@agentclientprotocol/sdk";

/**
 * The assistant's "OpenCode" provider: instead of the IDE's own model client and agent loop, the IDE hosts an
 * existing coding agent over the Agent Client Protocol (ACP) — OpenCode (`opencode acp`, MIT). The same bridge works
 * for any ACP agent (Claude Code and Codex through their ACP adapters, Gemini CLI), because only the command differs.
 *
 *   - The agent gets the HardKas IDE MCP server (compile, deploy, payments, node, tests, Kaspa docs) at session start.
 *   - It runs with its own config home under ~/.hardkas-ide/opencode, which carries the IDE's permission policy:
 *     everything asks (shell, edits, code execution, MCP tools), reads are allowed, secret files are denied.
 *   - Every permission request becomes the IDE's existing "confirm" event and waits for the user's answer.
 *   - File reads and writes the agent delegates to the client are refused outside the workspace and on secrets.
 *
 * Without an API key OpenCode offers free models (for example opencode/big-pickle); those prompts go to OpenCode's
 * hosted models.
 */

export type AcpEvent =
  | { type: "step"; id: string; title: string; tool: string; status: "running" | "succeeded" | "failed"; input?: Record<string, unknown>; output?: string; error?: string }
  | { type: "thought"; text: string }
  | { type: "confirm"; id: string; command: string }
  | { type: "delta"; text: string }
  | { type: "done"; summary: string; ok: boolean };

export interface AcpTurnOptions {
  /** Absolute workspace root. */
  cwd: string;
  /** What is sent to the agent as the user's prompt. */
  prompt: string;
  /** Model id offered by the agent (e.g. "opencode/big-pickle"); empty keeps the agent's default. */
  model?: string;
  /** "build" (may act, after approval) or "plan" (read-only). */
  mode?: "build" | "plan";
  /** Stream agent text as delta events (chat) instead of grouping it into thoughts (agent). */
  streamText?: boolean;
  /** Answers a permission request: true = allow once, false = reject. */
  decide: (req: { id: string; title: string; kind: string; detail: string }) => Promise<boolean>;
  /** False when the user already approved everything for this run: allow without showing the dialog. */
  shouldAsk?: () => boolean;
  signal: AbortSignal;
}

const SENSITIVE = /(accounts\.real\.json|dev-server-token|\.hardkas[\\/]+dev-accounts|\.env($|\.)|id_rsa|\.pem$|keystore)/i;

const POLICY = `{
  "$schema": "https://opencode.ai/config.json",
  // Written by HardKas IDE on every start: the policy of the agent the IDE hosts. Last matching rule wins.
  // The bundled binary never updates itself, and sessions are never shared to opencode.ai.
  "update": "disable",
  "share": "disabled",
  "permissions": [
    { "action": "*", "resource": "*", "effect": "ask" },
    { "action": "read", "resource": "*", "effect": "allow" },
    // Read-only HardKas tools (MCP action names are <server>_<tool>): no prompt. Payments, deploys, spends,
    // funding, file writes and node control still ask.
    { "action": "hardkas-ide_workspace_status", "resource": "*", "effect": "allow" },
    { "action": "hardkas-ide_list_files", "resource": "*", "effect": "allow" },
    { "action": "hardkas-ide_read_file", "resource": "*", "effect": "allow" },
    { "action": "hardkas-ide_list_artifacts", "resource": "*", "effect": "allow" },
    { "action": "hardkas-ide_query_index", "resource": "*", "effect": "allow" },
    { "action": "hardkas-ide_environment_status", "resource": "*", "effect": "allow" },
    { "action": "hardkas-ide_accounts_list", "resource": "*", "effect": "allow" },
    { "action": "hardkas-ide_account_balance", "resource": "*", "effect": "allow" },
    { "action": "hardkas-ide_tx_status", "resource": "*", "effect": "allow" },
    { "action": "hardkas-ide_hardkas_help", "resource": "*", "effect": "allow" },
    { "action": "hardkas-ide_kaspa_docs", "resource": "*", "effect": "allow" },
    { "action": "*", "resource": "*accounts.real.json*", "effect": "deny" },
    { "action": "*", "resource": "*dev-accounts*", "effect": "deny" },
    { "action": "*", "resource": "*dev-server-token*", "effect": "deny" },
    { "action": "*", "resource": "*.env", "effect": "deny" },
    { "action": "*", "resource": "*.env.*", "effect": "deny" },
    { "action": "*", "resource": "*keystore*", "effect": "deny" }
  ]
}
`;

const here = path.dirname(fileURLToPath(import.meta.url));

/** The staged desktop layout is stage/server/dist/<this file>; in the repo it is packages/ide-server/src or dist. */
function stageDir(): string | null {
  const candidate = path.resolve(here, "..", "..");
  return existsSync(path.join(candidate, "server")) && existsSync(path.join(candidate, "ui")) ? candidate : null;
}

export function resolveOpenCode(): string | null {
  if (process.env.HARDKAS_IDE_OPENCODE && existsSync(process.env.HARDKAS_IDE_OPENCODE)) return process.env.HARDKAS_IDE_OPENCODE;
  const stage = stageDir();
  const exe = process.platform === "win32" ? "opencode.exe" : "opencode";
  if (stage) {
    const staged = path.join(stage, "agents", "opencode", exe);
    if (existsSync(staged)) return staged;
  }
  for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
    if (dir && existsSync(path.join(dir, exe))) return path.join(dir, exe);
  }
  return null;
}

/** The IDE MCP server, started by the agent with this server's own Node. */
function mcpServer(port: number): { name: string; command: string; args: string[]; env: Array<{ name: string; value: string }> } | null {
  const stage = stageDir();
  const candidates = [
    stage ? path.join(stage, "mcp", "dist", "index.js") : "",
    path.resolve(here, "..", "..", "mcp-server", "dist", "index.js")
  ].filter(Boolean);
  const entry = candidates.find((p) => existsSync(p));
  if (!entry) return null;
  return { name: "hardkas-ide", command: process.execPath, args: [entry], env: [{ name: "HARDKAS_IDE_URL", value: `http://127.0.0.1:${port}` }] };
}

/** ~/.hardkas-ide/opencode: the agent's own config/data home, separate from any OpenCode the user runs. */
async function agentHome(): Promise<string> {
  const home = path.join(os.homedir(), ".hardkas-ide", "opencode");
  const configDir = path.join(home, ".config", "opencode");
  await fs.mkdir(configDir, { recursive: true });
  await fs.writeFile(path.join(configDir, "opencode.jsonc"), POLICY, "utf8");
  return home;
}

function insideRoot(root: string, p: string): string {
  const abs = path.resolve(root, p);
  const rel = path.relative(root, abs);
  if (rel.startsWith("..") || path.isAbsolute(rel)) throw new Error(`outside the workspace: ${p}`);
  if (SENSITIVE.test(abs)) throw new Error(`refused: ${path.basename(abs)} holds secrets`);
  return abs;
}

/** What the approval dialog shows: the HardKas tool call when the agent runs one, otherwise the agent's title. */
function describePermission(title: string, kind: string, input: unknown): string {
  const code = typeof (input as { code?: unknown } | null)?.code === "string" ? String((input as { code: string }).code) : "";
  const calls = [...code.matchAll(/tools\[\s*"hardkas-ide"\s*\]\.(\w+)\s*\(([^)]*)\)/g)].map((m) => `HardKas · ${m[1]}(${m[2].replace(/\s+/g, " ").trim()})`);
  if (calls.length > 0) return calls.join("\n");
  if (code) return `${title}: ${code.replace(/\s+/g, " ").slice(0, 300)}`;
  const command = typeof (input as { command?: unknown } | null)?.command === "string" ? String((input as { command: string }).command) : "";
  if (command) return command;
  return kind && kind !== "other" ? `${kind}: ${title}` : title;
}

/** A step's title: the HardKas tools it calls when it is a code block, otherwise the agent's own title. */
function stepTitle(title: string, input: unknown): string {
  const code = typeof (input as { code?: unknown } | null)?.code === "string" ? String((input as { code: string }).code) : "";
  const names = [...code.matchAll(/tools\[\s*"hardkas-ide"\s*\]\.(\w+)/g)].map((m) => m[1]);
  if (names.length > 0) return `HardKas · ${[...new Set(names)].join(", ")}`;
  return title;
}

function textOf(content: unknown): string {
  const items = Array.isArray(content) ? content : [content];
  return items
    .map((c: any) => (c?.type === "content" ? c.content : c))
    .map((c: any) => (c?.type === "text" ? String(c.text) : c?.type === "diff" ? `diff ${c.path}` : ""))
    .filter(Boolean)
    .join("\n");
}

class EventQueue<T> {
  private items: T[] = [];
  private wake: (() => void) | null = null;
  push(item: T) {
    this.items.push(item);
    this.wake?.();
    this.wake = null;
  }
  async next(): Promise<T> {
    while (this.items.length === 0) await new Promise<void>((r) => (this.wake = r));
    return this.items.shift() as T;
  }
}

/** One prompt turn with an ACP agent, as IDE assistant events. Ends with exactly one "done". */
export async function* runAcpTurn(o: AcpTurnOptions): AsyncGenerator<AcpEvent> {
  const exe = resolveOpenCode();
  if (!exe) {
    yield { type: "done", ok: false, summary: "OpenCode is not installed: put opencode on the PATH or set HARDKAS_IDE_OPENCODE to its executable." };
    return;
  }
  const port = Number(process.env.HARDKAS_IDE_PORT ?? 7421);
  const mcp = mcpServer(port);
  const home = await agentHome();
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    USERPROFILE: home,
    HOME: home,
    XDG_CONFIG_HOME: path.join(home, ".config"),
    XDG_DATA_HOME: path.join(home, ".local", "share"),
    XDG_STATE_HOME: path.join(home, ".local", "state"),
    XDG_CACHE_HOME: path.join(home, ".cache"),
    APPDATA: path.join(home, "AppData", "Roaming"),
    LOCALAPPDATA: path.join(home, "AppData", "Local"),
    NO_COLOR: "1"
  };

  const events = new EventQueue<AcpEvent>();
  const child = spawn(exe, ["acp"], { cwd: o.cwd, env, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
  let stderr = "";
  child.stderr.on("data", (d: Buffer) => (stderr = (stderr + d.toString("utf8")).slice(-4000)));
  const onAbort = () => child.kill();
  o.signal.addEventListener("abort", onAbort, { once: true });

  const steps = new Map<string, { title: string; kind: string }>();
  let pending = "";
  let last = "";
  const flush = () => {
    if (!o.streamText && pending.trim()) {
      events.push({ type: "thought", text: pending.trim() });
      last = pending.trim();
    }
    pending = "";
  };
  let declined: string | null = null;

  const stream = ndJsonStream(Writable.toWeb(child.stdin) as WritableStream<Uint8Array>, Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>);
  const app = client()
    .onRequest("session/request_permission", async ({ params }: any) => {
      flush();
      const id = `perm_${params.toolCall?.toolCallId ?? Math.random().toString(36).slice(2)}`;
      const title = String(params.toolCall?.title ?? "permission");
      const kind = String(params.toolCall?.kind ?? "other");
      const detail = describePermission(title, kind, params.toolCall?.rawInput);
      const ask = o.shouldAsk ? o.shouldAsk() : true;
      if (ask) events.push({ type: "confirm", id, command: detail });
      const allow = ask ? await o.decide({ id, title, kind, detail }) : true;
      const options: Array<{ optionId: string; kind: string }> = params.options ?? [];
      const option = options.find((op) => op.kind === (allow ? "allow_once" : "reject_once")) ?? options.find((op) => op.kind.startsWith(allow ? "allow" : "reject"));
      if (!allow) declined = detail;
      return option ? { outcome: { outcome: "selected", optionId: option.optionId } } : { outcome: { outcome: "cancelled" } };
    })
    .onRequest("fs/read_text_file", async ({ params }: any) => {
      const abs = insideRoot(o.cwd, params.path);
      let text = await fs.readFile(abs, "utf8");
      if (params.line || params.limit) {
        const lines = text.split(/\r?\n/);
        const start = Math.max(0, (params.line ?? 1) - 1);
        text = lines.slice(start, params.limit ? start + params.limit : undefined).join("\n");
      }
      return { content: text };
    })
    .onRequest("fs/write_text_file", async ({ params }: any) => {
      const abs = insideRoot(o.cwd, params.path);
      await fs.mkdir(path.dirname(abs), { recursive: true });
      await fs.writeFile(abs, params.content, "utf8");
      return {};
    })
    .onNotification("session/update", async ({ params }: any) => {
      const u = params.update;
      switch (u.sessionUpdate) {
        case "agent_message_chunk":
          if (u.content?.type === "text") {
            if (o.streamText) events.push({ type: "delta", text: u.content.text });
            else pending += u.content.text;
            last = o.streamText ? last + u.content.text : last;
          }
          break;
        case "plan":
          flush();
          if (!o.streamText) events.push({ type: "thought", text: "Plan:\n" + (u.entries ?? []).map((e: any) => `- [${e.status}] ${e.content}`).join("\n") });
          break;
        case "tool_call": {
          flush();
          // OpenCode wraps HardKas tool calls in an "execute" code block: show the calls, not "execute".
          const title = stepTitle(u.title ?? "tool", u.rawInput);
          steps.set(u.toolCallId, { title, kind: u.kind ?? "other" });
          if (!o.streamText) events.push({ type: "step", id: u.toolCallId, title, tool: u.kind === "other" ? "agent" : (u.kind ?? "agent"), status: "running", input: u.rawInput });
          break;
        }
        case "tool_call_update": {
          const s = steps.get(u.toolCallId) ?? { title: u.title ?? "tool", kind: u.kind ?? "other" };
          if (u.rawInput) s.title = stepTitle(u.title ?? s.title, u.rawInput);
          else if (u.title && u.title !== "execute") s.title = u.title;
          if (!o.streamText && (u.status === "completed" || u.status === "failed")) {
            const output = textOf(u.content ?? []) || (u.rawOutput ? JSON.stringify(u.rawOutput).slice(0, 4000) : "");
            events.push({ type: "step", id: u.toolCallId, title: s.title, tool: s.kind, status: u.status === "completed" ? "succeeded" : "failed", output, error: u.status === "failed" ? output : undefined });
          }
          break;
        }
        default:
          break;
      }
    });

  const run = app.connectWith(stream, async (ctx: any) => {
    const init = await ctx.request("initialize", {
      protocolVersion: 1,
      clientCapabilities: { fs: { readTextFile: true, writeTextFile: true }, terminal: false },
      clientInfo: { name: "hardkas-ide", version: "0.3.0" }
    });
    const session = await ctx.buildSession({ cwd: o.cwd, mcpServers: mcp ? [mcp] : [] }).start();
    const options: Array<{ id: string; name?: string }> = session.newSessionResponse.configOptions ?? [];
    const set = async (id: string, value: string) => {
      if (options.some((c) => c.id === id)) await ctx.request("session/set_config_option", { sessionId: session.sessionId, configId: id, value });
    };
    if (o.model) await set("model", o.model);
    await set("mode", o.mode ?? "build");
    if (!o.streamText) {
      events.push({ type: "thought", text: `${init.agentInfo?.name ?? "Agent"} ${init.agentInfo?.version ?? ""} · ${o.model || "default model"}${mcp ? " · HardKas tools connected" : " · HardKas tools NOT found (build packages/mcp-server)"}` });
    }
    const response = await session.prompt(o.prompt);
    flush();
    session.dispose?.();
    return response;
  });

  run.then(
    (response: any) => {
      const stop = String(response?.stopReason ?? "");
      if (declined) events.push({ type: "done", ok: false, summary: `Stopped: you declined “${declined}”. ${last}`.trim() });
      else events.push({ type: "done", ok: stop === "end_turn", summary: last || `Stopped (${stop}).` });
    },
    (error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      events.push({ type: "done", ok: false, summary: `The agent failed: ${message}${stderr ? `\n${stderr.split("\n").slice(-5).join("\n")}` : ""}` });
    }
  );

  try {
    for (;;) {
      const ev = await events.next();
      yield ev;
      if (ev.type === "done") break;
    }
  } finally {
    o.signal.removeEventListener("abort", onAbort);
    child.stdin.end();
    setTimeout(() => child.kill(), 1500).unref();
  }
}
