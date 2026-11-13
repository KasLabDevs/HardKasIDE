import { FlaskConical } from "lucide-react";
import { api, type TreeNode } from "@/api/client";
import { Plugin } from "@/engine/engine";
import { useIde } from "@/store/ide";
import { parseVitestJson, useTests, type TestRun } from "@/store/tests";
import { TestsPanel } from "@/panels/TestsPanel";
import type { ConsolePlugin } from "./console";

const RESULTS_FILE = ".hardkas/ide/test-results.json";
const IGNORED_TREE_DIRS = new Set(["node_modules", "dist", "coverage"]);
const TEST_FILE_RE = /\.(test|spec)\.[cm]?[jt]sx?$/;
const VITEST_CONFIG_RE = /^vitest\.config\.[cm]?[jt]sx?$/;

export interface VitestTarget {
  /** Workspace-relative directory to run Vitest from; undefined means workspace root. */
  cwd?: string;
  /** Paths relative to `cwd` (or workspace root if `cwd` is undefined). */
  files?: string[];
  /** Path passed to Vitest `--outputFile`, resolving back to workspace root's RESULTS_FILE. */
  outputFile: string;
}

function normalizeRelPath(p: string): string {
  return p.replace(/\\/g, "/").replace(/^\.\/+/, "").replace(/^\/+|\/+$/g, "");
}

function outputFileForCwd(cwd: string | undefined): string {
  if (!cwd) return RESULTS_FILE;
  const depth = cwd.split("/").filter(Boolean).length;
  return `${"../".repeat(depth)}${RESULTS_FILE}`;
}

function collectProjectStructure(tree: TreeNode[]): { subprojects: Set<string>; testFiles: string[] } {
  const subprojects = new Set<string>();
  const testFiles: string[] = [];

  const visit = (nodes: TreeNode[], parentPath: string) => {
    const hasMarker =
      parentPath !== "" &&
      nodes.some((n) => n.type === "file" && (n.name === "package.json" || VITEST_CONFIG_RE.test(n.name)));
    if (hasMarker) subprojects.add(parentPath);

    for (const node of nodes) {
      const nodePath = normalizeRelPath(node.path || (parentPath ? `${parentPath}/${node.name}` : node.name));
      if (node.type === "dir") {
        if (node.name.startsWith(".") || IGNORED_TREE_DIRS.has(node.name)) continue;
        if (node.children) visit(node.children, nodePath);
      } else if (TEST_FILE_RE.test(node.name)) {
        testFiles.push(nodePath);
      }
    }
  };

  visit(tree, "");
  return { subprojects, testFiles };
}

function findOwningSubproject(filePath: string, subprojects: Set<string>): string {
  const parts = filePath.split("/");
  for (let i = parts.length - 1; i >= 1; i--) {
    const candidate = parts.slice(0, i).join("/");
    if (subprojects.has(candidate)) return candidate;
  }
  return "";
}

/**
 * Resolves the directory (`cwd`) and relative arguments for invoking Vitest so nested
 * subprojects (e.g. `hardkas-workspace/`) run with their own `vitest.config.*` and `node_modules`.
 */
export function resolveVitestTargets(tree: TreeNode[], file?: string): VitestTarget[] {
  const { subprojects, testFiles } = collectProjectStructure(tree);

  if (file !== undefined) {
    const norm = normalizeRelPath(file);
    const owner = findOwningSubproject(norm, subprojects);
    if (!owner) {
      return [{ cwd: undefined, files: [norm], outputFile: RESULTS_FILE }];
    }
    const rel = norm.slice(owner.length + 1);
    return [{ cwd: owner, files: rel ? [rel] : undefined, outputFile: outputFileForCwd(owner) }];
  }

  if (testFiles.length === 0) {
    if (subprojects.size === 1) {
      const [onlySub] = subprojects;
      return [{ cwd: onlySub, files: undefined, outputFile: outputFileForCwd(onlySub) }];
    }
    return [{ cwd: undefined, files: undefined, outputFile: RESULTS_FILE }];
  }

  const groups = new Map<string, string[]>();
  for (const tf of testFiles) {
    const owner = findOwningSubproject(tf, subprojects);
    const list = groups.get(owner);
    if (list) list.push(tf);
    else groups.set(owner, [tf]);
  }

  if (groups.size === 1) {
    const [owner] = groups.keys();
    const cwd = owner || undefined;
    return [{ cwd, files: undefined, outputFile: outputFileForCwd(cwd) }];
  }

  const sortedOwners = Array.from(groups.keys()).sort((a, b) => a.localeCompare(b));
  return sortedOwners.map((owner) => {
    const cwd = owner || undefined;
    const ownerFiles = groups.get(owner) ?? [];
    const relFiles = owner ? ownerFiles.map((f) => f.slice(owner.length + 1)) : ownerFiles;
    return {
      cwd,
      files: relFiles.length > 0 ? relFiles : undefined,
      outputFile: outputFileForCwd(cwd)
    };
  });
}

/** Combines multiple sequential Vitest subproject runs into one TestRun summary. */
export function mergeTestRuns(runs: TestRun[]): TestRun {
  if (runs.length === 1) return runs[0];
  let total = 0;
  let passed = 0;
  let failed = 0;
  let skipped = 0;
  for (const r of runs) {
    total += r.total;
    passed += r.passed;
    failed += r.failed;
    skipped += r.skipped;
  }
  return {
    startedAt: runs[0].startedAt,
    finishedAt: runs[runs.length - 1].finishedAt,
    total,
    passed,
    failed,
    skipped,
    files: runs.flatMap((r) => r.files),
    success: runs.every((r) => r.success)
  };
}

/**
 * Test runner view (Eclipse JUnit style, with the debugger built in). Runs the workspace's vitest with the
 * JSON reporter and renders every test green / red, with failure details.
 *
 *   npx vitest run [file] --reporter=json --outputFile=.hardkas/ide/test-results.json
 */
export class TestsPlugin extends Plugin {
  view = TestsPanel;

  constructor() {
    super({
      name: "tests",
      displayName: "Tests",
      description: "Run the project's tests and see each one pass or fail",
      location: "sidePanel",
      icon: FlaskConical,
      order: 60,
      methods: ["open", "run", "runFile", "openTest"],
      events: ["runFinished"]
    });
  }

  open(): void {
    useIde.getState().revealPlugin(this.profile.name, "Tests");
  }

  async run(): Promise<void> {
    await this.runFile(undefined);
  }

  async runFile(file: string | undefined): Promise<void> {
    const store = useTests.getState();
    const console_ = this.engine.get<ConsolePlugin>("console");
    this.open();
    store.setRunning(true);
    store.setError(null);
    try {
      const ide = useIde.getState();
      const workspaceRoot = ide.workspace?.root ?? "";
      const targets = resolveVitestTargets(ide.tree, file);
      const runs: TestRun[] = [];
      for (const target of targets) {
        await api.fs.write(RESULTS_FILE, "{}");
        const args = [
          "vitest",
          "run",
          ...(target.files ?? []),
          "--reporter=json",
          `--outputFile=${target.outputFile}`,
          "--reporter=default"
        ];
        const result = await console_.run(args, target.cwd ? { command: "npx", cwd: target.cwd } : { command: "npx" });
        const text = await api.fs.read(RESULTS_FILE);
        if (!text.trim() || text.trim() === "{}") {
          throw new Error(
            result.status === "succeeded"
              ? "vitest produced no JSON report"
              : `vitest exited with code ${result.exitCode} and produced no report. Is vitest installed in the project? (npm install)`
          );
        }
        runs.push(parseVitestJson(text, workspaceRoot));
      }
      const run = mergeTestRuns(runs);
      store.setRun(run);
      this.emit("runFinished", run);
      if (run.failed > 0) console_.error(`Tests: ${run.failed} failed, ${run.passed} passed`);
      else console_.info(`Tests: ${run.passed} passed`);
    } catch (e) {
      store.setError(e instanceof Error ? e.message : String(e));
    } finally {
      store.setRunning(false);
    }
  }

  /** Opens the test's file at the failing line when known. */
  async openTest(file: string, line?: number): Promise<void> {
    await this.call("fileManager", "open", file);
    if (line) await this.call("editor", "gotoLine", line);
  }
}
