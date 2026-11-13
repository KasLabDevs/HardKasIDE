import { describe, expect, it } from "vitest";
import { cliMismatch, formatKas } from "./env";

describe("formatKas", () => {
  it("formats sompi as KAS without floating point noise", () => {
    expect(formatKas("500000000")).toBe("5 KAS");
    expect(formatKas("499824800")).toBe("4.998248 KAS");
    expect(formatKas("204700")).toBe("0.002047 KAS");
    expect(formatKas("0")).toBe("0 KAS");
    expect(formatKas("-100000000")).toBe("-1 KAS");
    expect(formatKas(null)).toBe("…");
  });

  it("leaves text it cannot read alone", () => {
    expect(formatKas("n/a")).toBe("n/a");
  });
});

describe("cliMismatch", () => {
  const base = { pinned: "0.12.0-rc.29", source: "project" as const, command: "hardkas", error: null };
  it("is true only when a version was read and differs from the tested one", () => {
    expect(cliMismatch(null)).toBe(false);
    expect(cliMismatch({ ...base, version: null })).toBe(false);
    expect(cliMismatch({ ...base, version: "0.12.0-rc.29" })).toBe(false);
    expect(cliMismatch({ ...base, version: "0.12.0-rc.30" })).toBe(true);
  });
});
