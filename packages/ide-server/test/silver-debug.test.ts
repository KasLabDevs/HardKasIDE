import assert from "node:assert/strict";
import { promises as fs, mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";

// A temp home (settings, trust list) and a runner path that is a plain test file: nothing real is touched or run.
const home = mkdtempSync(path.join(os.tmpdir(), "hk-sildbg-home-"));
process.env.USERPROFILE = home;
process.env.HOME = home;
process.env.HARDKAS_IDE_NO_LISTEN = "1";
const fakeRunner = path.join(home, "cli-debugger-test-file");
process.env.HARDKAS_SILVER_RUNNER = fakeRunner;

const dbg = await import("../src/silverDebug.ts");
const settings = await import("../src/ideSettings.ts");
const { app } = await import("../src/index.ts");

after(async () => {
  await fs.rm(home, { recursive: true, force: true });
});

// The runner's own text (cli-debugger v1.0.0, captured from a real session on the Vault template).
const STEP = `    18 |     require(withdrawSompi <= maxWithdrawSompi);
    19 |     require(tx.inputs.length == 1);
→   24 |     require(tx.outputs[0].scriptPubKey == selfSpk);
    25 |     require(tx.outputs[0].value >= currentBalance - withdrawSompi);
Constructor Args:
  maxWithdrawSompi (int) = 1000
  owner (pubkey) = 0x4f35
Call Arguments:
  ownerSig (sig) = 0x66ea
  withdrawSompi (int) = 300
Locals:
  currentBalance (int) = 5000
  selfSpk (byte[]) = [0x00, 0x00, 0xaa]
`;

const FAIL = `error: script ran, but verification failed
   --> 18:5
   |
17 |     require(withdrawSompi > 0);
18 |     require(withdrawSompi <= maxWithdrawSompi);
   |     ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^ verification failed here
`;

describe("parseReply: the runner's text", () => {
  it("reads the current line and every variable section", () => {
    const r = dbg.parseReply(STEP);
    assert.equal(r.line, 24);
    assert.deepEqual(
      r.variables.map((v) => `${v.section}/${v.name}/${v.type}/${v.value}`),
      [
        "Constructor Args/maxWithdrawSompi/int/1000",
        "Constructor Args/owner/pubkey/0x4f35",
        "Call Arguments/ownerSig/sig/0x66ea",
        "Call Arguments/withdrawSompi/int/300",
        "Locals/currentBalance/int/5000",
        "Locals/selfSpk/byte[]/[0x00, 0x00, 0xaa]"
      ]
    );
    assert.equal(r.error, null);
    assert.equal(r.done, false);
  });

  it("reads the stack", () => {
    assert.deepEqual(dbg.parseReply("Stack:\n[0] 8813\n[1] 0000aa20\n").stack, ["8813", "0000aa20"]);
  });

  it("reads a rejection with its line and column", () => {
    const r = dbg.parseReply(FAIL);
    assert.deepEqual(r.error, { message: "script ran, but verification failed", line: 18, column: 5 });
  });

  it("knows when the entry ran to the end", () => {
    assert.equal(dbg.parseReply("Done.\n").done, true);
  });
});

describe("runner approval", () => {
  it("reports a missing runner with how to build it", async () => {
    const info = await dbg.runnerInfo();
    assert.equal(info.available, false);
    assert.match(info.message, /cargo build --release -p cli-debugger/);
  });

  it("is unapproved until that exact build is approved, and a changed build needs a new approval", async () => {
    await fs.writeFile(fakeRunner, "build one", "utf8");
    let info = await dbg.runnerInfo();
    assert.equal(info.available, true);
    assert.equal(info.approved, false);
    assert.equal(info.trust, "UNVERIFIED");

    const call = (p: string, init: RequestInit & { headers?: Record<string, string> } = {}) =>
      app.request(`http://127.0.0.1:7421${p}`, { ...init, headers: { host: "127.0.0.1:7421", "content-type": "application/json", ...(init.headers ?? {}) } });

    const agent = await call("/api/silver-debug/approve", { method: "POST", headers: { "x-hardkas-client": "mcp" }, body: JSON.stringify({ sha256: info.sha256 }) });
    assert.equal(agent.status, 403, "an agent cannot approve a runner");
    const stale = await call("/api/silver-debug/approve", { method: "POST", body: JSON.stringify({ sha256: "0".repeat(64) }) });
    assert.equal(stale.status, 409, "approving a build other than the one on disk is refused");
    const ok = await call("/api/silver-debug/approve", { method: "POST", body: JSON.stringify({ sha256: info.sha256 }) });
    assert.equal(ok.status, 200);
    assert.equal((await dbg.runnerInfo()).approved, true);

    await fs.writeFile(fakeRunner, "build two", "utf8");
    info = await dbg.runnerInfo();
    assert.equal(info.approved, false, "a different binary is not approved");
  });

  it("refuses to start without an open, trusted workspace", async () => {
    await assert.rejects(dbg.startSession({ file: "a.sil", entry: "spend", constructorArgs: [], args: [] }), (e: unknown) => (e as { code?: string }).code === "NO_WORKSPACE");
  });
});

describe("third-party extensions switch", () => {
  const call = (p: string, init: RequestInit & { headers?: Record<string, string> } = {}) =>
    app.request(`http://127.0.0.1:7421${p}`, { ...init, headers: { host: "127.0.0.1:7421", "content-type": "application/json", ...(init.headers ?? {}) } });

  it("is off by default: installs, searches and third-party files are refused, the list is empty", async () => {
    assert.equal((await settings.readIdeSettings()).thirdPartyExtensions, false);
    assert.deepEqual(await (await call("/api/vsx/installed")).json(), { ok: true, installed: [] });
    for (const [method, p, body] of [
      ["POST", "/api/vsx/install", { namespace: "a", name: "b" }],
      ["GET", "/api/vsx/search?q=theme", undefined],
      ["POST", "/api/plugins/npm", { package: "x" }],
      ["GET", "/api/plugins/search?q=x", undefined],
      ["GET", "/api/plugins/static/x/index.html", undefined],
      ["GET", "/api/plugins/fetch?url=https%3A%2F%2Fexample.com%2Fp.json", undefined]
    ] as const) {
      const res = await call(p, { method, ...(body ? { body: JSON.stringify(body) } : {}) });
      assert.equal(res.status, 403, `${method} ${p}`);
      assert.equal(((await res.json()) as { code: string }).code, "EXTENSIONS_OFF", `${method} ${p}`);
    }
  });

  it("keeps the bundled example plugins", async () => {
    const res = await call("/api/plugins/examples/hello/index.html");
    assert.equal(res.status, 200);
  });

  it("only the user can turn it on, and then the routes answer again", async () => {
    const agent = await call("/api/settings", { method: "POST", headers: { "x-hardkas-client": "mcp" }, body: JSON.stringify({ thirdPartyExtensions: true }) });
    assert.equal(agent.status, 403);
    const on = await call("/api/settings", { method: "POST", body: JSON.stringify({ thirdPartyExtensions: true }) });
    assert.equal(((await on.json()) as { settings: { thirdPartyExtensions: boolean } }).settings.thirdPartyExtensions, true);
    const npm = await call("/api/plugins/npm", { method: "POST", body: JSON.stringify({ package: "../x" }) });
    assert.equal(((await npm.json()) as { code: string }).code, "BAD_PACKAGE", "past the switch, the route's own checks apply");
    await call("/api/settings", { method: "POST", body: JSON.stringify({ thirdPartyExtensions: false }) });
  });
});
