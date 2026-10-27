/**
 * Lightweight SilverScript source outline (no AST endpoint exists in HardKas yet).
 * Good enough for an Eclipse-style Outline: contracts, constructor parameters
 * ("attributes"), entries ("functions") with parameters, and require() counts.
 */

export interface SilParamDecl {
  type: string;
  name: string;
  initialExpr?: string;
}

export interface SilEntryDecl {
  name: string;
  params: SilParamDecl[];
  line: number;
  endLine: number;
  requires: number;
  isCovenantPolicy?: boolean;
  covenantAttrs?: Record<string, string>;
}

export interface SilContractDecl {
  name: string;
  params: SilParamDecl[];
  stateFields: SilParamDecl[];
  line: number;
  endLine: number;
  entries: SilEntryDecl[];
}

export interface SilOutline {
  pragma: string | null;
  contracts: SilContractDecl[];
}

function parseCovenantAttrs(rawAttr: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const part of rawAttr.split(",")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    const k = part.slice(0, eq).trim();
    const v = part.slice(eq + 1).trim();
    if (k && v) attrs[k] = v;
  }
  return attrs;
}

function parseContractStateFields(body: string): SilParamDecl[] {
  const fields: SilParamDecl[] = [];
  // Inspect top-level lines before the first entry/function/#[covenant
  const inner = body.slice(1, body.endsWith("}") ? -1 : body.length);
  const firstFnIdx = inner.search(/(?:#\[covenant|\bentry\b|\bentrypoint\b|\bfunction\b)/);
  const declBlock = firstFnIdx >= 0 ? inner.slice(0, firstFnIdx) : inner;
  const fieldRe = /\b([A-Za-z_]\w*(?:\s*\[\s*\d*\s*\])?)\s+([A-Za-z_]\w*)\s*=\s*([^;]+);/g;
  let m: RegExpExecArray | null;
  while ((m = fieldRe.exec(declBlock))) {
    fields.push({ type: m[1].trim(), name: m[2].trim(), initialExpr: m[3].trim() });
  }
  return fields;
}

export function parseSilOutline(source: string): SilOutline {
  const text = stripComments(source);
  const lines = text.split("\n");
  const pragma = /pragma\s+silverscript\s+([^;]+);/.exec(text)?.[1]?.trim() ?? null;
  const contracts: SilContractDecl[] = [];

  const contractRe = /contract\s+([A-Za-z_]\w*)\s*\(([^)]*)\)\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = contractRe.exec(text))) {
    const start = m.index;
    const bodyStart = m.index + m[0].length - 1;
    const bodyEnd = matchBrace(text, bodyStart);
    const line = lineOf(text, start);
    const body = text.slice(bodyStart, bodyEnd + 1);
    const contract: SilContractDecl = {
      name: m[1],
      params: parseParams(m[2]),
      stateFields: parseContractStateFields(body),
      line,
      endLine: lineOf(text, bodyEnd),
      entries: []
    };
    const fnRe = /(?:(#\[covenant\(([^)]*)\)\])\s*)?(?:entrypoint\s+function|entry|function)\s+([A-Za-z_]\w*)\s*\(([^)]*)\)\s*(?::\s*\([^)]*\)\s*)?\{/g;
    let e: RegExpExecArray | null;
    while ((e = fnRe.exec(body))) {
      const eStart = bodyStart + e.index;
      const eBodyStart = eStart + e[0].length - 1;
      const eBodyEnd = matchBrace(text, eBodyStart);
      const eBody = text.slice(eBodyStart, eBodyEnd + 1);
      const isCov = Boolean(e[1]);
      contract.entries.push({
        name: e[3],
        params: parseParams(e[4]),
        line: lineOf(text, eStart),
        endLine: lineOf(text, eBodyEnd),
        requires: (eBody.match(/\brequire\s*\(/g) ?? []).length,
        ...(isCov ? { isCovenantPolicy: true, covenantAttrs: parseCovenantAttrs(e[2] ?? "") } : {})
      });
    }
    contracts.push(contract);
  }
  void lines;
  return { pragma, contracts };
}

function parseParams(list: string): SilParamDecl[] {
  return list
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((p) => {
      const parts = p.split(/\s+/);
      const name = parts.pop() ?? "";
      return { type: parts.join(" ") || "?", name };
    });
}

/** Index of the brace matching the one at `open`, or the end of text. */
function matchBrace(text: string, open: number): number {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return text.length - 1;
}

function lineOf(text: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < text.length; i++) if (text[i] === "\n") line++;
  return line;
}

/** Blanks out comments while keeping line breaks, so positions stay valid. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, (s) => s.replace(/[^\n]/g, " ")).replace(/\/\/[^\n]*/g, (s) => " ".repeat(s.length));
}
