import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import { E2E_DIR } from "./playwright.config";

/**
 * The main path a new user takes, without Docker or the HardKas CLI: Home → open a project → the getting-started
 * guide → open a contract in the editor → the command palette. The project is never trusted, so nothing in it runs.
 */
const fixture = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "hello-hardkas");
const project = path.join(E2E_DIR, "projects", "hello-hardkas");

test.beforeAll(() => {
  fs.rmSync(project, { recursive: true, force: true });
  fs.cpSync(fixture, project, { recursive: true });
});

async function openProject(page: Page) {
  await page.goto("/");
  await expect(page.getByRole("button", { name: /New project/ })).toBeVisible();
  await page.locator("#home-open-folder-input").fill(project);
  await page.getByRole("button", { name: "Open", exact: true }).click();
  await expect(page.getByRole("tree", { name: "Workspace files" })).toBeVisible();
}

test("Home shows the version and opens a project", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await openProject(page);
  await expect(page.getByText(/HardKas IDE \d+\.\d+\.\d+/).first()).toBeVisible();
  // The tree arrives: never "Empty workspace" for a project that has files.
  await expect(page.getByRole("treeitem", { name: /contracts/ })).toBeVisible();
  await expect(page.getByText("Empty workspace.")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("an untrusted project shows the trust banner and the getting-started guide", async ({ page }) => {
  await openProject(page);
  await expect(page.getByRole("button", { name: "Trust this folder" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Getting started" })).toBeVisible();
  // Hiding the guide and bringing it back from the command palette.
  await page.getByRole("button", { name: "Hide getting started" }).click();
  await expect(page.getByRole("region", { name: "Getting started" })).toHaveCount(0);
  await page.keyboard.press("Control+Shift+P");
  await page.getByRole("textbox", { name: "Command palette" }).fill(">getting started");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("region", { name: "Getting started" })).toBeVisible();
});

test("a contract opens in the editor", async ({ page }) => {
  await openProject(page);
  const tree = page.getByRole("tree", { name: "Workspace files" });
  await tree.getByRole("treeitem", { name: /contracts/ }).click();
  await tree.getByRole("treeitem", { name: /escrow\.sil/ }).click();
  await expect(page.locator(".monaco-editor").first()).toBeVisible();
  await expect(page.locator(".monaco-editor .view-lines")).toContainText("contract Escrow");
});

test("the command palette lists the new commands", async ({ page }) => {
  await openProject(page);
  await page.keyboard.press("Control+Shift+P");
  const input = page.getByRole("textbox", { name: "Command palette" });
  await expect(input).toBeVisible();
  await input.fill(">diagnostics");
  await expect(page.getByText("Help: copy diagnostics for a bug report")).toBeVisible();
  await input.fill(">getting started");
  await expect(page.getByText("Help: show the getting-started guide")).toBeVisible();
  await page.keyboard.press("Escape");
});

test("the server reports a clear error for an unknown API route", async ({ request }) => {
  const res = await request.get("/api/does-not-exist");
  expect(res.status()).toBe(404);
  const body = (await res.json()) as { ok: boolean; code: string };
  expect(body).toMatchObject({ ok: false, code: "NOT_FOUND" });
});
