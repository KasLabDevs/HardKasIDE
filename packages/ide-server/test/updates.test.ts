import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import { HARDKAS_CLI_VERSION } from "../src/runner.js";
import { checkUpdates, compareSemver, parseSemver, pickPlatformAsset, releaseLink } from "../src/updates.js";

const DL = "https://github.com/KasLabDevs/HardKasIDE/releases/download/v0.3.0/";
/** The assets build-desktop.yml publishes (Tauri bundle names, as GitHub renames them), for every platform it builds. */
const RELEASE_ASSETS = [
  "HardKas-IDE-setup.exe",
  "HardKas.IDE_0.3.0_x64-setup.exe",
  "HardKas.IDE_0.3.0_arm64-setup.exe",
  "HardKas.IDE_0.3.0_x64_en-US.msi",
  "HardKas.IDE_0.3.0_aarch64.dmg",
  "HardKas.IDE_0.3.0_x64.dmg",
  "hardkas-ide_0.3.0_amd64.AppImage",
  "hardkas-ide_0.3.0_amd64.deb",
  "hardkas-ide_0.3.0_aarch64.AppImage",
  "hardkas-ide_0.3.0_arm64.deb"
].map((name) => ({ name, browser_download_url: DL + name }));
const only = (...names: string[]) => names.map((name) => ({ name, browser_download_url: DL + name }));

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
            assets: RELEASE_ASSETS
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
    assert.equal(report.ide.releaseUrl, "https://github.com/KasLabDevs/HardKasIDE/releases/tag/v0.3.0");
    assert.equal(report.ide.downloadUrl, pickPlatformAsset(RELEASE_ASSETS));

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

  /** Serves `release` as the IDE releases API and returns the IDE part of the report. */
  async function ideReport(release: unknown, n: string) {
    const ws = await makeTempWorkspace({ lockfile: "pnpm-lock.yaml" });
    const ideUrl = `https://example.invalid/ide/${Date.now()}-${n}`;
    process.env.HARDKAS_IDE_UPDATES_URL = ideUrl;
    process.env.HARDKAS_CLI_NPM_URL = `https://example.invalid/npm/${Date.now()}-${n}`;
    globalThis.fetch = (async (input: string | URL | Request) =>
      String(input) === ideUrl
        ? new Response(JSON.stringify(release), { status: 200 })
        : new Response(JSON.stringify({ latest: HARDKAS_CLI_VERSION }), { status: 200 })) as typeof fetch;
    return (await checkUpdates({ cwd: ws, currentIdeVersion: "0.2.0", force: true })).ide;
  }

  it("drops a download link or a release page outside this repository's GitHub releases", async () => {
    const ide = await ideReport(
      {
        tag_name: "v0.3.0",
        html_url: "https://evil.example/KasLabDevs/HardKasIDE/releases/tag/v0.3.0",
        assets: RELEASE_ASSETS.map((a) => ({ ...a, browser_download_url: a.browser_download_url.replace("github.com", "evil.example") }))
      },
      "3"
    );
    assert.equal(ide.latestVersion, "0.3.0");
    assert.equal(ide.downloadUrl, null);
    assert.equal(ide.releaseUrl, "https://github.com/KasLabDevs/HardKasIDE/releases");
  });

  it("ignores prereleases and drafts", async () => {
    for (const flags of [{ prerelease: true }, { draft: true }]) {
      const ide = await ideReport({ tag_name: "v0.4.0", html_url: `${DL}x`, assets: RELEASE_ASSETS, ...flags }, `4-${Object.keys(flags)[0]}`);
      assert.equal(ide.latestVersion, null, JSON.stringify(flags));
      assert.equal(ide.hasUpdate, false, JSON.stringify(flags));
      assert.equal(ide.downloadUrl, null, JSON.stringify(flags));
    }
    // A list (the /releases endpoint): the newest release that is neither a draft nor a prerelease.
    const ide = await ideReport(
      [
        { tag_name: "v0.5.0", draft: true, assets: RELEASE_ASSETS },
        { tag_name: "v0.4.0-rc.1", prerelease: true, assets: RELEASE_ASSETS },
        { tag_name: "v0.3.0", prerelease: false, draft: false, assets: RELEASE_ASSETS },
        { tag_name: "v0.2.0", assets: RELEASE_ASSETS }
      ],
      "5"
    );
    assert.equal(ide.latestVersion, "0.3.0");
    assert.equal(ide.hasUpdate, true);
  });
});

describe("pickPlatformAsset", () => {
  it("picks the installer for the running platform and architecture", () => {
    const cases: Array<[NodeJS.Platform, string, string]> = [
      ["win32", "x64", "HardKas-IDE-setup.exe"],
      ["win32", "arm64", "HardKas.IDE_0.3.0_arm64-setup.exe"],
      ["darwin", "x64", "HardKas.IDE_0.3.0_x64.dmg"],
      ["darwin", "arm64", "HardKas.IDE_0.3.0_aarch64.dmg"],
      ["linux", "x64", "hardkas-ide_0.3.0_amd64.AppImage"],
      ["linux", "arm64", "hardkas-ide_0.3.0_aarch64.AppImage"]
    ];
    for (const [platform, arch, name] of cases) {
      assert.equal(pickPlatformAsset(RELEASE_ASSETS, platform, arch), DL + name, `${platform}-${arch}`);
    }
  });

  it("never hands an Intel Mac an aarch64 build, but takes a universal one", () => {
    assert.equal(pickPlatformAsset(only("HardKas.IDE_0.3.0_aarch64.dmg"), "darwin", "x64"), null);
    assert.equal(pickPlatformAsset(only("HardKas.IDE_0.3.0_x64.dmg"), "darwin", "arm64"), null);
    assert.equal(pickPlatformAsset(only("HardKas.IDE_0.3.0_universal.dmg"), "darwin", "x64"), DL + "HardKas.IDE_0.3.0_universal.dmg");
  });

  it("keeps Windows arm64 and x64 apart and never falls back to any .exe", () => {
    const x64Only = only("HardKas-IDE-setup.exe", "HardKas.IDE_0.3.0_x64-setup.exe", "HardKas.IDE_0.3.0_x64_en-US.msi");
    assert.equal(pickPlatformAsset(x64Only, "win32", "arm64"), null);
    assert.equal(pickPlatformAsset(only("HardKas.IDE_0.3.0_arm64-setup.exe"), "win32", "x64"), null);
    assert.equal(pickPlatformAsset(only("HardKas.IDE_0.3.0_x64-setup.exe"), "win32", "x64"), DL + "HardKas.IDE_0.3.0_x64-setup.exe");
    assert.equal(pickPlatformAsset(only("HardKas.IDE_0.3.0_x64_en-US.msi"), "win32", "x64"), DL + "HardKas.IDE_0.3.0_x64_en-US.msi");
    assert.equal(pickPlatformAsset(only("tool.exe", "uninstall.exe", "HardKas.IDE.exe"), "win32", "x64"), null);
  });

  it("returns nothing for an architecture or platform no installer is built for", () => {
    assert.equal(pickPlatformAsset(RELEASE_ASSETS, "win32", "ia32"), null);
    assert.equal(pickPlatformAsset(RELEASE_ASSETS, "freebsd", "x64"), null);
    assert.equal(pickPlatformAsset(only("hardkas-ide_0.3.0_amd64.AppImage"), "linux", "arm64"), null);
  });
});

describe("releaseLink", () => {
  it("accepts only links into this repository's GitHub releases", () => {
    assert.equal(releaseLink(`${DL}HardKas-IDE-setup.exe`), `${DL}HardKas-IDE-setup.exe`);
    assert.equal(releaseLink("https://github.com/KasLabDevs/HardKasIDE/releases/tag/v0.3.0"), "https://github.com/KasLabDevs/HardKasIDE/releases/tag/v0.3.0");
    for (const bad of [
      "http://github.com/KasLabDevs/HardKasIDE/releases/tag/v0.3.0",
      "https://github.com.evil.example/KasLabDevs/HardKasIDE/releases/tag/v0.3.0",
      "https://evil.example/https://github.com/KasLabDevs/HardKasIDE/releases/",
      "https://github.com/KasLabDevs/HardKasIDEvil/releases/download/v0.3.0/x.exe",
      "https://github.com/Other/HardKasIDE/releases/download/v0.3.0/x.exe",
      "https://github.com/KasLabDevs/HardKasIDE/releases/../../../Other/x/releases/download/x.exe",
      "https://user:pw@github.com/KasLabDevs/HardKasIDE/releases/tag/v0.3.0",
      "https://github.com:8443/KasLabDevs/HardKasIDE/releases/tag/v0.3.0",
      "https://github.com/KasLabDevs/HardKasIDE/releases",
      "javascript:alert(1)",
      "not a url",
      42,
      null
    ]) {
      assert.equal(releaseLink(bad), null, String(bad));
    }
  });
});
