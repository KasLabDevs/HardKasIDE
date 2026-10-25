import { create } from "zustand";

/** JUnit-style test results, parsed from vitest's JSON reporter. */

export type TestStatus = "passed" | "failed" | "skipped" | "pending" | "todo";

export interface TestCase {
  id: string;
  title: string;
  fullName: string;
  ancestors: string[];
  status: TestStatus;
  durationMs: number | null;
  failureMessages: string[];
  /** Best-effort "file:line" extracted from the failure stack. */
  location?: { file: string; line: number };
}

export interface TestFile {
  file: string; // workspace-relative
  status: TestStatus;
  durationMs: number | null;
  message?: string;
  tests: TestCase[];
}

export interface TestRun {
  startedAt: string;
  finishedAt: string | null;
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  files: TestFile[];
  success: boolean;
  rawOutput?: string;
}

interface TestsState {
  run: TestRun | null;
  running: boolean;
  error: string | null;
  selected: string | null;
  setRun(run: TestRun | null): void;
  setRunning(r: boolean): void;
  setError(e: string | null): void;
  select(id: string | null): void;
}

export const useTests = create<TestsState>((set) => ({
  run: null,
  running: false,
  error: null,
  selected: null,
  setRun: (run) => set({ run }),
  setRunning: (running) => set({ running }),
  setError: (error) => set({ error }),
  select: (selected) => set({ selected })
}));

interface VitestJson {
  numTotalTests?: number;
  numPassedTests?: number;
  numFailedTests?: number;
  numPendingTests?: number;
  numTodoTests?: number;
  startTime?: number;
  success?: boolean;
  testResults?: Array<{
    name: string;
    status: string;
    startTime?: number;
    endTime?: number;
    message?: string;
    assertionResults?: Array<{
      title: string;
      fullName: string;
      ancestorTitles?: string[];
      status: string;
      duration?: number | null;
      failureMessages?: string[];
      location?: { line?: number; column?: number } | null;
    }>;
  }>;
}

export function parseVitestJson(text: string, workspaceRoot: string): TestRun {
  const j = JSON.parse(text) as VitestJson;
  const root = workspaceRoot.replace(/\\/g, "/").toLowerCase();
  const rel = (abs: string) => {
    const p = abs.replace(/\\/g, "/");
    return p.toLowerCase().startsWith(root) ? p.slice(root.length).replace(/^\/+/, "") : p;
  };
  const files: TestFile[] = (j.testResults ?? []).map((f) => {
    const file = rel(f.name);
    const tests: TestCase[] = (f.assertionResults ?? []).map((t, i) => {
      const status = normalise(t.status);
      const loc = t.location?.line ? { file, line: t.location.line } : locationFromStack(t.failureMessages ?? [], file);
      return {
        id: `${file}::${t.fullName || t.title}::${i}`,
        title: t.title,
        fullName: t.fullName || t.title,
        ancestors: t.ancestorTitles ?? [],
        status,
        durationMs: typeof t.duration === "number" ? t.duration : null,
        failureMessages: t.failureMessages ?? [],
        location: loc
      };
    });
    const anyFailed = tests.some((t) => t.status === "failed") || f.status === "failed";
    return {
      file,
      status: anyFailed ? "failed" : tests.length === 0 ? normalise(f.status) : "passed",
      durationMs: f.startTime && f.endTime ? f.endTime - f.startTime : null,
      message: f.message || undefined,
      tests
    };
  });
  return {
    startedAt: j.startTime ? new Date(j.startTime).toISOString() : new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    total: j.numTotalTests ?? files.reduce((n, f) => n + f.tests.length, 0),
    passed: j.numPassedTests ?? 0,
    failed: j.numFailedTests ?? 0,
    skipped: (j.numPendingTests ?? 0) + (j.numTodoTests ?? 0),
    files,
    success: Boolean(j.success)
  };
}

function normalise(s: string): TestStatus {
  if (s === "passed" || s === "failed" || s === "skipped" || s === "pending" || s === "todo") return s;
  if (s === "disabled") return "skipped";
  return "pending";
}

function locationFromStack(messages: string[], file: string): { file: string; line: number } | undefined {
  const base = file.split("/").pop() ?? file;
  for (const m of messages) {
    const re = new RegExp(`${base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}:(\\d+):\\d+`);
    const hit = re.exec(m);
    if (hit) return { file, line: Number(hit[1]) };
  }
  return undefined;
}
