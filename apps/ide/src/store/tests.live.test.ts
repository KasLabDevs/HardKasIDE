import { describe, expect, it } from "vitest";
import { foldVitestOutput, type LiveFile } from "./tests";

// What vitest's default reporter prints while it runs (non-TTY, as the IDE server runs it).
const OUTPUT = [
  "",
  " RUN  v3.2.7 C:/work/project",
  "",
  " ✓ src/store/env.test.ts (3 tests) 26ms",
  " ❯ src/utils/silverRecords.test.ts (13 tests | 2 failed) 31ms",
  "   × parseDeployRecord > reads a confirmed deploy 4ms",
  "   × markSpent > marks the consumed deploy 1ms",
  " ↓ src/views/skip.test.ts (2 tests | 2 skipped)",
  " √ test\\payment.test.ts (1 test) 5ms",
  "",
  " Test Files  1 failed | 3 passed (4)",
  ""
].join("\n");

describe("foldVitestOutput", () => {
  it("lists each finished file with its counts and failing tests", () => {
    const { live, rest } = foldVitestOutput([], "", OUTPUT);
    expect(rest).toBe("");
    expect(live.map((f) => [f.file, f.tests, f.failed, f.skipped, f.durationMs])).toEqual([
      ["src/store/env.test.ts", 3, 0, 0, 26],
      ["src/utils/silverRecords.test.ts", 13, 2, 0, 31],
      ["src/views/skip.test.ts", 2, 0, 2, null],
      ["test\\payment.test.ts", 1, 0, 0, 5]
    ]);
    expect(live[1].failures).toEqual(["parseDeployRecord > reads a confirmed deploy", "markSpent > marks the consumed deploy"]);
  });

  it("joins a line split across chunks", () => {
    let live: LiveFile[] = [];
    let rest = "";
    for (const chunk of [" ✓ src/store/en", "v.test.ts (3 tes", "ts) 26ms\n ❯ src/a.test.ts (2 tests | 1 failed)\n   × a fails\n"]) {
      ({ live, rest } = foldVitestOutput(live, rest, chunk));
    }
    expect(live.map((f) => f.file)).toEqual(["src/store/env.test.ts", "src/a.test.ts"]);
    expect(live[1].failures).toEqual(["a fails"]);
  });

  it("reads vitest 2.1's real output, skipping the indented lines of slow tests", () => {
    const real = " RUN  v2.1.9 C:/w/demo-workspace\n\n ✓ test/auction.test.ts (1 test) 2455ms\n   ✓ Kaspa Auction Covenant flow 2454ms\n ✓ test/payment.test.ts (1 test) 4026ms\n   ✓ payment flow 4025ms\n\n Test Files  2 passed (2)\n";
    const { live } = foldVitestOutput([], "", real);
    expect(live.map((f) => [f.file, f.tests, f.failed])).toEqual([
      ["test/auction.test.ts", 1, 0],
      ["test/payment.test.ts", 1, 0]
    ]);
  });

  it("ignores colour codes and lines that are not file results", () => {
    const { live } = foldVitestOutput([], "", "\x1b[32m ✓\x1b[39m src/x.test.ts \x1b[2m(4 tests)\x1b[22m 9ms\nsome log line\n");
    expect(live).toEqual([{ file: "src/x.test.ts", tests: 4, failed: 0, skipped: 0, durationMs: 9, failures: [] }]);
  });
});
