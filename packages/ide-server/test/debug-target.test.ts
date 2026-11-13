import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import { resolveVitestDebugTarget } from "../src/debug.js";

const tempDirs: string[] = [];

async function makeTempRoot(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "hardkas-ide-dbg-"));
  tempDirs.push(dir);
  return dir;
}

async function touch(filePath: string, content = "{}"): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, "utf8");
}

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) await fs.rm(dir, { recursive: true, force: true });
});

describe("resolveVitestDebugTarget", () => {
  it("uses root vitest for a standard single-package workspace", async () => {
    const root = await makeTempRoot();
    const rootEntry = path.join(root, "node_modules", "vitest", "vitest.mjs");
    await touch(rootEntry, "");
    await touch(path.join(root, "test", "payment.test.ts"), "export {};\n");

    const target = resolveVitestDebugTarget(root, "test/payment.test.ts");
    assert.equal(target.cwd, path.resolve(root));
    assert.equal(target.entry, rootEntry);
    assert.equal(target.fileArg, "test/payment.test.ts");
  });

  it("prefers nested subproject cwd and vitest.mjs over root vitest (single file)", async () => {
    const root = await makeTempRoot();
    await touch(path.join(root, "package.json"));
    await touch(path.join(root, "node_modules", "vitest", "vitest.mjs"), "");

    const subDir = path.join(root, "hardkas-workspace");
    const subEntry = path.join(subDir, "node_modules", "vitest", "vitest.mjs");
    await touch(path.join(subDir, "package.json"));
    await touch(path.join(subDir, "vitest.config.ts"), "export default {};\n");
    await touch(subEntry, "");
    await touch(path.join(subDir, "test", "golden-core.test.ts"), "export {};\n");

    const target = resolveVitestDebugTarget(root, "hardkas-workspace/test/golden-core.test.ts");
    assert.equal(target.cwd, subDir);
    assert.equal(target.entry, subEntry);
    assert.equal(target.fileArg, "test/golden-core.test.ts");
  });

  it("keeps nested subproject cwd even when vitest.mjs is hoisted to workspace root", async () => {
    const root = await makeTempRoot();
    const rootEntry = path.join(root, "node_modules", "vitest", "vitest.mjs");
    await touch(rootEntry, "");

    const subDir = path.join(root, "hardkas-workspace");
    await touch(path.join(subDir, "vitest.config.ts"), "export default {};\n");
    await touch(path.join(subDir, "test", "golden-core.test.ts"), "export {};\n");

    const target = resolveVitestDebugTarget(root, "hardkas-workspace/test/golden-core.test.ts");
    assert.equal(target.cwd, subDir);
    assert.equal(target.entry, rootEntry);
    assert.equal(target.fileArg, "test/golden-core.test.ts");
  });

  it("targets nested subproject on debugAll when tests only exist there", async () => {
    const root = await makeTempRoot();
    await touch(path.join(root, "node_modules", "vitest", "vitest.mjs"), "");

    const subDir = path.join(root, "hardkas-workspace");
    const subEntry = path.join(subDir, "node_modules", "vitest", "vitest.mjs");
    await touch(path.join(subDir, "package.json"));
    await touch(path.join(subDir, "vitest.config.ts"), "export default {};\n");
    await touch(subEntry, "");
    await touch(path.join(subDir, "test", "golden-core.test.ts"), "export {};\n");

    const target = resolveVitestDebugTarget(root);
    assert.equal(target.cwd, subDir);
    assert.equal(target.entry, subEntry);
    assert.equal(target.fileArg, undefined);
  });

  it("rejects paths escaping the workspace root", async () => {
    const root = await makeTempRoot();
    await touch(path.join(root, "node_modules", "vitest", "vitest.mjs"), "");
    assert.throws(() => resolveVitestDebugTarget(root, "../outside.test.ts"), /escapes/i);
  });

  it("errors clearly when vitest is not installed anywhere", async () => {
    const root = await makeTempRoot();
    assert.throws(() => resolveVitestDebugTarget(root), /vitest is not installed/i);
  });
});
