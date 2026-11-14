import { describe, expect, it } from "vitest";
import { normalizeSilverArgsText, normalizeSilverValue } from "./silverArgs";

describe("silverArgs", () => {
  it("writes hex bytes and pubkey as the CLI's number arrays", () => {
    expect(normalizeSilverValue({ kind: "pubkey", value: "0x3e1b" })).toEqual({ kind: "bytes", value: [0x3e, 0x1b] });
    expect(normalizeSilverValue({ type: "byte[32]", value: "ff00" })).toEqual({ kind: "bytes", value: [255, 0] });
    expect(normalizeSilverValue({ kind: "bytes", value: [1, 2] })).toEqual({ kind: "bytes", value: [1, 2] });
  });

  it("leaves other kinds, and text that is not a JSON array, alone", () => {
    expect(normalizeSilverValue({ kind: "int", value: 7 })).toEqual({ kind: "int", value: 7 });
    expect(normalizeSilverArgsText("not json")).toBe("not json");
    expect(normalizeSilverArgsText('{"kind":"int"}')).toBe('{"kind":"int"}');
  });

  it("normalizes nested arrays and objects", () => {
    expect(JSON.parse(normalizeSilverArgsText('[{"kind":"array","value":[{"kind":"pubkey","value":"0x01"}]}]'))).toEqual([{ kind: "array", value: [{ kind: "bytes", value: [1] }] }]);
  });
});
