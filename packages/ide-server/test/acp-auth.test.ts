import { after, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const home = mkdtempSync(path.join(os.tmpdir(), "hk-acp-auth-"));
process.env.USERPROFILE = home;
process.env.HOME = home;

const secrets = await import("../src/secrets.ts");
secrets.setSecretStore({
  get: async () => null,
  set: async () => {},
  delete: async () => {}
});

const acpAuth = await import("../src/acpAuth.ts");
const assistant = await import("../src/assistant.ts");

const realFetch = globalThis.fetch;

beforeEach(() => {
  rmSync(path.join(home, ".hardkas-ide"), { recursive: true, force: true });
  globalThis.fetch = realFetch;
});

after(() => {
  globalThis.fetch = realFetch;
  secrets.setSecretStore(null);
  rmSync(home, { recursive: true, force: true });
});

test("parseDeviceAuthOutput extracts OpenAI and OpenCode URLs, codes, and ANSI errors", () => {
  const openaiRaw = [
    "T  Connect an integration",
    "|",
    "•  Starting authorizationo  Authorization started",
    "|",
    "•  Enter code: 5NQA-CSNGT",
    "|",
    "•  https://auth.openai.com/codex/device",
    "|",
    "o  Waiting for authorization..."
  ].join("\n");
  const openai = acpAuth.parseDeviceAuthOutput(openaiRaw);
  assert.equal(openai.code, "5NQA-CSNGT");
  assert.equal(openai.url, "https://auth.openai.com/codex/device");
  assert.equal(openai.error, undefined);

  const browserRaw = [
    "•  Complete authorization in your browser. This window will close automatically.",
    "|",
    "•  https://auth.openai.com/oauth/authorize?response_type=code&client_id=app_test&redirect_uri=http%3A%2F%2Flocalhost%3A1455%2Fauth%2Fcallback&state=abc123",
    "|",
    "o  Waiting for authorization..."
  ].join("\n");
  const browser = acpAuth.parseDeviceAuthOutput(browserRaw);
  assert.equal(browser.code, undefined);
  assert.equal(
    browser.url,
    "https://auth.openai.com/oauth/authorize?response_type=code&client_id=app_test&redirect_uri=http%3A%2F%2Flocalhost%3A1455%2Fauth%2Fcallback&state=abc123"
  );
  assert.equal(browser.error, undefined);

  const errRaw = "\x1b[31mx  Transport: ECONNREFUSED: Unable to connect.\x1b[0m\n";
  const err = acpAuth.parseDeviceAuthOutput(errRaw);
  assert.equal(err.error, "Transport: ECONNREFUSED: Unable to connect.");
});

test("parseAuthListJson extracts safe public summaries and drops secret tokens", () => {
  assert.deepEqual(acpAuth.parseAuthListJson("[]"), []);
  assert.deepEqual(acpAuth.parseAuthListJson("No authenticated integrations"), []);

  const raw = JSON.stringify([
    {
      integrationID: "openai",
      email: "builder@example.com",
      credentialID: "cred_1",
      method: "chatgpt-headless",
      accessToken: "secret-access-token",
      refreshToken: "secret-refresh-token"
    },
    {
      id: "opencode",
      name: "OpenCode Console",
      token: "secret-opencode-token"
    }
  ]);

  const parsed = acpAuth.parseAuthListJson(raw);
  assert.equal(parsed.length, 2);
  assert.deepEqual(parsed[0], {
    target: "openai",
    label: "builder@example.com",
    credentialId: "cred_1",
    method: "chatgpt-headless"
  });
  assert.equal("accessToken" in parsed[0], false);
  assert.equal("refreshToken" in parsed[0], false);
  assert.deepEqual(parsed[1], {
    target: "opencode",
    label: "OpenCode Console"
  });
  assert.equal("token" in parsed[1], false);
});

test("testApiKeyConnection validates inputs and verifies Anthropic and local Ollama endpoints", async () => {
  const badUrl = await acpAuth.testApiKeyConnection({ provider: "anthropic", baseUrl: "ftp://bad", apiKey: "sk-ant-1" });
  assert.equal(badUrl.ok, false);
  assert.match(badUrl.message, /Base URL/);

  const missingKey = await acpAuth.testApiKeyConnection({ provider: "anthropic", baseUrl: "https://api.anthropic.com", apiKey: "" });
  assert.equal(missingKey.ok, false);
  assert.match(missingKey.message, /ANTHROPIC_API_KEY/);

  const calls: Array<{ url: string; headers: HeadersInit | undefined }> = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), headers: init?.headers });
    return new Response(JSON.stringify({ data: [{ id: "claude-sonnet-5-5" }, { id: "claude-opus-5-5" }] }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  }) as typeof fetch;

  const antOk = await acpAuth.testApiKeyConnection({ provider: "anthropic", baseUrl: "https://api.anthropic.com", apiKey: "sk-ant-test" });
  assert.equal(antOk.ok, true);
  assert.match(antOk.message, /2 models/);
  assert.equal(calls[0]?.url, "https://api.anthropic.com/v1/models");

  // Local Ollama endpoint needs no API key.
  const localOk = await acpAuth.testApiKeyConnection({ provider: "openai", baseUrl: "http://localhost:11434/v1", apiKey: "" });
  assert.equal(localOk.ok, true);
  assert.equal(calls[1]?.url, "http://localhost:11434/v1/models");
});

test("saveConfig persists openaiAuthMode oauth cleanly without storing or requiring an API key", async () => {
  await assistant.saveConfig({
    provider: "openai",
    openaiAuthMode: "oauth",
    baseUrl: "https://api.openai.com/v1",
    model: "openai/gpt-5.1-codex"
  });
  const cfg = await assistant.loadConfig();
  assert.equal(cfg.provider, "openai");
  assert.equal(cfg.openaiAuthMode, "oauth");
  assert.equal(cfg.model, "openai/gpt-5.1-codex");
  assert.equal(cfg.apiKey, "");
  assert.doesNotThrow(() => assistant.requireOpenCodeConsent(cfg));

  await assert.rejects(
    assistant.streamChat({ messages: [{ role: "user", content: "hi" }] }, new AbortController().signal).next(),
    (e: unknown) => e instanceof assistant.AssistantError && e.code === "AUTH_REQUIRED"
  );
});

test("ensureAcpReady enforces an explicit openai/... model in ChatGPT OAuth mode and rejects fallback", async () => {
  const signedInOpenAi = async () => ({ accounts: [{ target: "openai" }] });
  const baseCfg = {
    ...assistant.defaultConfig,
    provider: "openai" as const,
    openaiAuthMode: "oauth" as const,
    baseUrl: "https://api.openai.com/v1"
  };

  await assert.rejects(
    assistant.ensureAcpReady({ ...baseCfg, model: "" }, signedInOpenAi),
    (e: unknown) => e instanceof assistant.AssistantError && e.code === "MODEL_REQUIRED"
  );
  await assert.rejects(
    assistant.ensureAcpReady({ ...baseCfg, model: "opencode/big-pickle" }, signedInOpenAi),
    (e: unknown) => e instanceof assistant.AssistantError && e.code === "MODEL_REQUIRED"
  );
  await assert.doesNotReject(assistant.ensureAcpReady({ ...baseCfg, model: "openai/gpt-5.1-codex" }, signedInOpenAi));
});

test("single active account enforcement blocks signing in while logged into another integration", async () => {
  assert.throws(
    () => acpAuth.assertCanStartAuthLogin("openai", [{ target: "opencode", label: "user@opencode" }]),
    (e: unknown) => e instanceof acpAuth.AuthConflictError && e.status === 409 && /Sign out of OpenCode first/.test(e.message)
  );
  assert.throws(
    () => acpAuth.assertCanStartAuthLogin("opencode", [{ target: "openai", label: "user@openai" }]),
    (e: unknown) => e instanceof acpAuth.AuthConflictError && e.status === 409 && /Sign out of ChatGPT first/.test(e.message)
  );
  assert.throws(
    () => acpAuth.assertCanStartAuthLogin("openai", [{ target: "openai", label: "user@openai" }]),
    (e: unknown) => e instanceof acpAuth.AuthConflictError && /Already signed in to ChatGPT/.test(e.message)
  );
  assert.doesNotThrow(() => acpAuth.assertCanStartAuthLogin("openai", []));

  await assert.rejects(
    acpAuth.startAuthLogin("openai", "chatgpt-headless", async () => ({
      installed: true,
      accounts: [{ target: "opencode", label: "active-user" }],
      models: []
    })),
    (e: unknown) => e instanceof acpAuth.AuthConflictError && e.code === "ALREADY_SIGNED_IN"
  );
});
