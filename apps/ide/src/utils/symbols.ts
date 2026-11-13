import type { TreeNode } from "@/api/client";
import { parseSilOutline } from "./silParser";

export type SymbolKind =
  | "contract"
  | "entry"
  | "function"
  | "class"
  | "interface"
  | "type"
  | "const"
  | "test"
  | "heading"
  | "key";

export interface DocumentSymbol {
  id: string;
  name: string;
  kind: SymbolKind;
  line: number;
  endLine: number;
  detail?: string;
  parentId?: string;
}

/**
 * Extracts navigable symbols with line spans for Breadcrumbs, Quick Open (`@`), and outline navigation.
 */
export function extractDocumentSymbols(path: string, content: string): DocumentSymbol[] {
  const lower = path.toLowerCase();
  if (lower.endsWith(".sil")) return extractSilSymbols(content);
  if (/\.(?:[cm]?[jt]sx?)$/.test(lower)) return extractScriptSymbols(content);
  if (lower.endsWith(".md") || lower.endsWith(".mdx")) return extractMarkdownSymbols(content);
  if (lower.endsWith(".json")) return extractJsonTopKeys(content);
  return [];
}

function extractSilSymbols(content: string): DocumentSymbol[] {
  const outline = parseSilOutline(content);
  const out: DocumentSymbol[] = [];
  for (const c of outline.contracts) {
    const cid = `sil:contract:${c.name}:${c.line}`;
    const paramSummary = c.params.map((p) => `${p.type} ${p.name}`).join(", ");
    out.push({
      id: cid,
      name: c.name,
      kind: "contract",
      line: c.line,
      endLine: c.endLine,
      detail: paramSummary ? `(${paramSummary})` : `${c.entries.length} entries`
    });
    for (const e of c.entries) {
      const sig = e.params.map((p) => `${p.type} ${p.name}`).join(", ");
      const req = `${e.requires} require${e.requires === 1 ? "" : "s"}`;
      out.push({
        id: `sil:entry:${c.name}.${e.name}:${e.line}`,
        name: e.name,
        kind: "entry",
        line: e.line,
        endLine: e.endLine,
        parentId: cid,
        detail: `(${sig}) · ${req}`
      });
    }
  }
  return out;
}

function extractScriptSymbols(content: string): DocumentSymbol[] {
  const lines = content.split(/\r?\n/);
  const out: DocumentSymbol[] = [];
  let inBlockComment = false;
  let currentSuiteId: string | undefined;

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const lineNo = i + 1;
    let line = raw.trim();

    if (inBlockComment) {
      const end = line.indexOf("*/");
      if (end === -1) continue;
      inBlockComment = false;
      line = line.slice(end + 2).trim();
    }
    if (!line || line.startsWith("//")) continue;
    if (line.startsWith("/*")) {
      if (!line.includes("*/")) inBlockComment = true;
      continue;
    }

    const suite = /^describe(?:\.(?:only|skip))?\(\s*(['"`])(.+?)\1/.exec(line);
    if (suite) {
      const id = `ts:describe:${suite[2]}:${lineNo}`;
      currentSuiteId = id;
      out.push({ id, name: suite[2], kind: "test", line: lineNo, endLine: lineNo, detail: "describe" });
      continue;
    }

    const testCase = /^(?:it|test)(?:\.(?:only|skip))?\(\s*(['"`])(.+?)\1/.exec(line);
    if (testCase) {
      out.push({
        id: `ts:test:${testCase[2]}:${lineNo}`,
        name: testCase[2],
        kind: "test",
        line: lineNo,
        endLine: lineNo,
        parentId: currentSuiteId,
        detail: "test"
      });
      continue;
    }

    const fn = /^(?:export\s+(?:default\s+)?)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/.exec(line);
    if (fn) {
      currentSuiteId = undefined;
      out.push({ id: `ts:fn:${fn[1]}:${lineNo}`, name: fn[1], kind: "function", line: lineNo, endLine: lineNo });
      continue;
    }

    const cls = /^(?:export\s+(?:default\s+)?)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)\b/.exec(line);
    if (cls) {
      currentSuiteId = undefined;
      out.push({ id: `ts:class:${cls[1]}:${lineNo}`, name: cls[1], kind: "class", line: lineNo, endLine: lineNo });
      continue;
    }

    const iface = /^(?:export\s+)?interface\s+([A-Za-z_$][\w$]*)\b/.exec(line);
    if (iface) {
      currentSuiteId = undefined;
      out.push({ id: `ts:iface:${iface[1]}:${lineNo}`, name: iface[1], kind: "interface", line: lineNo, endLine: lineNo });
      continue;
    }

    const typeAlias = /^(?:export\s+)?type\s+([A-Za-z_$][\w$]*)\s*(?:<[^>]+>)?\s*=/.exec(line);
    if (typeAlias) {
      currentSuiteId = undefined;
      out.push({ id: `ts:type:${typeAlias[1]}:${lineNo}`, name: typeAlias[1], kind: "type", line: lineNo, endLine: lineNo });
      continue;
    }

    const exportedConst = /^export\s+(?:const|let)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=/.exec(line);
    if (exportedConst) {
      currentSuiteId = undefined;
      out.push({ id: `ts:const:${exportedConst[1]}:${lineNo}`, name: exportedConst[1], kind: "const", line: lineNo, endLine: lineNo });
    }
  }

  for (let i = 0; i < out.length; i++) {
    const next = out[i + 1];
    out[i].endLine = next ? Math.max(out[i].line, next.line - 1) : lines.length;
  }
  return out;
}

function extractMarkdownSymbols(content: string): DocumentSymbol[] {
  const lines = content.split(/\r?\n/);
  const out: DocumentSymbol[] = [];
  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed.startsWith("```") || trimmed.startsWith("~~~")) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const m = /^(#{1,3})\s+(.+?)\s*$/.exec(trimmed);
    if (m) {
      out.push({
        id: `md:h:${i + 1}`,
        name: m[2],
        kind: "heading",
        line: i + 1,
        endLine: i + 1,
        detail: m[1]
      });
    }
  }
  for (let i = 0; i < out.length; i++) {
    const next = out[i + 1];
    out[i].endLine = next ? Math.max(out[i].line, next.line - 1) : lines.length;
  }
  return out;
}

function extractJsonTopKeys(content: string): DocumentSymbol[] {
  const lines = content.split(/\r?\n/);
  const out: DocumentSymbol[] = [];
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (depth === 1) {
      const m = /^\s*"([^"\\]+)"\s*:/.exec(line);
      if (m) {
        out.push({ id: `json:${m[1]}:${i + 1}`, name: m[1], kind: "key", line: i + 1, endLine: i + 1 });
      }
    }
    for (let j = 0; j < line.length; j++) {
      const ch = line[j];
      if (inString) {
        if (escaped) escaped = false;
        else if (ch === "\\") escaped = true;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') inString = true;
      else if (ch === "{" || ch === "[") depth++;
      else if (ch === "}" || ch === "]") depth = Math.max(0, depth - 1);
    }
  }
  for (let i = 0; i < out.length; i++) {
    const next = out[i + 1];
    out[i].endLine = next ? Math.max(out[i].line, next.line - 1) : lines.length;
  }
  return out;
}

/**
 * Resolves the active breadcrumb chain `[outer, inner?]` containing `line`.
 */
export function activeSymbolTrail(symbols: DocumentSymbol[], line: number): DocumentSymbol[] {
  if (symbols.length === 0 || line <= 0) return [];
  const containing = symbols.filter((s) => s.line <= line && line <= s.endLine);
  if (containing.length === 0) return [];

  const inner = containing.reduce((best, cur) => (cur.line >= best.line ? cur : best), containing[0]);
  if (inner.parentId) {
    const parent = symbols.find((s) => s.id === inner.parentId);
    if (parent) return [parent, inner];
  }
  return [inner];
}

export interface BreadcrumbFolderSegment {
  label: string;
  dirPath: string;
  items: TreeNode[];
}

/**
 * Resolves clickable folder segments and sibling nodes along `filePath` from the explorer `tree`.
 */
export function collectBreadcrumbTreeSegments(
  tree: TreeNode[],
  filePath: string
): { folders: BreadcrumbFolderSegment[]; fileSiblings: TreeNode[] } {
  const parts = filePath.split("/").filter(Boolean);
  if (parts.length === 0) return { folders: [], fileSiblings: [] };

  let level = tree;
  const folders: BreadcrumbFolderSegment[] = [];
  for (let i = 0; i < parts.length - 1; i++) {
    const dirName = parts[i];
    const dirPath = parts.slice(0, i + 1).join("/");
    folders.push({ label: dirName, dirPath, items: level });
    const match = level.find((n) => n.type === "dir" && n.name === dirName);
    level = match?.children ?? [];
  }
  return { folders, fileSiblings: level };
}
