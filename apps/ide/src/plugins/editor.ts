import type * as Monaco from "monaco-editor";
import { Plugin } from "@/engine/engine";

/**
 * Editor service. Owns the Monaco instance and exposes the same kind of API
 * Remix's editor plugin exposes: markers, goto line, change events.
 */

export interface EditorDiagnostic {
  file: string;
  line: number;
  column?: number;
  endLine?: number;
  endColumn?: number;
  severity: "error" | "warning" | "info";
  message: string;
}

export class EditorPlugin extends Plugin {
  private editor: Monaco.editor.IStandaloneCodeEditor | null = null;
  private monaco: typeof Monaco | null = null;
  private changeTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    super({
      name: "editor",
      displayName: "Editor",
      location: "none",
      methods: ["addErrorMarker", "clearErrorMarkers", "gotoLine", "focus"],
      events: ["contentChanged", "editorMounted"]
    });
  }

  attach(editor: Monaco.editor.IStandaloneCodeEditor, monaco: typeof Monaco): void {
    this.editor = editor;
    this.monaco = monaco;
    this.emit("editorMounted");
  }

  /** The Monaco namespace once the editor has mounted (null before). */
  getMonaco(): typeof Monaco | null {
    return this.monaco;
  }

  /** Debounced like Remix (500 ms): drives auto-save and auto-compile. */
  notifyChange(path: string): void {
    if (this.changeTimer) clearTimeout(this.changeTimer);
    this.changeTimer = setTimeout(() => this.emit("contentChanged", path), 500);
  }

  addErrorMarker(diagnostics: EditorDiagnostic[], owner = "hardkas"): void {
    if (!this.monaco) return;
    const byFile = new Map<string, EditorDiagnostic[]>();
    for (const d of diagnostics) {
      const list = byFile.get(d.file) ?? [];
      list.push(d);
      byFile.set(d.file, list);
    }
    for (const model of this.monaco.editor.getModels()) {
      const path = model.uri.path.replace(/^\//, "");
      const list = byFile.get(path) ?? [];
      this.monaco.editor.setModelMarkers(
        model,
        owner,
        list.map((d) => ({
          startLineNumber: d.line,
          startColumn: d.column ?? 1,
          endLineNumber: d.endLine ?? d.line,
          endColumn: d.endColumn ?? (d.column ?? 1) + 1,
          message: d.message,
          severity:
            d.severity === "error"
              ? this.monaco!.MarkerSeverity.Error
              : d.severity === "warning"
                ? this.monaco!.MarkerSeverity.Warning
                : this.monaco!.MarkerSeverity.Info
        }))
      );
    }
  }

  clearErrorMarkers(owner = "hardkas"): void {
    if (!this.monaco) return;
    for (const model of this.monaco.editor.getModels()) {
      this.monaco.editor.setModelMarkers(model, owner, []);
    }
  }

  gotoLine(line: number, column = 1): void {
    this.editor?.revealLineInCenter(line);
    this.editor?.setPosition({ lineNumber: line, column });
    this.editor?.focus();
  }

  focus(): void {
    this.editor?.focus();
  }
}
