import { create } from "zustand";

export interface EditorCursorState {
  file: string | null;
  line: number;
  column: number;
  lineCount: number;
  errors: number;
  warnings: number;
  setPosition(file: string | null, line: number, column: number, lineCount: number): void;
  setDiagnostics(file: string | null, errors: number, warnings: number): void;
  clear(): void;
}

/**
 * Lightweight live editor state (cursor position and marker counts for the active model), kept separate
 * from `useIde` so high-frequency cursor movement only re-renders Breadcrumbs and StatusBar.
 */
export const useEditorCursor = create<EditorCursorState>((set) => ({
  file: null,
  line: 1,
  column: 1,
  lineCount: 1,
  errors: 0,
  warnings: 0,
  setPosition: (file, line, column, lineCount) =>
    set((s) =>
      s.file === file && s.line === line && s.column === column && s.lineCount === lineCount
        ? s
        : { file, line, column, lineCount }
    ),
  setDiagnostics: (file, errors, warnings) =>
    set((s) => (s.file === file && s.errors === errors && s.warnings === warnings ? s : { file, errors, warnings })),
  clear: () =>
    set((s) => (s.file === null && s.line === 1 && s.column === 1 ? s : { file: null, line: 1, column: 1, lineCount: 1, errors: 0, warnings: 0 }))
}));
