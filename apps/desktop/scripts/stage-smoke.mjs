/**
 * Smoke test of the staged desktop app (run after `pnpm --filter @hardkas-ide/desktop stage`).
 * It checks what the installer will ship and that it starts, on whatever OS runs it:
 *   - every staged part exists (Node, server, UI, MCP server, OpenCode agent, licences);
 *   - the staged version (VERSION.txt, server and MCP package.json) is the app version in tauri.conf.json;
 *   - the bundled OpenCode binary runs and reports the pinned version;
 *   - the staged Node loads @napi-rs/keyring (a native module) from stage/server/node_modules;
 *   - the staged server starts with the bundled Node and answers the API and the UI;
 *   - the staged MCP server starts with the bundled Node and lists its tools over stdio;
 *   - a fresh install has the OpenCode assistant off until the user turns it on.
 * CI runs it on Windows, macOS and Linux for every pull request, so a platform-only break shows up before a release tag.
 */
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const OPENCODE_VERSION = "2.3.0"; // the version stage.mjs pins

const here = path.dirname(fileURLToPath(import.meta.url));
const stage = path.resolve(here, "..", "src-tauri", "stage");
const win = process.platform === "win32";
const parts = {
  node: path.join(stage, "node", win ? "node.exe" : "node"),
  "node licence": path.join(stage, "node", "LICENSE"),
  server: path.join(stage, "server", "dist", "index.js"),
  ui: path.join(stage, "ui", "index.html"),
  mcp: path.join(stage, "mcp", "dist", "index.js"),
  opencode: path.join(stage, "agents", "opencode", win ? "opencode.exe" : "opencode"),
  "opencode licence": path.join(stage, "agents", "opencode", "LICENSE"),
  "third-party licences": path.join(stage, "THIRD_PARTY_LICENSES.txt"),
  version: path.join(stage, "VERSION.txt")
};

const fail = (msg) => {
  console.error(`✖ ${msg}`);
  process.exitCode = 1;
};
const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));

for (const [name, file] of Object.entries(parts)) {
  if (fs.existsSync(file)) console.log(`✔ staged ${name}: ${path.relative(stage, file)}`);
  else fail(`missing staged ${name}: ${file}`);
}
if (process.exitCode) process.exit(1);

// The installer is labelled with tauri.conf.json's version: what it carries must be that version too.
const appVersion = readJson(path.resolve(here, "..", "src-tauri", "tauri.conf.json")).version;
const stagedVersions = {
  "VERSION.txt": /^HardKas IDE (\S+)$/m.exec(fs.readFileSync(parts.version, "utf8"))?.[1] ?? "(none)",
  "server/package.json": readJson(path.join(stage, "server", "package.json")).version,
  "mcp/package.json": readJson(path.join(stage, "mcp", "package.json")).version
};
const wrong = Object.entries(stagedVersions).filter(([, v]) => v !== appVersion);
if (wrong.length) fail(`staged version differs from tauri.conf.json (${appVersion}): ${wrong.map(([f, v]) => `${f} ${v}`).join(", ")}`);
else console.log(`✔ staged version ${appVersion} matches tauri.conf.json (VERSION.txt, server and MCP package.json)`);

const version = execFileSync(parts.opencode, ["--version"], { encoding: "utf8", timeout: 60_000 }).trim();
// It prints "opencode v2.3.0": one word must be the pinned version, with or without a leading "v".
if (version.split(/\s+/).some((w) => w.replace(/^v/, "") === OPENCODE_VERSION)) console.log(`✔ bundled OpenCode runs: ${version}`);
else fail(`bundled OpenCode reports "${version}", expected ${OPENCODE_VERSION}`);

// @napi-rs/keyring is a native module with a per-platform binding package: load it with the staged Node, from the
// staged server's node_modules only (not from the repository around the stage folder).
try {
  const serverModules = path.join(stage, "server", "node_modules");
  const probe = [
    "const { createRequire } = require('node:module');",
    "const r = createRequire(process.argv[1]);",
    "const k = r('@napi-rs/keyring');",
    "if (typeof k.Entry !== 'function') throw new Error('@napi-rs/keyring has no Entry class');",
    "console.log(r.resolve('@napi-rs/keyring'));"
  ].join("\n");
  const resolved = execFileSync(parts.node, ["-e", probe, path.join(stage, "server", "package.json")], {
    encoding: "utf8",
    timeout: 30_000,
    cwd: path.join(stage, "server")
  }).trim();
  if (!path.resolve(resolved).startsWith(serverModules + path.sep)) throw new Error(`it resolved outside the stage: ${resolved}`);
  console.log(`✔ staged Node loads @napi-rs/keyring from ${path.relative(stage, resolved)}`);
} catch (error) {
  fail(`@napi-rs/keyring does not load from stage/server/node_modules with the staged Node: ${error instanceof Error ? error.message : error}`);
}

/** Starts the staged MCP server on stdio and returns the names of the tools it lists. */
async function mcpTools(ideUrl) {
  const child = spawn(parts.node, [parts.mcp], {
    cwd: path.join(stage, "mcp"),
    env: { ...process.env, HARDKAS_IDE_URL: ideUrl },
    stdio: ["pipe", "pipe", "pipe"]
  });
  let stderr = "";
  child.stderr.on("data", (d) => (stderr += d));
  const replies = new Map();
  let buffer = "";
  let wake = () => {};
  child.stdout.on("data", (d) => {
    buffer += d;
    let nl;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line) continue;
      try {
        const msg = JSON.parse(line);
        if (msg.id !== undefined) replies.set(msg.id, msg);
      } catch {
        // not a JSON-RPC line
      }
      wake();
    }
  });
  const send = (msg) => child.stdin.write(JSON.stringify({ jsonrpc: "2.0", ...msg }) + "\n");
  const reply = async (id) => {
    const deadline = Date.now() + 20_000;
    while (!replies.has(id)) {
      if (child.exitCode !== null) throw new Error(`the MCP server exited (${child.exitCode}): ${stderr.trim()}`);
      if (Date.now() > deadline) throw new Error(`no reply to request ${id} within 20 s: ${stderr.trim()}`);
      await new Promise((r) => {
        wake = r;
        setTimeout(r, 200);
      });
    }
    const msg = replies.get(id);
    if (msg.error) throw new Error(`request ${id}: ${JSON.stringify(msg.error)}`);
    return msg.result;
  };
  try {
    send({ id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "hardkas-ide-stage-smoke", version: "0" } } });
    const init = await reply(1);
    send({ method: "notifications/initialized" });
    send({ id: 2, method: "tools/list", params: {} });
    const list = await reply(2);
    return { server: init?.serverInfo, tools: (list?.tools ?? []).map((t) => t.name) };
  } finally {
    child.kill();
  }
}

const home = fs.mkdtempSync(path.join(os.tmpdir(), "hk-ide-smoke-"));
const workspace = path.join(home, "ws");
fs.mkdirSync(workspace);
// Away from 7420/7421, where a running IDE and its dev UI listen.
const port = String(7430 + Math.floor(Math.random() * 60));
const server = spawn(parts.node, [parts.server], {
  env: {
    ...process.env,
    HARDKAS_IDE_PORT: port,
    HARDKAS_IDE_STATIC: path.join(stage, "ui"),
    HARDKAS_IDE_WORKSPACE: workspace,
    HOME: home,
    USERPROFILE: home
  },
  stdio: ["ignore", "pipe", "pipe"]
});
let log = "";
server.stdout.on("data", (d) => (log += d));
server.stderr.on("data", (d) => (log += d));

const base = `http://127.0.0.1:${port}`;
const get = async (p) => {
  const res = await fetch(base + p, { signal: AbortSignal.timeout(5000) });
  return { status: res.status, text: await res.text() };
};

try {
  let up = false;
  for (let i = 0; i < 60 && !up; i++) {
    try {
      up = (await get("/api/assistant/config")).status === 200;
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  if (!up) throw new Error(`the staged server did not answer on ${base} within 30 s`);
  console.log(`✔ staged server answers on ${base} with the bundled Node`);

  const cfg = JSON.parse((await get("/api/assistant/config")).text);
  if (!cfg.ok) throw new Error(`assistant config: ${JSON.stringify(cfg)}`);
  if (cfg.config.provider !== "opencode" || cfg.config.opencodeConsent !== false) {
    throw new Error(`a fresh install must have OpenCode as the provider and turned off: ${JSON.stringify(cfg.config)}`);
  }
  console.log(`✔ fresh install: assistant is OpenCode (${cfg.config.model}) and off until the user turns it on`);

  const page = await get("/");
  if (page.status !== 200 || !/<html/i.test(page.text)) throw new Error(`UI: HTTP ${page.status}`);
  console.log("✔ staged UI is served");

  try {
    const mcp = await mcpTools(base);
    if (mcp.tools.length === 0) throw new Error("it listed no tools");
    console.log(`✔ staged MCP server (${mcp.server?.name ?? "?"} ${mcp.server?.version ?? "?"}) answers over stdio with ${mcp.tools.length} tools: ${mcp.tools.slice(0, 4).join(", ")}, …`);
  } catch (error) {
    fail(`the staged MCP server: ${error instanceof Error ? error.message : String(error)}`);
  }
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
  console.error("--- server output ---\n" + log);
} finally {
  server.kill();
  await new Promise((r) => setTimeout(r, 500));
  fs.rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
