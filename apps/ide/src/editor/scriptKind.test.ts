import { describe, expect, it } from "vitest";
import { scriptKindFor } from "./scriptKind";

const K = { JS: 1, JSX: 2, TS: 3, TSX: 4 };

describe("scriptKindFor", () => {
  it("takes .mts/.cts and their .d. forms for TypeScript", () => {
    expect(scriptKindFor("file:///scripts/generate-silver-tests.d.mts", K)).toBe(K.TS);
    expect(scriptKindFor("file:///src/a.MTS", K)).toBe(K.TS);
    expect(scriptKindFor("file:///node_modules/x/index.d.cts", K)).toBe(K.TS);
  });

  it("takes .mjs/.cjs for JavaScript and leaves the rest to Monaco", () => {
    expect(scriptKindFor("file:///scripts/run.mjs", K)).toBe(K.JS);
    expect(scriptKindFor("file:///scripts/run.cjs", K)).toBe(K.JS);
    expect(scriptKindFor("file:///src/App.tsx", K)).toBeNull();
    expect(scriptKindFor("file:///src/a.ts", K)).toBeNull();
  });
});
