import { describe, expect, it } from "vitest";
import type { TreeNode } from "@/api/client";
import type { TestRun } from "@/store/tests";
import { mergeTestRuns, resolveVitestTargets } from "./tests";

const dir = (name: string, path: string, children: TreeNode[]): TreeNode => ({ name, path, type: "dir", children });
const file = (name: string, path: string): TreeNode => ({ name, path, type: "file" });

describe("resolveVitestTargets", () => {
  const merchantPosTree: TreeNode[] = [
    dir("hardkas-workspace", "hardkas-workspace", [
      dir("test", "hardkas-workspace/test", [file("golden-core.test.ts", "hardkas-workspace/test/golden-core.test.ts")]),
      file("package.json", "hardkas-workspace/package.json"),
      file("vitest.config.ts", "hardkas-workspace/vitest.config.ts")
    ]),
    dir(".hardkas", ".hardkas", [
      dir("ide", ".hardkas/ide", [file("scratch.test.ts", ".hardkas/ide/scratch.test.ts")])
    ]),
    file("package.json", "package.json"),
    file("vite.config.ts", "vite.config.ts")
  ];

  it("keeps root cwd for single-package workspaces", () => {
    const tree: TreeNode[] = [
      dir("test", "test", [file("payment.test.ts", "test/payment.test.ts")]),
      file("package.json", "package.json")
    ];
    expect(resolveVitestTargets(tree, "test/payment.test.ts")).toEqual([
      { cwd: undefined, files: ["test/payment.test.ts"], outputFile: ".hardkas/ide/test-results.json" }
    ]);
  });

  it("runs nested subproject single-file tests from their subproject directory", () => {
    expect(resolveVitestTargets(merchantPosTree, "hardkas-workspace/test/golden-core.test.ts")).toEqual([
      {
        cwd: "hardkas-workspace",
        files: ["test/golden-core.test.ts"],
        outputFile: "../.hardkas/ide/test-results.json"
      }
    ]);
  });

  it("normalizes Windows backslashes and deeper nesting", () => {
    const deepTree: TreeNode[] = [
      dir("packages", "packages", [
        dir("app", "packages/app", [
          file("package.json", "packages/app/package.json"),
          dir("test", "packages/app/test", [file("flow.spec.ts", "packages/app/test/flow.spec.ts")])
        ])
      ])
    ];
    expect(resolveVitestTargets(deepTree, "packages\\app\\test\\flow.spec.ts")).toEqual([
      {
        cwd: "packages/app",
        files: ["test/flow.spec.ts"],
        outputFile: "../../.hardkas/ide/test-results.json"
      }
    ]);
  });

  it("targets the nested subproject on Run All when only it contains tests", () => {
    expect(resolveVitestTargets(merchantPosTree, undefined)).toEqual([
      {
        cwd: "hardkas-workspace",
        files: undefined,
        outputFile: "../.hardkas/ide/test-results.json"
      }
    ]);
  });

  it("splits Run All into isolated targets when root and a subproject both contain tests", () => {
    const mixedTree: TreeNode[] = [
      ...merchantPosTree,
      dir("test", "test", [file("root.test.ts", "test/root.test.ts")])
    ];
    expect(resolveVitestTargets(mixedTree, undefined)).toEqual([
      { cwd: undefined, files: ["test/root.test.ts"], outputFile: ".hardkas/ide/test-results.json" },
      {
        cwd: "hardkas-workspace",
        files: ["test/golden-core.test.ts"],
        outputFile: "../.hardkas/ide/test-results.json"
      }
    ]);
  });
});

describe("mergeTestRuns", () => {
  const sampleRun = (passed: number, failed: number, filePath: string): TestRun => ({
    startedAt: "2026-11-13T00:00:00.000Z",
    finishedAt: "2026-11-13T00:00:01.000Z",
    total: passed + failed,
    passed,
    failed,
    skipped: 0,
    files: [{ file: filePath, status: failed > 0 ? "failed" : "passed", durationMs: 10, tests: [] }],
    success: failed === 0
  });

  it("aggregates totals, files, and overall success across subproject runs", () => {
    const merged = mergeTestRuns([
      sampleRun(2, 0, "test/root.test.ts"),
      sampleRun(1, 1, "hardkas-workspace/test/golden-core.test.ts")
    ]);
    expect(merged.total).toBe(4);
    expect(merged.passed).toBe(3);
    expect(merged.failed).toBe(1);
    expect(merged.success).toBe(false);
    expect(merged.files.map((f) => f.file)).toEqual([
      "test/root.test.ts",
      "hardkas-workspace/test/golden-core.test.ts"
    ]);
  });
});
