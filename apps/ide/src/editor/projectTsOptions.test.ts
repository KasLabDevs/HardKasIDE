import { describe, expect, it } from "vitest";
import { parseJsonc, projectTsOptions } from "./projectTsOptions";

describe("parseJsonc", () => {
  it("reads tsconfig's comments and trailing commas, and leaves // inside strings alone", () => {
    expect(parseJsonc(`{
      // a comment
      "compilerOptions": { /* block */ "strict": true, "baseUrl": "http://x//y", },
    }`)).toEqual({ compilerOptions: { strict: true, baseUrl: "http://x//y" } });
  });
});

describe("projectTsOptions", () => {
  it("takes strict and spells out its family, keeping an explicit opt-out", () => {
    const { options } = projectTsOptions(`{ "compilerOptions": { "strict": true, "strictPropertyInitialization": false, "jsx": "react-jsx", "noUnusedLocals": false } }`);
    expect(options.strict).toBe(true);
    expect(options.strictFunctionTypes).toBe(true);
    expect(options.noImplicitAny).toBe(true);
    expect(options.strictPropertyInitialization).toBe(false);
    expect(options.noUnusedLocals).toBe(false);
    expect(options.jsx).toBe(4);
  });

  it("leaves module resolution and emit to the editor", () => {
    const { options } = projectTsOptions(`{ "compilerOptions": { "module": "ESNext", "moduleResolution": "bundler", "outDir": "dist", "noEmit": true } }`);
    expect(options).toEqual({});
  });

  it("says why nothing was taken", () => {
    expect(projectTsOptions(null).note).toBe("no tsconfig.json");
    expect(projectTsOptions("{ broken").note).toMatch(/does not parse/);
    expect(projectTsOptions(`{ "include": ["src"] }`).note).toMatch(/no compilerOptions/);
  });
});
