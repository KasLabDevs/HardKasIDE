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

step("Build the IDE server and the UI");
run("pnpm --filter @hardkas-ide/server build");
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

step("Copy the Node runtime");
fs.mkdirSync(path.join(stage, "node"), { recursive: true });
fs.copyFileSync(process.execPath, path.join(stage, "node", exe));

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
