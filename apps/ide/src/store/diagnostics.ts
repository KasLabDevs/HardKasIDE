import { create } from "zustand";

export interface DiagnosticTextEdit {
  startLineNumber: number;
  startColumn: number;
  endLineNumber: number;
  endColumn: number;
  text: string;
}

export interface DiagnosticFix {
  title: string;
  edit: DiagnosticTextEdit;
}

export interface IdeDiagnostic {
  id: string;
  file: string;
  source: string;
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
  severity: "error" | "warning" | "info";
  code?: string;
  message: string;
  hint?: string;
  fixes?: DiagnosticFix[];
}

export interface FileDiagCount {
  errors: number;
  warnings: number;
  infos: number;
}

export function normalizeDiagPath(p: string): string {
  return p.replace(/\\/g, "/").replace(/^\/+/, "");
}

function summarizeAll(byFileSource: Record<string, Record<string, IdeDiagnostic[]>>): {
  byFile: Record<string, IdeDiagnostic[]>;
  countsByFile: Record<string, FileDiagCount>;
  totals: FileDiagCount;
} {
  const byFile: Record<string, IdeDiagnostic[]> = {};
  const countsByFile: Record<string, FileDiagCount> = {};
  const totals: FileDiagCount = { errors: 0, warnings: 0, infos: 0 };

  for (const [file, sources] of Object.entries(byFileSource)) {
    const merged: IdeDiagnostic[] = [];
    const dedupe = new Set<string>();
    for (const items of Object.values(sources)) {
      for (const item of items) {
        const key = `${item.line}:${item.column}:${item.severity}:${item.message}`;
        if (dedupe.has(key)) continue;
        dedupe.add(key);
        merged.push(item);
      }
    }
    if (merged.length === 0) continue;
    merged.sort((a, b) => {
      const sevOrder = (s: IdeDiagnostic["severity"]) => (s === "error" ? 0 : s === "warning" ? 1 : 2);
      return sevOrder(a.severity) - sevOrder(b.severity) || a.line - b.line || a.column - b.column;
    });
    byFile[file] = merged;

    const counts: FileDiagCount = { errors: 0, warnings: 0, infos: 0 };
    for (const item of merged) {
      if (item.severity === "error") counts.errors++;
      else if (item.severity === "warning") counts.warnings++;
      else counts.infos++;
    }
    countsByFile[file] = counts;
    totals.errors += counts.errors;
    totals.warnings += counts.warnings;
    totals.infos += counts.infos;
  }

  return { byFile, countsByFile, totals };
}

interface DiagnosticsState {
  /** Internal map: file -> source -> items */
  raw: Record<string, Record<string, IdeDiagnostic[]>>;
  /** Deduplicated sorted diagnostics per file */
  byFile: Record<string, IdeDiagnostic[]>;
  countsByFile: Record<string, FileDiagCount>;
  totals: FileDiagCount;

  setFileDiagnostics(file: string, source: string, items: IdeDiagnostic[]): void;
  replaceSourceDiagnostics(source: string, map: Map<string, IdeDiagnostic[]>): void;
  clearFile(file: string): void;
  resetWorkspace(): void;
}

export const useDiagnostics = create<DiagnosticsState>((set) => ({
  raw: {},
  byFile: {},
  countsByFile: {},
  totals: { errors: 0, warnings: 0, infos: 0 },

  setFileDiagnostics: (file, source, items) =>
    set((s) => {
      const norm = normalizeDiagPath(file);
      if (!norm) return s;
      const nextRaw = { ...s.raw };
      const fileSources = { ...(nextRaw[norm] ?? {}) };
      if (items.length > 0) {
        fileSources[source] = items.map((d) => ({ ...d, file: norm, source }));
      } else {
        delete fileSources[source];
      }
      if (Object.keys(fileSources).length > 0) {
        nextRaw[norm] = fileSources;
      } else {
        delete nextRaw[norm];
      }
      return { raw: nextRaw, ...summarizeAll(nextRaw) };
    }),

  replaceSourceDiagnostics: (source, map) =>
    set((s) => {
      const nextRaw: Record<string, Record<string, IdeDiagnostic[]>> = {};
      for (const [file, sources] of Object.entries(s.raw)) {
        const clone = { ...sources };
        delete clone[source];
        if (Object.keys(clone).length > 0) nextRaw[file] = clone;
      }
      for (const [file, items] of map.entries()) {
        const norm = normalizeDiagPath(file);
        if (!norm || items.length === 0) continue;
        nextRaw[norm] = {
          ...(nextRaw[norm] ?? {}),
          [source]: items.map((d) => ({ ...d, file: norm, source }))
        };
      }
      return { raw: nextRaw, ...summarizeAll(nextRaw) };
    }),

  clearFile: (file) =>
    set((s) => {
      const norm = normalizeDiagPath(file);
      if (!(norm in s.raw)) return s;
      const nextRaw = { ...s.raw };
      delete nextRaw[norm];
      return { raw: nextRaw, ...summarizeAll(nextRaw) };
    }),

  resetWorkspace: () => set({ raw: {}, byFile: {}, countsByFile: {}, totals: { errors: 0, warnings: 0, infos: 0 } })
}));

/** Computes aggregated error/warning counts for any directory prefix in the workspace tree. */
export function folderDiagCounts(countsByFile: Record<string, FileDiagCount>, dirPath: string): FileDiagCount {
  const prefix = normalizeDiagPath(dirPath).replace(/\/+$/, "") + "/";
  const out: FileDiagCount = { errors: 0, warnings: 0, infos: 0 };
  for (const [file, c] of Object.entries(countsByFile)) {
    if (file.startsWith(prefix)) {
      out.errors += c.errors;
      out.warnings += c.warnings;
      out.infos += c.infos;
    }
  }
  return out;
}

/** Finds all diagnostics overlapping a cursor/hover position on `file`. */
export function diagnosticsAtPosition(file: string, line: number, column?: number): IdeDiagnostic[] {
  const norm = normalizeDiagPath(file);
  const items = useDiagnostics.getState().byFile[norm] ?? [];
  return items.filter((d) => {
    if (line < d.line || line > d.endLine) return false;
    if (column === undefined) return true;
    if (d.line === d.endLine) {
      return column >= d.column && column <= Math.max(d.endColumn, d.column + 1);
    }
    return true;
  });
}

/** Finds diagnostics with auto-fixes overlapping `[startLine..endLine]`. */
export function fixableDiagnosticsInRange(file: string, startLine: number, endLine: number): IdeDiagnostic[] {
  const norm = normalizeDiagPath(file);
  const items = useDiagnostics.getState().byFile[norm] ?? [];
  return items.filter(
    (d) => Array.isArray(d.fixes) && d.fixes.length > 0 && d.endLine >= startLine && d.line <= endLine
  );
}
