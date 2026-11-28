import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Capability ranking, rate-limit cooldown tracking, and automatic best-model selection for OpenCode hosted free models.
 *
 * `opencode models --standalone` returns free models sorted alphabetically, not by capability. This module:
 *   1. Ranks all available free OpenCode models from strongest coding/reasoning capability to lightest/fastest,
 *      keeping any newly rotated `opencode/*-free` models rather than truncating the list.
 *   2. Parses provider rate-limit / quota / retry-after errors to track when each limited model resets.
 *   3. Picks the highest-capability non-cooled-down model (used by `opencode/auto` and pre-first-byte failover),
 *      automatically restoring top models as soon as their cooldown reset passes.
 */

export const OPENCODE_AUTO_MODEL = "opencode/auto";

export type ModelTier = "frontier" | "strong" | "balanced" | "fast";

export interface RankedOpenCodeModel {
  id: string;
  shortId: string;
  name: string;
  rank: number;
  tier: ModelTier;
  contextWindow?: number;
  outputLimit?: number;
  summary: string;
  free: boolean;
}

export interface ModelCooldownInfo {
  model: string;
  limitedAt: number;
  retryAt: number;
  reason: string;
}

interface CatalogSpec {
  id: string;
  name: string;
  tier: ModelTier;
  score: number;
  contextWindow?: number;
  outputLimit?: number;
  summary: string;
}

// Ordered best -> worst coding & agentic capability using OpenCode / models.dev specs.
const CURATED_FREE_SPECS: readonly CatalogSpec[] = [
  {
    id: "opencode/beam-free",
    name: "Beam Free",
    tier: "frontier",
    score: 1000,
    contextWindow: 1_048_576,
    outputLimit: 131_072,
    summary: "501B MoE flagship · 1M context · strongest overall coding & agentic reasoning"
  },
  {
    id: "opencode/deepseek-v4.1-flash-free",
    name: "DeepSeek V4.1 Flash Free",
    tier: "frontier",
    score: 960,
    contextWindow: 200_000,
    outputLimit: 32_000,
    summary: "DeepSeek V4.1 MoE · strong coding, SilverScript & tool use"
  },
  {
    id: "opencode/nemotron-3.5-super-vl-free",
    name: "Nemotron 3.5 Super VL Free",
    tier: "frontier",
    score: 920,
    contextWindow: 1_048_576,
    outputLimit: 131_072,
    summary: "NVIDIA Nemotron 3.5 Super · 1M context · agentic & multimodal"
  },
  {
    id: "opencode/mimo-v2.6-flash-free",
    name: "MiMo-V2.6-Flash Free",
    tier: "strong",
    score: 880,
    contextWindow: 200_000,
    outputLimit: 32_000,
    summary: "Xiaomi 309B MoE · strong software engineering & reasoning"
  },
  {
    id: "opencode/seaglass-alpha-free",
    name: "Seaglass Alpha Free",
    tier: "strong",
    score: 840,
    contextWindow: 1_048_576,
    outputLimit: 131_072,
    summary: "1M context frontier stealth alpha · high output reasoning"
  },
  {
    id: "opencode/iceman-free",
    name: "Iceman Free",
    tier: "strong",
    score: 800,
    contextWindow: 262_144,
    outputLimit: 131_072,
    summary: "262K context · strong structured reasoning & code generation"
  },
  {
    id: "opencode/big-pickle",
    name: "Big Pickle",
    tier: "balanced",
    score: 760,
    contextWindow: 200_000,
    outputLimit: 32_000,
    summary: "200K context · dependable Zen generalist coding model"
  },
  {
    id: "opencode/tidepool-alpha-free",
    name: "Tidepool Alpha Free",
    tier: "balanced",
    score: 720,
    contextWindow: 1_048_576,
    outputLimit: 131_072,
    summary: "1M context stealth preview · general coding & analysis"
  },
  {
    id: "opencode/flint-40b-free",
    name: "Flint 40B Free",
    tier: "balanced",
    score: 680,
    contextWindow: 262_144,
    outputLimit: 65_536,
    summary: "40B MoE coding model · compact & responsive"
  },
  {
    id: "opencode/hy4-flash-free",
    name: "Hy4 Flash Free",
    tier: "fast",
    score: 640,
    contextWindow: 1_048_576,
    outputLimit: 65_536,
    summary: "Hunyuan 4 Flash · 1M context · fast high-throughput responses"
  },
  {
    id: "opencode/nemotron-3.5-lightning-free",
    name: "Nemotron 3.5 Lightning Free",
    tier: "fast",
    score: 600,
    contextWindow: 262_144,
    outputLimit: 262_144,
    summary: "Fast lightweight Nemotron variant · lowest latency fallback"
  }
];

const CURATED_BY_ID = new Map(CURATED_FREE_SPECS.map((s) => [s.id.toLowerCase(), s]));

export function isFreeOpenCodeModel(modelId: string): boolean {
  const id = modelId.trim().toLowerCase();
  if (!id.startsWith("opencode/") || id === OPENCODE_AUTO_MODEL) return false;
  return id.endsWith("-free") || id === "opencode/big-pickle" || CURATED_BY_ID.has(id);
}

function formatFallbackName(shortId: string): string {
  return shortId
    .split("-")
    .map((part) => (part ? part[0].toUpperCase() + part.slice(1) : ""))
    .join(" ");
}

function heuristicSpec(id: string): { score: number; tier: ModelTier; summary: string } {
  const lower = id.toLowerCase();
  let score = 700;
  if (/pro|max|opus|ultra|super|beam|deepseek-v4/.test(lower)) score += 160;
  if (/alpha|v4\.1|v3\.5|k2\.5|k3|m3/.test(lower)) score += 50;
  if (/1t|501b|400b|309b/.test(lower)) score += 90;
  if (/40b|70b|mini|small/.test(lower)) score -= 70;
  if (/flash|lightning|lite|nano|fast/.test(lower)) score -= 110;
  const tier: ModelTier = score >= 880 ? "frontier" : score >= 780 ? "strong" : score >= 660 ? "balanced" : "fast";
  return { score, tier, summary: "OpenCode Zen free model (auto-scored by capability tier)" };
}

/**
 * Ranks all available OpenCode free models from highest to lowest capability.
 * Never truncates the list: newly rotated `opencode/*-free` models are scored and included automatically.
 */
export function rankOpenCodeFreeModels(rawModels: string[] = []): RankedOpenCodeModel[] {
  const seen = new Set<string>();
  const collected: Array<{ id: string; spec: CatalogSpec }> = [];

  const liveFree = rawModels
    .map((m) => m.trim())
    .filter((m) => isFreeOpenCodeModel(m));

  const source = liveFree.length > 0 ? liveFree : CURATED_FREE_SPECS.map((s) => s.id);
  for (const id of source) {
    const key = id.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const curated = CURATED_BY_ID.get(key);
    if (curated) {
      collected.push({ id, spec: curated });
    } else {
      const shortId = id.slice("opencode/".length);
      const h = heuristicSpec(id);
      collected.push({
        id,
        spec: {
          id,
          name: formatFallbackName(shortId),
          tier: h.tier,
          score: h.score,
          summary: h.summary
        }
      });
    }
  }

  collected.sort((a, b) => b.spec.score - a.spec.score || a.id.localeCompare(b.id));

  return collected.map(({ id, spec }, idx) => ({
    id,
    shortId: id.slice("opencode/".length),
    name: spec.name,
    rank: idx + 1,
    tier: spec.tier,
    ...(spec.contextWindow ? { contextWindow: spec.contextWindow } : {}),
    ...(spec.outputLimit ? { outputLimit: spec.outputLimit } : {}),
    summary: spec.summary,
    free: true
  }));
}

/** Lists all `opencode/*` models: free models first (best -> worst), followed by any paid/account OpenCode models. */
export function rankAllOpenCodeModels(rawModels: string[] = []): RankedOpenCodeModel[] {
  const freeRanked = rankOpenCodeFreeModels(rawModels);
  const seen = new Set(freeRanked.map((m) => m.id.toLowerCase()));
  const extra: RankedOpenCodeModel[] = [];

  for (const raw of rawModels) {
    const id = raw.trim();
    const key = id.toLowerCase();
    if (!key.startsWith("opencode/") || key === OPENCODE_AUTO_MODEL || seen.has(key)) continue;
    seen.add(key);
    const shortId = id.slice("opencode/".length);
    extra.push({
      id,
      shortId,
      name: formatFallbackName(shortId),
      rank: freeRanked.length + extra.length + 1,
      tier: "frontier",
      summary: "OpenCode account model",
      free: false
    });
  }

  return [...freeRanked, ...extra];
}

// ---------------------------------------------------------------- rate-limit parsing & cooldown persistence

const MIN_COOLDOWN_MS = 15_000;
const MAX_COOLDOWN_MS = 24 * 60 * 60_000;
const DEFAULT_RATE_LIMIT_COOLDOWN_MS = 3 * 60_000;
const DEFAULT_QUOTA_COOLDOWN_MS = 15 * 60_000;
const DEFAULT_DAILY_COOLDOWN_MS = 60 * 60_000;

function defaultCooldownFile(): string {
  return path.join(os.homedir(), ".hardkas-ide", "opencode-cooldowns.json");
}

function clampCooldown(ms: number): number {
  return Math.max(MIN_COOLDOWN_MS, Math.min(MAX_COOLDOWN_MS, Math.round(ms)));
}

function parseDurationUnitMs(amount: number, unit: string): number {
  const u = unit.toLowerCase();
  if (u.startsWith("ms")) return amount;
  if (u.startsWith("d")) return amount * 24 * 60 * 60_000;
  if (u.startsWith("h")) return amount * 60 * 60_000;
  if (u.startsWith("m")) return amount * 60_000;
  return amount * 1000;
}

export type AcpFailureKind = "rate_limit" | "transient" | "fatal";

export interface ClassifiedAcpFailure {
  kind: AcpFailureKind;
  retryAt?: number;
  retryAfterMs?: number;
  reason: string;
}

/**
 * Classifies an agent/provider failure into:
 *   - `rate_limit`: hard 429/quota/reset signal — records a timed cooldown until `retryAt`.
 *   - `transient`: temporary upstream glitch (`temporarily unavailable`, 502/503/504, `overloaded`) — retried
 *     immediately on fallback for the current turn without putting the top model into multi-minute cooldown.
 *   - `fatal`: non-retryable failure (auth, bad input, syntax, etc.).
 */
const HTTP_429_RE =
  /(?:http(?:\s+status)?|status(?:\s+code)?)\s*[:=]?\s*429\b|\b429\s+too\s+many\s+requests\b/i;
const HTTP_5XX_RE =
  /(?:http(?:\s+status)?|status(?:\s+code)?)\s*[:=]?\s*(?:502|503|504)\b|\b(?:502\s+bad\s+gateway|503\s+service\s+(?:temporarily\s+)?unavailable|504\s+gateway\s+timeout)\b/i;

export function classifyAcpFailure(errorText: string, now = Date.now()): ClassifiedAcpFailure {
  const clean = errorText.trim();
  const hasExplicitRateSignal =
    HTTP_429_RE.test(clean) ||
    /rate[\s_-]*limit|too many requests|requests? per (?:min|minute|hour|day)|tokens? per (?:min|minute)/i.test(clean) ||
    /quota\b.*(?:exceeded|exhausted|limit|reached)|limit(?:s)?\s+(?:exceeded|reached)|out of (?:credits?|quota)|insufficient[_\s-]quota/i.test(clean) ||
    /retry[\s_-]*after|try again in\b|resets?\s+(?:in|at)\b/i.test(clean);

  const hasTransientSignal =
    /overloaded|high demand|temporarily unavailable|service unavailable|bad gateway|gateway timeout|econnreset|etimedout/i.test(clean) ||
    HTTP_5XX_RE.test(clean);

  if (!hasExplicitRateSignal) {
    if (hasTransientSignal) {
      return { kind: "transient", reason: "Temporary upstream availability issue" };
    }
    return { kind: "fatal", reason: "" };
  }

  // 1) Explicit ISO timestamp (e.g. "resets at 2026-11-27T15:30:00Z")
  const isoMatch = clean.match(/\b(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?)\b/);
  if (isoMatch) {
    const parsed = Date.parse(isoMatch[1]);
    if (Number.isFinite(parsed) && parsed > now) {
      const ms = clampCooldown(parsed - now);
      return { kind: "rate_limit", retryAt: now + ms, retryAfterMs: ms, reason: summarizeRateLimitReason(clean) };
    }
  }

  // 2) Epoch reset header/timestamp (seconds or ms)
  const epochMatch = clean.match(/(?:x-ratelimit-reset|reset[_\s-]*at|retry[_\s-]*at)\s*[:=]\s*(\d{10,13})\b/i);
  if (epochMatch) {
    const rawEpoch = Number(epochMatch[1]);
    const epochMs = epochMatch[1].length <= 10 ? rawEpoch * 1000 : rawEpoch;
    if (Number.isFinite(epochMs) && epochMs > now) {
      const ms = clampCooldown(epochMs - now);
      return { kind: "rate_limit", retryAt: now + ms, retryAfterMs: ms, reason: summarizeRateLimitReason(clean) };
    }
  }

  // 3) Compound phrase: "try again in 1h 20m 5s" / "resets in 4m 30s" / "wait 90 seconds"
  const compoundMatch = clean.match(
    /(?:try again|resets?|available|wait|cooldown|retry)\s+(?:in\s+|for\s+)?(?:(\d+)\s*(?:days?|d)\s*)?(?:(\d+)\s*(?:hours?|hrs?|h)\s*)?(?:(\d+)\s*(?:minutes?|mins?|m)\s*)?(?:(\d+(?:\.\d+)?)\s*(?:seconds?|secs?|s))?/i
  );
  if (compoundMatch && (compoundMatch[1] || compoundMatch[2] || compoundMatch[3] || compoundMatch[4])) {
    const totalMs =
      Number(compoundMatch[1] ?? 0) * 24 * 60 * 60_000 +
      Number(compoundMatch[2] ?? 0) * 60 * 60_000 +
      Number(compoundMatch[3] ?? 0) * 60_000 +
      Number(compoundMatch[4] ?? 0) * 1000;
    if (totalMs > 0) {
      const ms = clampCooldown(totalMs);
      return { kind: "rate_limit", retryAt: now + ms, retryAfterMs: ms, reason: summarizeRateLimitReason(clean) };
    }
  }

  // 4) Header-like `Retry-After: 120` or `retry-after=45s`
  const retryHeader = clean.match(/retry[\s_-]*after\s*[:=]\s*(\d+(?:\.\d+)?)\s*(ms|s|sec|seconds|m|min|minutes|h|hr|hours|d|days)?\b/i);
  if (retryHeader) {
    const val = Number(retryHeader[1]);
    const ms = clampCooldown(parseDurationUnitMs(val, retryHeader[2] ?? "s"));
    return { kind: "rate_limit", retryAt: now + ms, retryAfterMs: ms, reason: summarizeRateLimitReason(clean) };
  }

  // 5) Sensible default window based on rate-limit error class when upstream omits reset time
  const defaultMs = /daily|per day/i.test(clean)
    ? DEFAULT_DAILY_COOLDOWN_MS
    : /quota|hourly|per hour/i.test(clean)
      ? DEFAULT_QUOTA_COOLDOWN_MS
      : DEFAULT_RATE_LIMIT_COOLDOWN_MS;

  return { kind: "rate_limit", retryAt: now + defaultMs, retryAfterMs: defaultMs, reason: summarizeRateLimitReason(clean) };
}

/**
 * Backwards-compatible wrapper over `classifyAcpFailure` indicating hard rate-limit/quota cooldown vs transient issues.
 */
export function detectRateLimitError(
  errorText: string,
  now = Date.now()
): { isRateLimit: boolean; isTransient: boolean; retryAt?: number; retryAfterMs?: number; reason: string } {
  const c = classifyAcpFailure(errorText, now);
  return {
    isRateLimit: c.kind === "rate_limit",
    isTransient: c.kind === "transient",
    ...(c.retryAt !== undefined ? { retryAt: c.retryAt } : {}),
    ...(c.retryAfterMs !== undefined ? { retryAfterMs: c.retryAfterMs } : {}),
    reason: c.reason
  };
}

function summarizeRateLimitReason(clean: string): string {
  if (/quota|credit/i.test(clean)) return "Free quota reached";
  return "Rate limited (429)";
}

async function readCooldownMap(file = defaultCooldownFile(), now = Date.now()): Promise<Map<string, ModelCooldownInfo>> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await fs.readFile(file, "utf8"));
  } catch {
    return new Map();
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return new Map();

  const out = new Map<string, ModelCooldownInfo>();
  let pruned = false;
  for (const [key, val] of Object.entries(parsed as Record<string, unknown>)) {
    if (!val || typeof val !== "object") {
      pruned = true;
      continue;
    }
    const rec = val as Record<string, unknown>;
    const retryAt = Number(rec.retryAt);
    const limitedAt = Number(rec.limitedAt);
    const model = typeof rec.model === "string" && rec.model ? rec.model : key;
    if (!Number.isFinite(retryAt) || retryAt <= now) {
      pruned = true;
      continue;
    }
    out.set(model.toLowerCase(), {
      model,
      limitedAt: Number.isFinite(limitedAt) ? limitedAt : now,
      retryAt,
      reason: typeof rec.reason === "string" && rec.reason ? rec.reason : "Rate limited"
    });
  }

  if (pruned) {
    await writeCooldownMap(out, file).catch(() => undefined);
  }
  return out;
}

async function writeCooldownMap(map: Map<string, ModelCooldownInfo>, file = defaultCooldownFile()): Promise<void> {
  const obj: Record<string, ModelCooldownInfo> = {};
  for (const info of map.values()) {
    obj[info.model] = info;
  }
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(obj, null, 2), "utf8");
}

export async function getActiveCooldowns(now = Date.now(), file = defaultCooldownFile()): Promise<ModelCooldownInfo[]> {
  const map = await readCooldownMap(file, now);
  return [...map.values()].sort((a, b) => a.retryAt - b.retryAt);
}

export async function markModelRateLimited(
  model: string,
  errorText: string,
  now = Date.now(),
  file = defaultCooldownFile()
): Promise<ModelCooldownInfo | null> {
  const detected = detectRateLimitError(errorText, now);
  if (!detected.isRateLimit || !detected.retryAt) return null;
  const map = await readCooldownMap(file, now);
  const info: ModelCooldownInfo = {
    model,
    limitedAt: now,
    retryAt: detected.retryAt,
    reason: detected.reason
  };
  map.set(model.toLowerCase(), info);
  await writeCooldownMap(map, file);
  return info;
}

export async function handleModelTurnFailure(
  model: string,
  errorText: string,
  now = Date.now(),
  file = defaultCooldownFile()
): Promise<{ retryNext: boolean; cooldown: ModelCooldownInfo | null; transient: boolean; reason: string }> {
  const classified = classifyAcpFailure(errorText, now);
  if (classified.kind === "rate_limit" && classified.retryAt) {
    const map = await readCooldownMap(file, now);
    const info: ModelCooldownInfo = {
      model,
      limitedAt: now,
      retryAt: classified.retryAt,
      reason: classified.reason
    };
    map.set(model.toLowerCase(), info);
    await writeCooldownMap(map, file);
    return { retryNext: true, cooldown: info, transient: false, reason: classified.reason };
  }
  if (classified.kind === "transient") {
    return { retryNext: true, cooldown: null, transient: true, reason: classified.reason };
  }
  return { retryNext: false, cooldown: null, transient: false, reason: classified.reason };
}

export async function markModelSucceeded(model: string, file = defaultCooldownFile()): Promise<void> {
  if (!model || model === OPENCODE_AUTO_MODEL) return;
  const map = await readCooldownMap(file);
  if (map.delete(model.toLowerCase())) {
    await writeCooldownMap(map, file).catch(() => undefined);
  }
}

export async function clearModelCooldown(model?: string, file = defaultCooldownFile()): Promise<void> {
  if (!model) {
    await writeCooldownMap(new Map(), file).catch(() => undefined);
    return;
  }
  const map = await readCooldownMap(file);
  if (map.delete(model.toLowerCase())) {
    await writeCooldownMap(map, file).catch(() => undefined);
  }
}

export function formatCooldownRemaining(retryAt: number, now = Date.now()): string {
  const sec = Math.max(0, Math.ceil((retryAt - now) / 1000));
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  if (m < 60) return s > 0 ? `${m}m ${s}s` : `${m}m`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return rm > 0 ? `${h}h ${rm}m` : `${h}h`;
}

export interface OpenCodeSelectionResult {
  /** Best non-cooled-down model (or the preferred model if ready). */
  activeModel: string;
  /** Ordered list of candidate models to try for this turn (best available -> fallbacks). */
  attempts: string[];
  /** Full free-model catalog sorted best -> worst capability. */
  rankedFreeModels: RankedOpenCodeModel[];
  /** Currently active cooldowns (not yet reset). */
  cooldowns: ModelCooldownInfo[];
  /** True when the preferred/top capability model is currently in cooldown so a fallback is active. */
  usingFallback: boolean;
}

/**
 * Selects the ordered candidate models for an OpenCode turn:
 *   - `opencode/auto` picks the highest-capability free model whose cooldown has expired (and automatically
 *     restores #1 as soon as its reset time elapses).
 *   - An explicit free model starts with that choice if ready, with lower-ranked non-cooled-down free models as
 *     automatic fallbacks if it hits a rate limit (or promotes the best ready model while preferred is cooling down).
 *   - An explicit paid/account OpenCode model (`!isFreeOpenCodeModel`) stays pinned with no free-model fallback.
 */
export function selectBestOpenCodeModels(opts: {
  configuredModel: string;
  availableModels: string[];
  cooldowns: ModelCooldownInfo[];
  autoFailover?: boolean;
  now?: number;
}): OpenCodeSelectionResult {
  const now = opts.now ?? Date.now();
  const configured = opts.configuredModel.trim();
  const rankedFreeModels = rankOpenCodeFreeModels(opts.availableModels);
  const activeCooldowns = opts.cooldowns.filter((c) => c.retryAt > now);
  const cooledByKey = new Map(activeCooldowns.map((c) => [c.model.toLowerCase(), c]));

  if (configured && configured !== OPENCODE_AUTO_MODEL && !isFreeOpenCodeModel(configured)) {
    return {
      activeModel: configured,
      attempts: [configured],
      rankedFreeModels,
      cooldowns: activeCooldowns,
      usingFallback: false
    };
  }

  const readyFree = rankedFreeModels.filter((m) => !cooledByKey.has(m.id.toLowerCase())).map((m) => m.id);
  const coolingSorted = rankedFreeModels
    .filter((m) => cooledByKey.has(m.id.toLowerCase()))
    .sort((a, b) => (cooledByKey.get(a.id.toLowerCase())?.retryAt ?? 0) - (cooledByKey.get(b.id.toLowerCase())?.retryAt ?? 0))
    .map((m) => m.id);

  const orderedPool = readyFree.length > 0 ? readyFree : coolingSorted;
  const allowFallback = opts.autoFailover !== false || configured === OPENCODE_AUTO_MODEL || !configured;

  if (!configured || configured === OPENCODE_AUTO_MODEL) {
    const topId = rankedFreeModels[0]?.id ?? "";
    const activeModel = orderedPool[0] ?? topId;
    return {
      activeModel,
      attempts: orderedPool,
      rankedFreeModels,
      cooldowns: activeCooldowns,
      usingFallback: Boolean(topId && activeModel && activeModel.toLowerCase() !== topId.toLowerCase())
    };
  }

  const preferredIsCooling = cooledByKey.has(configured.toLowerCase());
  let attempts: string[];
  if (!preferredIsCooling) {
    const others = allowFallback ? orderedPool.filter((id) => id.toLowerCase() !== configured.toLowerCase()) : [];
    attempts = [configured, ...others];
  } else if (allowFallback) {
    // Preferred model is rate-limited right now: immediately use the highest-capability available free model.
    attempts = orderedPool.length > 0 ? orderedPool : [configured];
  } else {
    attempts = [configured];
  }

  return {
    activeModel: attempts[0] ?? configured,
    attempts,
    rankedFreeModels,
    cooldowns: activeCooldowns,
    usingFallback: Boolean(attempts[0] && attempts[0].toLowerCase() !== configured.toLowerCase())
  };
}
