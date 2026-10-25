/**
 * Lightweight SilverScript source outline (no AST endpoint exists in HardKas yet).
 * Good enough for an Eclipse-style Outline: contracts, constructor parameters
 * ("attributes"), entries ("functions") with parameters, and require() counts.
 */

export interface SilParamDecl {
  type: string;
  name: string;
}

export interface SilEntryDecl {
  name: string;
  params: SilParamDecl[];
  line: number;
  endLine: number;
  requires: number;
}

export interface SilContractDecl {
  name: string;
  params: SilParamDecl[];
  line: number;
  endLine: number;
  entries: SilEntryDecl[];
}

export interface SilOutline {
  pragma: string | null;
  contracts: SilContractDecl[];
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
    const contract: SilContractDecl = {
      name: m[1],
      params: parseParams(m[2]),
      line,
      endLine: lineOf(text, bodyEnd),
      entries: []
    };
    const body = text.slice(bodyStart, bodyEnd + 1);
    const entryRe = /entry\s+([A-Za-z_]\w*)\s*\(([^)]*)\)\s*\{/g;
    let e: RegExpExecArray | null;
    while ((e = entryRe.exec(body))) {
      const eStart = bodyStart + e.index;
      const eBodyStart = eStart + e[0].length - 1;
      const eBodyEnd = matchBrace(text, eBodyStart);
      const eBody = text.slice(eBodyStart, eBodyEnd + 1);
      contract.entries.push({
        name: e[1],
        params: parseParams(e[2]),
        line: lineOf(text, eStart),
        endLine: lineOf(text, eBodyEnd),
        requires: (eBody.match(/\brequire\s*\(/g) ?? []).length
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
