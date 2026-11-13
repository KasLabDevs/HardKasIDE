/**
 * Smoke test of the staged desktop app (run after `pnpm --filter @hardkas-ide/desktop stage`).
 * It checks what the installer will ship and that it starts, on whatever OS runs it:
 *   - every staged part exists (Node, server, UI, MCP server, OpenCode agent);
 *   - the bundled OpenCode binary runs;
 *   - the staged server starts with the bundled Node and answers the API and the UI;
 *   - a fresh install has the OpenCode assistant off until the user turns it on.
 * CI runs it on Windows, macOS and Linux for every pull request, so a platform-only break shows up before a release tag.
 */
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const stage = path.resolve(here, "..", "src-tauri", "stage");
const win = process.platform === "win32";
const parts = {
  node: path.join(stage, "node", win ? "node.exe" : "node"),
  server: path.join(stage, "server", "dist", "index.js"),
  ui: path.join(stage, "ui", "index.html"),
  mcp: path.join(stage, "mcp", "dist", "index.js"),
  opencode: path.join(stage, "agents", "opencode", win ? "opencode.exe" : "opencode")
};

const fail = (msg) => {
  console.error(`✖ ${msg}`);
  process.exitCode = 1;
};

for (const [name, file] of Object.entries(parts)) {
  if (fs.existsSync(file)) console.log(`✔ staged ${name}: ${path.relative(stage, file)}`);
  else fail(`missing staged ${name}: ${file}`);
}
if (process.exitCode) process.exit(1);

const version = execFileSync(parts.opencode, ["--version"], { encoding: "utf8", timeout: 60_000 }).trim();
console.log(`✔ bundled OpenCode runs: ${version}`);

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
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
  console.error("--- server output ---\n" + log);
} finally {
  server.kill();
  await new Promise((r) => setTimeout(r, 500));
  fs.rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
