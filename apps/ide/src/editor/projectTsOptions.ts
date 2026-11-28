/**
 * The checking options of the project's own `tsconfig.json`, for the editor. Without them the editor checks with
 * looser defaults than the project's `tsc`, and the two disagree: with `strict` off, TypeScript infers a generic
 * component's `T` differently, and `onChange={setFilter}` turns red in the editor while `tsc` is happy.
 *
 * Only options that change what is an error are taken; module resolution and emit stay the editor's own.
 */

/** tsconfig is JSON with comments and trailing commas. */
export function parseJsonc(text: string): unknown {
  let out = "";
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      out += c;
      if (c === "\\") out += text[++i] ?? "";
      else if (c === '"') inString = false;
    } else if (c === '"') {
      inString = true;
      out += c;
    } else if (c === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i++;
      out += "\n";
    } else if (c === "/" && text[i + 1] === "*") {
      i += 2;
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i++;
      i++;
    } else {
      out += c;
    }
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, "$1"));
}

const STRICT_FAMILY = [
  "noImplicitAny",
  "noImplicitThis",
  "strictNullChecks",
  "strictFunctionTypes",
  "strictBindCallApply",
  "strictPropertyInitialization",
  "useUnknownInCatchVariables",
  "alwaysStrict"
] as const;

const COPIED_FLAGS = [
  ...STRICT_FAMILY,
  "strict",
  "exactOptionalPropertyTypes",
  "noUncheckedIndexedAccess",
  "noImplicitOverride",
  "noImplicitReturns",
  "noFallthroughCasesInSwitch",
  "noPropertyAccessFromIndexSignature",
  "noUnusedLocals",
  "noUnusedParameters",
  "allowUnreachableCode",
  "allowUnusedLabels",
  "useDefineForClassFields",
  "experimentalDecorators",
  "verbatimModuleSyntax"
] as const;

/** The editor's names for `jsx` (Monaco's JsxEmit values). */
const JSX: Record<string, number> = { preserve: 1, react: 2, "react-native": 3, "react-jsx": 4, "react-jsxdev": 5 };

export interface ProjectTsOptions {
  options: Record<string, boolean | number | string>;
  /** Why nothing was taken, when nothing was. */
  note?: string;
}

/** The project's checking options, from the text of its root `tsconfig.json` (null when there is none). */
export function projectTsOptions(tsconfigText: string | null | undefined): ProjectTsOptions {
  if (!tsconfigText) return { options: {}, note: "no tsconfig.json" };
  let parsed: unknown;
  try {
    parsed = parseJsonc(tsconfigText);
  } catch (e) {
    return { options: {}, note: `tsconfig.json does not parse: ${e instanceof Error ? e.message : String(e)}` };
  }
  const co = (parsed as { compilerOptions?: Record<string, unknown> } | null)?.compilerOptions;
  if (!co || typeof co !== "object") return { options: {}, note: "tsconfig.json has no compilerOptions" };

  const options: Record<string, boolean | number | string> = {};
  for (const k of COPIED_FLAGS) if (typeof co[k] === "boolean") options[k] = co[k] as boolean;
  // `strict` turns the whole family on unless one of them says otherwise; the editor is told each one explicitly.
  if (co.strict === true) for (const k of STRICT_FAMILY) if (typeof co[k] !== "boolean") options[k] = true;
  if (typeof co.jsx === "string" && JSX[co.jsx.toLowerCase()] !== undefined) options.jsx = JSX[co.jsx.toLowerCase()];
  if (typeof co.jsxImportSource === "string") options.jsxImportSource = co.jsxImportSource;
  return { options };
}
