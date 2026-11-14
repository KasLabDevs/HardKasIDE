import assert from "node:assert/strict";
import { promises as fs, mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";

// A temp home for the trust list and settings, and a server that never listens: these tests touch nothing real.
const home = mkdtempSync(path.join(os.tmpdir(), "hk-harden-home-"));
process.env.USERPROFILE = home;
process.env.HOME = home;
process.env.HARDKAS_IDE_NO_LISTEN = "1";

const guard = await import("../src/guard.ts");
const secretPaths = await import("../src/secretPaths.ts");
const workspace = await import("../src/workspace.ts");
const wsfs = await import("../src/fs.ts");
const { agentEnv } = await import("../src/acpAgent.ts");
const { isInternalAddress } = await import("../src/plugins.ts");

const temps: string[] = [home];
async function makeDir(prefix = "hk-harden-"): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  temps.push(dir);
  return dir;
}
async function makeProject(): Promise<string> {
  const dir = await makeDir("hk-harden-proj-");
  await fs.writeFile(path.join(dir, "hardkas.config.ts"), "export default {}\n", "utf8");
  return dir;
}

after(async () => {
  workspace.closeWorkspace();
  for (const d of temps) await fs.rm(d, { recursive: true, force: true });
});

describe("checkRequest: only the IDE page and local programs reach the API", () => {
  const hosts = guard.allowedHostnames({} as NodeJS.ProcessEnv);
  const origins = guard.ideOrigins(7421, { dev: false, env: {} as NodeJS.ProcessEnv });
  const check = (f: Partial<Parameters<typeof guard.checkRequest>[0]>) =>
    guard.checkRequest({ method: "POST", path: "/api/run", host: "127.0.0.1:7421", ...f }, hosts, origins);

  it("accepts the IDE's own origin, on every loopback name", () => {
    for (const o of ["http://127.0.0.1:7421", "http://localhost:7421", "http://[::1]:7421"]) assert.equal(check({ origin: o }).ok, true, o);
  });

  it("refuses a page on another port, another host, and Origin: null", () => {
    for (const o of ["http://localhost:8080", "http://127.0.0.1:5173", "https://evil.example", "null"]) {
      const v = check({ origin: o });
      assert.equal(v.ok, false, o);
      if (!v.ok) assert.equal(v.code, "FORBIDDEN_ORIGIN");
    }
  });

  it("refuses GETs from other pages too (a GET can read a file)", () => {
    assert.equal(check({ method: "GET", path: "/api/fs/file", origin: "http://localhost:8080" }).ok, false);
    assert.equal(check({ method: "GET", path: "/api/fs/file", secFetchSite: "cross-site" }).ok, false);
    assert.equal(check({ method: "GET", path: "/api/fs/file", secFetchSite: "same-site" }).ok, false);
  });

  it("trusts the browser's Sec-Fetch-Site over the Origin, and refuses a foreign Referer", () => {
    assert.equal(check({ origin: "http://127.0.0.1:7421", secFetchSite: "cross-site" }).ok, false);
    assert.equal(check({ method: "GET", path: "/api/plugins/fetch", referer: "http://localhost:8080/page" }).ok, false);
    assert.equal(check({ method: "GET", path: "/api/plugins/fetch", referer: "not a url" }).ok, false);
    assert.equal(check({ method: "GET", path: "/api/fs/file", referer: "http://127.0.0.1:7421/" }).ok, true);
  });

  it("accepts a local program that sends no Origin and no Sec-Fetch-Site (the MCP server)", () => {
    assert.equal(check({}).ok, true);
    assert.equal(check({ secFetchSite: "same-origin" }).ok, true);
  });

  it("lets plugin files load from anywhere, but only for reads", () => {
    assert.equal(check({ method: "GET", path: "/api/plugins/static/x/index.html", origin: "null" }).ok, true);
    assert.equal(check({ method: "POST", path: "/api/plugins/static/x/index.html", origin: "null" }).ok, false);
  });

  it("adds Vite's origin only in dev", () => {
    assert.equal(guard.ideOrigins(7421, { dev: true, env: {} as NodeJS.ProcessEnv }).has("http://localhost:5173"), true);
    assert.equal(origins.has("http://localhost:5173"), false);
  });

  it("refuses another Host before anything else", () => {
    const v = check({ host: "evil.example:7421", origin: "http://127.0.0.1:7421" });
    assert.equal(v.ok, false);
    if (!v.ok) assert.equal(v.code, "FORBIDDEN_HOST");
  });
});

describe("secret paths", () => {
  it("key stores are refused for everyone, whatever the spelling", () => {
    for (const p of [
      ".hardkas/accounts.real.json",
      ".HARDKAS/Accounts.Real.Json",
      ".hardkas/accounts.real.json.",
      ".hardkas/accounts.real.json::$DATA",
      ".hardkas/dev-accounts/alice.json",
      ".hardkas/backups/reset-1/accounts.real.json",
      ".hardkas/dev-server-token",
      "sub/my.keystore.json"
    ]) {
      assert.equal(secretPaths.isKeyStorePath(p), true, p);
    }
    for (const p of ["contracts/Vault.sil", ".hardkas/artifacts/silver/x.json", "README.md"]) assert.equal(secretPaths.isKeyStorePath(p), false, p);
  });

  it("private files are refused for agents, examples are not", () => {
    for (const p of [".env", ".env.local", "app/.env.production", "id_rsa", ".ssh/id_ed25519", "certs/server.pem", "a.p12", "b.pfx"]) {
      assert.equal(secretPaths.isAgentForbidden(p), true, p);
    }
    for (const p of [".env.example", ".env.sample", ".env.template", "src/env.ts", "contracts/Vault.sil"]) {
      assert.equal(secretPaths.isAgentForbidden(p), false, p);
    }
  });
});

describe("workspace: trust and refused folders", () => {
  it("a new folder is untrusted until trusted, and requireTrusted says so", async () => {
    const dir = await makeProject();
    assert.equal(await workspace.isTrusted(dir), false);
    await assert.rejects(workspace.requireTrusted(dir), (e: unknown) => e instanceof workspace.WorkspaceError && e.code === "UNTRUSTED_WORKSPACE" && e.status === 403);
    await workspace.trustFolder(dir);
    assert.equal(await workspace.isTrusted(dir), true);
    assert.equal(await workspace.isTrusted(path.join(dir, "contracts")), true, "subfolders inherit");
    await workspace.requireTrusted(dir);
  });

  it("opening an untrusted folder reports trusted: false and writes nothing into it", async () => {
    const dir = await makeDir();
    await fs.writeFile(path.join(dir, "package.json"), JSON.stringify({ dependencies: { "@hardkas/sdk": "0.13.0" } }), "utf8");
    const info = await workspace.openWorkspace(dir);
    assert.equal(info.trusted, false);
    assert.deepEqual(await fs.readdir(dir), ["package.json"], "no hardkas.config.ts created in an untrusted folder");
    workspace.closeWorkspace();
  });

  it("refuses the home folder, a drive root and the settings folders", async () => {
    for (const dir of [home, path.parse(home).root, path.join(home, ".hardkas-ide")]) {
      await fs.mkdir(dir, { recursive: true }).catch(() => undefined);
      await assert.rejects(workspace.openWorkspace(dir), (e: unknown) => e instanceof workspace.WorkspaceError && e.code === "NOT_A_PROJECT_FOLDER", dir);
    }
  });

  it("an agent may open only HardKas projects", async () => {
    const plain = await makeDir();
    await assert.rejects(workspace.openWorkspace(plain, { requireProject: true }), (e: unknown) => e instanceof workspace.WorkspaceError && e.code === "NOT_A_HARDKAS_PROJECT");
    const proj = await makeProject();
    assert.equal((await workspace.openWorkspace(proj, { requireProject: true })).root, await fs.realpath(proj));
    workspace.closeWorkspace();
  });
});

describe("workspace files: secrets and links", () => {
  it("refuses key stores to the user and private files to agents only", async () => {
    const dir = await makeProject();
    await fs.mkdir(path.join(dir, ".hardkas"), { recursive: true });
    await fs.writeFile(path.join(dir, ".hardkas", "accounts.real.json"), "{}", "utf8");
    await fs.writeFile(path.join(dir, ".env"), "SECRET=1", "utf8");
    await workspace.openWorkspace(dir);
    try {
      await assert.rejects(wsfs.readFile(".hardkas/accounts.real.json", "user"), (e: unknown) => e instanceof wsfs.FsError && e.code === "SECRET_FILE");
      await assert.rejects(wsfs.writeFile(".hardkas/accounts.real.json", "x", "user"), (e: unknown) => e instanceof wsfs.FsError && e.code === "SECRET_FILE");
      assert.equal(await wsfs.readFile(".env", "user"), "SECRET=1");
      await assert.rejects(wsfs.readFile(".env", "agent"), (e: unknown) => e instanceof wsfs.FsError && e.code === "SECRET_FILE");
      await assert.rejects(wsfs.remove(".hardkas", "user"), "a folder holding keys cannot be deleted");
      assert.equal(await fs.readFile(path.join(dir, ".hardkas", "accounts.real.json"), "utf8"), "{}");
    } finally {
      workspace.closeWorkspace();
    }
  });

  it("refuses Windows alternate data streams", { skip: process.platform !== "win32" }, async () => {
    const dir = await makeProject();
    await workspace.openWorkspace(dir);
    try {
      await assert.rejects(wsfs.writeFile("note.txt:hidden", "x"), (e: unknown) => e instanceof wsfs.FsError && e.code === "BAD_PATH");
      await assert.rejects(wsfs.readFile(".env::$DATA", "agent"), (e: unknown) => e instanceof wsfs.FsError);
    } finally {
      workspace.closeWorkspace();
    }
  });

  it("does not follow a link out of the workspace", async (t) => {
    const dir = await makeProject();
    const outside = await makeDir("hk-harden-outside-");
    await fs.writeFile(path.join(outside, "secret.txt"), "outside", "utf8");
    try {
      await fs.symlink(outside, path.join(dir, "linked"), "junction");
    } catch (error) {
      t.skip(`cannot create a directory link here: ${error instanceof Error ? error.message : String(error)}`);
      return;
    }
    await workspace.openWorkspace(dir);
    try {
      await assert.rejects(wsfs.readFile("linked/secret.txt"), (e: unknown) => e instanceof wsfs.FsError && e.code === "OUTSIDE_WORKSPACE");
      await assert.rejects(wsfs.writeFile("linked/new.txt", "x"), (e: unknown) => e instanceof wsfs.FsError && e.code === "OUTSIDE_WORKSPACE");
      await assert.rejects(fs.access(path.join(outside, "new.txt")));
      const names = JSON.stringify(await wsfs.readTree());
      assert.equal(names.includes("secret.txt"), false, "the tree does not walk into links");
    } finally {
      workspace.closeWorkspace();
    }
  });
});

describe("agentEnv: the agent gets an allow-listed environment", () => {
  it("drops keys and tokens, keeps what programs need, and disables project config", () => {
    const env = agentEnv("/tmp/agent-home", {
      PATH: "/usr/bin",
      ANTHROPIC_API_KEY: "sk-ant-x",
      OPENAI_API_KEY: "sk-x",
      GITHUB_TOKEN: "ghp_x",
      AWS_SECRET_ACCESS_KEY: "x",
      NPM_TOKEN: "x"
    } as NodeJS.ProcessEnv);
    for (const k of ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GITHUB_TOKEN", "AWS_SECRET_ACCESS_KEY", "NPM_TOKEN"]) assert.equal(env[k], undefined, k);
    assert.ok(env.PATH ?? env.Path, "PATH is kept");
    assert.equal(env.OPENCODE_DISABLE_PROJECT_CONFIG, "1");
    assert.equal(env.OPENCODE_CONFIG_PROJECT_DISABLE, "1");
  });
});

describe("plugin fetch: internal addresses", () => {
  it("recognizes loopback, private, link-local and mapped addresses", () => {
    for (const a of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:127.0.0.1", "[::1]"]) {
      assert.equal(isInternalAddress(a), true, a);
    }
    for (const a of ["8.8.8.8", "1.1.1.1", "172.32.0.1", "2606:4700::1111"]) assert.equal(isInternalAddress(a), false, a);
  });
});

describe("routes (app.request, no socket)", async () => {
  const { app } = await import("../src/index.ts");
  const call = (p: string, init: RequestInit & { headers?: Record<string, string> } = {}) =>
    app.request(`http://127.0.0.1:7421${p}`, { ...init, headers: { host: "127.0.0.1:7421", ...(init.headers ?? {}) } });

  it("/api/info names the server and its version", async () => {
    const res = await call("/api/info");
    const body = (await res.json()) as { name: string; version: string };
    assert.equal(body.name, "hardkas-ide-server");
    assert.match(body.version, /^\d+\.\d+\.\d+/);
  });

  it("a page on another origin cannot start a job or read a file", async () => {
    const run = await call("/api/run", { method: "POST", headers: { origin: "http://localhost:8080", "content-type": "application/json" }, body: JSON.stringify({ args: ["--version"] }) });
    assert.equal(run.status, 403);
    const read = await call("/api/fs/file?path=README.md", { headers: { origin: "null" } });
    assert.equal(read.status, 403);
  });

  it("an agent cannot trust a folder, and an untrusted folder runs nothing", async () => {
    const dir = await makeProject();
    const open = await call("/api/workspace/open", { method: "POST", headers: { "content-type": "application/json", "x-hardkas-client": "mcp" }, body: JSON.stringify({ path: dir }) });
    assert.equal(open.status, 200);
    const trust = await call("/api/workspace/trust", { method: "POST", headers: { "x-hardkas-client": "mcp" } });
    assert.equal(trust.status, 403);
    const run = await call("/api/run", { method: "POST", headers: { "content-type": "application/json", "x-hardkas-client": "mcp" }, body: JSON.stringify({ args: ["--version"] }) });
    assert.equal(run.status, 403);
    assert.equal(((await run.json()) as { code: string }).code, "UNTRUSTED_WORKSPACE");
    workspace.closeWorkspace();
  });

  it("an agent gets no .env, the user does", async () => {
    const dir = await makeProject();
    await fs.writeFile(path.join(dir, ".env"), "SECRET=1", "utf8");
    await call("/api/workspace/open", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ path: dir }) });
    const agent = await call("/api/fs/file?path=.env", { headers: { "x-hardkas-client": "mcp" } });
    assert.equal(agent.status, 403);
    const user = await call("/api/fs/file?path=.env");
    assert.equal(user.status, 200);
    workspace.closeWorkspace();
  });

  it("plugin files are served with a sandbox CSP", async () => {
    const res = await call("/api/plugins/examples/hello/index.html", { headers: { origin: "null" } });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-security-policy"), guard.SANDBOX_CSP);
    assert.equal(res.headers.get("x-content-type-options"), "nosniff");
  });
});
