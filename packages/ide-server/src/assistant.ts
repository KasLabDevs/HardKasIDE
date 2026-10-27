import { exec } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import * as wsfs from "./fs.js";
import { startJob, waitForJob } from "./runner.js";

/**
 * Assistant backend: provider-agnostic chat, grounded in the official Kaspa docs.
 *
 * Why not "just use the Kaspa Research GPT"? A ChatGPT custom GPT lives inside chatgpt.com: it has
 * no API, and the site forbids being framed (CSP frame-ancestors 'self'). What Kaspa does publish for
 * AIs is docs.kaspa.org/llms.txt and /llms-full.txt, plus an "Agent Brief" for Toccata/Silverscript.
 * Feeding those to any model gives the same grounding without depending on one vendor.
 *
 * Providers: "anthropic" (Messages API) and "openai" (any OpenAI-compatible Chat Completions
 * endpoint: OpenAI, OpenRouter, LM Studio, Ollama at http://localhost:11434/v1, …).
 * The API key is stored in ~/.hardkas-ide/assistant.json on this machine and never sent to the browser.
 */

const HOME = path.join(os.homedir(), ".hardkas-ide");
const CONFIG_FILE = path.join(HOME, "assistant.json");
const CACHE_DIR = path.join(HOME, "cache");
const DOCS_BASE = "https://docs.kaspa.org";
const DOCS_TTL_MS = 24 * 60 * 60 * 1000;

export type Provider = "anthropic" | "openai";
export type DocsMode = "off" | "core" | "full";

export interface AssistantConfig {
  provider: Provider;
  baseUrl: string;
  model: string;
  apiKey: string;
  docs: DocsMode;
  maxTokens: number;
}

const DEFAULTS: Record<Provider, { baseUrl: string; model: string }> = {
  anthropic: { baseUrl: "https://api.anthropic.com", model: "claude-sonnet-5-5" },
  openai: { baseUrl: "https://api.openai.com/v1", model: "" }
};

export const defaultConfig: AssistantConfig = { provider: "anthropic", baseUrl: DEFAULTS.anthropic.baseUrl, model: DEFAULTS.anthropic.model, apiKey: "", docs: "core", maxTokens: 4096 };

export function providerDefaults(): typeof DEFAULTS {
  return DEFAULTS;
}

export async function loadConfig(): Promise<AssistantConfig> {
  try {
    const raw = JSON.parse(await fs.readFile(CONFIG_FILE, "utf8")) as Partial<AssistantConfig>;
    return { ...defaultConfig, ...raw };
  } catch {
    return { ...defaultConfig };
  }
}

/** What the browser may see: everything except the key. */
export function publicConfig(c: AssistantConfig) {
  const { apiKey, ...rest } = c;
  return { ...rest, hasKey: apiKey.length > 0, keyHint: apiKey ? `…${apiKey.slice(-4)}` : "" };
}

export async function saveConfig(patch: Partial<AssistantConfig> & { clearKey?: boolean }): Promise<AssistantConfig> {
  const current = await loadConfig();
  const next: AssistantConfig = { ...current };
  if (patch.provider && (patch.provider === "anthropic" || patch.provider === "openai")) {
    next.provider = patch.provider;
    // Switching provider without touching URL/model resets them to that provider's defaults.
    if (patch.baseUrl === undefined) next.baseUrl = DEFAULTS[patch.provider].baseUrl;
    if (patch.model === undefined) next.model = DEFAULTS[patch.provider].model;
  }
  if (typeof patch.baseUrl === "string") next.baseUrl = patch.baseUrl.trim().replace(/\/+$/, "");
  if (typeof patch.model === "string") next.model = patch.model.trim();
  if (typeof patch.apiKey === "string" && patch.apiKey.trim()) next.apiKey = patch.apiKey.trim();
  if (patch.clearKey) next.apiKey = "";
  if (patch.docs === "off" || patch.docs === "core" || patch.docs === "full") next.docs = patch.docs;
  if (typeof patch.maxTokens === "number" && patch.maxTokens >= 256 && patch.maxTokens <= 32000) next.maxTokens = Math.floor(patch.maxTokens);
  if (next.baseUrl && !/^https?:\/\//.test(next.baseUrl)) throw new Error("Base URL must start with http:// or https://");
  await fs.mkdir(HOME, { recursive: true });
  await fs.writeFile(CONFIG_FILE, JSON.stringify(next, null, 2), { encoding: "utf8", mode: 0o600 });
  return next;
}

// ---------------------------------------------------------------- Kaspa docs context

const CORE_PAGES = ["/llms.mdx/toccata/agent-brief/content.md", "/llms.mdx/toccata/silverscript/content.md", "/llms.mdx/integrate/getting-started/content.md", "/llms.mdx/references/content.md"];

async function cachedFetch(key: string, urls: string[]): Promise<{ text: string; fetchedAt: number; stale: boolean }> {
  const file = path.join(CACHE_DIR, `kaspa-docs-${key}.md`);
  let cached: { text: string; fetchedAt: number } | null = null;
  try {
    const stat = await fs.stat(file);
    cached = { text: await fs.readFile(file, "utf8"), fetchedAt: stat.mtimeMs };
  } catch {
    cached = null;
  }
  if (cached && Date.now() - cached.fetchedAt < DOCS_TTL_MS) return { ...cached, stale: false };
  try {
    const parts: string[] = [];
    for (const u of urls) {
      const res = await fetch(DOCS_BASE + u, { headers: { accept: "text/markdown, text/plain" } });
      if (!res.ok) throw new Error(`${u}: ${res.status}`);
      parts.push((await res.text()).trim());
    }
    const text = parts.join("\n\n---\n\n");
    await fs.mkdir(CACHE_DIR, { recursive: true });
    await fs.writeFile(file, text, "utf8");
    return { text, fetchedAt: Date.now(), stale: false };
  } catch (error) {
    if (cached) return { ...cached, stale: true };
    throw error;
  }
}

export async function kaspaDocs(mode: DocsMode): Promise<{ text: string; chars: number; fetchedAt: number | null; stale: boolean; mode: DocsMode } | null> {
  if (mode === "off") return null;
  const r = mode === "full" ? await cachedFetch("full", ["/llms-full.txt"]) : await cachedFetch("core", CORE_PAGES);
  return { text: r.text, chars: r.text.length, fetchedAt: r.fetchedAt, stale: r.stale, mode };
}

// ---------------------------------------------------------------- chat

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ChatRequest {
  messages: ChatMessage[];
  /** Extra context from the IDE: workspace, environment, current file. */
  context?: { workspace?: string; environment?: string; file?: { path: string; content: string } | null };
}

const SENSITIVE = /(accounts\.real\.json|dev-server-token|\.hardkas[\\/]+dev-accounts|\.env($|\.)|id_rsa|\.pem$|keystore)/i;

export function isSensitivePath(p: string): boolean {
  return SENSITIVE.test(p);
}

function systemPrompt(req: ChatRequest, docs: { text: string; mode: DocsMode } | null): string {
  const lines = [
    "You are the assistant inside HardKas IDE, a development environment for Kaspa built on the HardKas toolkit.",
    "HardKas plans, signs, simulates, inspects and replays Kaspa transactions; it compiles SilverScript (.sil) covenant contracts with silverc and deploys/spends them on a local rusty-kaspad (simnet) in Docker.",
    "Environments: Simulator (in-memory, network 'simulated'), Local node (Docker rusty-kaspad, network 'simnet'), Public testnet (testnet-10). Mainnet is blocked by HardKas policy.",
    "Be concise and concrete. When you write SilverScript or shell commands, put them in fenced code blocks (```silverscript or ```bash). Say so when you are not sure instead of guessing Kaspa protocol details, and prefer the Kaspa documentation below over memory: Toccata is UTXO-native, not account-native, so do not import an Ethereum contract model.",
    "You can only chat: you cannot run commands or edit files yourself. Suggest what the user can run or paste."
  ];
  const ctx = req.context ?? {};
  if (ctx.workspace) lines.push(`Open project: ${ctx.workspace}`);
  if (ctx.environment) lines.push(`Selected environment: ${ctx.environment}`);
  if (ctx.file && !isSensitivePath(ctx.file.path)) {
    const body = ctx.file.content.length > 24000 ? ctx.file.content.slice(0, 24000) + "\n…(truncated)" : ctx.file.content;
    lines.push(`\nThe user has this file open (${ctx.file.path}):\n\`\`\`\n${body}\n\`\`\``);
  }
  if (docs) lines.push(`\n# Official Kaspa documentation (${docs.mode === "full" ? "full corpus" : "core pack"}, from docs.kaspa.org)\n\n${docs.text}`);
  return lines.join("\n");
}

export class AssistantError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string
  ) {
    super(message);
  }
}

/** Streams the model's answer as text deltas. Throws AssistantError before the first byte for config problems. */
export async function* streamChat(req: ChatRequest, signal: AbortSignal): AsyncGenerator<{ type: "delta"; text: string } | { type: "meta"; docs: { mode: DocsMode; chars: number; stale: boolean } | null; model: string }> {
  const cfg = await loadConfig();
  if (!cfg.model) throw new AssistantError(400, "NO_MODEL", "Pick a model in the assistant settings first.");
  const isLocal = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])/.test(cfg.baseUrl);
  if (!cfg.apiKey && !(cfg.provider === "openai" && isLocal)) {
    throw new AssistantError(400, "NO_KEY", "Add your API key in the assistant settings (gear icon). A local Ollama or LM Studio endpoint needs no key.");
  }
  if (!req.messages?.length) throw new AssistantError(400, "BAD_REQUEST", "messages is required");

  let docs: Awaited<ReturnType<typeof kaspaDocs>> = null;
  try {
    docs = await kaspaDocs(cfg.docs);
  } catch {
    docs = null; // docs unreachable: continue without them, the meta event tells the UI
  }
  yield { type: "meta", docs: docs ? { mode: docs.mode, chars: docs.chars, stale: docs.stale } : null, model: cfg.model };
  const system = systemPrompt(req, docs);
  const messages = req.messages.slice(-30);

  if (cfg.provider === "anthropic") {
    const res = await fetch(`${cfg.baseUrl}/v1/messages`, {
      method: "POST",
      signal,
      headers: { "content-type": "application/json", "x-api-key": cfg.apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: cfg.model, max_tokens: cfg.maxTokens, system, messages, stream: true })
    });
    if (!res.ok || !res.body) throw await upstreamError(res);
    for await (const data of sseData(res.body)) {
      let ev: { type?: string; delta?: { type?: string; text?: string }; error?: { message?: string } };
      try {
        ev = JSON.parse(data) as typeof ev;
      } catch {
        continue;
      }
      if (ev.type === "content_block_delta" && ev.delta?.type === "text_delta" && ev.delta.text) yield { type: "delta", text: ev.delta.text };
      else if (ev.type === "error") throw new AssistantError(502, "UPSTREAM", ev.error?.message ?? "provider error");
    }
    return;
  }

  const headers: Record<string, string> = { "content-type": "application/json" };
  if (cfg.apiKey) headers.authorization = `Bearer ${cfg.apiKey}`;
  const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
    method: "POST",
    signal,
    headers,
    // OpenAI's newer models reject `max_tokens` and require `max_completion_tokens`; other compatible
    // servers (OpenRouter, Ollama, LM Studio, Groq, DeepSeek…) still expect `max_tokens`.
    body: JSON.stringify({
      model: cfg.model,
      stream: true,
      ...(/^https:\/\/api\.openai\.com\//.test(cfg.baseUrl) ? { max_completion_tokens: cfg.maxTokens } : { max_tokens: cfg.maxTokens }),
      messages: [{ role: "system", content: system }, ...messages]
    })
  });
  if (!res.ok || !res.body) throw await upstreamError(res);
  for await (const data of sseData(res.body)) {
    if (data === "[DONE]") return;
    let ev: { choices?: Array<{ delta?: { content?: string | null } }>; error?: { message?: string } };
    try {
      ev = JSON.parse(data) as typeof ev;
    } catch {
      continue;
    }
    if (ev.error) throw new AssistantError(502, "UPSTREAM", ev.error.message ?? "provider error");
    const text = ev.choices?.[0]?.delta?.content;
    if (text) yield { type: "delta", text };
  }
}

async function upstreamError(res: Response): Promise<AssistantError> {
  let detail = "";
  try {
    const j = (await res.json()) as { error?: { message?: string } | string; message?: string };
    detail = typeof j.error === "string" ? j.error : (j.error?.message ?? j.message ?? "");
  } catch {
    // body not JSON
  }
  const hint = res.status === 401 || res.status === 403 ? " (check the API key)" : res.status === 404 ? " (check the model name and base URL)" : res.status === 429 ? " (rate limited or out of credit)" : "";
  return new AssistantError(502, "UPSTREAM", `Provider answered ${res.status}${hint}${detail ? `: ${detail}` : ""}`);
}

/** Yields the `data:` payloads of a Server-Sent Events byte stream. */
async function* sseData(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buffer.search(/\r?\n\r?\n/)) >= 0) {
        const block = buffer.slice(0, idx);
        buffer = buffer.slice(idx).replace(/^\r?\n\r?\n/, "");
        const data = block
          .split(/\r?\n/)
          .filter((l) => l.startsWith("data:"))
          .map((l) => l.slice(5).trimStart())
          .join("\n");
        if (data) yield data;
      }
    }
  } finally {
    reader.releaseLock();
  }
}

// ---------------------------------------------------------------- autonomous agent mode

export interface AgentRequest {
  goal: string;
  context?: { workspace?: string; environment?: string; file?: { path: string; content: string } | null };
}

export type AgentEvent =
  | { type: "step"; id: string; title: string; tool: string; status: "running" | "succeeded" | "failed"; input?: Record<string, unknown>; output?: string; error?: string }
  | { type: "thought"; text: string }
  | { type: "done"; summary: string; ok: boolean };

const AGENT_TOOLS_ANTHROPIC = [
  {
    name: "execute_terminal_command",
    description: "Run any shell or CLI command directly in the integrated terminal / workspace root (e.g. 'hardkas ...', 'npm install ...', 'npx vitest ...', 'node scripts/...', 'git ...'). Returns stdout, stderr and exit status.",
    input_schema: {
      type: "object",
      properties: {
        command: { type: "string", description: "The shell command line string to execute in the workspace root" }
      },
      required: ["command"]
    }
  },
  {
    name: "write_file",
    description: "Write or update a file in the project workspace (contracts, tests, scripts).",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Relative file path inside the workspace, e.g. 'contracts/escrow.sil' or 'test/escrow.test.ts'" },
        content: { type: "string", description: "Complete file content to write" }
      },
      required: ["path", "content"]
    }
  },
  {
    name: "read_file",
    description: "Read a file from the workspace.",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Relative file path inside the workspace" }
      },
      required: ["path"]
    }
  },
  {
    name: "list_files",
    description: "List files in the workspace directory.",
    input_schema: {
      type: "object",
      properties: {
        dir: { type: "string", description: "Optional subfolder, e.g. 'contracts'" }
      }
    }
  },
  {
    name: "compile_silverscript",
    description: "Compile a SilverScript contract (.sil) with silverc via hardkas CLI. Returns compiled ABI on success or detailed compiler errors.",
    input_schema: {
      type: "object",
      properties: {
        file: { type: "string", description: "Path to .sil file, e.g. 'contracts/escrow.sil'" }
      },
      required: ["file"]
    }
  },
  {
    name: "run_tests",
    description: "Execute Vitest test suite in the workspace to verify contract behavior.",
    input_schema: {
      type: "object",
      properties: {
        file: { type: "string", description: "Optional specific test file, e.g. 'test/payment.test.ts'" }
      }
    }
  },
  {
    name: "fund_account",
    description: "Fund an account (e.g. alice, bob) with test KAS on the local simnet node.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Account name, e.g. 'alice'" },
        amountKas: { type: "string", description: "Amount in KAS as decimal string, e.g. '100'" }
      },
      required: ["name", "amountKas"]
    }
  }
];

const AGENT_TOOLS_OPENAI = AGENT_TOOLS_ANTHROPIC.map((t) => ({
  type: "function" as const,
  function: {
    name: t.name,
    description: t.description,
    parameters: t.input_schema
  }
}));

async function executeAgentTool(name: string, args: Record<string, unknown>): Promise<{ ok: boolean; title: string; output: string; error?: string }> {
  try {
    switch (name) {
      case "execute_terminal_command": {
        const cmd = String(args.command ?? "").trim();
        if (!cmd) return { ok: false, title: "Empty terminal command", output: "Command cannot be empty", error: "Command cannot be empty" };
        const root = wsfs.resolveInRoot("");
        const isWin = process.platform === "win32";
        const env = {
          ...process.env,
          TERM: "xterm-256color",
          COLORTERM: "truecolor",
          HARDKAS_ROOT: root,
          HARDKAS_IDE: "1",
          PATH: `${root}${isWin ? "\\node_modules\\.bin;" : "/node_modules/.bin:"}${process.env.PATH ?? ""}`
        };

        return await new Promise<{ ok: boolean; title: string; output: string; error?: string }>((resolve) => {
          exec(cmd, { cwd: root, env, maxBuffer: 10 * 1024 * 1024, timeout: 180_000 }, (error, stdout, stderr) => {
            const combined = ((stdout || "") + "\n" + (stderr || "")).trim();
            const output = combined.length > 8000 ? combined.slice(0, 8000) + "\n...(truncated)" : combined;
            const ok = !error;
            const title = ok
              ? `Terminal: ${cmd.length > 45 ? cmd.slice(0, 45) + "…" : cmd}`
              : `Terminal error: ${cmd.length > 40 ? cmd.slice(0, 40) + "…" : cmd}`;
            resolve({
              ok,
              title,
              output: output || (ok ? "(command completed with no output)" : "(command failed with no output)"),
              error: error ? (stderr.trim() || error.message) : undefined
            });
          });
        });
      }
      case "write_file": {
        const p = String(args.path ?? "").replace(/^[/\\]+/, "");
        const content = String(args.content ?? "");
        await wsfs.writeFile(p, content);
        return { ok: true, title: `Wrote ${p} (${content.length} chars)`, output: `Successfully wrote ${p}` };
      }
      case "read_file": {
        const p = String(args.path ?? "").replace(/^[/\\]+/, "");
        const content = await wsfs.readFile(p);
        return { ok: true, title: `Read ${p}`, output: content.length > 8000 ? content.slice(0, 8000) + "\n...(truncated)" : content };
      }
      case "list_files": {
        const tree = await wsfs.readTree(String(args.dir ?? ""));
        const files: string[] = [];
        const walk = (nodes: any[]) => {
          for (const n of nodes) {
            if (n.type === "file") files.push(n.path);
            else if (n.children) walk(n.children);
          }
        };
        walk(tree);
        return { ok: true, title: `Listed ${files.length} files`, output: JSON.stringify(files.slice(0, 100), null, 2) };
      }
      case "compile_silverscript": {
        const file = String(args.file ?? "").replace(/^[/\\]+/, "");
        const job = await startJob({ args: ["silver", "compile", file, "--json"] });
        await waitForJob(job);
        if (job.status === "succeeded") {
          return { ok: true, title: `Compiled ${file} successfully`, output: `Compilation succeeded:\n${job.stdout.slice(0, 3000)}` };
        } else {
          const err = job.stderr.trim() || (job.result as any)?.message || `Compilation failed with exit code ${job.exitCode}`;
          return { ok: false, title: `Compiler error in ${file}`, output: err, error: err };
        }
      }
      case "run_tests": {
        const file = args.file ? String(args.file).replace(/^[/\\]+/, "") : undefined;
        const job = await startJob({ args: ["vitest", "run", ...(file ? [file] : [])], command: "npx" });
        await waitForJob(job, 120_000);
        const out = (job.stdout + "\n" + job.stderr).trim();
        const ok = job.status === "succeeded";
        return {
          ok,
          title: ok ? "Vitest tests passed" : "Vitest tests failed",
          output: out.slice(-3000),
          error: !ok ? out.slice(-1200) : undefined
        };
      }
      case "fund_account": {
        const acc = String(args.name ?? "alice");
        const amount = String(args.amountKas ?? "100");
        const job = await startJob({ args: ["localnet", "fund", acc, "--amount", amount, "--profile", "toccata-v2", "--json"] });
        await waitForJob(job, 180_000);
        const ok = job.status === "succeeded";
        return {
          ok,
          title: ok ? `Funded ${acc} with ${amount} KAS` : `Funding ${acc} failed`,
          output: ok ? `Funded ${acc} with ${amount} KAS` : job.stderr,
          error: !ok ? job.stderr : undefined
        };
      }
      default:
        return { ok: false, title: `Unknown tool: ${name}`, output: `Tool ${name} does not exist`, error: `Tool ${name} does not exist` };
    }
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    return { ok: false, title: `Error executing ${name}`, output: err, error: err };
  }
}

export async function* streamAgent(req: AgentRequest, signal: AbortSignal): AsyncGenerator<AgentEvent> {
  const cfg = await loadConfig();
  if (!cfg.model) throw new AssistantError(400, "NO_MODEL", "Pick a model in the assistant settings first.");
  const isLocal = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])/.test(cfg.baseUrl);
  if (!cfg.apiKey && !(cfg.provider === "openai" && isLocal)) {
    throw new AssistantError(400, "NO_KEY", "Add your API key in assistant settings (gear icon) to run Agent Mode.");
  }
  if (!req.goal?.trim()) throw new AssistantError(400, "BAD_REQUEST", "goal is required");

  let docs: Awaited<ReturnType<typeof kaspaDocs>> = null;
  try {
    docs = await kaspaDocs(cfg.docs);
  } catch {
    docs = null;
  }

  const system = [
    "You are the HardKas Autonomous AI Agent, a Principal Kaspa Smart Contract & Web3 Engineer.",
    "You have real, working tools in the user's IDE workspace: execute_terminal_command, write_file, read_file, list_files, compile_silverscript, run_tests, and fund_account.",
    "",
    "Instructions:",
    "1. When tasked to create or modify contracts, scripts or tests, write complete code using write_file.",
    "2. ALWAYS call compile_silverscript immediately after writing or editing a .sil contract.",
    "3. You have full terminal access: use execute_terminal_command to run CLI commands, install packages, execute scripts, and inspect node/contract state.",
    "4. If compilation or commands fail, inspect the error output, fix the code with write_file, and re-run until it succeeds.",
    "5. When writing tests, write clean Vitest/HardKas tests in the test/ directory and run them with run_tests or execute_terminal_command.",
    "6. Be direct, efficient and autonomous. Take initiative to fix errors. When done, output a concise final summary of what was built and verified.",
    docs ? `\n# Kaspa Documentation Reference:\n${docs.text.slice(0, 16000)}` : ""
  ].join("\n");

  const MAX_STEPS = 16;
  let stepCount = 0;

  if (cfg.provider === "anthropic") {
    const messages: Array<any> = [{ role: "user", content: req.goal }];
    while (stepCount < MAX_STEPS) {
      if (signal.aborted) return;
      stepCount++;
      const res = await fetch(`${cfg.baseUrl}/v1/messages`, {
        method: "POST",
        signal,
        headers: { "content-type": "application/json", "x-api-key": cfg.apiKey, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({ model: cfg.model, max_tokens: cfg.maxTokens, system, messages, tools: AGENT_TOOLS_ANTHROPIC })
      });
      if (!res.ok) throw await upstreamError(res);
      const data = (await res.json()) as { content?: Array<{ type: string; text?: string; id?: string; name?: string; input?: Record<string, unknown> }> };
      const content = data.content ?? [];
      const toolUses = content.filter((c) => c.type === "tool_use") as Array<{ id: string; name: string; input: Record<string, unknown> }>;
      const textBlock = content.find((c) => c.type === "text")?.text ?? "";
      if (textBlock.trim()) yield { type: "thought", text: textBlock.trim() };

      if (toolUses.length === 0) {
        yield { type: "done", summary: textBlock || "Goal completed successfully.", ok: true };
        return;
      }

      messages.push({ role: "assistant", content });
      const toolResults: Array<{ type: "tool_result"; tool_use_id: string; content: string }> = [];

      for (const tu of toolUses) {
        if (signal.aborted) return;
        const stepId = `step_${Date.now()}_${tu.id}`;
        yield { type: "step", id: stepId, title: `Running ${tu.name}...`, tool: tu.name, status: "running", input: tu.input };
        const result = await executeAgentTool(tu.name, tu.input);
        yield { type: "step", id: stepId, title: result.title, tool: tu.name, status: result.ok ? "succeeded" : "failed", output: result.output, error: result.error };
        toolResults.push({ type: "tool_result", tool_use_id: tu.id, content: result.output });
      }

      messages.push({ role: "user", content: toolResults });
    }
    yield { type: "done", summary: "Reached maximum agent step limit (8 steps).", ok: false };
    return;
  }

  // OpenAI / compatible
  const messages: Array<any> = [{ role: "user", content: req.goal }];
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (cfg.apiKey) headers.authorization = `Bearer ${cfg.apiKey}`;

  while (stepCount < MAX_STEPS) {
    if (signal.aborted) return;
    stepCount++;
    const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
      method: "POST",
      signal,
      headers,
      body: JSON.stringify({
        model: cfg.model,
        messages: [{ role: "system", content: system }, ...messages],
        tools: AGENT_TOOLS_OPENAI
      })
    });
    if (!res.ok) throw await upstreamError(res);
    const data = (await res.json()) as { choices?: Array<{ message?: { role: string; content?: string | null; tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }> } }> };
    const msg = data.choices?.[0]?.message;
    if (!msg) break;

    if (msg.content) yield { type: "thought", text: msg.content.trim() };
    const toolCalls = msg.tool_calls ?? [];
    if (toolCalls.length === 0) {
      yield { type: "done", summary: msg.content ?? "Goal completed successfully.", ok: true };
      return;
    }

    messages.push(msg);

    for (const tc of toolCalls) {
      if (signal.aborted) return;
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(tc.function.arguments);
      } catch {
        args = {};
      }
      const stepId = `step_${Date.now()}_${tc.id}`;
      yield { type: "step", id: stepId, title: `Running ${tc.function.name}...`, tool: tc.function.name, status: "running", input: args };
      const result = await executeAgentTool(tc.function.name, args);
      yield { type: "step", id: stepId, title: result.title, tool: tc.function.name, status: result.ok ? "succeeded" : "failed", output: result.output, error: result.error };
      messages.push({ role: "tool", tool_call_id: tc.id, content: result.output });
    }
  }

  yield { type: "done", summary: "Reached maximum agent step limit (8 steps).", ok: false };
}
