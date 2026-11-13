import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

// Settings under a temp home, keys in an in-memory store: these tests never touch the real credential store.
const home = mkdtempSync(path.join(os.tmpdir(), "hk-keys-"));
process.env.USERPROFILE = home;
process.env.HOME = home;
const saved = { ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY, OPENAI_API_KEY: process.env.OPENAI_API_KEY };
delete process.env.ANTHROPIC_API_KEY;
delete process.env.OPENAI_API_KEY;

const secrets = await import("../src/secrets.ts");
const a = await import("../src/assistant.ts");

const memory = new Map<string, string>();
let broken = false;
secrets.setSecretStore({
  async get(k) {
    if (broken) throw new Error("no secret service");
    return memory.get(k) ?? null;
  },
  async set(k, v) {
    if (broken) throw new Error("no secret service");
    memory.set(k, v);
  },
  async delete(k) {
    if (broken) throw new Error("no secret service");
    memory.delete(k);
  }
});

const file = path.join(home, ".hardkas-ide", "assistant.json");
const readFile = () => JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
const FAKE_ANT = "sk-ant-fake-0000000000000000000000000000abcd";
const FAKE_OAI = "sk-fake-1111111111111111111111111111wxyz";

beforeEach(() => {
  memory.clear();
  broken = false;
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.OPENAI_API_KEY;
  rmSync(path.join(home, ".hardkas-ide"), { recursive: true, force: true });
});

after(() => {
  secrets.setSecretStore(null);
  for (const [k, v] of Object.entries(saved)) if (v === undefined) delete process.env[k];
  else process.env[k] = v;
  rmSync(home, { recursive: true, force: true });
});

test("a key typed in the settings goes to the credential store, never into the file", async () => {
  await a.saveConfig({ provider: "anthropic", apiKey: `  ${FAKE_ANT}  ` });
  assert.equal(memory.get("anthropic-api-key"), FAKE_ANT);
  const onDisk = readFileSync(file, "utf8");
  assert.equal(onDisk.includes("sk-ant"), false);
  assert.equal("apiKey" in readFile(), false);
  assert.equal("keySource" in readFile(), false);

  const cfg = await a.loadConfig();
  assert.equal(cfg.apiKey, FAKE_ANT);
  assert.equal(cfg.keySource, "keychain");
  const view = a.publicConfig(cfg);
  assert.equal("apiKey" in view, false);
  assert.equal(view.hasKey, true);
  assert.equal(view.keyHint, "…abcd");
  assert.equal(view.keySource, "keychain");
});

test("each provider keeps its own key", async () => {
  await a.saveConfig({ provider: "anthropic", apiKey: FAKE_ANT });
  await a.saveConfig({ provider: "openai", baseUrl: "https://api.openai.com/v1", model: "gpt-x", apiKey: FAKE_OAI });
  assert.equal(memory.get("anthropic-api-key"), FAKE_ANT);
  assert.equal(memory.get("openai-api-key"), FAKE_OAI);
  assert.equal((await a.loadConfig()).apiKey, FAKE_OAI);
  await a.saveConfig({ provider: "anthropic" });
  assert.equal((await a.loadConfig()).apiKey, FAKE_ANT);
});

test("the environment variable wins over the stored key", async () => {
  await a.saveConfig({ provider: "anthropic", apiKey: FAKE_ANT });
  process.env.ANTHROPIC_API_KEY = "sk-ant-from-env-9999";
  const cfg = await a.loadConfig();
  assert.equal(cfg.apiKey, "sk-ant-from-env-9999");
  assert.equal(cfg.keySource, "env");
});

test("a key left in assistant.json by an earlier version moves to the store and leaves the file", async () => {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify({ provider: "anthropic", model: "claude-sonnet-5-5", apiKey: FAKE_ANT, docs: "core" }), "utf8");
  const cfg = await a.loadConfig();
  assert.equal(cfg.keySource, "keychain");
  assert.equal(cfg.apiKey, FAKE_ANT);
  assert.equal(memory.get("anthropic-api-key"), FAKE_ANT);
  assert.equal("apiKey" in readFile(), false);
  assert.equal(readFile().model, "claude-sonnet-5-5");
});

test("an old key saved while OpenCode was selected goes to the provider its prefix names", async () => {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify({ provider: "opencode", apiKey: FAKE_OAI }), "utf8");
  await a.loadConfig();
  assert.equal(memory.get("openai-api-key"), FAKE_OAI);
  assert.equal("apiKey" in readFile(), false);
});

test("without a credential store an old key stays in the file and keeps working, and is not lost on save", async () => {
  broken = true;
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify({ provider: "anthropic", apiKey: FAKE_ANT }), "utf8");
  const cfg = await a.loadConfig();
  assert.equal(cfg.keySource, "file");
  assert.equal(cfg.apiKey, FAKE_ANT);
  await a.saveConfig({ docs: "off" });
  assert.equal(readFile().apiKey, FAKE_ANT);
  assert.equal(readFile().docs, "off");
});

test("without a credential store a new key is refused with a pointer to the variable, and nothing is written", async () => {
  broken = true;
  await assert.rejects(a.saveConfig({ provider: "anthropic", apiKey: FAKE_ANT }), /ANTHROPIC_API_KEY/);
  assert.equal(existsSync(file) ? readFileSync(file, "utf8").includes("sk-ant") : false, false);
});

test("remove key deletes it from the store, and removes a key that could only stay in the file", async () => {
  await a.saveConfig({ provider: "anthropic", apiKey: FAKE_ANT });
  await a.saveConfig({ clearKey: true });
  assert.equal(memory.has("anthropic-api-key"), false);
  assert.equal((await a.loadConfig()).keySource, null);

  broken = true;
  writeFileSync(file, JSON.stringify({ provider: "anthropic", apiKey: FAKE_ANT }), "utf8");
  await a.saveConfig({ clearKey: true });
  assert.equal("apiKey" in readFile(), false);
  assert.equal((await a.loadConfig()).hasOwnProperty("apiKey") && (await a.loadConfig()).apiKey, "");
});

test("OpenCode needs no key and never reads the store", async () => {
  let reads = 0;
  secrets.setSecretStore({
    async get() {
      reads++;
      return null;
    },
    async set() {},
    async delete() {}
  });
  const cfg = await a.loadConfig();
  assert.equal(cfg.provider, "opencode");
  assert.equal(cfg.keySource, null);
  assert.equal(reads, 0);
  secrets.setSecretStore({
    async get(k) {
      return memory.get(k) ?? null;
    },
    async set(k, v) {
      memory.set(k, v);
    },
    async delete(k) {
      memory.delete(k);
    }
  });
});
