import { beforeEach, describe, expect, it } from "vitest";
import { applyTextEditToSource } from "@/shell/ProblemsPanel";
import { diagnosticsAtPosition, fixableDiagnosticsInRange, folderDiagCounts, useDiagnostics } from "./diagnostics";

describe("useDiagnostics store & helpers", () => {
  beforeEach(() => {
    useDiagnostics.getState().resetWorkspace();
  });

  it("aggregates diagnostics per file/source and computes folder rollups for explorer badges", () => {
    const st = useDiagnostics.getState();
    st.setFileDiagnostics("contracts/Escrow.sil", "sil-lint", [
      {
        id: "1",
        file: "contracts/Escrow.sil",
        source: "sil-lint",
        line: 5,
        column: 3,
        endLine: 5,
        endColumn: 8,
        severity: "error",
        code: "SIL-ERR",
        message: "Missing ';'",
        fixes: [{ title: "Insert ';'", edit: { startLineNumber: 5, startColumn: 8, endLineNumber: 5, endColumn: 8, text: ";" } }]
      }
    ]);
    st.setFileDiagnostics("dapp/src/App.tsx", "monaco", [
      {
        id: "2",
        file: "dapp/src/App.tsx",
        source: "typescript",
        line: 12,
        column: 10,
        endLine: 12,
        endColumn: 15,
        severity: "warning",
        code: "TS6133",
        message: "Unused variable"
      }
    ]);

    const after = useDiagnostics.getState();
    expect(after.totals).toEqual({ errors: 1, warnings: 1, infos: 0 });
    expect(folderDiagCounts(after.countsByFile, "contracts")).toEqual({ errors: 1, warnings: 0, infos: 0 });
    expect(folderDiagCounts(after.countsByFile, "dapp")).toEqual({ errors: 0, warnings: 1, infos: 0 });

    expect(diagnosticsAtPosition("contracts/Escrow.sil", 5, 4)).toHaveLength(1);
    expect(fixableDiagnosticsInRange("contracts/Escrow.sil", 5, 5)).toHaveLength(1);

    st.replaceSourceDiagnostics("sil-lint", new Map());
    expect(useDiagnostics.getState().countsByFile["contracts/Escrow.sil"]).toBeUndefined();
  });

  it("applies Quick Fix text edits cleanly while preserving CRLF line endings", () => {
    const src = "pragma silverscript ^0.1.0;\r\ncontract A() {\r\n  entry x() {\r\n    require(true)\r\n  }\r\n}";
    const fixed = applyTextEditToSource(src, {
      startLineNumber: 4,
      startColumn: 18,
      endLineNumber: 4,
      endColumn: 18,
      text: ";"
    });
    expect(fixed).toContain("require(true);\r\n");
  });
});
