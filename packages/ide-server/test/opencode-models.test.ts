import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import {
  classifyAcpFailure,
  clearModelCooldown,
  detectRateLimitError,
  formatCooldownRemaining,
  getActiveCooldowns,
  handleModelTurnFailure,
  markModelRateLimited,
  markModelSucceeded,
  OPENCODE_AUTO_MODEL,
  rankOpenCodeFreeModels,
  selectBestOpenCodeModels
} from "../src/opencodeModels.js";

const LIVE_11_MODELS = [
  "opencode/beam-free",
  "opencode/big-pickle",
  "opencode/deepseek-v4.1-flash-free",
  "opencode/flint-40b-free",
  "opencode/hy4-flash-free",
  "opencode/iceman-free",
  "opencode/mimo-v2.6-flash-free",
  "opencode/nemotron-3.5-lightning-free",
  "opencode/nemotron-3.5-super-vl-free",
  "opencode/seaglass-alpha-free",
  "opencode/tidepool-alpha-free"
];

const tempDirs: string[] = [];

async function makeTempCooldownFile(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "hardkas-cooldowns-"));
  tempDirs.push(dir);
  return path.join(dir, "opencode-cooldowns.json");
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })));
});

describe("opencodeModels capability ranking & rate-limit recovery", () => {
  it("ranks all live free models from strongest to lightest without truncating", () => {
    const ranked = rankOpenCodeFreeModels(LIVE_11_MODELS);
    assert.equal(ranked.length, 11);
    assert.equal(ranked[0].id, "opencode/beam-free");
    assert.equal(ranked[0].rank, 1);
    assert.equal(ranked[1].id, "opencode/deepseek-v4.1-flash-free");
    assert.equal(ranked[2].id, "opencode/nemotron-3.5-super-vl-free");
    assert.equal(ranked[ranked.length - 1].id, "opencode/nemotron-3.5-lightning-free");
    assert.equal(ranked[ranked.length - 1].rank, 11);
  });

  it("includes unknown newly rotated free models and scores flagship variants higher than flash/lightning", () => {
    const ranked = rankOpenCodeFreeModels([
      ...LIVE_11_MODELS,
      "opencode/qwen4-max-free",
      "opencode/tiny-lightning-free"
    ]);
    assert.equal(ranked.length, 13);
    const maxIdx = ranked.findIndex((m) => m.id === "opencode/qwen4-max-free");
    const lightIdx = ranked.findIndex((m) => m.id === "opencode/tiny-lightning-free");
    assert.ok(maxIdx >= 0 && lightIdx > maxIdx);
  });

  it("extracts rate-limit reset windows from Retry-After, natural phrases, and ISO timestamps", () => {
    const now = Date.parse("2026-11-27T14:00:00.000Z");

    const retryHeader = detectRateLimitError("HTTP 429 Too Many Requests\nRetry-After: 90", now);
    assert.equal(retryHeader.isRateLimit, true);
    assert.equal(retryHeader.retryAfterMs, 90_000);
    assert.equal(retryHeader.retryAt, now + 90_000);

    const phrase = detectRateLimitError("Rate limit exceeded. Try again in 4m 30s.", now);
    assert.equal(phrase.isRateLimit, true);
    assert.equal(phrase.retryAfterMs, 270_000);

    const iso = detectRateLimitError("Free quota reached; resets at 2026-11-27T14:20:00Z", now);
    assert.equal(iso.isRateLimit, true);
    assert.equal(iso.retryAfterMs, 20 * 60_000);

    const nonLimit = detectRateLimitError("SyntaxError: unexpected token in SilverScript source", now);
    assert.equal(nonLimit.isRateLimit, false);
    assert.equal(nonLimit.isTransient, false);

    const transient = classifyAcpFailure("Upstream server temporarily unavailable (503)", now);
    assert.equal(transient.kind, "transient");
    assert.equal(transient.retryAt, undefined);

    const status502 = classifyAcpFailure("HTTP 502 Bad Gateway", now);
    assert.equal(status502.kind, "transient");

    const bareLine429 = classifyAcpFailure("SyntaxError in contracts/Escrow.sil line 429", now);
    assert.equal(bareLine429.kind, "fatal");

    const bareLine503 = classifyAcpFailure("Compiler check failed at line 503 column 12", now);
    assert.equal(bareLine503.kind, "fatal");

    const httpStatus429 = classifyAcpFailure("status code 429", now);
    assert.equal(httpStatus429.kind, "rate_limit");
  });

  it("retries transient hiccups on fallback for that turn without pausing #1 in persistent cooldown", async () => {
    const file = await makeTempCooldownFile();
    const t0 = Date.parse("2026-11-27T14:00:00.000Z");

    const transientOutcome = await handleModelTurnFailure(
      "opencode/beam-free",
      "503 Service temporarily unavailable",
      t0,
      file
    );
    assert.equal(transientOutcome.retryNext, true);
    assert.equal(transientOutcome.transient, true);
    assert.equal(transientOutcome.cooldown, null);
    assert.equal((await getActiveCooldowns(t0 + 1000, file)).length, 0);

    const rateOutcome = await handleModelTurnFailure(
      "opencode/beam-free",
      "HTTP 429 rate limit Retry-After: 60",
      t0,
      file
    );
    assert.equal(rateOutcome.retryNext, true);
    assert.equal(rateOutcome.transient, false);
    assert.ok(rateOutcome.cooldown);
    assert.equal((await getActiveCooldowns(t0 + 1000, file)).length, 1);
  });

  it("falls back down the capability list on rate limit and restores #1 automatically once reset passes", async () => {
    const file = await makeTempCooldownFile();
    const t0 = Date.parse("2026-11-27T14:00:00.000Z");

    // 1. Fresh auto mode chooses #1 beam-free.
    const initial = selectBestOpenCodeModels({
      configuredModel: OPENCODE_AUTO_MODEL,
      availableModels: LIVE_11_MODELS,
      cooldowns: await getActiveCooldowns(t0, file),
      now: t0
    });
    assert.equal(initial.activeModel, "opencode/beam-free");
    assert.equal(initial.usingFallback, false);
    assert.equal(initial.attempts.length, 11);

    // 2. beam-free hits a 429 with 2-minute reset -> automatically promotes #2 deepseek-v4.1-flash-free.
    const cd1 = await markModelRateLimited("opencode/beam-free", "HTTP 429 Retry-After: 120", t0, file);
    assert.ok(cd1);
    assert.equal(formatCooldownRemaining(cd1.retryAt, t0), "2m");

    const whileCooling = selectBestOpenCodeModels({
      configuredModel: OPENCODE_AUTO_MODEL,
      availableModels: LIVE_11_MODELS,
      cooldowns: await getActiveCooldowns(t0 + 30_000, file),
      now: t0 + 30_000
    });
    assert.equal(whileCooling.activeModel, "opencode/deepseek-v4.1-flash-free");
    assert.equal(whileCooling.usingFallback, true);
    assert.equal(whileCooling.attempts.includes("opencode/beam-free"), false);

    // 3. Explicit free model in cooldown also fails over automatically when autoFailover is enabled.
    const explicitCooling = selectBestOpenCodeModels({
      configuredModel: "opencode/beam-free",
      availableModels: LIVE_11_MODELS,
      cooldowns: await getActiveCooldowns(t0 + 30_000, file),
      autoFailover: true,
      now: t0 + 30_000
    });
    assert.equal(explicitCooling.activeModel, "opencode/deepseek-v4.1-flash-free");
    assert.equal(explicitCooling.usingFallback, true);

    // 4. Once reset window elapses (t0 + 121s), cooldown expires cleanly and #1 beam-free is restored!
    const afterResetCooldowns = await getActiveCooldowns(t0 + 121_000, file);
    assert.equal(afterResetCooldowns.length, 0);

    const restored = selectBestOpenCodeModels({
      configuredModel: OPENCODE_AUTO_MODEL,
      availableModels: LIVE_11_MODELS,
      cooldowns: afterResetCooldowns,
      now: t0 + 121_000
    });
    assert.equal(restored.activeModel, "opencode/beam-free");
    assert.equal(restored.usingFallback, false);

    // 5. Explicit paid model stays pinned, and markModelSucceeded / clearModelCooldown work cleanly.
    const paid = selectBestOpenCodeModels({
      configuredModel: "opencode/claude-opus-4-6",
      availableModels: LIVE_11_MODELS,
      cooldowns: [],
      now: t0
    });
    assert.deepEqual(paid.attempts, ["opencode/claude-opus-4-6"]);

    await markModelRateLimited("opencode/iceman-free", "429 rate limit", t0, file);
    assert.equal((await getActiveCooldowns(t0 + 1000, file)).length, 1);
    await markModelSucceeded("opencode/iceman-free", file);
    assert.equal((await getActiveCooldowns(t0 + 1000, file)).length, 0);

    await markModelRateLimited("opencode/big-pickle", "429 rate limit", t0, file);
    await clearModelCooldown(undefined, file);
    assert.equal((await getActiveCooldowns(t0 + 1000, file)).length, 0);
  });
});
