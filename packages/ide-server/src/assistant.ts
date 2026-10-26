import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

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
