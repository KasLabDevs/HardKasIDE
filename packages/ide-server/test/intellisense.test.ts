import assert from "node:assert/strict";
import { promises as fs, mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, afterEach, describe, it } from "node:test";

const tempHome = mkdtempSync(path.join(os.tmpdir(), "hardkas-ide-isense-home-"));
process.env.USERPROFILE = tempHome;
process.env.HOME = tempHome;
process.env.HARDKAS_IDE_NO_LISTEN = "1";

const { readIntelliSenseContext, importedPackages } = await import("../src/fs.js");
const workspace = await import("../src/workspace.js");

const tempDirs: string[] = [];

async function makeTempRoot(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "hardkas-ide-isense-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  workspace.closeWorkspace();
  for (const dir of tempDirs.splice(0)) {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

after(async () => {
  await fs.rm(tempHome, { recursive: true, force: true });
});

describe("readIntelliSenseContext", () => {
  it("collects workspace .sil, .ts/.tsx, and declared node_modules .d.ts while excluding secrets", async () => {
    const root = await makeTempRoot();
    await fs.mkdir(path.join(root, "contracts"), { recursive: true });
    await fs.mkdir(path.join(root, "dapp/src"), { recursive: true });
    await fs.mkdir(path.join(root, ".hardkas"), { recursive: true });
    await fs.mkdir(path.join(root, "node_modules/react"), { recursive: true });

    await fs.writeFile(
      path.join(root, "package.json"),
      JSON.stringify({ name: "demo", dependencies: { react: "^19.0.0" } }),
      "utf8"
    );
    await fs.writeFile(path.join(root, "contracts/Escrow.sil"), "pragma silverscript ^0.1.0;\ncontract Escrow() {}", "utf8");
    await fs.writeFile(path.join(root, "dapp/src/App.tsx"), "export function App() { return <div />; }", "utf8");
    await fs.writeFile(path.join(root, ".env"), "SECRET_KEY=supersecret", "utf8");
    await fs.writeFile(path.join(root, ".hardkas/accounts.real.json"), '{"accounts":[]}', "utf8");
    await fs.writeFile(path.join(root, "node_modules/react/package.json"), '{"name":"react","types":"index.d.ts"}', "utf8");
    await fs.writeFile(path.join(root, "node_modules/react/index.d.ts"), "export function useState<T>(v: T): [T, (n: T) => void];", "utf8");

    await workspace.openWorkspace(root);
    const ctx = await readIntelliSenseContext();

    const srcPaths = ctx.sourceFiles.map((f) => f.path);
    assert.ok(srcPaths.includes("contracts/Escrow.sil"));
    assert.ok(srcPaths.includes("dapp/src/App.tsx"));
    assert.ok(!srcPaths.some((p) => p.includes(".env") || p.includes("accounts.real.json")));

    const typePaths = ctx.typeDefs.map((f) => f.path);
    assert.ok(typePaths.includes("node_modules/react/index.d.ts"));
  });
});

describe("importedPackages", () => {
  it("finds the packages a type file pulls in, by package name", () => {
    const dts = [
      'export * from "@trystero-p2p/nostr";',
      'import type { A } from "@hardkas/core/dist/types";',
      'type B = import("undici-types").Request;',
      '/// <reference types="node" />',
      'import "side-effect";',
      'import { x } from "./local";',
      'import fs from "node:fs";'
    ].join("\n");
    assert.deepEqual([...importedPackages(dts)].sort(), ["@hardkas/core", "@trystero-p2p/nostr", "node", "side-effect", "undici-types"]);
  });
});
