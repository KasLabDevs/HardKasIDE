import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

// The assistant keeps its settings under ~/.hardkas-ide: point the home at a temp folder before loading it.
const home = mkdtempSync(path.join(os.tmpdir(), "hk-consent-"));
process.env.USERPROFILE = home;
process.env.HOME = home;
const a = await import("../src/assistant.ts");

after(() => rmSync(home, { recursive: true, force: true }));

const ac = () => new AbortController().signal;

test("a fresh install has OpenCode off and a zero-retention default model", async () => {
  const cfg = await a.loadConfig();
  assert.equal(cfg.provider, "opencode");
  assert.equal(cfg.opencodeConsent, false);
  assert.equal(cfg.model, "opencode/deepseek-v4.1-flash-free");
  assert.equal(a.providerDefaults().opencode.model, "opencode/deepseek-v4.1-flash-free");
});

test("chat and agent refuse to reach OpenCode before consent, without starting it", async () => {
  await assert.rejects(a.streamChat({ messages: [{ role: "user", content: "hi" }] } as never, ac()).next(), (e: unknown) => {
    assert.ok(e instanceof a.AssistantError);
    assert.equal(e.code, "CONSENT_REQUIRED");
    assert.equal(e.status, 403);
    return true;
  });
  await assert.rejects(a.streamAgent({ goal: "list files" } as never, ac()).next(), (e: unknown) => e instanceof a.AssistantError && e.code === "CONSENT_REQUIRED");
});

test("requireOpenCodeConsent only blocks the OpenCode provider", () => {
  const base = { ...a.defaultConfig };
  assert.throws(() => a.requireOpenCodeConsent({ ...base, provider: "opencode", opencodeConsent: false }), /OpenCode assistant is off/);
  assert.doesNotThrow(() => a.requireOpenCodeConsent({ ...base, provider: "opencode", opencodeConsent: true }));
  assert.doesNotThrow(() => a.requireOpenCodeConsent({ ...base, provider: "anthropic", opencodeConsent: false }));
  assert.doesNotThrow(() => a.requireOpenCodeConsent({ ...base, provider: "openai", opencodeConsent: false }));
});

test("consent is saved, shown to the browser, and can be withdrawn; non-boolean values are ignored", async () => {
  await a.saveConfig({ opencodeConsent: true });
  const file = JSON.parse(readFileSync(path.join(home, ".hardkas-ide", "assistant.json"), "utf8"));
  assert.equal(file.opencodeConsent, true);
  const view = a.publicConfig(await a.loadConfig());
  assert.equal(view.opencodeConsent, true);
  assert.equal("apiKey" in view, false);

  await a.saveConfig({ opencodeConsent: "yes" as never });
  assert.equal((await a.loadConfig()).opencodeConsent, true);

  await a.saveConfig({ opencodeConsent: false });
  assert.equal((await a.loadConfig()).opencodeConsent, false);
});

test("switching provider keeps the consent answer as it was", async () => {
  await a.saveConfig({ opencodeConsent: true });
  await a.saveConfig({ provider: "openai", baseUrl: "http://localhost:11434/v1", model: "llama3.2" });
  await a.saveConfig({ provider: "opencode" });
  const cfg = await a.loadConfig();
  assert.equal(cfg.provider, "opencode");
  assert.equal(cfg.opencodeConsent, true);
  assert.equal(cfg.model, "opencode/deepseek-v4.1-flash-free");
});
