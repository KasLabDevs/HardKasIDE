import { describe, expect, it } from "vitest";
import { filePathBonus, flattenTreePaths, parsePaletteQuery, scorePaletteMatch } from "./commandPaletteModel";

describe("parsePaletteQuery", () => {
  it("recognizes >, @, :, and file:line[:col] modes", () => {
    expect(parsePaletteQuery(">compile")).toEqual({ mode: "commands", filter: "compile", line: null, column: null });
    expect(parsePaletteQuery("  @release")).toEqual({ mode: "symbols", filter: "release", line: null, column: null });
    expect(parsePaletteQuery(":42:7")).toEqual({ mode: "line", filter: "42:7", line: 42, column: 7 });
    expect(parsePaletteQuery("contracts/tienda.sil:9")).toEqual({
      mode: "files",
      filter: "contracts/tienda.sil",
      line: 9,
      column: null
    });
    expect(parsePaletteQuery("tienda")).toEqual({ mode: "files", filter: "tienda", line: null, column: null });
  });
});

describe("scorePaletteMatch", () => {
  it("ranks exact and prefix basename matches ahead of deep path substrings and supports fuzzy matching", () => {
    const exactBase = scorePaletteMatch("tienda.sil", "contracts/tienda.sil");
    const testPath = scorePaletteMatch("tienda.sil", "test/tienda.sil.snapshot.json");
    const fuzzy = scorePaletteMatch("tdsl", "contracts/tienda.sil");

    expect(exactBase).not.toBeNull();
    expect(testPath).not.toBeNull();
    expect(fuzzy).not.toBeNull();
    expect(exactBase!.score).toBeGreaterThan(testPath!.score);
    expect(exactBase!.indices).toEqual([10, 11, 12, 13, 14, 15, 16, 17, 18, 19]);
  });

  it("prioritizes recently opened files and skips node_modules unless requested", () => {
    const tree = [
      { name: "node_modules", path: "node_modules", type: "dir" as const, children: [{ name: "a.js", path: "node_modules/a.js", type: "file" as const }] },
      { name: "contracts", path: "contracts", type: "dir" as const, children: [{ name: "tienda.sil", path: "contracts/tienda.sil", type: "file" as const }] }
    ];
    expect(flattenTreePaths(tree, false)).toEqual(["contracts/tienda.sil"]);
    expect(flattenTreePaths(tree, true)).toEqual(["node_modules/a.js", "contracts/tienda.sil"]);
    expect(filePathBonus("contracts/tienda.sil", 0, true)).toBeGreaterThan(filePathBonus("pnpm-lock.yaml", -1, false));
  });
});
