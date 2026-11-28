import assert from "node:assert/strict";
import { promises as fs, mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, afterEach, describe, it } from "node:test";

const tempHome = mkdtempSync(path.join(os.tmpdir(), "hardkas-ide-scripts-home-"));
process.env.USERPROFILE = tempHome;
process.env.HOME = tempHome;
process.env.HARDKAS_IDE_NO_LISTEN = "1";

const { classifyScript, detectPackageManager, discoverWorkspaceScripts, resolvePackageScript } = await import("../src/scripts.js");
const { openScriptTerminal } = await import("../src/terminal.js");
const workspace = await import("../src/workspace.js");

const tempDirs: string[] = [];

async function makeTempRoot(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "hardkas-ide-scripts-"));
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

describe("classifyScript", () => {
  it("distinguishes launch, build, test and deploy scripts without misclassifying vite build", () => {
    assert.equal(classifyScript("dev", "vite --port 5173"), "launch");
    assert.equal(classifyScript("preview", "vite preview --port 5173"), "launch");
    assert.equal(classifyScript("dev:server", "tsx watch src/index.ts"), "launch");
    assert.equal(classifyScript("dapp", "node dapp/serve.mjs"), "launch");
    assert.equal(classifyScript("start", "node dist/index.js"), "launch");
    assert.equal(classifyScript("build", "tsc --noEmit && vite build"), "build");
    assert.equal(classifyScript("typecheck", "pnpm -r run typecheck"), "build");
    assert.equal(classifyScript("test", "vitest run"), "test");
    assert.equal(classifyScript("deploy", "npx wrangler pages deploy dist/site"), "deploy");
    assert.equal(classifyScript("seed", "node scripts/seed.mjs"), "other");
  });
});

describe("detectPackageManager & discoverWorkspaceScripts", () => {
  it("scans root + subpackages, skips ignored dirs, and detects pnpm/yarn/bun/npm properly", async () => {
    const root = await makeTempRoot();
    await fs.writeFile(path.join(root, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n", "utf8");
    await fs.writeFile(
      path.join(root, "package.json"),
      JSON.stringify({
        name: "my-monorepo",
        scripts: {
          dev: "pnpm -r --parallel run dev",
          build: "pnpm -r run build"
        }
      }),
      "utf8"
    );

    const webDir = path.join(root, "apps", "web");
    await fs.mkdir(webDir, { recursive: true });
    await fs.writeFile(
      path.join(webDir, "package.json"),
      JSON.stringify({
        name: "@app/web",
        scripts: {
          dev: "vite --port 5173",
          deploy: "npx wrangler pages deploy dist"
        }
      }),
      "utf8"
    );

    const apiDir = path.join(root, "apps", "api");
    await fs.mkdir(apiDir, { recursive: true });
    await fs.writeFile(path.join(apiDir, "yarn.lock"), "# yarn\n", "utf8");
    await fs.writeFile(
      path.join(apiDir, "package.json"),
      JSON.stringify({
        name: "@app/api",
        scripts: {
          start: "node server.js",
          test: "vitest run"
        }
      }),
      "utf8"
    );

    const emptyPkg = path.join(root, "packages", "types");
    await fs.mkdir(emptyPkg, { recursive: true });
    await fs.writeFile(path.join(emptyPkg, "package.json"), JSON.stringify({ name: "@app/types" }), "utf8");

    const nmPkg = path.join(root, "node_modules", "ignored-dep");
    await fs.mkdir(nmPkg, { recursive: true });
    await fs.writeFile(path.join(nmPkg, "package.json"), JSON.stringify({ name: "ignored", scripts: { test: "echo no" } }), "utf8");

    const hiddenPkg = path.join(root, ".hardkas");
    await fs.mkdir(hiddenPkg, { recursive: true });
    await fs.writeFile(path.join(hiddenPkg, "package.json"), JSON.stringify({ name: "hidden", scripts: { dev: "echo no" } }), "utf8");

    const found = await discoverWorkspaceScripts(root);
    assert.deepEqual(
      found.map((p) => p.relDir),
      [".", "apps/api", "apps/web"]
    );
    assert.equal(found[0].manager, "pnpm");
    assert.equal(found[2].manager, "pnpm"); // inherited from workspace root
    assert.equal(found[1].manager, "yarn"); // child lockfile overrides parent
    assert.equal(found[2].scripts[0].cliPreview, "pnpm run dev");
    assert.equal(found[2].scripts[1].kind, "deploy");
  });

  it("honors packageManager field and bun lockfiles", async () => {
    const root = await makeTempRoot();
    await fs.writeFile(path.join(root, "bun.lock"), "", "utf8");
    await fs.writeFile(path.join(root, "package.json"), JSON.stringify({ name: "bun-app" }), "utf8");
    assert.equal(await detectPackageManager(root, root), "bun");

    await fs.writeFile(path.join(root, "package.json"), JSON.stringify({ name: "bun-app", packageManager: "npm@10.9.0" }), "utf8");
    assert.equal(await detectPackageManager(root, root), "npm");
  });
});

describe("resolvePackageScript & trust boundary", () => {
  it("resolves declared scripts and rejects unknown scripts or path escapes", async () => {
    const root = await makeTempRoot();
    await fs.mkdir(path.join(root, "web"), { recursive: true });
    await fs.writeFile(
      path.join(root, "web", "package.json"),
      JSON.stringify({ name: "web", scripts: { dev: "vite", "bad&cmd": "echo x" } }),
      "utf8"
    );

    const ok = await resolvePackageScript(root, "web", "dev");
    assert.equal(ok.script, "dev");
    assert.equal(ok.manager, "npm");
    assert.equal(ok.cliPreview, "npm run dev");

    await assert.rejects(
      resolvePackageScript(root, "web", "missing"),
      (e: unknown) => e instanceof workspace.WorkspaceError && e.code === "SCRIPT_NOT_FOUND"
    );
    await assert.rejects(
      resolvePackageScript(root, "../outside", "dev"),
      (e: unknown) => e instanceof workspace.WorkspaceError && e.code === "OUTSIDE_WORKSPACE"
    );
    await assert.rejects(
      resolvePackageScript(root, "web", "bad&cmd"),
      (e: unknown) => e instanceof workspace.WorkspaceError && e.code === "BAD_SCRIPT_NAME"
    );
  });

  it("refuses openScriptTerminal in an untrusted workspace", async () => {
    const root = await makeTempRoot();
    await fs.writeFile(path.join(root, "package.json"), JSON.stringify({ name: "untrusted", scripts: { dev: "vite" } }), "utf8");
    await workspace.openWorkspace(root);
    await assert.rejects(
      openScriptTerminal({ pkgDir: ".", script: "dev" }),
      (e: unknown) => e instanceof workspace.WorkspaceError && e.code === "UNTRUSTED_WORKSPACE"
    );
  });

  it("/api/scripts route answers cleanly with 409 before workspace open and lists packages once open", async () => {
    const { app } = await import("../src/index.ts");
    const call = (p: string) => app.request(`http://127.0.0.1:7421${p}`, { headers: { host: "127.0.0.1:7421" } });

    const before = await call("/api/scripts");
    assert.equal(before.status, 409);

    const root = await makeTempRoot();
    await fs.writeFile(path.join(root, "package.json"), JSON.stringify({ name: "demo", scripts: { dev: "vite" } }), "utf8");
    await workspace.openWorkspace(root);

    const after = await call("/api/scripts");
    assert.equal(after.status, 200);
    const body = (await after.json()) as { ok: boolean; packages: Array<{ name: string; scripts: Array<{ name: string }> }> };
    assert.equal(body.ok, true);
    assert.equal(body.packages.length, 1);
    assert.equal(body.packages[0].scripts[0].name, "dev");
  });
});
