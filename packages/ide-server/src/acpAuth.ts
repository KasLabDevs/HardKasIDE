import { spawn } from "node:child_process";
import crypto from "node:crypto";
import { agentEnv, agentHome, resolveOpenCode } from "./acpAgent.js";
import {
  getActiveCooldowns,
  rankAllOpenCodeModels,
  rankOpenCodeFreeModels,
  type ModelCooldownInfo,
  type RankedOpenCodeModel
} from "./opencodeModels.js";

/**
 * Browser / device OAuth management for HardKas IDE's hosted OpenCode ACP agent.
 *
 * Allows users to sign in to OpenCode and ChatGPT (OpenAI Codex device OAuth) directly
 * from the IDE settings UI without running CLI commands or pasting API keys. Credentials stay
 * inside OpenCode's isolated IDE home (`~/.hardkas-ide/opencode`) and tokens never cross HTTP.
 */

export type AcpAuthTarget = "opencode" | "openai";
export type AcpAuthMethod = "device" | "chatgpt-browser" | "chatgpt-headless";

export interface AuthAccountSummary {
  target: string;
  label: string;
  credentialId?: string;
  method?: string;
}

export interface AuthStatusView {
  installed: boolean;
  accounts: AuthAccountSummary[];
  models: string[];
  rankedFreeModels?: RankedOpenCodeModel[];
  cooldowns?: ModelCooldownInfo[];
}

export interface AuthLoginSessionView {
  id: string;
  target: AcpAuthTarget;
  method: AcpAuthMethod;
  status: "starting" | "pending" | "succeeded" | "failed" | "cancelled";
  url?: string;
  code?: string;
  error?: string;
  startedAt: number;
}

interface InternalLoginSession extends AuthLoginSessionView {
  kill?: () => void;
}

const DEFAULT_METHOD: Record<AcpAuthTarget, AcpAuthMethod> = {
  opencode: "device",
  openai: "chatgpt-browser"
};

const ANSI_RE = /\x1b\[[0-9;?]*[A-Za-z]/g;
const AUTH_SESSION_TTL_MS = 15 * 60 * 1000;
const MODELS_CACHE_TTL_MS = 60 * 1000;

const authSessions = new Map<string, InternalLoginSession>();
let cachedModels: { at: number; items: string[] } | null = null;

export function invalidateAgentModelsCache(): void {
  cachedModels = null;
}

/** Strips ANSI escapes from OpenCode CLI output before extracting user codes or errors. */
export function stripAnsi(text: string): string {
  return text.replace(ANSI_RE, "");
}

/** Extracts verification URL, one-time device code, and any terminal error from `opencode auth login`. */
export function parseDeviceAuthOutput(raw: string): { url?: string; code?: string; error?: string } {
  const clean = stripAnsi(raw);
  const codeMatch = clean.match(/Enter code:\s*([A-Z0-9-]{4,32})/i);
  const urlMatch = clean.match(/https:\/\/[^\s"'<>]+/i);
  const errMatch = clean.match(/^[x✕✖]\s+(.+)$/m);
  return {
    code: codeMatch?.[1]?.trim(),
    url: urlMatch?.[0]?.trim(),
    error: errMatch?.[1]?.trim()
  };
}

function normalizeIntegrationId(raw: unknown): string {
  const s = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (s.includes("openai") || s.includes("chatgpt")) return "openai";
  if (s.includes("opencode")) return "opencode";
  return s;
}

/**
 * Parses `opencode auth list --format json` conservatively and keeps only public display fields.
 * Never returns tokens, cookies, refresh keys, or credential payloads.
 */
export function parseAuthListJson(raw: string): AuthAccountSummary[] {
  const trimmed = stripAnsi(raw).trim();
  if (!trimmed || trimmed === "No authenticated integrations") return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return [];
  }
  const items: unknown[] = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === "object" && Array.isArray((parsed as { data?: unknown[] }).data)
      ? (parsed as { data: unknown[] }).data
      : parsed && typeof parsed === "object" && Array.isArray((parsed as { integrations?: unknown[] }).integrations)
        ? (parsed as { integrations: unknown[] }).integrations
        : [];

  const out: AuthAccountSummary[] = [];
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const target = normalizeIntegrationId(rec.integrationID ?? rec.integrationId ?? rec.provider ?? rec.id ?? rec.target);
    if (!target) continue;
    const label =
      (typeof rec.email === "string" && rec.email.trim()) ||
      (typeof rec.account === "string" && rec.account.trim()) ||
      (typeof rec.label === "string" && rec.label.trim()) ||
      (typeof rec.name === "string" && rec.name.trim()) ||
      target;
    const credentialId =
      typeof rec.credentialID === "string"
        ? rec.credentialID
        : typeof rec.credentialId === "string"
          ? rec.credentialId
          : typeof rec.id === "string" && rec.id !== target
            ? rec.id
            : undefined;
    const method = typeof rec.method === "string" ? rec.method : typeof rec.type === "string" ? rec.type : undefined;
    out.push({ target, label, ...(credentialId ? { credentialId } : {}), ...(method ? { method } : {}) });
  }
  return out;
}

async function runOpenCodeCli(args: string[], timeoutMs = 15_000): Promise<{ code: number | null; stdout: string; stderr: string }> {
  const exe = resolveOpenCode();
  if (!exe) throw new Error("OpenCode CLI is not installed");
  const home = await agentHome();
  const env = agentEnv(home);

  return await new Promise((resolve) => {
    const child = spawn(exe, args, { cwd: home, env, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    child.stdin.end();
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      resolve({ code: null, stdout, stderr: `${stderr}\nTimed out waiting for OpenCode CLI`.trim() });
    }, timeoutMs);
    child.stdout.on("data", (d: Buffer) => (stdout += d.toString("utf8")));
    child.stderr.on("data", (d: Buffer) => (stderr += d.toString("utf8")));
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ code: -1, stdout, stderr: err.message });
    });
  });
}

export async function listAgentModels(force = false): Promise<string[]> {
  if (!force && cachedModels && Date.now() - cachedModels.at < MODELS_CACHE_TTL_MS) return cachedModels.items;
  if (!resolveOpenCode()) return [];
  const res = await runOpenCodeCli(["models", "--standalone"], 15_000);
  if (res.code !== 0) return cachedModels?.items ?? [];
  const raw = stripAnsi(res.stdout)
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => /^[a-z0-9._-]+\/[a-z0-9._:/-]+$/i.test(l));
  const rankedOpenCode = rankAllOpenCodeModels(raw).map((m) => m.id);
  const others = raw.filter((m) => !m.toLowerCase().startsWith("opencode/"));
  const items = [...rankedOpenCode, ...others];
  cachedModels = { at: Date.now(), items };
  return items;
}

export async function getAuthStatus(refreshModels = false): Promise<AuthStatusView> {
  if (!resolveOpenCode()) return { installed: false, accounts: [], models: [], rankedFreeModels: [], cooldowns: [] };
  const [authRes, models, cooldowns] = await Promise.all([
    runOpenCodeCli(["auth", "list", "--format", "json", "--standalone"], 12_000),
    listAgentModels(refreshModels),
    getActiveCooldowns()
  ]);
  return {
    installed: true,
    accounts: authRes.code === 0 ? parseAuthListJson(authRes.stdout) : [],
    models,
    rankedFreeModels: rankOpenCodeFreeModels(models),
    cooldowns
  };
}

function pruneOldSessions(): void {
  const cutoff = Date.now() - AUTH_SESSION_TTL_MS;
  for (const [id, s] of authSessions) {
    if (s.startedAt < cutoff) {
      s.kill?.();
      authSessions.delete(id);
    }
  }
}

function sessionSnapshot(s: InternalLoginSession): AuthLoginSessionView {
  const { kill: _k, ...view } = s;
  return { ...view };
}

export class AuthConflictError extends Error {
  readonly status = 409;
  readonly code = "ALREADY_SIGNED_IN";
}

function targetDisplayName(target: string): string {
  return target === "openai" ? "ChatGPT" : target === "opencode" ? "OpenCode" : target;
}

/** Enforces a single active OAuth account: users must sign out of the current provider before signing into another. */
export function assertCanStartAuthLogin(target: AcpAuthTarget, accounts: AuthAccountSummary[]): void {
  const other = accounts.find((a) => a.target !== target);
  if (other) {
    throw new AuthConflictError(
      `Sign out of ${targetDisplayName(other.target)} first before signing in with ${targetDisplayName(target)}.`
    );
  }
  if (accounts.some((a) => a.target === target)) {
    throw new AuthConflictError(`Already signed in to ${targetDisplayName(target)}. Sign out first to switch accounts.`);
  }
}

export async function startAuthLogin(
  target: AcpAuthTarget,
  requestedMethod?: AcpAuthMethod,
  readStatus: () => Promise<AuthStatusView> = () => getAuthStatus(false)
): Promise<AuthLoginSessionView> {
  pruneOldSessions();
  const current = await readStatus();
  assertCanStartAuthLogin(target, current.accounts);

  const exe = resolveOpenCode();
  if (!exe) throw new Error("OpenCode is not installed on this machine.");

  const method = requestedMethod ?? DEFAULT_METHOD[target];
  for (const existing of authSessions.values()) {
    if (existing.status === "starting" || existing.status === "pending") {
      existing.status = "cancelled";
      existing.kill?.();
    }
  }

  const home = await agentHome();
  const env = agentEnv(home);
  const id = `auth_${crypto.randomBytes(6).toString("hex")}`;
  const session: InternalLoginSession = {
    id,
    target,
    method,
    status: "starting",
    startedAt: Date.now()
  };
  authSessions.set(id, session);

  const child = spawn(exe, ["auth", "login", target, "--method", method, "--standalone"], {
    cwd: home,
    env,
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true
  });
  child.stdin.end();

  let buffer = "";
  let settled = false;
  let notifyReady: (() => void) | null = null;
  const wake = () => {
    notifyReady?.();
    notifyReady = null;
  };

  const timeout = setTimeout(() => {
    if (settled) return;
    session.status = "failed";
    session.error = "Sign-in timed out after 10 minutes.";
    child.kill();
    wake();
  }, 10 * 60 * 1000);
  timeout.unref();

  session.kill = () => {
    clearTimeout(timeout);
    child.kill();
  };

  const ingest = (chunk: Buffer) => {
    buffer += chunk.toString("utf8");
    const parsed = parseDeviceAuthOutput(buffer);
    if (parsed.code) session.code = parsed.code;
    if (parsed.url) session.url = parsed.url;
    if (parsed.error) session.error = parsed.error;
    if (session.status === "starting" && (session.url || session.code)) {
      session.status = "pending";
      wake();
    }
  };

  child.stdout.on("data", ingest);
  child.stderr.on("data", ingest);
  child.on("close", (code) => {
    settled = true;
    clearTimeout(timeout);
    if (session.status === "cancelled") return;
    if (code === 0) {
      session.status = "succeeded";
      invalidateAgentModelsCache();
    } else {
      session.status = "failed";
      const parsed = parseDeviceAuthOutput(buffer);
      session.error = parsed.error ?? session.error ?? `Login exited with code ${code ?? "unknown"}`;
    }
    wake();
  });
  child.on("error", (err) => {
    settled = true;
    clearTimeout(timeout);
    session.status = "failed";
    session.error = err.message;
    wake();
  });

  // Wait briefly so the initial HTTP response already carries the code + login URL in most cases.
  await Promise.race([
    new Promise<void>((r) => (notifyReady = r)),
    new Promise<void>((r) => setTimeout(r, 4000))
  ]);

  return sessionSnapshot(session);
}

export function getAuthSession(id: string): AuthLoginSessionView | null {
  const s = authSessions.get(id);
  return s ? sessionSnapshot(s) : null;
}

export function cancelAuthLogin(id: string): boolean {
  const s = authSessions.get(id);
  if (!s) return false;
  if (s.status === "starting" || s.status === "pending") {
    s.status = "cancelled";
    s.kill?.();
  }
  return true;
}

export async function logoutAuth(target: AcpAuthTarget): Promise<AuthStatusView> {
  const status = await getAuthStatus(false);
  const matching = status.accounts.filter((a) => a.target === target);
  if (matching.length > 0) {
    for (const acct of matching) {
      const args = acct.credentialId ? ["auth", "logout", target, acct.credentialId, "--standalone"] : ["auth", "logout", target, "--standalone"];
      await runOpenCodeCli(args, 12_000);
    }
  } else {
    await runOpenCodeCli(["auth", "logout", target, "--standalone"], 12_000);
  }
  invalidateAgentModelsCache();
  return await getAuthStatus(true);
}

/** Tests an API-key / local OpenAI-compatible or Anthropic connection cleanly from ide-server. */
export async function testApiKeyConnection(opts: {
  provider: "anthropic" | "openai";
  baseUrl: string;
  apiKey: string;
}): Promise<{ ok: boolean; message: string; models?: string[] }> {
  const base = opts.baseUrl.trim().replace(/\/+$/, "");
  if (!/^https?:\/\//.test(base)) return { ok: false, message: "Base URL must start with http:// or https://" };
  const isLocal = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])/.test(base);
  if (!opts.apiKey.trim() && !(opts.provider === "openai" && isLocal)) {
    return {
      ok: false,
      message:
        opts.provider === "anthropic"
          ? "Set ANTHROPIC_API_KEY via terminal command first (then click Refresh or Test)."
          : "Enter an API key first to verify this connection."
    };
  }

  try {
    if (opts.provider === "anthropic") {
      const res = await fetch(`${base}/v1/models`, {
        signal: AbortSignal.timeout(10_000),
        headers: { "x-api-key": opts.apiKey.trim(), "anthropic-version": "2023-06-01" }
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        return { ok: false, message: `Anthropic returned ${res.status}${text ? `: ${text.slice(0, 160)}` : ""}` };
      }
      const data = (await res.json().catch(() => ({}))) as { data?: Array<{ id?: string }> };
      const models = (data.data ?? []).map((m) => m.id).filter((id): id is string => typeof id === "string");
      return { ok: true, message: `Connected to Anthropic${models.length ? ` (${models.length} models)` : ""}`, models };
    }

    const headers: Record<string, string> = {};
    if (opts.apiKey.trim()) headers.authorization = `Bearer ${opts.apiKey.trim()}`;
    const res = await fetch(`${base}/models`, { signal: AbortSignal.timeout(10_000), headers });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { ok: false, message: `Endpoint returned ${res.status}${text ? `: ${text.slice(0, 160)}` : ""}` };
    }
    const data = (await res.json().catch(() => ({}))) as { data?: Array<{ id?: string }> };
    const models = (data.data ?? []).map((m) => m.id).filter((id): id is string => typeof id === "string");
    return { ok: true, message: `Connected${models.length ? ` (${models.length} models available)` : ""}`, models };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
}
