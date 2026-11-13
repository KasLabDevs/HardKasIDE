import type { TreeNode } from "@/api/client";

export type PaletteMode = "files" | "commands" | "symbols" | "line";

export interface ParsedPaletteQuery {
  mode: PaletteMode;
  filter: string;
  line: number | null;
  column: number | null;
}

export interface PaletteMatch {
  score: number;
  indices: number[];
}

/**
 * Parses Quick Open prefixes:
 * - `>foo` → command palette
 * - `@foo` → symbols in the active file
 * - `:42` or `:42:8` → go to line/column in active file
 * - `foo.sil:12` → file search with target line jump
 */
export function parsePaletteQuery(raw: string): ParsedPaletteQuery {
  const trimmed = raw.trimStart();
  if (trimmed.startsWith(">")) {
    return { mode: "commands", filter: trimmed.slice(1).trimStart(), line: null, column: null };
  }
  if (trimmed.startsWith("@")) {
    return { mode: "symbols", filter: trimmed.slice(1).trimStart(), line: null, column: null };
  }
  if (trimmed.startsWith(":")) {
    const body = trimmed.slice(1).trim();
    const m = /^(\d+)(?::(\d+))?/.exec(body);
    return {
      mode: "line",
      filter: body,
      line: m ? Math.max(1, Number(m[1])) : null,
      column: m?.[2] ? Math.max(1, Number(m[2])) : null
    };
  }

  const lineSuffix = /^(.+?):(\d+)(?::(\d+))?$/.exec(trimmed.trim());
  if (lineSuffix) {
    return {
      mode: "files",
      filter: lineSuffix[1].trim(),
      line: Math.max(1, Number(lineSuffix[2])),
      column: lineSuffix[3] ? Math.max(1, Number(lineSuffix[3])) : null
    };
  }
  return { mode: "files", filter: trimmed.trim(), line: null, column: null };
}

/**
 * Computes a deterministic relevance score + matched character indices for highlighting.
 * Returns null if `query` does not match `text`.
 */
export function scorePaletteMatch(query: string, text: string): PaletteMatch | null {
  const q = query.trim().toLowerCase();
  if (!q) return { score: 0, indices: [] };

  const lower = text.toLowerCase();
  const baseIdx = Math.max(lower.lastIndexOf("/") + 1, 0);
  const words = q.split(/\s+/).filter(Boolean);

  if (words.length > 1) {
    const indices: number[] = [];
    let score = 0;
    for (const w of words) {
      const idx = lower.indexOf(w);
      if (idx === -1) return null;
      score += idx >= baseIdx ? 40 : 18;
      if (idx === baseIdx || idx === 0 || isWordBoundary(text, idx)) score += 25;
      for (let k = 0; k < w.length; k++) indices.push(idx + k);
    }
    return { score, indices: [...new Set(indices)].sort((a, b) => a - b) };
  }

  const single = words[0];
  const baseName = lower.slice(baseIdx);
  if (baseName === single) {
    return {
      score: 300 - text.length * 0.05,
      indices: Array.from({ length: single.length }, (_, k) => baseIdx + k)
    };
  }
  if (baseName.startsWith(single)) {
    return {
      score: 220 - text.length * 0.05,
      indices: Array.from({ length: single.length }, (_, k) => baseIdx + k)
    };
  }

  const exactAt = lower.indexOf(single, baseIdx);
  if (exactAt !== -1) {
    const boundary = isWordBoundary(text, exactAt) ? 45 : 0;
    return {
      score: 140 + boundary - (exactAt - baseIdx) - text.length * 0.05,
      indices: Array.from({ length: single.length }, (_, k) => exactAt + k)
    };
  }

  const anyAt = lower.indexOf(single);
  if (anyAt !== -1) {
    const boundary = anyAt === 0 || isWordBoundary(text, anyAt) ? 35 : 0;
    return {
      score: 95 + boundary - anyAt * 0.2 - text.length * 0.05,
      indices: Array.from({ length: single.length }, (_, k) => anyAt + k)
    };
  }

  // Fuzzy subsequence match fallback (e.g. "tsil" -> "contracts/tienda.sil")
  const fuzzy = matchSubsequence(single, text, baseIdx);
  return fuzzy;
}

function isWordBoundary(text: string, idx: number): boolean {
  if (idx <= 0) return true;
  const prev = text[idx - 1];
  const curr = text[idx];
  if (prev === "/" || prev === "." || prev === "_" || prev === "-" || prev === " " || prev === ":") return true;
  return prev >= "a" && prev <= "z" && curr >= "A" && curr <= "Z";
}

function matchSubsequence(needle: string, haystack: string, baseIdx: number): PaletteMatch | null {
  const lower = haystack.toLowerCase();
  const indices: number[] = [];
  let j = 0;
  let score = 30;
  let consecutive = 0;

  for (let i = 0; i < lower.length && j < needle.length; i++) {
    if (lower[i] === needle[j]) {
      indices.push(i);
      if (i >= baseIdx) score += 8;
      if (isWordBoundary(haystack, i)) score += 10;
      if (consecutive > 0) score += 6 * consecutive;
      consecutive++;
      j++;
    } else {
      consecutive = 0;
    }
  }
  if (j < needle.length) return null;
  return { score: score - haystack.length * 0.05, indices };
}

/**
 * Flattens workspace file tree paths cleanly, skipping `node_modules` and `.git` unless explicitly searched.
 */
export function flattenTreePaths(tree: TreeNode[], includeNoise = false): string[] {
  const out: string[] = [];
  const walk = (nodes: TreeNode[]) => {
    for (const n of nodes) {
      if (!includeNoise && (n.name === "node_modules" || n.name === ".git")) continue;
      if (n.type === "file") out.push(n.path);
      else if (n.children) walk(n.children);
    }
  };
  walk(tree);
  return out;
}

/** Priority boost for Kaspa contract / source paths over config/lock noise. */
export function filePathBonus(path: string, recentIdx: number, isOpen: boolean): number {
  let bonus = 0;
  if (recentIdx >= 0) bonus += Math.max(20, 120 - recentIdx * 8);
  if (isOpen) bonus += 35;
  if (path.endsWith(".sil")) bonus += 16;
  else if (/\.(?:test|spec)\.[cm]?[jt]sx?$/.test(path)) bonus += 10;
  else if (/\.[cm]?[jt]sx?$/.test(path)) bonus += 12;
  if (path.endsWith("pnpm-lock.yaml") || path.endsWith("package-lock.json")) bonus -= 30;
  return bonus;
}
