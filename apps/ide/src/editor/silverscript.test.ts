import { describe, expect, it } from "vitest";
import { getSilverscriptHover, silverscriptCompletions } from "./silverscript";

describe("SilverScript language docs & completions", () => {
  it("provides hover documentation for core SilverScript primitives and Kaspa introspection", () => {
    expect(getSilverscriptHover("checkSig")?.signature).toContain("checkSig(");
    expect(getSilverscriptHover("outputs")?.summary).toContain("covenants");
    expect(getSilverscriptHover("sompi")?.summary).toContain("100,000,000 sompi");
    expect(getSilverscriptHover("unknownIdentifier")).toBeNull();
  });

  it("includes expanded covenant and Kaspa builtin snippets", () => {
    const labels = silverscriptCompletions.map((c) => c.label);
    expect(labels).toContain("checkSig");
    expect(labels).toContain("checkMultiSig");
    expect(labels).toContain("blake2b");
    expect(labels).toContain("tx.outputs");
  });
});
