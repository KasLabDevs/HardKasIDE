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

/** One test file vitest finished, as its default reporter announces it while the run goes on. */
export interface LiveFile {
  file: string;
  tests: number;
  failed: number;
  skipped: number;
  durationMs: number | null;
  /** Names of the failing tests, from the `×` lines under the file. */
  failures: string[];
}

interface TestsState {
  run: TestRun | null;
  running: boolean;
  /** Files finished so far in the run in progress (the full results arrive at the end, from the JSON report). */
  live: LiveFile[];
  error: string | null;
  selected: string | null;
  setRun(run: TestRun | null): void;
  setRunning(r: boolean): void;
  setLive(live: LiveFile[]): void;
  setError(e: string | null): void;
  select(id: string | null): void;
}

export const useTests = create<TestsState>((set) => ({
  run: null,
  running: false,
  live: [],
  error: null,
  selected: null,
  setRun: (run) => set({ run }),
  setRunning: (running) => set({ running }),
  setLive: (live) => set({ live }),
  setError: (error) => set({ error }),
  select: (selected) => set({ selected })
}));

// ---------------------------------------------------------------- live progress (vitest's default reporter)

const ANSI = /\x1b\[[0-9;]*m/g;
// " ✓ src/a.test.ts (3 tests) 26ms", " ❯ src/b.test.ts (5 tests | 1 failed) 30ms", " ↓ src/c.test.ts (2 tests | 2 skipped)".
// Windows consoles may print √ instead of ✓.
const FILE_LINE = /^\s*([✓√❯×↓])\s+(\S+\.(?:test|spec)\.[cm]?[jt]sx?)\s+\((\d+) tests?(?:\s*\|\s*(\d+) failed)?(?:\s*\|\s*(\d+) skipped)?\)(?:\s+(\d+)\s*ms)?/;
const FAIL_LINE = /^\s+[×✗]\s+(.+?)(?:\s+\d+\s*ms)?\s*$/;

/**
 * Folds one chunk of vitest's console output into the live list. Lines are split across chunks, so the caller keeps
 * `rest` (the unfinished last line) and passes it back with the next chunk.
 */
export function foldVitestOutput(live: LiveFile[], rest: string, chunk: string): { live: LiveFile[]; rest: string } {
  const text = (rest + chunk).replace(ANSI, "").replace(/\r\n?/g, "\n");
  const lines = text.split("\n");
  const nextRest = lines.pop() ?? "";
  let out = live;
  for (const line of lines) {
    const f = FILE_LINE.exec(line);
    if (f) {
      const entry: LiveFile = {
        file: f[2],
        tests: Number(f[3]),
        failed: f[4] ? Number(f[4]) : f[1] === "×" ? Number(f[3]) : 0,
        skipped: f[5] ? Number(f[5]) : f[1] === "↓" ? Number(f[3]) : 0,
        durationMs: f[6] ? Number(f[6]) : null,
        failures: []
      };
      out = [...out.filter((x) => x.file !== entry.file), entry];
      continue;
    }
    const x = FAIL_LINE.exec(line);
    if (x && out.length > 0) {
      const last = out[out.length - 1];
      if (last.failed > last.failures.length) out = [...out.slice(0, -1), { ...last, failures: [...last.failures, x[1]] }];
    }
  }
  return { live: out, rest: nextRest };
}

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
        durationMs: typeof t.duration === "number" ? Math.round(t.duration) : null,
        failureMessages: t.failureMessages ?? [],
        location: loc
      };
    });
    const anyFailed = tests.some((t) => t.status === "failed") || f.status === "failed";
    return {
      file,
      status: anyFailed ? "failed" : tests.length === 0 ? normalise(f.status) : "passed",
      durationMs: f.startTime && f.endTime ? Math.round(f.endTime - f.startTime) : null,
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
