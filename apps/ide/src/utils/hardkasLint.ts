import type { IdeDiagnostic } from "@/store/diagnostics";
import { analyzeSilverSymbols, closestMatch, type SilverContractSymbolModel } from "./silverLinter";

export interface WorkspaceContractIndex {
  byName: Map<string, { file: string; contract: SilverContractSymbolModel }>;
  bySilFile: Map<string, SilverContractSymbolModel[]>;
}

/** Builds a lightweight index of all contracts and entrypoints defined across workspace `.sil` files. */
export function indexWorkspaceContracts(files: Array<{ path: string; content: string }>): WorkspaceContractIndex {
  const byName = new Map<string, { file: string; contract: SilverContractSymbolModel }>();
  const bySilFile = new Map<string, SilverContractSymbolModel[]>();
  for (const f of files) {
    if (!f.path.toLowerCase().endsWith(".sil")) continue;
    const { contracts } = analyzeSilverSymbols(f.content);
    if (contracts.length === 0) continue;
    bySilFile.set(f.path, contracts);
    for (const c of contracts) {
      byName.set(c.name, { file: f.path, contract: c });
    }
  }
  return { byName, bySilFile };
}

function defaultArgForSilverType(silType: string): { kind: string; value: unknown } {
  const t = silType.trim().toLowerCase();
  if (t === "int" || t === "sompi" || t === "temporal") return { kind: "int", value: 1 };
  if (t === "bool") return { kind: "bool", value: true };
  if (t === "byte") return { kind: "byte", value: 0 };
  if (t === "string") return { kind: "text", value: "" };
  return { kind: "bytes", value: Array.from({ length: 32 }, () => 0) };
}

function isCompatibleKind(silType: string, rawKind: string): boolean {
  const t = silType.trim().toLowerCase();
  const k = rawKind.trim().toLowerCase();
  if (t === "int" || t === "sompi" || t === "temporal") return k === "int";
  if (t === "bool") return k === "bool";
  if (t === "byte") return k === "byte" || k === "int" || k === "bytes";
  if (t === "string") return k === "text" || k === "string";
  if (t === "pubkey") return k === "bytes" || k === "pubkey" || k === "address";
  if (t.startsWith("byte")) return k === "bytes" || k === "byte" || k === "address" || k === "text";
  return true;
}

function lineColAtOffset(text: string, offset: number): { line: number; column: number } {
  const safe = Math.max(0, Math.min(offset, text.length));
  const upTo = text.slice(0, safe);
  const lines = upTo.split("\n");
  return { line: lines.length, column: (lines.at(-1)?.length ?? 0) + 1 };
}

/** Validates `*.constructor-args.json` against its sibling `.sil` contract parameters. */
export function lintConstructorArgsFile(
  file: string,
  content: string,
  index: WorkspaceContractIndex
): IdeDiagnostic[] {
  if (!file.toLowerCase().endsWith(".constructor-args.json")) return [];
  const diags: IdeDiagnostic[] = [];
  const lines = content.split(/\r?\n/);

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Invalid JSON";
    diags.push({
      id: `hardkas:json:${file}`,
      file,
      source: "hardkas",
      line: 1,
      column: 1,
      endLine: 1,
      endColumn: Math.max(2, (lines[0] ?? "").length + 1),
      severity: "error",
      code: "HK-ARGS-JSON",
      message: `Invalid JSON in constructor args: ${msg}`
    });
    return diags;
  }

  const siblingSil = file.replace(/\.constructor-args\.json$/i, ".sil");
  const contracts = index.bySilFile.get(siblingSil);
  const contract = contracts?.[0];
  if (!contract) return diags;

  if (!Array.isArray(parsed)) {
    const scaffold = JSON.stringify(contract.params.map((p) => defaultArgForSilverType(p.type)), null, 2);
    diags.push({
      id: `hardkas:args-array:${file}`,
      file,
      source: "hardkas",
      line: 1,
      column: 1,
      endLine: 1,
      endColumn: Math.max(2, (lines[0] ?? "").length + 1),
      severity: "error",
      code: "HK-ARGS-SHAPE",
      message: `Constructor args for '${contract.name}' must be a JSON array of { kind, value } objects.`,
      fixes: [
        {
          title: `Scaffold constructor args for ${contract.name}`,
          edit: {
            startLineNumber: 1,
            startColumn: 1,
            endLineNumber: Math.max(1, lines.length),
            endColumn: (lines.at(-1) ?? "").length + 1,
            text: scaffold + "\n"
          }
        }
      ]
    });
    return diags;
  }

  if (parsed.length !== contract.params.length) {
    const sig = contract.params.map((p) => `${p.type} ${p.name}`).join(", ");
    const scaffold = JSON.stringify(
      contract.params.map((p, idx) => {
        const existing = parsed[idx];
        if (existing && typeof existing === "object" && "kind" in existing && "value" in existing) return existing;
        return defaultArgForSilverType(p.type);
      }),
      null,
      2
    );
    diags.push({
      id: `hardkas:args-len:${file}`,
      file,
      source: "hardkas",
      line: 1,
      column: 1,
      endLine: 1,
      endColumn: Math.max(2, (lines[0] ?? "").length + 1),
      severity: "error",
      code: "HK-ARGS-COUNT",
      message: `Contract '${contract.name}(${sig})' expects ${contract.params.length} constructor arg(s), but ${parsed.length} given.`,
      fixes: [
        {
          title: `Sync array to match ${contract.name}'s ${contract.params.length} parameter(s)`,
          edit: {
            startLineNumber: 1,
            startColumn: 1,
            endLineNumber: Math.max(1, lines.length),
            endColumn: (lines.at(-1) ?? "").length + 1,
            text: scaffold + "\n"
          }
        }
      ]
    });
  }

  // Validate each element's kind matches expected SilverScript parameter type
  const kindMatches = Array.from(content.matchAll(/"kind"\s*:\s*"([^"]*)"/g));
  const len = Math.min(parsed.length, contract.params.length);
  for (let i = 0; i < len; i++) {
    const item = parsed[i];
    const param = contract.params[i];
    const kindMatch = kindMatches[i];
    const pos = kindMatch ? lineColAtOffset(content, kindMatch.index ?? 0) : { line: 1, column: 1 };
    const endCol = kindMatch ? pos.column + kindMatch[0].length : pos.column + 1;

    if (!item || typeof item !== "object" || typeof (item as Record<string, unknown>).kind !== "string") {
      diags.push({
        id: `hardkas:args-item:${file}:${i}`,
        file,
        source: "hardkas",
        line: pos.line,
        column: pos.column,
        endLine: pos.line,
        endColumn: endCol,
        severity: "error",
        code: "HK-ARGS-ITEM",
        message: `Constructor arg #${i} (${param.type} ${param.name}) must be { "kind": "...", "value": ... }.`
      });
      continue;
    }

    const kindVal = String((item as Record<string, unknown>).kind);
    if (!isCompatibleKind(param.type, kindVal)) {
      const expected = defaultArgForSilverType(param.type).kind;
      diags.push({
        id: `hardkas:args-kind:${file}:${i}`,
        file,
        source: "hardkas",
        line: pos.line,
        column: pos.column,
        endLine: pos.line,
        endColumn: endCol,
        severity: "error",
        code: "HK-ARGS-TYPE",
        message: `Constructor arg #${i} (${param.name}) has kind '${kindVal}', expected '${expected}' for SilverScript '${param.type}'.`,
        fixes: kindMatch
          ? [
              {
                title: `Change kind to '${expected}'`,
                edit: {
                  startLineNumber: pos.line,
                  startColumn: pos.column,
                  endLineNumber: pos.line,
                  endColumn: endCol,
                  text: `"kind": "${expected}"`
                }
              }
            ]
          : undefined
      });
    }
  }

  return diags;
}

/** Validates HardKas cross-file contract/entry references inside TS/JS scripts, fronts, and config files. */
export function lintHardkasWorkspaceFile(
  file: string,
  content: string,
  index: WorkspaceContractIndex
): IdeDiagnostic[] {
  const lower = file.toLowerCase();
  if (lower.endsWith(".constructor-args.json")) {
    return lintConstructorArgsFile(file, content, index);
  }

  const diags: IdeDiagnostic[] = [];

  // 1. `hardkas.config.*`: policy reminders (mainnet blocked, allowPublic note)
  if (/^hardkas\.config\.[cm]?[jt]s$/i.test(file.split("/").pop() ?? "")) {
    const m = /\ballowPublic\s*:\s*true\b/.exec(content);
    if (m && m.index !== undefined) {
      const pos = lineColAtOffset(content, m.index);
      diags.push({
        id: `hardkas:allow-public:${file}`,
        file,
        source: "hardkas",
        line: pos.line,
        column: pos.column,
        endLine: pos.line,
        endColumn: pos.column + m[0].length,
        severity: "warning",
        code: "HK-POLICY-PUBLIC",
        message: "allowPublic: true permits remote testnet RPC calls; Kaspa mainnet remains blocked by HardKas policy.",
        fixes: [
          {
            title: "Set allowPublic: false",
            edit: {
              startLineNumber: pos.line,
              startColumn: pos.column,
              endLineNumber: pos.line,
              endColumn: pos.column + m[0].length,
              text: "allowPublic: false"
            }
          }
        ]
      });
    }
  }

  // 2. Cross-reference `{ contract: "Name", entry: "fn" }` or `spendContract({ ... })` in TS/JS/front files
  if (/\.(?:[cm]?[jt]sx?)$/i.test(lower) && index.byName.size > 0) {
    const pairRe = /\bcontract\s*:\s*["']([A-Za-z_]\w*)["'][\s\S]{0,160}?\bentry\s*:\s*["']([A-Za-z_]\w*)["']/g;
    let m: RegExpExecArray | null;
    while ((m = pairRe.exec(content)) !== null) {
      const contractName = m[1];
      const entryName = m[2];
      const hit = index.byName.get(contractName);
      if (!hit) continue;
      const validEntries = hit.contract.scopes.filter((s) => s.kind === "entry").map((s) => s.name);
      if (validEntries.length > 0 && !validEntries.includes(entryName)) {
        const entryOffset = m.index + m[0].lastIndexOf(entryName);
        const pos = lineColAtOffset(content, entryOffset);
        const suggest = closestMatch(entryName, validEntries, 2);
        diags.push({
          id: `hardkas:entry-mismatch:${file}:${pos.line}:${pos.column}`,
          file,
          source: "hardkas",
          line: pos.line,
          column: pos.column,
          endLine: pos.line,
          endColumn: pos.column + entryName.length,
          severity: "error",
          code: "HK-UNKNOWN-ENTRY",
          message: `Contract '${contractName}' (${hit.file}) has no entry '${entryName}'. Available: ${validEntries.join(", ")}.`,
          fixes: suggest
            ? [
                {
                  title: `Replace '${entryName}' with '${suggest}'`,
                  edit: {
                    startLineNumber: pos.line,
                    startColumn: pos.column,
                    endLineNumber: pos.line,
                    endColumn: pos.column + entryName.length,
                    text: suggest
                  }
                }
              ]
            : undefined
        });
      }
    }
  }

  return diags;
}
