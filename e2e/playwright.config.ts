import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "@playwright/test";

/**
 * End-to-end smoke test of the IDE: the real server (serving the built UI from apps/ide/dist) in a real browser.
 *
 * The server runs with its home folder pointed at a throwaway directory, so the test never touches the user's
 * ~/.hardkas-ide (recent projects, trusted folders, assistant settings). Locally it drives the installed Chrome
 * (no browser download); on CI it uses Playwright's Chromium (`pnpm exec playwright install chromium`).
 *
 *   pnpm test:e2e          builds the UI, then runs this suite
 */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const E2E_PORT = Number(process.env.E2E_PORT ?? 7461);
export const E2E_DIR = path.join(os.tmpdir(), "hardkas-ide-e2e");
const home = path.join(E2E_DIR, "home");

// The config is loaded by the runner and again by every worker: only the runner starts from a clean folder.
if (!process.env.TEST_WORKER_INDEX) {
  fs.rmSync(E2E_DIR, { recursive: true, force: true });
  fs.mkdirSync(home, { recursive: true });
}

export default defineConfig({
  testDir: ".",
  testMatch: "*.spec.ts",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  retries: process.env.CI ? 1 : 0,
  workers: 1, // one server, one browser: the tests share its workspace state
  reporter: process.env.CI ? [["list"], ["html", { open: "never", outputFolder: path.join(root, "e2e", "report") }]] : "list",
  outputDir: path.join(E2E_DIR, "results"),
  use: {
    baseURL: `http://127.0.0.1:${E2E_PORT}`,
    channel: process.env.CI ? undefined : "chrome",
    viewport: { width: 1400, height: 900 },
    trace: "retain-on-failure"
  },
  webServer: {
    command: "pnpm --dir packages/ide-server exec tsx src/index.ts",
    cwd: root,
    url: `http://127.0.0.1:${E2E_PORT}/api/info`,
    reuseExistingServer: false,
    timeout: 60_000,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      HARDKAS_IDE_PORT: String(E2E_PORT),
      HOME: home,
      USERPROFILE: home,
      HARDKAS_IDE_WORKSPACE: "" // start on Home even when the shell pins a workspace
    }
  }
});
