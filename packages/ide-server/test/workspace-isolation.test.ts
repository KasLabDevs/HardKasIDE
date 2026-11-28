import assert from "node:assert/strict";
import { promises as fs, mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, afterEach, describe, it } from "node:test";

const tempHome = mkdtempSync(path.join(os.tmpdir(), "hardkas-ws-home-"));
process.env.USERPROFILE = tempHome;
process.env.HOME = tempHome;
process.env.HARDKAS_IDE_NO_LISTEN = "1";

const { app } = await import("../src/index.js");

const tempRoots: string[] = [];

async function makeWorkspace(name: string, scriptName: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), `hardkas-ws-${name}-`));
  tempRoots.push(dir);
  await fs.writeFile(path.join(dir, "hardkas.config.ts"), "export default {};\n", "utf8");
  await fs.writeFile(
    path.join(dir, "package.json"),
    JSON.stringify({ name, scripts: { [scriptName]: "echo ok" } }, null, 2),
    "utf8"
  );
  return await fs.realpath(dir);
}

async function req(urlPath: string, init: RequestInit & { tab?: string } = {}) {
  const headers: Record<string, string> = {
    host: "127.0.0.1:7421",
    ...(init.headers as Record<string, string> | undefined)
  };
  if (init.tab) headers["x-hardkas-tab"] = init.tab;
  if (init.body && !headers["content-type"]) headers["content-type"] = "application/json";
  return await app.request(`http://127.0.0.1:7421${urlPath}`, { ...init, headers });
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })));
});

after(async () => {
  await fs.rm(tempHome, { recursive: true, force: true });
});

describe("per-tab workspace isolation", () => {
  it("keeps distinct dApp workspaces isolated across tabs and starts fresh tabs on Home", async () => {
    const dappA = await makeWorkspace("dapp-alpha", "alpha-dev");
    const dappB = await makeWorkspace("dapp-beta", "beta-dev");

    // Tab A opens dappA; Tab B opens dappB.
    const openA = await req("/api/workspace/open", { method: "POST", body: JSON.stringify({ path: dappA }), tab: "tab-alpha" });
    assert.equal(openA.status, 200);
    const openB = await req("/api/workspace/open", { method: "POST", body: JSON.stringify({ path: dappB }), tab: "tab-beta" });
    assert.equal(openB.status, 200);

    // Tab A still sees dappA and only alpha-dev scripts; Tab B sees dappB and beta-dev scripts.
    const wsA = (await (await req("/api/workspace", { tab: "tab-alpha" })).json()) as { workspace: { root: string } };
    const wsB = (await (await req("/api/workspace", { tab: "tab-beta" })).json()) as { workspace: { root: string } };
    assert.equal(wsA.workspace.root, dappA);
    assert.equal(wsB.workspace.root, dappB);

    const scriptsA = (await (await req("/api/scripts", { tab: "tab-alpha" })).json()) as { packages: Array<{ scripts: Array<{ name: string }> }> };
    const scriptsB = (await (await req("/api/scripts", { tab: "tab-beta" })).json()) as { packages: Array<{ scripts: Array<{ name: string }> }> };
    assert.deepEqual(scriptsA.packages[0].scripts.map((s) => s.name), ["alpha-dev"]);
    assert.deepEqual(scriptsB.packages[0].scripts.map((s) => s.name), ["beta-dev"]);

    // Brand-new Tab C starts on Home (root: null), never inheriting Tab A or Tab B.
    const wsC = (await (await req("/api/workspace", { tab: "tab-gamma" })).json()) as { workspace: { root: string | null } };
    assert.equal(wsC.workspace.root, null);

    // Closing Tab A does not close Tab B.
    await req("/api/workspace/close", { method: "POST", tab: "tab-alpha" });
    const wsAAfter = (await (await req("/api/workspace", { tab: "tab-alpha" })).json()) as { workspace: { root: string | null } };
    const wsBAfter = (await (await req("/api/workspace", { tab: "tab-beta" })).json()) as { workspace: { root: string | null } };
    assert.equal(wsAAfter.workspace.root, null);
    assert.equal(wsBAfter.workspace.root, dappB);
  });
});
