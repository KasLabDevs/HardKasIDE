/**
 * Collects everything the installed app needs next to its executable, under src-tauri/stage:
 *
 *   stage/node/node.exe      the Node runtime that runs the IDE server (this machine's Node)
 *   stage/server/            ide-server: compiled code + production dependencies (real folders, no symlinks)
 *   stage/ui/                the built IDE (apps/ide/dist), served by ide-server
 *
 * Tauri then ships stage/** as resources. Run it through `pnpm --filter @hardkas-ide/desktop build`.
 */
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const desktop = path.resolve(here, "..");
const root = path.resolve(desktop, "..", "..");
const stage = path.join(desktop, "src-tauri", "stage");
const exe = process.platform === "win32" ? "node.exe" : "node";

const step = (label) => console.log(`\n▸ ${label}`);
// CI=true keeps pnpm from prompting (there is no terminal to answer in a build).
const run = (cmd, cwd = root) => execSync(cmd, { cwd, stdio: "inherit", env: { ...process.env, CI: "true" } });

step("Ensure desktop splash screen");
const splashSrc = path.join(desktop, "splash", "index.html");
const distDir = path.join(desktop, "dist");
fs.mkdirSync(distDir, { recursive: true });
if (fs.existsSync(splashSrc)) {
  fs.copyFileSync(splashSrc, path.join(distDir, "index.html"));
}

step("Build the IDE server, the MCP server and the UI");
run("pnpm --filter @hardkas-ide/server build");
run("pnpm --filter @hardkas-ide/mcp build");
run("pnpm --filter @hardkas-ide/ide build");

step(`Reset ${path.relative(root, stage)}`);
fs.rmSync(stage, { recursive: true, force: true });
fs.mkdirSync(stage, { recursive: true });

step("Copy the UI");
fs.cpSync(path.join(root, "apps", "ide", "dist"), path.join(stage, "ui"), { recursive: true });

step("Copy the server and install its production dependencies");
const serverSrc = path.join(root, "packages", "ide-server");
const serverOut = path.join(stage, "server");
fs.mkdirSync(serverOut, { recursive: true });
fs.cpSync(path.join(serverSrc, "dist"), path.join(serverOut, "dist"), { recursive: true });
const pkg = JSON.parse(fs.readFileSync(path.join(serverSrc, "package.json"), "utf8"));
fs.writeFileSync(
  path.join(serverOut, "package.json"),
  JSON.stringify({ name: pkg.name, version: pkg.version, private: true, type: pkg.type, dependencies: pkg.dependencies }, null, 2)
);
// npm lays out real folders (pnpm uses junctions, which installers do not carry over reliably).
run("npm install --omit=dev --no-audit --no-fund --loglevel=error", serverOut);

// The MCP server the hosted agent (OpenCode, over ACP) uses to reach the IDE: stage/mcp/dist/index.js,
// started by the agent with the bundled Node. See packages/ide-server/src/acpAgent.ts.
step("Copy the MCP server and install its production dependencies");
const mcpSrc = path.join(root, "packages", "mcp-server");
const mcpOut = path.join(stage, "mcp");
fs.mkdirSync(mcpOut, { recursive: true });
fs.cpSync(path.join(mcpSrc, "dist"), path.join(mcpOut, "dist"), { recursive: true });
const mcpPkg = JSON.parse(fs.readFileSync(path.join(mcpSrc, "package.json"), "utf8"));
fs.writeFileSync(
  path.join(mcpOut, "package.json"),
  JSON.stringify({ name: mcpPkg.name, version: mcpPkg.version, private: true, type: mcpPkg.type, dependencies: mcpPkg.dependencies }, null, 2)
);
run("npm install --omit=dev --no-audit --no-fund --loglevel=error", mcpOut);

// The OpenCode agent binary (MIT): from HARDKAS_IDE_OPENCODE_EXE when set, otherwise the pinned npm release.
const OPENCODE_VERSION = "2.3.0";
step(`Copy the OpenCode agent ${OPENCODE_VERSION}`);
const agentOut = path.join(stage, "agents", "opencode");
fs.mkdirSync(agentOut, { recursive: true });
let opencodeExe = process.env.HARDKAS_IDE_OPENCODE_EXE ?? "";
if (!opencodeExe || !fs.existsSync(opencodeExe)) {
  const cache = path.join(desktop, ".opencode-cache");
  fs.mkdirSync(cache, { recursive: true });
  if (!fs.existsSync(path.join(cache, "package.json"))) fs.writeFileSync(path.join(cache, "package.json"), "{\"private\":true}\n");
  run(`npm install --no-save --no-audit --no-fund --loglevel=error @opencode/cli@${OPENCODE_VERSION}`, cache);
  opencodeExe = path.join(cache, "node_modules", "@opencode", "cli", "bin", process.platform === "win32" ? "opencode.exe" : "opencode");
}
fs.copyFileSync(opencodeExe, path.join(agentOut, path.basename(opencodeExe)));
fs.writeFileSync(
  path.join(agentOut, "NOTICE.txt"),
  `OpenCode ${OPENCODE_VERSION} (npm package @opencode/cli), an open-source AI coding agent.\n` +
    `License: MIT, as declared by the package. Source and full license text: https://github.com/anomalyco/opencode\n` +
    `HardKas IDE starts it as an Agent Client Protocol agent (opencode acp) with its own config home under ~/.hardkas-ide/opencode.\n`
);

step("Copy the Node runtime");
fs.mkdirSync(path.join(stage, "node"), { recursive: true });
const stagedExe = path.join(stage, "node", exe);
fs.copyFileSync(process.execPath, stagedExe);
if (process.platform !== "win32") {
  fs.chmodSync(stagedExe, 0o755);
}

fs.writeFileSync(path.join(stage, "VERSION.txt"), `HardKas IDE ${pkg.version}\nnode ${process.version}\nbuilt ${new Date().toISOString()}\n`);

const size = (dir) => {
  let total = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    total += e.isDirectory() ? size(p) : fs.statSync(p).size;
  }
  return total;
};
console.log(`\n✔ staged ${(size(stage) / 1024 / 1024).toFixed(0)} MB in ${path.relative(root, stage)}`);
