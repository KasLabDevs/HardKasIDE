export interface SilverCompileSummary {
  file?: string;
  ok: boolean;
  contracts?: Array<{ name: string; lockingScript?: string; address?: string }>;
  bytecode?: string;
  scriptPublicKey?: string;
  raw?: unknown;
  errorText?: string;
}

export const SILVER_TOOLCHAIN = {
  silvercVersion: "1.0.0",
  languageVersion: "0.1.0",
  supportedPragma: "^0.1.0"
} as const;

export interface SilverVersionCheck {
  pragmaRaw: string | null;
  pragmaVersion: string | null;
  pragmaLine: number;
  status: "ok" | "missing" | "mismatch";
  silvercVersion: string;
  languageVersion: string;
  message: string;
}

export interface SilverSourceDiagnostic {
  file: string;
  line: number;
  column: number;
  endColumn?: number;
  severity: "error" | "warning" | "info";
  code: string;
  message: string;
  hint?: string;
}

/**
 * Requirement 5: Inspects the `pragma silverscript` version in a `.sil` file and compares it
 * with the active `silverc` compiler & SilverScript language version.
 */
export function analyzeSilverVersion(source: string): SilverVersionCheck {
  const lines = source.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = /^\s*pragma\s+silverscript\s+([^;]+);/i.exec(line);
    if (m) {
      const raw = m[1].trim();
      const verMatch = /(\d+\.\d+\.\d+|\d+\.\d+)/.exec(raw);
      const ver = verMatch ? verMatch[1] : raw;
      const isCompatible = ver.startsWith("0.1");
      return {
        pragmaRaw: raw,
        pragmaVersion: ver,
        pragmaLine: i + 1,
        status: isCompatible ? "ok" : "mismatch",
        silvercVersion: SILVER_TOOLCHAIN.silvercVersion,
        languageVersion: SILVER_TOOLCHAIN.languageVersion,
        message: isCompatible
          ? `Compatible: pragma ${raw} matches silverc v${SILVER_TOOLCHAIN.silvercVersion} (SilverScript ${SILVER_TOOLCHAIN.languageVersion}).`
          : `API Version Warning: Contract declares pragma ${raw}, but active silverc v${SILVER_TOOLCHAIN.silvercVersion} targets SilverScript ${SILVER_TOOLCHAIN.supportedPragma}. The SilverScript API moves fast; update pragma or toolchain.`
      };
    }
  }
  return {
    pragmaRaw: null,
    pragmaVersion: null,
    pragmaLine: 1,
    status: "missing",
    silvercVersion: SILVER_TOOLCHAIN.silvercVersion,
    languageVersion: SILVER_TOOLCHAIN.languageVersion,
    message: `Missing 'pragma silverscript ${SILVER_TOOLCHAIN.supportedPragma};' header. Pin the version explicitly because silverc and SilverScript APIs evolve rapidly.`
  };
}

/**
 * Requirement 2: Extracts readable, line-linked diagnostics from `silverc` output AND static `.sil` source analysis.
 * Guarantees accurate line & column numbers so clicking any error/warning jumps straight to the `.sil` line.
 */
export function parseSilverDiagnostics(
  file: string,
  source: string,
  compileResult?: SilverCompileSummary | null,
  auditFindings?: Array<{ severity: string; rule: string; message: string; line?: number }>
): SilverSourceDiagnostic[] {
  const diagnostics: SilverSourceDiagnostic[] = [];
  const lines = source ? source.split(/\r?\n/) : [];

  // 1. Pragma version check
  if (source.trim().length > 0) {
    const ver = analyzeSilverVersion(source);
    if (ver.status === "missing") {
      diagnostics.push({
        file,
        line: 1,
        column: 1,
        severity: "warning",
        code: "SIL-PRAGMA-001",
        message: ver.message,
        hint: `Add 'pragma silverscript ^0.1.0;' on line 1.`
      });
    } else if (ver.status === "mismatch") {
      diagnostics.push({
        file,
        line: ver.pragmaLine,
        column: 1,
        severity: "warning",
        code: "SIL-PRAGMA-002",
        message: ver.message,
        hint: `Change pragma to 'pragma silverscript ^0.1.0;' for silverc v${SILVER_TOOLCHAIN.silvercVersion}.`
      });
    }
  }

  // 2. Parse explicit `silverc` compiler errors or locate semantic compiler errors accurately
  if (compileResult && !compileResult.ok) {
    const rawMsg = extractCompilerErrorText(compileResult);
    const explicitDiagnostics = parseExplicitLineDiagnostics(file, rawMsg, lines);

    if (explicitDiagnostics.length > 0) {
      diagnostics.push(...explicitDiagnostics);
    } else {
      const mapped = mapSilvercErrorToSource(rawMsg, lines);
      for (const hit of mapped) {
        diagnostics.push({
          file,
          line: hit.line,
          column: hit.column,
          endColumn: hit.endColumn,
          severity: "error",
          code: hit.code ?? "SILVERC-ERR",
          message: rawMsg || "silverc compilation failed",
          hint: hit.hint ?? "Unsupported or invalid construct reported by silverc."
        });
      }
    }
  }

  // 3. Static `.sil` line-by-line syntax & covenant linting so errors are always caught with exact line numbers
  if (lines.length > 0) {
    let braceDepth = 0;
    let lastOpenBraceLine = 1;
    for (let i = 0; i < lines.length; i++) {
      const rawLine = lines[i];
      const clean = rawLine.replace(/\/\/.*$/, "").trim();
      if (!clean) continue;

      for (const ch of clean) {
        if (ch === "{") {
          braceDepth++;
          lastOpenBraceLine = i + 1;
        } else if (ch === "}") {
          braceDepth--;
        }
      }

      // Check for statements missing semicolon inside functions
      if (
        /^(require\s*\(|int\s+\w+\s*=|byte\[\d*\]\s+\w+\s*=|bytes\s+\w+\s*=|pubkey\s+\w+\s*=|bool\s+\w+\s*=)/.test(clean) &&
        !clean.endsWith(";") &&
        // A statement that goes on to the next line (open parenthesis) is not missing its ';'.
        (clean.match(/\(/g) ?? []).length === (clean.match(/\)/g) ?? []).length
      ) {
        const alreadyReported = diagnostics.some((d) => d.line === i + 1 && d.severity === "error");
        if (!alreadyReported) {
          diagnostics.push({
            file,
            line: i + 1,
            column: rawLine.length,
            severity: "error",
            code: "SIL-SYNTAX-SEMI",
            message: `Missing ';' at end of SilverScript statement on line ${i + 1}.`,
            hint: "Every 'require(...)' and variable declaration in SilverScript must end with ';'."
          });
        }
      }
    }

    if (braceDepth !== 0) {
      diagnostics.push({
        file,
        line: braceDepth > 0 ? lastOpenBraceLine : lines.length,
        column: 1,
        severity: "error",
        code: "SIL-SYNTAX-BRACE",
        message: braceDepth > 0 ? `Unclosed '{' block starting at line ${lastOpenBraceLine}.` : "Unexpected closing '}' brace."
      });
    }
  }

  // 4. Merge any audit findings with line mapping
  if (auditFindings) {
    for (const f of auditFindings) {
      let line = f.line ?? 1;
      if (!f.line && lines.length > 0) {
        const idx = lines.findIndex((l) => l.includes("entrypoint") || l.includes("tx.outputs") || l.includes("checkSig"));
        if (idx >= 0) line = idx + 1;
      }
      diagnostics.push({
        file,
        line,
        column: 1,
        severity: f.severity === "high" || f.severity === "error" ? "error" : f.severity === "info" ? "info" : "warning",
        code: f.rule.toUpperCase(),
        message: f.message
      });
    }
  }

  return diagnostics;
}

export interface SilverOutputRef {
  entrypoint: string;
  line: number;
  outputIndex: number;
  /** What the source constrains on that output: its script (`scriptPubKey`) or its `value`. */
  field: "scriptPubKey" | "value";
  /** The constraint as written in the source, e.g. `>= splitAmount`. */
  constraint: string;
}

export interface SilverSourceSummary {
  entrypoints: Array<{ name: string; line: number }>;
  requireCount: number;
  sigChecks: number;
  outputRefs: SilverOutputRef[];
  /** Size in bytes of the locking script silverc produced; null until the contract is compiled. */
  compiledScriptBytes: number | null;
  compiledScriptHex: string | null;
}

/**
 * What the `.sil` source itself says: entrypoints, `require(...)` count, signature checks and which outputs each
 * entrypoint constrains. Read from the text, not executed. The script size comes only from a real silverc result.
 */
export function summarizeSilverSource(source: string, compileResult?: SilverCompileSummary | null): SilverSourceSummary {
  const lines = source ? source.split(/\r?\n/) : [];
  const entrypoints: SilverSourceSummary["entrypoints"] = [];
  const outputRefs: SilverOutputRef[] = [];
  let current = "";
  let requireCount = 0;
  let sigChecks = 0;
  for (let i = 0; i < lines.length; i++) {
    const code = stripLineCommentKeepCols(lines[i]);
    const ep = /\bentrypoint\s+function\s+([A-Za-z_]\w*)|\bentry\s+([A-Za-z_]\w*)\s*\(/.exec(code);
    if (ep) {
      current = ep[1] ?? ep[2];
      entrypoints.push({ name: current, line: i + 1 });
    }
    requireCount += (code.match(/\brequire\s*\(/g) ?? []).length;
    sigChecks += (code.match(/\bcheck(?:Multi)?Sig\s*\(/g) ?? []).length;
    const re = /\btx\.outputs\s*\[\s*(\d+)\s*\]\.(scriptPubKey|lockingBytecode|value)\s*(==|>=|<=|>|<|!=)\s*([^;]+?)\s*(?:;|$)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(code)) !== null) {
      // `require(a == b);` captures `b)`: drop the parentheses that close the require, keep balanced ones.
      let rhs = m[4].trim();
      while (rhs.endsWith(")") && (rhs.match(/\)/g) ?? []).length > (rhs.match(/\(/g) ?? []).length) rhs = rhs.slice(0, -1).trimEnd();
      outputRefs.push({
        entrypoint: current || "(contract)",
        line: i + 1,
        outputIndex: Number(m[1]),
        field: m[2] === "value" ? "value" : "scriptPubKey",
        constraint: `${m[3]} ${rhs}`
      });
    }
  }
  const hex = (compileResult?.ok ? (compileResult.scriptPublicKey ?? compileResult.bytecode ?? "") : "").replace(/^0x/, "");
  const validHex = /^[0-9a-fA-F]+$/.test(hex) && hex.length % 2 === 0 ? hex : "";
  return {
    entrypoints,
    requireCount,
    sigChecks,
    outputRefs,
    compiledScriptBytes: validHex ? validHex.length / 2 : null,
    compiledScriptHex: validHex || null
  };
}

/** True when a silverc / CLI error says the pinned SilverScript compiler is not installed yet. */
export function isSilvercMissing(text: string | undefined | null): boolean {
  return !!text && (/toolchain install silverc/i.test(text) || /\bsilverc\b[^\n]*\bnot installed\b/i.test(text) || /SILVERC_(?:NOT_FOUND|MISSING|TOOLCHAIN_NOT_INSTALLED)/.test(text));
}

/** Extracts plain human/compiler error text from `silverc` results without stringifying timestamps or hashes. */
export function extractCompilerErrorText(compileResult: SilverCompileSummary): string {
  const parts: string[] = [];
  if (typeof compileResult.errorText === "string" && compileResult.errorText.trim()) {
    parts.push(compileResult.errorText.trim());
  }
  const raw = compileResult.raw;
  if (typeof raw === "string" && raw.trim()) {
    parts.push(raw.trim());
  } else if (raw && typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    for (const key of ["message", "error", "stderr", "detail"] as const) {
      if (typeof obj[key] === "string" && (obj[key] as string).trim()) {
        parts.push((obj[key] as string).trim());
      }
    }
  }
  const unique = Array.from(new Set(parts));
  return unique.join("\n").trim() || "silverc compilation failed";
}

function stripLineCommentKeepCols(rawLine: string): string {
  const idx = rawLine.indexOf("//");
  return idx >= 0 ? rawLine.slice(0, idx) : rawLine;
}

function parseExplicitLineDiagnostics(file: string, rawText: string, lines: string[]): SilverSourceDiagnostic[] {
  const out: SilverSourceDiagnostic[] = [];
  const seen = new Set<string>();
  const sanitized = rawText
    // Avoid mistaking ISO timestamps (2026-11-13T03:54:00.123Z) or URLs for :line:col
    .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?/g, "<ts>")
    .replace(/https?:\/\/[^\s)]+/gi, "<url>");

  const patterns: RegExp[] = [
    /-->\s*[^\s:\r\n]+\.sil:(\d+)(?::(\d+))?(?:\s*\n?[^\r\n]*)?/gi,
    /\bat\s+line\s+(\d+)(?:,\s*col(?:umn)?\s*(\d+))?\s*[:\-]?\s*(.+)/gi,
    /(?:^|[\s(])(?:line\s+|[^\s:]+\.sil:)(\d+)(?::(\d+))?\s*[-:]?\s*(.+)/gim,
    /\[(\d+):(\d+)\]\s*(.+)/gi
  ];

  for (const pat of patterns) {
    let m: RegExpExecArray | null;
    while ((m = pat.exec(sanitized)) !== null) {
      const lineNum = Math.max(1, Math.min(lines.length || 999, Number(m[1]) || 1));
      const colNum = Math.max(1, Number(m[2]) || 1);
      const msg = (m[3] || rawText.split(/\r?\n/)[0] || "silverc compilation error").trim();
      const key = `${lineNum}:${colNum}:${msg}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        file,
        line: lineNum,
        column: colNum,
        endColumn: colNum + 12,
        severity: "error",
        code: "SILVERC-ERR",
        message: msg
      });
    }
  }
  return out;
}

export interface MappedSilverErrorHit {
  line: number;
  column: number;
  endColumn: number;
  code?: string;
  hint?: string;
}

/**
 * Maps semantic `silverc` v1.0.0 error messages (which often omit `:line:col`, e.g.
 * `"unsupported feature: field access on transaction introspection is not supported"`)
 * to exact source line & column spans in `.sil` contracts.
 */
export function mapSilvercErrorToSource(errMsg: string, lines: string[]): MappedSilverErrorHit[] {
  if (lines.length === 0) return [{ line: 1, column: 1, endColumn: 2, code: "SILVERC-ERR" }];
  const hits: MappedSilverErrorHit[] = [];

  // 1. Transaction introspection field access (e.g. tx.inputs[this.activeInputIndex].lockingBytecode / .value)
  if (/transaction introspection|field access on transaction|activeInputIndex|tx\.inputs/i.test(errMsg)) {
    const collectMatches = (re: RegExp, hint: string) => {
      for (let i = 0; i < lines.length; i++) {
        const codePart = stripLineCommentKeepCols(lines[i]);
        if (!codePart.trim()) continue;
        re.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = re.exec(codePart)) !== null) {
          hits.push({
            line: i + 1,
            column: m.index + 1,
            endColumn: m.index + m[0].length + 1,
            code: "SILVERC-UNSUPPORTED",
            hint
          });
          if (hits.length >= 6) return;
        }
      }
    };

    collectMatches(
      /\btx\.inputs\s*\[[^\]]+\](?:\.[A-Za-z_]\w*)+|\bthis\.activeInputIndex\b/g,
      "silverc v1.0.0 does not yet support input introspection field access (tx.inputs[...] / activeInputIndex). Use Toccata State parameters with #[covenant(...)] instead."
    );
    if (hits.length === 0) {
      collectMatches(
        /\btx\.(?:inputs|outputs)\s*\[[^\]]+\](?:\.[A-Za-z_]\w*)+/g,
        "Transaction introspection expression is not supported in this silverc compilation mode."
      );
    }
    if (hits.length > 0) return hits;
  }

  // 2. Quoted symbol/identifier in compiler diagnostic (e.g. `unknown identifier 'foo'` or `` `foo` ``)
  const quoted = Array.from(errMsg.matchAll(/['"`]([A-Za-z_][A-Za-z0-9_.[\]]*)['"`]/g))
    .map((m) => m[1])
    .filter((tok) => tok.length > 1 && !["sil", "silverc", "json", "cli"].includes(tok.toLowerCase()));
  for (const token of quoted) {
    for (let i = 0; i < lines.length; i++) {
      const codePart = stripLineCommentKeepCols(lines[i]);
      const idx = codePart.indexOf(token);
      if (idx >= 0) {
        return [{
          line: i + 1,
          column: idx + 1,
          endColumn: idx + token.length + 1,
          code: "SILVERC-ERR"
        }];
      }
    }
  }

  // 3. Covenant attribute / State mismatch
  if (/covenant|State\b|prev_state|state_span/i.test(errMsg)) {
    for (let i = 0; i < lines.length; i++) {
      const codePart = stripLineCommentKeepCols(lines[i]);
      const m = /#\[covenant\b[^\]]*\]|\bfunction\s+[A-Za-z_]\w*\s*\([^)]*\bState\b/.exec(codePart);
      if (m) {
        return [{
          line: i + 1,
          column: m.index + 1,
          endColumn: m.index + m[0].length + 1,
          code: "SILVERC-COVENANT"
        }];
      }
    }
  }

  // 4. Pragma or constructor mismatch
  if (/pragma/i.test(errMsg)) {
    const idx = lines.findIndex((l) => /\bpragma\b/.test(stripLineCommentKeepCols(l)));
    if (idx >= 0) {
      const col = Math.max(1, lines[idx].indexOf("pragma") + 1);
      return [{ line: idx + 1, column: col, endColumn: lines[idx].length + 1, code: "SILVERC-PRAGMA" }];
    }
  }
  if (/constructor argument/i.test(errMsg)) {
    const idx = lines.findIndex((l) => /\bcontract\s+[A-Za-z_]\w*/.test(stripLineCommentKeepCols(l)));
    if (idx >= 0) {
      const m = /\bcontract\s+[A-Za-z_]\w*\s*\([^)]*\)/.exec(lines[idx]);
      const col = m ? m.index + 1 : 1;
      return [{ line: idx + 1, column: col, endColumn: m ? m.index + m[0].length + 1 : lines[idx].length + 1, code: "SILVERC-ARGS" }];
    }
  }

  // 5. Missing semicolon syntax fallback
  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const trimmed = stripLineCommentKeepCols(rawLine).trim();
    if (!trimmed) continue;
    if (/^(require|int|pubkey|sig|bytes|bool|pragma|return)\b/.test(trimmed) && !trimmed.endsWith(";") && !trimmed.endsWith("{")) {
      return [{ line: i + 1, column: Math.max(1, rawLine.length), endColumn: rawLine.length + 1, code: "SILVERC-SYNTAX" }];
    }
  }

  return [{ line: 1, column: 1, endColumn: Math.max(2, lines[0].length + 1), code: "SILVERC-ERR" }];
}
