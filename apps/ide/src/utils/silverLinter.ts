import type { DiagnosticFix, IdeDiagnostic } from "@/store/diagnostics";
import { SILVER_TOOLCHAIN, analyzeSilverVersion } from "./silverInspector";

export interface SilverToken {
  kind: "ident" | "number" | "string" | "punct" | "op";
  value: string;
  line: number;
  column: number;
  endColumn: number;
  offset: number;
}

export interface SilverSymbolDef {
  name: string;
  type: string;
  role: "contract" | "constructor-param" | "contract-field" | "entry" | "function" | "entry-param" | "local-var";
  line: number;
  column: number;
  endColumn: number;
  detail?: string;
}

export interface SilverScopeBlock {
  kind: "entry" | "function";
  name: string;
  line: number;
  bodyStartIdx: number;
  bodyEndIdx: number;
  params: SilverSymbolDef[];
  locals: SilverSymbolDef[];
  requires: number;
}

export interface SilverContractSymbolModel {
  name: string;
  line: number;
  column: number;
  endColumn: number;
  params: SilverSymbolDef[];
  fields: SilverSymbolDef[];
  scopes: SilverScopeBlock[];
}

export interface SilverSymbolAnalysis {
  tokens: SilverToken[];
  contracts: SilverContractSymbolModel[];
  topKeywords: string[];
}

export const SIL_FLOW_KEYWORDS = new Set(["if", "else", "return", "import", "for", "while"]);
export const SIL_DECL_KEYWORDS = new Set([
  "pragma",
  "silverscript",
  "contract",
  "entry",
  "entrypoint",
  "function",
  "covenant",
  "transition",
  "state",
  "const",
  "let",
  "new",
  "true",
  "false",
  "this",
  "tx"
]);
export const SIL_TYPES = new Set([
  "pubkey",
  "sig",
  "datasig",
  "bytes",
  "byte",
  "int",
  "bool",
  "string",
  "address",
  "hash160",
  "hash256",
  "sompi",
  "temporal",
  "State",
  "ScriptPubKeyP2PK"
]);
export const SIL_BUILTINS = new Set([
  "require",
  "assert",
  "checkSig",
  "checkMultiSig",
  "checkDataSig",
  "sha256",
  "blake2b",
  "hash160",
  "hash256",
  "ScriptPubKeyP2PK",
  "LockingBytecodeP2PK",
  "LockingBytecodeP2SH",
  "abs",
  "min",
  "max",
  "within",
  // Covenant state and introspection (silverscript-lang: validateOutputState, readInputState and their
  // *WithTemplate forms; the Op* intrinsics are matched by isIntrinsicName below).
  "checkSigs",
  "validateOutputState",
  "validateOutputStateWithTemplate",
  "validateOutputStateWithInputTemplate",
  "readInputState",
  "readInputStateWithTemplate",
  "ScriptPubKeyP2SH",
  "unsigned"
]);

/** SilverScript's opcode intrinsics (`OpCovInputIdx`, `OpCovOutputCount`, `OpInputCovenantId`, `OpAuthOutputIdx`…). */
export function isIntrinsicName(name: string): boolean {
  return /^Op[A-Z][A-Za-z0-9]*$/.test(name);
}

/** Builtins that check an output's whole state, script included: calling one binds that output's scriptPubKey. */
const OUTPUT_STATE_VALIDATORS = new Set(["validateOutputState", "validateOutputStateWithTemplate", "validateOutputStateWithInputTemplate"]);

// `tx.daa` / `tx.time`: absolute locks (CLTV); `this.ageDaa`: relative lock (CSV) — silverc compiles all three.
const TX_PROPS = new Set(["inputs", "outputs", "time", "daa", "lockTime", "version"]);
const TX_OUTPUT_FIELDS = new Set(["value", "scriptPubKey", "lockingBytecode"]);
const TX_INPUT_FIELDS = new Set([
  "value",
  "scriptPubKey",
  "lockingBytecode",
  "outpointTransactionHash",
  "outpointIndex",
  "sequence"
]);
const THIS_FIELDS = new Set(["activeScriptPubKey", "activeInputIndex", "activeBytecode", "activeLockingBytecode", "ageDaa"]);

const BUILTIN_ARITY: Record<string, { min: number; max: number; signature: string }> = {
  require: { min: 1, max: 2, signature: "require(bool condition, [string message])" },
  assert: { min: 1, max: 2, signature: "assert(bool condition)" },
  checkSig: { min: 2, max: 2, signature: "checkSig(sig s, pubkey pk)" },
  checkMultiSig: { min: 2, max: 2, signature: "checkMultiSig(sig[] sigs, pubkey[] pks)" },
  checkDataSig: { min: 3, max: 3, signature: "checkDataSig(datasig s, bytes msg, pubkey pk)" },
  sha256: { min: 1, max: 1, signature: "sha256(bytes data)" },
  blake2b: { min: 1, max: 1, signature: "blake2b(bytes data)" },
  hash160: { min: 1, max: 1, signature: "hash160(bytes data)" },
  hash256: { min: 1, max: 1, signature: "hash256(bytes data)" }
};

/** The type recorded for a `for(i, …)` loop variable. */
const LOOP_VAR_TYPE = "int (loop)";

/** `struct` names of the source being analysed (types like any other); set at the start of each analysis. */
let structTypes = new Set<string>();

function isTypeToken(tok: SilverToken | undefined): boolean {
  if (!tok || tok.kind !== "ident") return false;
  return SIL_TYPES.has(tok.value) || structTypes.has(tok.value) || /^bytes\d+$/.test(tok.value);
}

/** Comment- & string-aware tokenizer returning exact 1-based line and column coordinates. */
export function tokenizeSilver(source: string): SilverToken[] {
  const tokens: SilverToken[] = [];
  let i = 0;
  let line = 1;
  let col = 1;
  const n = source.length;

  const advance = (count = 1) => {
    for (let k = 0; k < count && i < n; k++) {
      if (source[i] === "\n") {
        line++;
        col = 1;
      } else {
        col++;
      }
      i++;
    }
  };

  while (i < n) {
    const ch = source[i];
    if (ch === " " || ch === "\t" || ch === "\r" || ch === "\n") {
      advance(1);
      continue;
    }
    // Line comment
    if (ch === "/" && source[i + 1] === "/") {
      while (i < n && source[i] !== "\n") advance(1);
      continue;
    }
    // Block comment
    if (ch === "/" && source[i + 1] === "*") {
      advance(2);
      while (i < n && !(source[i] === "*" && source[i + 1] === "/")) advance(1);
      if (i < n) advance(2);
      continue;
    }
    // String literal
    if (ch === '"' || ch === "'") {
      const quote = ch;
      const startLine = line;
      const startCol = col;
      const startOff = i;
      advance(1);
      while (i < n && source[i] !== quote && source[i] !== "\n") {
        if (source[i] === "\\") advance(2);
        else advance(1);
      }
      if (i < n && source[i] === quote) advance(1);
      tokens.push({
        kind: "string",
        value: source.slice(startOff, i),
        line: startLine,
        column: startCol,
        endColumn: startLine === line ? col : startCol + 1,
        offset: startOff
      });
      continue;
    }
    // Hex or decimal number
    if (/[0-9]/.test(ch)) {
      const startCol = col;
      const startOff = i;
      if (ch === "0" && (source[i + 1] === "x" || source[i + 1] === "X")) {
        advance(2);
        while (i < n && /[0-9a-fA-F_]/.test(source[i])) advance(1);
      } else {
        while (i < n && /[0-9_]/.test(source[i])) advance(1);
      }
      tokens.push({
        kind: "number",
        value: source.slice(startOff, i),
        line,
        column: startCol,
        endColumn: col,
        offset: startOff
      });
      continue;
    }
    // Identifier / keyword
    if (/[A-Za-z_]/.test(ch)) {
      const startCol = col;
      const startOff = i;
      while (i < n && /[A-Za-z0-9_]/.test(source[i])) advance(1);
      tokens.push({
        kind: "ident",
        value: source.slice(startOff, i),
        line,
        column: startCol,
        endColumn: col,
        offset: startOff
      });
      continue;
    }
    // Multi-char operators
    const two = source.slice(i, i + 2);
    if (["==", "!=", "<=", ">=", "&&", "||", "<<", ">>", "->"].includes(two)) {
      const startCol = col;
      const startOff = i;
      advance(2);
      tokens.push({ kind: "op", value: two, line, column: startCol, endColumn: col, offset: startOff });
      continue;
    }
    // Punctuation vs single-char op
    const startCol = col;
    const startOff = i;
    advance(1);
    const isPunct = "{}()[];,.:#".includes(ch);
    tokens.push({
      kind: isPunct ? "punct" : "op",
      value: ch,
      line,
      column: startCol,
      endColumn: col,
      offset: startOff
    });
  }
  return tokens;
}

export function levenshtein(a: string, b: string): number {
  const la = a.length;
  const lb = b.length;
  if (Math.abs(la - lb) > 3) return 4;
  const dp = Array.from({ length: lb + 1 }, (_, j) => j);
  for (let i = 1; i <= la; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= lb; j++) {
      const temp = dp[j];
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + cost);
      prev = temp;
    }
  }
  return dp[lb];
}

export function closestMatch(word: string, candidates: Iterable<string>, maxDist = 2): string | null {
  const lower = word.toLowerCase();
  let best: string | null = null;
  let bestScore = maxDist + 1;
  for (const cand of candidates) {
    if (cand === word) continue;
    const dist = levenshtein(lower, cand.toLowerCase());
    const exactCasePenalty = dist === 0 ? 0.1 : dist;
    if (exactCasePenalty < bestScore) {
      bestScore = exactCasePenalty;
      best = cand;
    }
  }
  return best;
}

function findMatchingToken(tokens: SilverToken[], startIdx: number, open: string, close: string): number {
  let depth = 0;
  for (let i = startIdx; i < tokens.length; i++) {
    if (tokens[i].value === open) depth++;
    else if (tokens[i].value === close) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return tokens.length - 1;
}

/** Reads parameter declarations inside `(...)`, returning symbols with exact coordinates. */
function parseParamTokens(
  tokens: SilverToken[],
  openParenIdx: number,
  closeParenIdx: number,
  role: "constructor-param" | "entry-param"
): SilverSymbolDef[] {
  const out: SilverSymbolDef[] = [];
  let i = openParenIdx + 1;
  while (i < closeParenIdx) {
    // Skip commas
    if (tokens[i].value === ",") {
      i++;
      continue;
    }
    const typeParts: string[] = [];
    while (i < closeParenIdx && tokens[i].value !== ",") {
      // Last identifier before `,` or `)` is param name (unless followed by `[` or `]`)
      const cur = tokens[i];
      const next = tokens[i + 1];
      if (cur.kind === "ident" && (!next || next.value === "," || i + 1 === closeParenIdx)) {
        out.push({
          name: cur.value,
          type: typeParts.join("") || "any",
          role,
          line: cur.line,
          column: cur.column,
          endColumn: cur.endColumn
        });
        i++;
        break;
      }
      typeParts.push(cur.value);
      i++;
    }
  }
  return out;
}

/** Parses SilverScript contracts, fields, entrypoints, parameters, and local variable declarations. */
export function analyzeSilverSymbols(source: string): SilverSymbolAnalysis {
  const tokens = tokenizeSilver(source);
  const contracts: SilverContractSymbolModel[] = [];
  structTypes = new Set(tokens.flatMap((t, k) => (t.kind === "ident" && t.value === "struct" && tokens[k + 1]?.kind === "ident" ? [tokens[k + 1].value] : [])));

  let i = 0;
  while (i < tokens.length) {
    const t = tokens[i];
    if (t.kind === "ident" && t.value === "contract" && tokens[i + 1]?.kind === "ident") {
      const nameTok = tokens[i + 1];
      let cursor = i + 2;
      let params: SilverSymbolDef[] = [];
      if (tokens[cursor]?.value === "(") {
        const closeP = findMatchingToken(tokens, cursor, "(", ")");
        params = parseParamTokens(tokens, cursor, closeP, "constructor-param");
        cursor = closeP + 1;
      }
      if (tokens[cursor]?.value !== "{") {
        i++;
        continue;
      }
      const bodyStart = cursor;
      const bodyEnd = findMatchingToken(tokens, bodyStart, "{", "}");
      const contractModel: SilverContractSymbolModel = {
        name: nameTok.value,
        line: nameTok.line,
        column: nameTok.column,
        endColumn: nameTok.endColumn,
        params,
        fields: [],
        scopes: []
      };

      let j = bodyStart + 1;
      while (j < bodyEnd) {
        const cur = tokens[j];
        // Skip #[covenant(...)] attribute metadata
        if (cur.value === "#" && tokens[j + 1]?.value === "[") {
          j = findMatchingToken(tokens, j + 1, "[", "]") + 1;
          continue;
        }
        // `struct Name { … }`: a type declaration; its members are not contract fields.
        if (cur.kind === "ident" && cur.value === "struct" && tokens[j + 2]?.value === "{") {
          j = findMatchingToken(tokens, j + 2, "{", "}") + 1;
          continue;
        }
        // Entry / function declaration
        const isEntrypointFn =
          cur.kind === "ident" &&
          cur.value === "entrypoint" &&
          tokens[j + 1]?.kind === "ident" &&
          tokens[j + 1].value === "function";
        const isEntryOrFn =
          cur.kind === "ident" && (cur.value === "entry" || cur.value === "function" || isEntrypointFn);
        if (isEntryOrFn) {
          const kind: "entry" | "function" = cur.value === "function" ? "function" : "entry";
          const fnNameIdx = isEntrypointFn ? j + 2 : j + 1;
          const fnNameTok = tokens[fnNameIdx];
          if (fnNameTok?.kind === "ident" && tokens[fnNameIdx + 1]?.value === "(") {
            const pClose = findMatchingToken(tokens, fnNameIdx + 1, "(", ")");
            const fnParams = parseParamTokens(tokens, fnNameIdx + 1, pClose, "entry-param");
            let braceIdx = pClose + 1;
            // Optional return tuple `: (type ...)`
            while (braceIdx < bodyEnd && tokens[braceIdx].value !== "{" && tokens[braceIdx].value !== ";") {
              braceIdx++;
            }
            if (tokens[braceIdx]?.value === "{") {
              const fnEnd = findMatchingToken(tokens, braceIdx, "{", "}");
              const locals: SilverSymbolDef[] = [];
              let requires = 0;
              for (let k = braceIdx + 1; k < fnEnd; k++) {
                const tk = tokens[k];
                if (tk.kind === "ident" && (tk.value === "require" || tk.value === "assert") && tokens[k + 1]?.value === "(") {
                  requires++;
                }
                // Local variable declaration: `<type> ([] | [N])? <ident> =` or `let <ident> =`; a loop variable
                // `for(<ident>, start, end, max)`; a destructuring `(<type> <ident>, …) = f(…)`.
                if (tk.kind === "ident" && tk.value === "let" && tokens[k + 1]?.kind === "ident") {
                  const v = tokens[k + 1];
                  locals.push({ name: v.value, type: "let", role: "local-var", line: v.line, column: v.column, endColumn: v.endColumn });
                } else if (tk.kind === "ident" && tk.value === "for" && tokens[k + 1]?.value === "(" && tokens[k + 2]?.kind === "ident" && tokens[k + 3]?.value === ",") {
                  // A loop variable lives in its loop: two loops may both use `i` (LOOP_VAR_TYPE skips the duplicate check).
                  const v = tokens[k + 2];
                  locals.push({ name: v.value, type: LOOP_VAR_TYPE, role: "local-var", line: v.line, column: v.column, endColumn: v.endColumn });
                } else if (isTypeToken(tk)) {
                  let d = k + 1;
                  let arr = "";
                  if (tokens[d]?.value === "[") {
                    const brClose = findMatchingToken(tokens, d, "[", "]");
                    arr = tokens.slice(d, brClose + 1).map((x) => x.value).join("");
                    d = brClose + 1;
                  }
                  if (tokens[d]?.kind === "ident" && tokens[d].value === "constant") d++;
                  const v = tokens[d];
                  // `,` / `)` / `}`: an element of a destructuring, `(State[] next, int n) = f(…)` or
                  // `State { amount: int a } = readInputState(i)` (a type then a name before `)` or `}` occurs nowhere
                  // else in a body: casts are `int(x)`, `byte[32](x)`).
                  const after = tokens[d + 1]?.value;
                  if (v?.kind === "ident" && (after === "=" || after === ";" || after === "," || after === ")" || after === "}")) {
                    locals.push({
                      name: v.value,
                      type: tk.value + arr,
                      role: "local-var",
                      line: v.line,
                      column: v.column,
                      endColumn: v.endColumn
                    });
                  }
                }
              }
              contractModel.scopes.push({
                kind,
                name: fnNameTok.value,
                line: fnNameTok.line,
                bodyStartIdx: braceIdx,
                bodyEndIdx: fnEnd,
                params: fnParams,
                locals,
                requires
              });
              j = fnEnd + 1;
              continue;
            }
          }
        }

        // Contract-level field declaration: `<const?> <type> ([]?) <ident> = ...;`
        if (cur.kind === "ident" && (cur.value === "const" || isTypeToken(cur))) {
          const typeIdx = cur.value === "const" ? j + 1 : j;
          const typeTok = tokens[typeIdx];
          if (isTypeToken(typeTok)) {
            let d = typeIdx + 1;
            let arr = "";
            if (tokens[d]?.value === "[") {
              const brClose = findMatchingToken(tokens, d, "[", "]");
              arr = tokens.slice(d, brClose + 1).map((x) => x.value).join("");
              d = brClose + 1;
            }
            // `int constant MAX_FEE = …;` / `byte[32] constant ZERO32 = …;`: SilverScript puts `constant` after the type.
            const isConstant = tokens[d]?.kind === "ident" && tokens[d].value === "constant";
            if (isConstant) d++;
            const fieldTok = tokens[d];
            if (fieldTok?.kind === "ident" && (tokens[d + 1]?.value === "=" || tokens[d + 1]?.value === ";")) {
              contractModel.fields.push({
                name: fieldTok.value,
                type: (cur.value === "const" || isConstant ? "const " : "") + typeTok.value + arr,
                role: "contract-field",
                line: fieldTok.line,
                column: fieldTok.column,
                endColumn: fieldTok.endColumn
              });
            }
          }
        }
        j++;
      }

      contracts.push(contractModel);
      i = bodyEnd + 1;
      continue;
    }
    i++;
  }

  return { tokens, contracts, topKeywords: ["pragma", "contract", "import"] };
}

/** Resolves Eclipse-style symbol hover information for declared contracts, params, entries, and local vars. */
export function getSilverSymbolHover(
  source: string,
  line: number,
  column: number
): { signature: string; summary: string } | null {
  const analysis = analyzeSilverSymbols(source);
  const tok = analysis.tokens.find((t) => t.kind === "ident" && t.line === line && column >= t.column && column <= t.endColumn);
  if (!tok) return null;

  for (const c of analysis.contracts) {
    if (c.name === tok.value) {
      const sig = c.params.map((p) => `${p.type} ${p.name}`).join(", ");
      return {
        signature: `contract ${c.name}(${sig})`,
        summary: `SilverScript contract with ${c.scopes.length} entry/function block(s) (declared on line ${c.line}).`
      };
    }
    const cParam = c.params.find((p) => p.name === tok.value);
    if (cParam) {
      return {
        signature: `(constructor param) ${cParam.type} ${cParam.name}`,
        summary: `Immutable constructor argument of contract \`${c.name}\` (line ${cParam.line}).`
      };
    }
    const cField = c.fields.find((f) => f.name === tok.value);
    if (cField) {
      return {
        signature: `(contract state) ${cField.type} ${cField.name}`,
        summary: `Contract-level field in \`${c.name}\` (line ${cField.line}).`
      };
    }
    for (const s of c.scopes) {
      const scopeStartLine = s.line;
      const scopeEndLine = analysis.tokens[s.bodyEndIdx]?.line ?? s.line;
      if (s.name === tok.value) {
        const sig = s.params.map((p) => `${p.type} ${p.name}`).join(", ");
        return {
          signature: `${s.kind} ${s.name}(${sig})`,
          summary: `${s.kind === "entry" ? "Contract spending path" : "Helper function"} in \`${c.name}\` with ${s.requires} \`require()\` guard(s).`
        };
      }
      if (line >= scopeStartLine && line <= scopeEndLine) {
        const ep = s.params.find((p) => p.name === tok.value);
        if (ep) {
          return {
            signature: `(parameter) ${ep.type} ${ep.name}`,
            summary: `Parameter of \`${s.kind} ${s.name}\` (line ${ep.line}).`
          };
        }
        const lv = s.locals.find((l) => l.name === tok.value);
        if (lv) {
          return {
            signature: `(local var) ${lv.type} ${lv.name}`,
            summary: `Local variable declared in \`${s.name}\` on line ${lv.line}.`
          };
        }
      }
    }
  }
  return null;
}

/**
 * Runs instantaneous Eclipse-style static syntax, scope, type/arity, and covenant linting
 * over a `.sil` file, generating exact token spans and one-click Quick Fixes.
 */
export function lintSilverSource(file: string, source: string): IdeDiagnostic[] {
  const diags: IdeDiagnostic[] = [];
  const lines = source ? source.split(/\r?\n/) : [];
  if (!source.trim()) return diags;

  const push = (d: Omit<IdeDiagnostic, "id" | "file" | "source">) => {
    diags.push({
      id: `sil-lint:${d.code ?? "SIL"}:${d.line}:${d.column}:${diags.length}`,
      file,
      source: "sil-lint",
      ...d
    });
  };

  // 1. Pragma version check with exact range + Quick Fix
  const ver = analyzeSilverVersion(source);
  if (ver.status === "missing") {
    push({
      line: 1,
      column: 1,
      endLine: 1,
      endColumn: Math.max(2, (lines[0] ?? "").length + 1),
      severity: "warning",
      code: "SIL-PRAGMA-001",
      message: ver.message,
      hint: `Add 'pragma silverscript ${SILVER_TOOLCHAIN.supportedPragma};' on line 1.`,
      fixes: [
        {
          title: `Insert 'pragma silverscript ${SILVER_TOOLCHAIN.supportedPragma};' on line 1`,
          edit: { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 1, text: `pragma silverscript ${SILVER_TOOLCHAIN.supportedPragma};\n` }
        }
      ]
    });
  } else if (ver.status === "mismatch") {
    const lineText = lines[ver.pragmaLine - 1] ?? "";
    const semiCol = lineText.indexOf(";");
    const pragmaIdx = Math.max(0, lineText.indexOf("pragma"));
    push({
      line: ver.pragmaLine,
      column: pragmaIdx + 1,
      endLine: ver.pragmaLine,
      endColumn: semiCol >= 0 ? semiCol + 2 : lineText.length + 1,
      severity: "warning",
      code: "SIL-PRAGMA-002",
      message: ver.message,
      hint: `Change pragma to 'pragma silverscript ${SILVER_TOOLCHAIN.supportedPragma};'.`,
      fixes: [
        {
          title: `Update pragma to '^0.1.0'`,
          edit: {
            startLineNumber: ver.pragmaLine,
            startColumn: pragmaIdx + 1,
            endLineNumber: ver.pragmaLine,
            endColumn: semiCol >= 0 ? semiCol + 2 : lineText.length + 1,
            text: `pragma silverscript ${SILVER_TOOLCHAIN.supportedPragma};`
          }
        }
      ]
    });
  }

  const analysis = analyzeSilverSymbols(source);
  const { tokens, contracts } = analysis;

  // 2. Bracket, paren, and brace matching with exact token locations
  const stack: SilverToken[] = [];
  const pairs: Record<string, string> = { "{": "}", "(": ")", "[": "]" };
  const closeToOpen: Record<string, string> = { "}": "{", ")": "(", "]": "[" };
  for (const tok of tokens) {
    if (tok.kind === "punct" && (tok.value === "{" || tok.value === "(" || tok.value === "[")) {
      stack.push(tok);
    } else if (tok.kind === "punct" && (tok.value === "}" || tok.value === ")" || tok.value === "]")) {
      const expectedOpen = closeToOpen[tok.value];
      const top = stack.at(-1);
      if (!top || top.value !== expectedOpen) {
        const code = tok.value === "}" ? "SIL-SYNTAX-BRACE" : tok.value === ")" ? "SIL-SYNTAX-PAREN" : "SIL-SYNTAX-BRACKET";
        push({
          line: tok.line,
          column: tok.column,
          endLine: tok.line,
          endColumn: tok.endColumn,
          severity: "error",
          code,
          message: `Unexpected closing '${tok.value}' on line ${tok.line}.`
        });
      } else {
        stack.pop();
      }
    }
  }
  for (const unclosed of stack) {
    const code = unclosed.value === "{" ? "SIL-SYNTAX-BRACE" : unclosed.value === "(" ? "SIL-SYNTAX-PAREN" : "SIL-SYNTAX-BRACKET";
    const expectedClose = pairs[unclosed.value];
    const lastLine = Math.max(1, lines.length);
    const lastCol = (lines[lastLine - 1] ?? "").length + 1;
    const fixes: DiagnosticFix[] =
      unclosed.value === "{"
        ? [
            {
              title: "Insert missing '}' at end of file",
              edit: { startLineNumber: lastLine, startColumn: lastCol, endLineNumber: lastLine, endColumn: lastCol, text: "\n}\n" }
            }
          ]
        : [];
    push({
      line: unclosed.line,
      column: unclosed.column,
      endLine: unclosed.line,
      endColumn: unclosed.endColumn,
      severity: "error",
      code,
      message: `Unclosed '${unclosed.value}' starting at line ${unclosed.line} (expected '${expectedClose}').`,
      fixes
    });
  }

  // 3. Statement semicolon check using token stream (respects multiline calls & comments cleanly)
  const stmtStartsByLine = new Map<number, SilverToken[]>();
  for (const tok of tokens) {
    const list = stmtStartsByLine.get(tok.line) ?? [];
    list.push(tok);
    stmtStartsByLine.set(tok.line, list);
  }
  let parenDepth = 0;
  let bracketDepth = 0;
  for (let lineIdx = 1; lineIdx <= lines.length; lineIdx++) {
    const lineTokens = stmtStartsByLine.get(lineIdx) ?? [];
    const startedBalanced = parenDepth === 0 && bracketDepth === 0;
    for (const tok of lineTokens) {
      if (tok.value === "(") parenDepth++;
      else if (tok.value === ")") parenDepth = Math.max(0, parenDepth - 1);
      else if (tok.value === "[") bracketDepth++;
      else if (tok.value === "]") bracketDepth = Math.max(0, bracketDepth - 1);
    }
    if (lineTokens.length === 0) continue;
    const first = lineTokens[0];
    const last = lineTokens.at(-1)!;
    const endsBalanced = parenDepth === 0 && bracketDepth === 0;
    const isStatementHead =
      first.kind === "ident" &&
      (first.value === "pragma" ||
        first.value === "require" ||
        first.value === "assert" ||
        first.value === "return" ||
        first.value === "let" ||
        first.value === "const" ||
        isTypeToken(first));
    const validEnders = new Set([";", "{", "}", ",", ":"]);
    // Also allow multiline binary operator continuation onto next line
    const isOpContinue = last.kind === "op" && ["&&", "||", "+", "-", "*", "/", "==", "!=", "<", ">", "<=", ">=", "="].includes(last.value);
    const nextLineFirst = (stmtStartsByLine.get(lineIdx + 1) ?? [])[0];
    const nextContinues =
      nextLineFirst &&
      ((nextLineFirst.kind === "op" && ["&&", "||", "==", "!=", "<=", ">="].includes(nextLineFirst.value)) ||
        nextLineFirst.value === ".");

    if (
      startedBalanced &&
      endsBalanced &&
      isStatementHead &&
      !validEnders.has(last.value) &&
      !isOpContinue &&
      !nextContinues &&
      first.value !== "contract"
    ) {
      // Avoid flagging multi-line `contract Name(...)` or `entry foo(...)` headers whose `{` is on next line
      const opensBlockNextLine = nextLineFirst?.value === "{";
      if (!opensBlockNextLine) {
        push({
          line: lineIdx,
          column: last.endColumn,
          endLine: lineIdx,
          endColumn: last.endColumn + 1,
          severity: "error",
          code: "SIL-SYNTAX-SEMI",
          message: `Missing ';' at end of SilverScript statement on line ${lineIdx}.`,
          hint: "Every statement and declaration in SilverScript must end with ';'.",
          fixes: [
            {
              title: "Insert missing ';'",
              edit: {
                startLineNumber: lineIdx,
                startColumn: last.endColumn,
                endLineNumber: lineIdx,
                endColumn: last.endColumn,
                text: ";"
              }
            }
          ]
        });
      }
    }
  }

  // 4. Top-level & contract-header keyword typo detection
  let depth = 0;
  for (let idx = 0; idx < tokens.length; idx++) {
    const tok = tokens[idx];
    if (tok.value === "{") {
      depth++;
      continue;
    }
    if (tok.value === "}") {
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (tok.value === "#" && tokens[idx + 1]?.value === "[") {
      idx = findMatchingToken(tokens, idx + 1, "[", "]");
      continue;
    }
    if ((depth === 0 || depth === 1) && tok.kind === "ident") {
      const prev = tokens[idx - 1];
      const atStatementStart = !prev || prev.value === ";" || prev.value === "{" || prev.value === "}" || prev.value === "]";
      if (atStatementStart) {
        const candidates = depth === 0 ? ["pragma", "contract", "import"] : ["entry", "entrypoint", "function", "const", "let", ...SIL_TYPES];
        if (!candidates.includes(tok.value) && !/^bytes\d+$/.test(tok.value)) {
          const suggest = closestMatch(tok.value, candidates, 2);
          if (suggest) {
            push({
              line: tok.line,
              column: tok.column,
              endLine: tok.line,
              endColumn: tok.endColumn,
              severity: "error",
              code: "SIL-TYPO-KW",
              message: `Unexpected token '${tok.value}'. Did you mean '${suggest}'?`,
              fixes: [
                {
                  title: `Replace '${tok.value}' with '${suggest}'`,
                  edit: {
                    startLineNumber: tok.line,
                    startColumn: tok.column,
                    endLineNumber: tok.line,
                    endColumn: tok.endColumn,
                    text: suggest
                  }
                }
              ]
            });
          }
        }
      }
    }
  }

  // 5. Scope-aware checks inside each contract & entry/function
  const allContractFnNames = new Set<string>();
  for (const c of contracts) {
    for (const s of c.scopes) allContractFnNames.add(s.name);
  }

  for (const c of contracts) {
    // Check duplicate constructor params
    const seenContractDecls = new Set<string>();
    for (const p of [...c.params, ...c.fields]) {
      if (seenContractDecls.has(p.name)) {
        push({
          line: p.line,
          column: p.column,
          endLine: p.line,
          endColumn: p.endColumn,
          severity: "error",
          code: "SIL-DUP-DECL",
          message: `Duplicate declaration '${p.name}' in contract '${c.name}'.`
        });
      }
      seenContractDecls.add(p.name);
    }

    const contractNames = new Set([...c.params.map((p) => p.name), ...c.fields.map((f) => f.name)]);

    for (const scope of c.scopes) {
      // Duplicate entry params / locals
      const scopeDecls = new Set<string>();
      for (const p of [...scope.params, ...scope.locals]) {
        if (scopeDecls.has(p.name) && p.type !== LOOP_VAR_TYPE) {
          push({
            line: p.line,
            column: p.column,
            endLine: p.line,
            endColumn: p.endColumn,
            severity: "error",
            code: "SIL-DUP-DECL",
            message: `Duplicate declaration '${p.name}' inside '${scope.name}'.`
          });
        }
        scopeDecls.add(p.name);
      }

      // Covenant safety: entry with zero require() / assert() guards
      if (scope.kind === "entry" && scope.requires === 0) {
        const pubkeyParam = c.params.find((p) => p.type === "pubkey");
        const sigParam = scope.params.find((p) => p.type === "sig");
        const fixSnippet =
          pubkeyParam && sigParam
            ? `\n    require(checkSig(${sigParam.name}, ${pubkeyParam.name}));`
            : pubkeyParam
              ? `\n    require(checkSig(sig, ${pubkeyParam.name}));`
              : `\n    require(true);`;
        const openBrace = tokens[scope.bodyStartIdx];
        push({
          line: scope.line,
          column: 1,
          endLine: scope.line,
          endColumn: (lines[scope.line - 1] ?? "").length + 1,
          severity: "warning",
          code: "SIL-COV-NOREQ",
          message: `Entry '${scope.name}' has no require(...) or assert(...) guards; anyone can spend via this path.`,
          hint: "Add at least one signature or covenant condition with require(...).",
          fixes: openBrace
            ? [
                {
                  title: "Add require(...) guard",
                  edit: {
                    startLineNumber: openBrace.line,
                    startColumn: openBrace.endColumn,
                    endLineNumber: openBrace.line,
                    endColumn: openBrace.endColumn,
                    text: fixSnippet
                  }
                }
              ]
            : undefined
        });
      }

      const validIdents = new Set<string>([
        ...contractNames,
        ...scopeDecls,
        ...allContractFnNames,
        ...SIL_FLOW_KEYWORDS,
        ...SIL_DECL_KEYWORDS,
        ...SIL_TYPES,
        ...SIL_BUILTINS
      ]);

      const localDeclPositions = new Set(scope.locals.map((l) => `${l.line}:${l.column}`));
      // Track covenant output constraints in this entry
      const valueCheckedOutputs = new Map<string, SilverToken>();
      const spkCheckedOutputs = new Set<string>();

      for (let k = scope.bodyStartIdx + 1; k < scope.bodyEndIdx; k++) {
        const tok = tokens[k];
        const prev = tokens[k - 1];
        const next = tokens[k + 1];

        // Check `require(a = b)` assignment mistake inside require/assert call
        if (tok.kind === "ident" && (tok.value === "require" || tok.value === "assert") && next?.value === "(") {
          const closeCall = findMatchingToken(tokens, k + 1, "(", ")");
          let innerDepth = 0;
          for (let q = k + 2; q < closeCall; q++) {
            const qt = tokens[q];
            if (qt.value === "(" || qt.value === "[") innerDepth++;
            else if (qt.value === ")" || qt.value === "]") innerDepth = Math.max(0, innerDepth - 1);
            else if (innerDepth === 0 && qt.value === "=") {
              push({
                line: qt.line,
                column: qt.column,
                endLine: qt.line,
                endColumn: qt.endColumn,
                severity: "error",
                code: "SIL-REQ-ASSIGN",
                message: `Assignment '=' used inside ${tok.value}(...) instead of comparison '=='.`,
                hint: "Use '==' to compare values inside require/assert.",
                fixes: [
                  {
                    title: "Replace '=' with '=='",
                    edit: {
                      startLineNumber: qt.line,
                      startColumn: qt.column,
                      endLineNumber: qt.line,
                      endColumn: qt.endColumn,
                      text: "=="
                    }
                  }
                ]
              });
            }
          }
        }

        // Member access checks: `tx.<prop>`, `this.<prop>`, `tx.outputs[i].<field>`, `tx.inputs[i].<field>`
        if (tok.kind === "ident" && tok.value === "tx" && next?.value === "." && tokens[k + 2]?.kind === "ident") {
          const prop = tokens[k + 2];
          if (!TX_PROPS.has(prop.value)) {
            const suggest = closestMatch(prop.value, TX_PROPS, 2);
            push({
              line: prop.line,
              column: prop.column,
              endLine: prop.line,
              endColumn: prop.endColumn,
              severity: "error",
              code: "SIL-TX-MEMBER",
              message: `Unknown transaction property 'tx.${prop.value}'.${suggest ? ` Did you mean '${suggest}'?` : ""}`,
              hint: `Valid tx properties: ${Array.from(TX_PROPS).join(", ")}.`,
              fixes: suggest
                ? [
                    {
                      title: `Replace '${prop.value}' with '${suggest}'`,
                      edit: {
                        startLineNumber: prop.line,
                        startColumn: prop.column,
                        endLineNumber: prop.line,
                        endColumn: prop.endColumn,
                        text: suggest
                      }
                    }
                  ]
                : undefined
            });
          } else if ((prop.value === "outputs" || prop.value === "inputs") && tokens[k + 3]?.value === "[") {
            const brEnd = findMatchingToken(tokens, k + 3, "[", "]");
            const idxSlice = tokens.slice(k + 4, brEnd).map((x) => x.value).join("");
            if (tokens[brEnd + 1]?.value === "." && tokens[brEnd + 2]?.kind === "ident") {
              const fieldTok = tokens[brEnd + 2];
              const allowed = prop.value === "outputs" ? TX_OUTPUT_FIELDS : TX_INPUT_FIELDS;
              if (!allowed.has(fieldTok.value)) {
                const suggest = closestMatch(fieldTok.value, allowed, 3);
                push({
                  line: fieldTok.line,
                  column: fieldTok.column,
                  endLine: fieldTok.line,
                  endColumn: fieldTok.endColumn,
                  severity: "error",
                  code: "SIL-TX-FIELD",
                  message: `Unknown field '.${fieldTok.value}' on tx.${prop.value}[...].${suggest ? ` Did you mean '${suggest}'?` : ""}`,
                  hint: `Valid fields: ${Array.from(allowed).join(", ")}.`,
                  fixes: suggest
                    ? [
                        {
                          title: `Replace '${fieldTok.value}' with '${suggest}'`,
                          edit: {
                            startLineNumber: fieldTok.line,
                            startColumn: fieldTok.column,
                            endLineNumber: fieldTok.line,
                            endColumn: fieldTok.endColumn,
                            text: suggest
                          }
                        }
                      ]
                    : undefined
                });
              } else if (prop.value === "outputs") {
                if (fieldTok.value === "value") valueCheckedOutputs.set(idxSlice || "0", fieldTok);
                else if (fieldTok.value === "scriptPubKey" || fieldTok.value === "lockingBytecode") {
                  spkCheckedOutputs.add(idxSlice || "0");
                }
              }
            }
          }
          continue;
        }

        if (tok.kind === "ident" && tok.value === "this" && next?.value === "." && tokens[k + 2]?.kind === "ident") {
          const prop = tokens[k + 2];
          if (!THIS_FIELDS.has(prop.value)) {
            const suggest = closestMatch(prop.value, THIS_FIELDS, 3);
            push({
              line: prop.line,
              column: prop.column,
              endLine: prop.line,
              endColumn: prop.endColumn,
              severity: "error",
              code: "SIL-THIS-MEMBER",
              message: `Unknown contract context property 'this.${prop.value}'.`,
              hint: `Valid properties: ${Array.from(THIS_FIELDS).join(", ")}.`,
              fixes: suggest
                ? [
                    {
                      title: `Replace '${prop.value}' with '${suggest}'`,
                      edit: {
                        startLineNumber: prop.line,
                        startColumn: prop.column,
                        endLineNumber: prop.line,
                        endColumn: prop.endColumn,
                        text: suggest
                      }
                    }
                  ]
                : undefined
            });
          }
          continue;
        }

        // Skip member field names right after `.`
        if (prev?.value === ".") continue;

        // Function / builtin call arity & name check
        if (tok.kind === "ident" && next?.value === "(") {
          const closeP = findMatchingToken(tokens, k + 1, "(", ")");
          // Count top-level comma-separated args
          let argc = 0;
          if (closeP > k + 2) {
            argc = 1;
            let pd = 0;
            for (let q = k + 2; q < closeP; q++) {
              // `{…}` too: an array literal `sig[]{s1, s2}` is one argument.
              if (tokens[q].value === "(" || tokens[q].value === "[" || tokens[q].value === "{") pd++;
              else if (tokens[q].value === ")" || tokens[q].value === "]" || tokens[q].value === "}") pd = Math.max(0, pd - 1);
              else if (pd === 0 && tokens[q].value === ",") argc++;
            }
          }
          const spec = BUILTIN_ARITY[tok.value];
          if (spec && (argc < spec.min || argc > spec.max)) {
            push({
              line: tok.line,
              column: tok.column,
              endLine: tok.line,
              endColumn: tok.endColumn,
              severity: "error",
              code: "SIL-CALL-ARITY",
              message: `'${tok.value}' expects ${spec.min === spec.max ? spec.min : `${spec.min}-${spec.max}`} argument(s), got ${argc}.`,
              hint: `Signature: ${spec.signature}`
            });
          } else if (OUTPUT_STATE_VALIDATORS.has(tok.value) && closeP > k + 2) {
            // validateOutputState(i, next) checks output i's script and state together: it binds output i.
            const firstArg: string[] = [];
            for (let q = k + 2; q < closeP && tokens[q].value !== ","; q++) firstArg.push(tokens[q].value);
            spkCheckedOutputs.add(firstArg.join("") || "0");
          } else if (!SIL_BUILTINS.has(tok.value) && !isIntrinsicName(tok.value) && !SIL_TYPES.has(tok.value) && !allContractFnNames.has(tok.value) && !SIL_FLOW_KEYWORDS.has(tok.value)) {
            // `pubkey(x)`, `int(x)`, `byte[32](x)`: a type name before `(` is a cast, not a call (SIL_TYPES above).
            const suggest = closestMatch(tok.value, [...SIL_BUILTINS, ...allContractFnNames], 2);
            push({
              line: tok.line,
              column: tok.column,
              endLine: tok.line,
              endColumn: tok.endColumn,
              severity: "error",
              code: "SIL-UNKNOWN-CALL",
              message: `Unknown function or builtin '${tok.value}(...)'.${suggest ? ` Did you mean '${suggest}'?` : ""}`,
              fixes: suggest
                ? [
                    {
                      title: `Replace '${tok.value}' with '${suggest}'`,
                      edit: {
                        startLineNumber: tok.line,
                        startColumn: tok.column,
                        endLineNumber: tok.line,
                        endColumn: tok.endColumn,
                        text: suggest
                      }
                    }
                  ]
                : undefined
            });
          }
          continue;
        }

        // Skip type keywords preceding a declaration identifier (`int amount = ...;`)
        if (isTypeToken(tok)) continue;
        // Skip declaration target identifiers (`int myVar =`, `byte[32] myVar =`, `let x =`)
        if (tok.kind === "ident" && localDeclPositions.has(`${tok.line}:${tok.column}`)) {
          continue;
        }

        // Unknown identifier check inside entry/function body
        if (tok.kind === "ident" && !validIdents.has(tok.value) && !isIntrinsicName(tok.value)) {
          const suggest = closestMatch(tok.value, validIdents, 2);
          push({
            line: tok.line,
            column: tok.column,
            endLine: tok.line,
            endColumn: tok.endColumn,
            severity: "error",
            code: "SIL-UNDEF-IDENT",
            message: `Undefined identifier '${tok.value}'.${suggest ? ` Did you mean '${suggest}'?` : ""}`,
            hint: suggest ? `Available symbol/keyword: '${suggest}'.` : "Declare this variable or add it to contract/entry parameters.",
            fixes: suggest
              ? [
                  {
                    title: `Replace '${tok.value}' with '${suggest}'`,
                    edit: {
                      startLineNumber: tok.line,
                      startColumn: tok.column,
                      endLineNumber: tok.line,
                      endColumn: tok.endColumn,
                      text: suggest
                    }
                  }
                ]
              : undefined
          });
        }
      }

      // Covenant check: output[i].value constrained without locking its scriptPubKey
      if (scope.kind === "entry") {
        for (const [idxStr, fieldTok] of valueCheckedOutputs.entries()) {
          if (!spkCheckedOutputs.has(idxStr)) {
            push({
              line: fieldTok.line,
              column: fieldTok.column,
              endLine: fieldTok.line,
              endColumn: fieldTok.endColumn,
              severity: "warning",
              code: "SIL-COV-UNBOUND-OUT",
              message: `Output[${idxStr}].value is constrained without locking tx.outputs[${idxStr}].scriptPubKey.`,
              hint: `Add require(tx.outputs[${idxStr}].scriptPubKey == expectedSpk); so funds cannot be redirected.`
            });
          }
        }
      }
    }
  }

  return diags;
}
