import { FlaskConical } from "lucide-react";
import { api } from "@/api/client";
import { Plugin } from "@/engine/engine";
import { useIde } from "@/store/ide";
import { parseVitestJson, useTests } from "@/store/tests";
import { TestsPanel } from "@/panels/TestsPanel";
import type { ConsolePlugin } from "./console";

const RESULTS_FILE = ".hardkas/ide/test-results.json";

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
      await api.fs.write(RESULTS_FILE, "{}");
      const args = ["vitest", "run", ...(file ? [file] : []), "--reporter=json", `--outputFile=${RESULTS_FILE}`, "--reporter=default"];
      const result = await console_.run(args, { command: "npx" });
      const text = await api.fs.read(RESULTS_FILE);
      if (!text.trim() || text.trim() === "{}") {
        throw new Error(result.status === "succeeded" ? "vitest produced no JSON report" : `vitest exited with code ${result.exitCode} and produced no report. Is vitest installed in the project? (npm install)`);
      }
      const run = parseVitestJson(text, useIde.getState().workspace?.root ?? "");
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
