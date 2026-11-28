import assert from "node:assert/strict";
import { promises as fs, mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";

// A temp home for the trust list, and a server that never listens: these tests touch nothing real.
const home = mkdtempSync(path.join(os.tmpdir(), "hk-tree-home-"));
process.env.USERPROFILE = home;
process.env.HOME = home;
process.env.HARDKAS_IDE_NO_LISTEN = "1";

const workspace = await import("../src/workspace.ts");
const wsfs = await import("../src/fs.ts");

const project = mkdtempSync(path.join(os.tmpdir(), "hk-tree-proj-"));

async function write(rel: string, content = "x"): Promise<void> {
  const abs = path.join(project, ...rel.split("/"));
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, content, "utf8");
}

before(async () => {
  await write("hardkas.config.ts", "export default {}\n");
  await write("contracts/a.sil");
  await write("node_modules/left-pad/index.js");
  await write("node_modules/left-pad/package.json", "{}");
  await write("dist/app.js");
  await write(".git/HEAD", "ref: refs/heads/main\n");
  await write(".hardkas/artifacts/plans/p.json", "{}");
  await write(".hardkas/dev-accounts/alice.json", "{}");
  await write(".hardkas/accounts.real.json", "{}");
  await workspace.trustFolder(project);
  await workspace.openWorkspace(project);
});

after(async () => {
  workspace.closeWorkspace();
  await fs.rm(project, { recursive: true, force: true });
  await fs.rm(home, { recursive: true, force: true });
});

const find = (nodes: Awaited<ReturnType<typeof wsfs.readTree>>, p: string): (typeof nodes)[number] | undefined => {
  for (const n of nodes) {
    if (n.path === p) return n;
    const inner = n.children ? find(n.children, p) : undefined;
    if (inner) return inner;
  }
  return undefined;
};

describe("readTree: hidden folders listed but not read, key stores locked, .git never", () => {
  it("flags node_modules and dist as hidden, without children", async () => {
    const tree = await wsfs.readTree("");
    for (const p of ["node_modules", "dist"]) {
      const n = find(tree, p);
      assert.ok(n, `${p} is listed`);
      assert.equal(n.hidden, true);
      assert.equal(n.children, undefined, `${p} is not read`);
    }
    assert.equal(find(tree, ".git"), undefined);
    assert.ok(find(tree, ".hardkas/artifacts/plans/p.json"), "the rest of .hardkas is read as before");
  });

  it("marks key stores as locked and does not read inside them", async () => {
    const tree = await wsfs.readTree("");
    const dev = find(tree, ".hardkas/dev-accounts");
    assert.equal(dev?.locked, true);
    assert.equal(dev?.children, undefined);
    assert.equal(find(tree, ".hardkas/accounts.real.json")?.locked, true);
    assert.equal(find(tree, "contracts/a.sil")?.locked, undefined);
  });
});

describe("readDir: one level, on demand", () => {
  it("lists a hidden folder one level at a time", async () => {
    const top = await wsfs.readDir("node_modules");
    assert.deepEqual(top.nodes.map((n) => [n.path, n.type, n.children]), [["node_modules/left-pad", "dir", undefined]]);
    assert.equal(top.truncated, false);
    const inner = await wsfs.readDir("node_modules/left-pad");
    assert.deepEqual(inner.nodes.map((n) => n.name), ["index.js", "package.json"]);
  });

  it("refuses key stores and paths outside the workspace", async () => {
    await assert.rejects(wsfs.readDir(".hardkas/dev-accounts"), /private keys|SECRET/i);
    await assert.rejects(wsfs.readDir("../"), /escapes|OUTSIDE/i);
  });
});
