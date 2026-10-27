import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import { HARDKAS_CLI_VERSION } from "../src/runner.js";
import { checkUpdates, compareSemver, parseSemver } from "../src/updates.js";

const origFetch = globalThis.fetch;
const origIdeUrl = process.env.HARDKAS_IDE_UPDATES_URL;
const origNpmUrl = process.env.HARDKAS_CLI_NPM_URL;
const tempDirs: string[] = [];

async function makeTempWorkspace(opts: {
  lockfile?: "pnpm-lock.yaml" | "yarn.lock" | "package-lock.json";
  cliDep?: string;
  cliDevDep?: string;
  installedCliVersion?: string;
}): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "hardkas-ide-upd-"));
  tempDirs.push(dir);
  if (opts.lockfile) {
    await fs.writeFile(path.join(dir, opts.lockfile), "# lockfile\n", "utf8");
  }
  const pkg: Record<string, unknown> = { name: "test-ws", private: true };
  if (opts.cliDep) pkg.dependencies = { "@hardkas/cli": opts.cliDep };
  if (opts.cliDevDep) pkg.devDependencies = { "@hardkas/cli": opts.cliDevDep };
  await fs.writeFile(path.join(dir, "package.json"), JSON.stringify(pkg, null, 2), "utf8");
  if (opts.installedCliVersion) {
    const cliDir = path.join(dir, "node_modules", "@hardkas", "cli");
    await fs.mkdir(cliDir, { recursive: true });
    await fs.writeFile(path.join(cliDir, "package.json"), JSON.stringify({ name: "@hardkas/cli", version: opts.installedCliVersion }), "utf8");
  }
  return dir;
}

afterEach(async () => {
  globalThis.fetch = origFetch;
  if (origIdeUrl === undefined) delete process.env.HARDKAS_IDE_UPDATES_URL;
  else process.env.HARDKAS_IDE_UPDATES_URL = origIdeUrl;
  if (origNpmUrl === undefined) delete process.env.HARDKAS_CLI_NPM_URL;
  else process.env.HARDKAS_CLI_NPM_URL = origNpmUrl;
  while (tempDirs.length > 0) {
    const d = tempDirs.pop()!;
    await fs.rm(d, { recursive: true, force: true }).catch(() => {});
  }
});

describe("semver parsing and comparison", () => {
  it("parses release tags and compares stable and prerelease versions", () => {
    assert.deepEqual(parseSemver("v0.13.0-rc.1"), {
      major: 0,
      minor: 13,
      patch: 0,
      pre: ["rc", 1]
    });
    assert.equal(parseSemver("not-a-version"), null);
    assert.equal(compareSemver("0.3.0", "0.2.0"), 1);
    assert.equal(compareSemver("v0.2.0", "0.2.0"), 0);
    assert.equal(compareSemver("0.13.0-rc.2", "0.13.0-rc.1"), 1);
    assert.equal(compareSemver("0.13.0", "0.13.0-rc.1"), 1);
    assert.equal(compareSemver("0.12.0-rc.27", "0.13.0-rc.1"), -1);
  });
});

describe("checkUpdates", () => {
  it("detects newer IDE release, selects matching asset, and detects outdated pnpm workspace CLI", async () => {
    const ws = await makeTempWorkspace({
      lockfile: "pnpm-lock.yaml",
      cliDep: "0.12.0-rc.27",
      installedCliVersion: "0.12.0-rc.27"
    });
    const ideUrl = `https://example.invalid/ide/${Date.now()}-1`;
    const npmUrl = `https://example.invalid/npm/${Date.now()}-1`;
    process.env.HARDKAS_IDE_UPDATES_URL = ideUrl;
    process.env.HARDKAS_CLI_NPM_URL = npmUrl;

    globalThis.fetch = (async (input: string | URL | Request) => {
      const u = String(input);
      if (u === ideUrl) {
        return new Response(
          JSON.stringify({
            tag_name: "v0.3.0",
            name: "HardKas IDE v0.3.0",
            html_url: "https://github.com/KasLabDevs/HardKasIDE/releases/tag/v0.3.0",
            published_at: "2026-11-13T00:00:00Z",
            body: "Centered search bar and update checker.",
            assets: [
              { name: "HardKas-IDE-setup.exe", browser_download_url: "https://dl.example/win.exe" },
              { name: "HardKas-IDE.dmg", browser_download_url: "https://dl.example/mac.dmg" },
              { name: "HardKas-IDE.AppImage", browser_download_url: "https://dl.example/linux.AppImage" }
            ]
          }),
          { status: 200 }
        );
      }
      if (u === npmUrl) {
        return new Response(JSON.stringify({ latest: HARDKAS_CLI_VERSION, next: HARDKAS_CLI_VERSION }), { status: 200 });
      }
      return new Response("not found", { status: 404 });
    }) as typeof fetch;

    const report = await checkUpdates({ cwd: ws, currentIdeVersion: "0.2.0", force: true });
    assert.equal(report.ide.hasUpdate, true);
    assert.equal(report.ide.latestVersion, "0.3.0");
    assert.equal(report.ide.notes, "Centered search bar and update checker.");
    const expectedUrl =
      process.platform === "win32"
        ? "https://dl.example/win.exe"
        : process.platform === "darwin"
          ? "https://dl.example/mac.dmg"
          : "https://dl.example/linux.AppImage";
    assert.equal(report.ide.downloadUrl, expectedUrl);

    assert.equal(report.cli.hasUpdate, true);
    assert.equal(report.cli.reason, "project-behind");
    assert.equal(report.cli.projectVersion, "0.12.0-rc.27");
    assert.equal(report.cli.updateCommand, `pnpm add @hardkas/cli@${HARDKAS_CLI_VERSION}`);
  });

  it("degrades cleanly offline without throwing and honors 15m URL cache unless forced", async () => {
    const ws = await makeTempWorkspace({
      lockfile: "package-lock.json",
      cliDevDep: HARDKAS_CLI_VERSION,
      installedCliVersion: HARDKAS_CLI_VERSION
    });
    const ideUrl = `https://example.invalid/ide/${Date.now()}-2`;
    const npmUrl = `https://example.invalid/npm/${Date.now()}-2`;
    process.env.HARDKAS_IDE_UPDATES_URL = ideUrl;
    process.env.HARDKAS_CLI_NPM_URL = npmUrl;

    let ideFetches = 0;
    globalThis.fetch = (async (input: string | URL | Request) => {
      const u = String(input);
      if (u === ideUrl) {
        ideFetches++;
        if (ideFetches === 1) throw new Error("network down");
        return new Response(JSON.stringify({ tag_name: "v0.2.0", html_url: "https://github.com/KasLabDevs/HardKasIDE/releases/tag/v0.2.0", assets: [] }), { status: 200 });
      }
      return new Response(JSON.stringify({ latest: "0.14.0" }), { status: 200 });
    }) as typeof fetch;

    const offline = await checkUpdates({ cwd: ws, currentIdeVersion: "0.2.0", force: false });
    assert.equal(offline.ide.hasUpdate, false);
    assert.match(offline.ide.error ?? "", /network down/);
    assert.equal(offline.cli.targetVersion, "0.14.0");
    assert.equal(offline.cli.updateCommand, "npm install -D @hardkas/cli@0.14.0");

    // Non-forced second call hits cache.
    await checkUpdates({ cwd: ws, currentIdeVersion: "0.2.0", force: false });
    assert.equal(ideFetches, 1);

    // Forced call refreshes remote state.
    const online = await checkUpdates({ cwd: ws, currentIdeVersion: "0.2.0", force: true });
    assert.equal(ideFetches, 2);
    assert.equal(online.ide.error, null);
    assert.equal(online.ide.latestVersion, "0.2.0");
    assert.equal(online.ide.hasUpdate, false);
  });
});
