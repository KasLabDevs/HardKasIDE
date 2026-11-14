/**
 * Collects everything the installed app needs next to its executable, under src-tauri/stage:
 *
 *   stage/node/node.exe           the Node runtime that runs the IDE server (this machine's Node) + its LICENSE
 *   stage/server/                 ide-server: compiled code + production dependencies (real folders, no symlinks)
 *   stage/mcp/                    the MCP server the hosted agent uses, same layout
 *   stage/ui/                     the built IDE (apps/ide/dist), served by ide-server
 *   stage/agents/opencode/        the OpenCode agent binary (integrity-checked) + LICENSE + NOTICE.txt
 *   stage/THIRD_PARTY_LICENSES.txt  the licence texts of every package the server, the MCP server and the UI ship
 *
 * Tauri then ships stage/** as resources. Run it through `pnpm --filter @hardkas-ide/desktop build`.
 */
import { execSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";

const here = path.dirname(fileURLToPath(import.meta.url));
const desktop = path.resolve(here, "..");
const root = path.resolve(desktop, "..", "..");
const stage = path.join(desktop, "src-tauri", "stage");
const exe = process.platform === "win32" ? "node.exe" : "node";

const step = (label) => console.log(`\n▸ ${label}`);
// CI=true keeps pnpm from prompting (there is no terminal to answer in a build) and makes it keep to the lockfile.
const run = (cmd, cwd = root) => execSync(cmd, { cwd, stdio: "inherit", env: { ...process.env, CI: "true" } });
const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const sha256 = (buf) => crypto.createHash("sha256").update(buf).digest("hex");

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

/** Fails when anything under `dir` is a symlink or a junction: installers do not carry those reliably. */
function assertRealFolders(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    const st = fs.lstatSync(p);
    if (st.isSymbolicLink()) throw new Error(`${p} is a symlink or junction; the staged tree must hold real folders only`);
    if (st.isDirectory()) assertRealFolders(p);
  }
}

/** Removes every node_modules/.bin (command shims, symlinks on macOS and Linux): nothing runs them in the app. */
function dropBinShims(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!e.isDirectory() || e.isSymbolicLink()) continue;
    const p = path.join(dir, e.name);
    if (e.name === ".bin" && path.basename(dir) === "node_modules") fs.rmSync(p, { recursive: true, force: true });
    else dropBinShims(p);
  }
}

/** Every installed package under a hoisted node_modules (nested node_modules included). */
function installedPackages(nodeModules) {
  const found = [];
  const visit = (nm) => {
    if (!fs.existsSync(nm)) return;
    for (const e of fs.readdirSync(nm, { withFileTypes: true })) {
      if (!e.isDirectory() || e.name.startsWith(".")) continue;
      const dirs = e.name.startsWith("@")
        ? fs.readdirSync(path.join(nm, e.name), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => path.join(nm, e.name, d.name))
        : [path.join(nm, e.name)];
      for (const d of dirs) {
        if (fs.existsSync(path.join(d, "package.json"))) found.push(d);
        visit(path.join(d, "node_modules"));
      }
    }
  };
  visit(nodeModules);
  return found;
}

/**
 * Stages a workspace package with the production dependencies the lockfile pins (pnpm-lock.yaml), laid out as
 * real folders (node-linker=hoisted), then keeps only node_modules, the compiled code and a package.json whose
 * dependencies name the exact versions shipped.
 */
function deployPackage(filter, src, out) {
  fs.rmSync(out, { recursive: true, force: true });
  run(`pnpm --filter ${filter} deploy --prod --config.node-linker=hoisted --config.inject-workspace-packages=true "${out}"`);
  for (const e of fs.readdirSync(out)) if (e !== "node_modules") fs.rmSync(path.join(out, e), { recursive: true, force: true });
  const nm = path.join(out, "node_modules");
  for (const e of fs.readdirSync(nm)) if (e === ".pnpm" || e.startsWith(".modules") || e.startsWith(".pnpm-")) fs.rmSync(path.join(nm, e), { recursive: true, force: true });
  dropBinShims(out);
  assertRealFolders(out);
  fs.cpSync(path.join(src, "dist"), path.join(out, "dist"), { recursive: true });
  const pkg = readJson(path.join(src, "package.json"));
  const dependencies = {};
  for (const name of Object.keys(pkg.dependencies ?? {})) {
    const file = path.join(nm, ...name.split("/"), "package.json");
    if (!fs.existsSync(file)) throw new Error(`${filter}: dependency ${name} was not deployed`);
    dependencies[name] = readJson(file).version;
  }
  fs.writeFileSync(
    path.join(out, "package.json"),
    JSON.stringify({ name: pkg.name, version: pkg.version, private: true, type: pkg.type, dependencies }, null, 2) + "\n"
  );
  console.log(`  ${installedPackages(nm).length} packages from pnpm-lock.yaml in ${path.relative(root, out)}`);
  return pkg;
}

step("Stage the server with its production dependencies (from pnpm-lock.yaml)");
const serverOut = path.join(stage, "server");
const pkg = deployPackage("@hardkas-ide/server", path.join(root, "packages", "ide-server"), serverOut);

// The MCP server the hosted agent (OpenCode, over ACP) uses to reach the IDE: stage/mcp/dist/index.js,
// started by the agent with the bundled Node. See packages/ide-server/src/acpAgent.ts.
step("Stage the MCP server with its production dependencies (from pnpm-lock.yaml)");
const mcpOut = path.join(stage, "mcp");
deployPackage("@hardkas-ide/mcp", path.join(root, "packages", "mcp-server"), mcpOut);

// ---------------------------------------------------------------- OpenCode
// The OpenCode agent binary (MIT) comes from its per-platform npm package. The tarball is downloaded straight from
// the registry (no npm install, so no postinstall script runs) and must match the sha512 below; the binary inside
// must match the sha256 below. HARDKAS_IDE_OPENCODE_EXE (local builds) skips the download, not the sha256 check.
// The values were read from https://registry.npmjs.org/@opencode/<package>/2.3.0 (dist.integrity) and from the
// binaries inside those tarballs. Changing OPENCODE_VERSION means recording them again.
const OPENCODE_VERSION = "2.3.0";
const OPENCODE = {
  // The launcher package (its postinstall copies the platform binary); not shipped, recorded for reference.
  "cli": { integrity: "sha512-Q5RV8jLJ4O8bY2O8X2hkBOkgPf6+nDB9MEkz/Q/Cc4Ojd2SwUFFzEd1LzgNGKiXiS7g/9+/X4eqhrxY60fLMOQ==" },
  "cli-windows-x64": {
    integrity: "sha512-0wnPu8aCczjN82X6qK+XmMFiheyvOnBXRsb+hkyTWaeG6WlIeN9cM6J7vKnj741juyIE7q57SmRSRVPWUmun/g==",
    bin: "package/bin/opencode.exe",
    sha256: "38153a142354634c82b5cfe6c00b19df15a71e6cf8c17ef5f5c1a4cc684a6917"
  },
  "cli-windows-arm64": {
    integrity: "sha512-dqOtQicdmaKxyA8fSBYysegVl0QrlHYWXy/D/ocgZvGa0bNGi+9KR6N1Za9BCkOu/q7gemroXliMS+aBREhShA==",
    bin: "package/bin/opencode.exe",
    sha256: "34ca6637c30ea332d7ba43c8bf889062ce49441752ce1f4f784ff30264668a0b"
  },
  "cli-darwin-x64": {
    integrity: "sha512-OARYGefjQb1xClR9lX0bTl/unxaJ2H9kpyqYuEH+59YdgantqpMdPrXXnJgwiydk3WP94CxWLXFOxSYtCxoDQQ==",
    bin: "package/bin/opencode",
    sha256: "06b36d6b341e4bc248d982fd634d9075baa804383ff4a030b923888ef7a7095a"
  },
  "cli-darwin-arm64": {
    integrity: "sha512-ey2HOWX2DK2YJrKta5a+pcvIlkiCyJJsN7NjkJZPsVg9TDXpQWE1OJLWVFqjxZcWNtaMjvKYlrlCY6g8Z2Lb+A==",
    bin: "package/bin/opencode",
    sha256: "9f3147cae4ca323827d3ca39451b0d3431b2906e79a08e9b09d1eb34bb703f52"
  },
  "cli-linux-x64": {
    integrity: "sha512-8T3K8L6Nd4fSG5BSgofqhmIDQ1ZvzDZZ2J7bFVB9RK1d5Hjqh24IcxgbcwpgGKkdvItrayi4Rl+wrSmhl17FFg==",
    bin: "package/bin/opencode",
    sha256: "2e0e4656521ca56e5ba16a00d48429958b8105b3fa6466710a4350e68759381f"
  },
  "cli-linux-arm64": {
    integrity: "sha512-1IF1NQFD5mdZ7NcU81UifdYAVKEDAP/J07ylbgE4ZATminS7pOn5SOXVzyOkuN1WLcDzXunkju0hw8hug48wTg==",
    bin: "package/bin/opencode",
    sha256: "5c7d89bc2d5fa5d83cc7768b813ca671368e70b8b9eda9d1ca9e6ec6b66d8ce0"
  }
};
// The copyright line of https://github.com/anomalyco/opencode/blob/dev/LICENSE (the npm packages carry no licence file).
const OPENCODE_COPYRIGHT = "Copyright (c) 2025 opencode";

/** The regular files of a .tar buffer, by path (ustar, with pax and GNU long names). */
function tarFiles(buf) {
  const files = new Map();
  let off = 0;
  let longName = null;
  while (off + 512 <= buf.length) {
    const h = buf.subarray(off, off + 512);
    if (h.every((b) => b === 0)) break;
    const str = (a, b) => h.subarray(a, b).toString("utf8").replace(/\0[\s\S]*$/, "");
    const size = parseInt(str(124, 136).trim() || "0", 8);
    const type = String.fromCharCode(h[156] || 48);
    const prefix = str(345, 500);
    const name = longName ?? (prefix ? `${prefix}/${str(0, 100)}` : str(0, 100));
    longName = null;
    const data = buf.subarray(off + 512, off + 512 + size);
    off += 512 + Math.ceil(size / 512) * 512;
    if (type === "x") longName = /\d+ path=([^\n]*)\n/.exec(data.toString("utf8"))?.[1] ?? null;
    else if (type === "L") longName = data.toString("utf8").replace(/\0[\s\S]*$/, "");
    else if (type === "0") files.set(name, data);
  }
  return files;
}

const ocPlatform = { win32: "windows", darwin: "darwin", linux: "linux" }[process.platform] ?? process.platform;
const ocPackage = `cli-${ocPlatform}-${process.arch}`;
const ocPinned = OPENCODE[ocPackage];
if (!ocPinned?.sha256) throw new Error(`no pinned OpenCode ${OPENCODE_VERSION} build for ${process.platform}-${process.arch} (@opencode/${ocPackage})`);

step(`Stage the OpenCode agent ${OPENCODE_VERSION} (@opencode/${ocPackage})`);
const agentOut = path.join(stage, "agents", "opencode");
fs.mkdirSync(agentOut, { recursive: true });
let opencodeBinary;
let opencodeFrom;
const override = process.env.HARDKAS_IDE_OPENCODE_EXE ?? "";
if (override) {
  if (!fs.existsSync(override)) throw new Error(`HARDKAS_IDE_OPENCODE_EXE=${override} does not exist`);
  opencodeBinary = fs.readFileSync(override);
  opencodeFrom = override;
} else {
  const cache = path.join(desktop, ".opencode-cache");
  fs.mkdirSync(cache, { recursive: true });
  const tgzPath = path.join(cache, `${ocPackage}-${OPENCODE_VERSION}.tgz`);
  const url = `https://registry.npmjs.org/@opencode/${ocPackage}/-/${ocPackage}-${OPENCODE_VERSION}.tgz`;
  let tgz = fs.existsSync(tgzPath) ? fs.readFileSync(tgzPath) : null;
  const integrityOf = (buf) => "sha512-" + crypto.createHash("sha512").update(buf).digest("base64");
  if (!tgz || integrityOf(tgz) !== ocPinned.integrity) {
    console.log(`  downloading ${url}`);
    const res = await fetch(url, { signal: AbortSignal.timeout(10 * 60_000) });
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
    tgz = Buffer.from(await res.arrayBuffer());
  }
  const integrity = integrityOf(tgz);
  if (integrity !== ocPinned.integrity) {
    throw new Error(`@opencode/${ocPackage}@${OPENCODE_VERSION}: tarball integrity ${integrity} does not match the pinned ${ocPinned.integrity}`);
  }
  console.log(`  tarball sha512 matches the pinned integrity`);
  fs.writeFileSync(tgzPath, tgz);
  opencodeBinary = tarFiles(zlib.gunzipSync(tgz)).get(ocPinned.bin);
  if (!opencodeBinary) throw new Error(`@opencode/${ocPackage}@${OPENCODE_VERSION}: ${ocPinned.bin} is not in the tarball`);
  opencodeFrom = `${url} (${ocPinned.bin})`;
}
const binaryHash = sha256(opencodeBinary);
if (binaryHash !== ocPinned.sha256) {
  throw new Error(`OpenCode binary from ${opencodeFrom}: sha256 ${binaryHash} does not match the pinned ${ocPinned.sha256} for ${ocPackage}@${OPENCODE_VERSION}`);
}
console.log(`  binary sha256 matches the pinned ${ocPackage} build: ${binaryHash}`);
const stagedAgent = path.join(agentOut, process.platform === "win32" ? "opencode.exe" : "opencode");
fs.writeFileSync(stagedAgent, opencodeBinary);
if (process.platform !== "win32") fs.chmodSync(stagedAgent, 0o755);
console.log(`  ${opencodeFrom} -> ${path.relative(root, stagedAgent)}`);
const MIT = (copyright) =>
  `MIT License\n\n${copyright}\n\n` +
  `Permission is hereby granted, free of charge, to any person obtaining a copy\nof this software and associated documentation files (the "Software"), to deal\nin the Software without restriction, including without limitation the rights\nto use, copy, modify, merge, publish, distribute, sublicense, and/or sell\ncopies of the Software, and to permit persons to whom the Software is\nfurnished to do so, subject to the following conditions:\n\n` +
  `The above copyright notice and this permission notice shall be included in all\ncopies or substantial portions of the Software.\n\n` +
  `THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR\nIMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,\nFITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE\nAUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER\nLIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,\nOUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE\nSOFTWARE.\n`;
fs.writeFileSync(path.join(agentOut, "LICENSE"), MIT(OPENCODE_COPYRIGHT));
fs.writeFileSync(
  path.join(agentOut, "NOTICE.txt"),
  `OpenCode ${OPENCODE_VERSION} (npm package @opencode/${ocPackage}, sha256 ${binaryHash}), an open-source AI coding agent.\n` +
    `License: MIT (see LICENSE next to this file). Source: https://github.com/anomalyco/opencode\n` +
    `HardKas IDE starts it as an Agent Client Protocol agent (opencode acp) with its own config home under ~/.hardkas-ide/opencode.\n`
);

// ---------------------------------------------------------------- Node
step("Copy the Node runtime and its licence");
fs.mkdirSync(path.join(stage, "node"), { recursive: true });
const stagedExe = path.join(stage, "node", exe);
fs.copyFileSync(process.execPath, stagedExe);
if (process.platform !== "win32") {
  fs.chmodSync(stagedExe, 0o755);
}
// The official archives keep LICENSE next to node.exe (Windows) or one level up from bin/node (macOS, Linux). The
// Windows MSI installs none: point HARDKAS_IDE_NODE_LICENSE at the LICENSE of the same Node release.
const nodeDir = path.dirname(process.execPath);
const nodeLicense = [process.env.HARDKAS_IDE_NODE_LICENSE, path.join(nodeDir, "LICENSE"), path.join(nodeDir, "..", "LICENSE")]
  .filter(Boolean)
  .find((p) => fs.existsSync(p));
if (!nodeLicense) {
  throw new Error(
    `Node's LICENSE is not next to ${process.execPath} (nor one level up). Use the official Node ${process.version} archive, ` +
      `or set HARDKAS_IDE_NODE_LICENSE to the LICENSE file of Node ${process.version}.`
  );
}
fs.copyFileSync(nodeLicense, path.join(stage, "node", "LICENSE"));
console.log(`  ${nodeLicense} -> ${path.relative(root, path.join(stage, "node", "LICENSE"))}`);

// ---------------------------------------------------------------- third-party licences
step("Collect third-party licences");
const LICENSE_FILE = /^(licen[cs]e|copying|notice)([.-].*)?$/i;
/** Finds `name` from `fromDir` the way Node does: the nearest node_modules/<name> going up. */
function resolvePackageDir(name, fromDir) {
  for (let dir = fromDir; ; dir = path.dirname(dir)) {
    const candidate = path.join(dir, "node_modules", ...name.split("/"));
    if (fs.existsSync(path.join(candidate, "package.json"))) return fs.realpathSync(candidate);
    if (path.dirname(dir) === dir) return null;
  }
}
/** A package and its production dependencies (dependencies + installed optionalDependencies), transitively. */
function withProductionDeps(names, fromDir, seen = new Map()) {
  for (const name of names) {
    const dir = resolvePackageDir(name, fromDir);
    if (!dir) {
      if (seen.has(`?${name}`)) continue;
      seen.set(`?${name}`, null);
      continue;
    }
    if ([...seen.values()].includes(dir)) continue;
    const p = readJson(path.join(dir, "package.json"));
    seen.set(`${p.name}@${p.version}`, dir);
    withProductionDeps([...Object.keys(p.dependencies ?? {}), ...Object.keys(p.optionalDependencies ?? {})], dir, seen);
  }
  return seen;
}
const ideDir = path.join(root, "apps", "ide");
const idePkg = readJson(path.join(ideDir, "package.json"));
// Vite bundles monaco-editor into the UI although apps/ide lists it under devDependencies, so it ships too.
const UI_BUNDLED_DEV_DEPS = ["monaco-editor"];
const uiPackages = [...withProductionDeps([...Object.keys(idePkg.dependencies ?? {}), ...UI_BUNDLED_DEV_DEPS], ideDir)]
  .filter(([, dir]) => dir)
  .map(([, dir]) => dir);

const entries = new Map();
const add = (dir, shippedIn) => {
  const p = readJson(path.join(dir, "package.json"));
  const key = `${p.name}@${p.version}`;
  const entry = entries.get(key) ?? { name: p.name, version: p.version, license: p.license ?? p.licenses?.map?.((l) => l.type ?? l).join(" OR ") ?? "UNKNOWN", dir, shippedIn: new Set() };
  entry.shippedIn.add(shippedIn);
  entries.set(key, entry);
};
for (const dir of installedPackages(path.join(serverOut, "node_modules"))) add(dir, "server");
for (const dir of installedPackages(path.join(mcpOut, "node_modules"))) add(dir, "mcp");
for (const dir of uiPackages) add(dir, "ui");

const rule = "=".repeat(78);
let missing = 0;
let notices =
  `HardKas IDE ${pkg.version}: third-party software\n\n` +
  `The installer ships these packages: the IDE server (server), the MCP server (mcp) and the user interface bundle (ui).\n` +
  `The Node.js runtime and the OpenCode agent carry their own licences: node/LICENSE and agents/opencode/LICENSE.\n`;
for (const e of [...entries.values()].sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version))) {
  const files = fs.readdirSync(e.dir).filter((f) => LICENSE_FILE.test(f) && fs.statSync(path.join(e.dir, f)).isFile()).sort();
  notices += `\n${rule}\n${e.name}@${e.version}  (${e.license}; ${[...e.shippedIn].sort().join(", ")})\n${rule}\n`;
  if (files.length === 0) {
    missing++;
    notices += `\nThis package ships no licence file. Its package.json declares the licence: ${e.license}.\n`;
  }
  for (const f of files) notices += `\n${fs.readFileSync(path.join(e.dir, f), "utf8").replace(/\r\n/g, "\n").trimEnd()}\n`;
}
fs.writeFileSync(path.join(stage, "THIRD_PARTY_LICENSES.txt"), notices);
console.log(`  ${entries.size} packages (${missing} without a licence file) -> ${path.relative(root, path.join(stage, "THIRD_PARTY_LICENSES.txt"))}`);

fs.writeFileSync(
  path.join(stage, "VERSION.txt"),
  `HardKas IDE ${pkg.version}\nnode ${process.version}\nopencode ${OPENCODE_VERSION}\nbuilt ${new Date().toISOString()}\n`
);

const size = (dir) => {
  let total = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    total += e.isDirectory() ? size(p) : fs.statSync(p).size;
  }
  return total;
};
console.log(`\n✔ staged ${(size(stage) / 1024 / 1024).toFixed(0)} MB in ${path.relative(root, stage)}`);
