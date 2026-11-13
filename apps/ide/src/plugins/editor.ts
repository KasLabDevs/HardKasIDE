import type * as Monaco from "monaco-editor";
import { Plugin } from "@/engine/engine";

/**
 * Editor service. Owns the Monaco instance and exposes markers, goto line,
 * insert/trigger helpers and change events to the other plugins.
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
  private pendingGoto: { path: string; line: number; column: number } | null = null;
  private markersByOwner = new Map<string, Map<string, EditorDiagnostic[]>>();

  constructor() {
    super({
      name: "editor",
      displayName: "Editor",
      location: "none",
      methods: ["addErrorMarker", "setFileMarkers", "clearErrorMarkers", "gotoLine", "gotoFileLine", "focus", "insertText", "trigger"],
      events: ["contentChanged", "editorMounted"]
    });
  }

  onDeactivation(): void {
    if (this.changeTimer) {
      clearTimeout(this.changeTimer);
      this.changeTimer = null;
    }
  }

  attach(editor: Monaco.editor.IStandaloneCodeEditor, monaco: typeof Monaco): void {
    this.editor = editor;
    this.monaco = monaco;
    for (const model of monaco.editor.getModels()) {
      this.applyStoredMarkersForModel(model);
    }
    this.emit("editorMounted");
  }

  /** The Monaco namespace once the editor has mounted (null before). */
  getMonaco(): typeof Monaco | null {
    return this.monaco;
  }

  /** Debounced (500 ms): drives auto-save and auto-compile. */
  notifyChange(path: string): void {
    if (this.changeTimer) clearTimeout(this.changeTimer);
    this.changeTimer = setTimeout(() => this.emit("contentChanged", path), 500);
  }

  private normalizePath(p: string): string {
    return p.replace(/\\/g, "/").replace(/^\/+/, "");
  }

  private toMonacoMarkers(list: EditorDiagnostic[]): Monaco.editor.IMarkerData[] {
    const monaco = this.monaco!;
    return list.map((d) => ({
      startLineNumber: d.line,
      startColumn: d.column ?? 1,
      endLineNumber: d.endLine ?? d.line,
      endColumn: d.endColumn ?? (d.column ?? 1) + 1,
      message: d.message,
      source: "silverc",
      severity:
        d.severity === "error"
          ? monaco.MarkerSeverity.Error
          : d.severity === "warning"
            ? monaco.MarkerSeverity.Warning
            : monaco.MarkerSeverity.Info
    }));
  }

  applyStoredMarkersForModel(model: Monaco.editor.ITextModel): void {
    if (!this.monaco) return;
    const norm = this.normalizePath(model.uri.path);
    for (const [owner, byFile] of this.markersByOwner.entries()) {
      const list = byFile.get(norm) ?? [];
      this.monaco.editor.setModelMarkers(model, owner, this.toMonacoMarkers(list));
    }
  }

  /** Replaces diagnostics for a single file under `owner`, preserving markers on other open tabs. */
  setFileMarkers(file: string, diagnostics: EditorDiagnostic[], owner = "hardkas"): void {
    const norm = this.normalizePath(file);
    let byFile = this.markersByOwner.get(owner);
    if (!byFile) {
      byFile = new Map<string, EditorDiagnostic[]>();
      this.markersByOwner.set(owner, byFile);
    }
    if (diagnostics.length > 0) byFile.set(norm, diagnostics);
    else byFile.delete(norm);

    if (!this.monaco) return;
    for (const model of this.monaco.editor.getModels()) {
      if (this.normalizePath(model.uri.path) === norm) {
        this.monaco.editor.setModelMarkers(model, owner, this.toMonacoMarkers(diagnostics));
      }
    }
  }

  addErrorMarker(diagnostics: EditorDiagnostic[], owner = "hardkas"): void {
    const byFile = new Map<string, EditorDiagnostic[]>();
    for (const d of diagnostics) {
      const normFile = this.normalizePath(d.file);
      const list = byFile.get(normFile) ?? [];
      list.push(d);
      byFile.set(normFile, list);
    }
    this.markersByOwner.set(owner, byFile);
    if (!this.monaco) return;
    for (const model of this.monaco.editor.getModels()) {
      const path = this.normalizePath(model.uri.path);
      const list = byFile.get(path) ?? [];
      this.monaco.editor.setModelMarkers(model, owner, this.toMonacoMarkers(list));
    }
  }

  clearErrorMarkers(owner = "hardkas", file?: string): void {
    if (file) {
      this.setFileMarkers(file, [], owner);
      return;
    }
    this.markersByOwner.delete(owner);
    if (!this.monaco) return;
    for (const model of this.monaco.editor.getModels()) {
      this.monaco.editor.setModelMarkers(model, owner, []);
    }
  }

  gotoLine(line: number, column = 1): void {
    const ed = this.editor;
    if (!ed) return;
    const model = ed.getModel();
    const clampedLine = model ? Math.min(Math.max(1, line), model.getLineCount()) : Math.max(1, line);
    ed.revealLineInCenter(clampedLine);
    ed.setPosition({ lineNumber: clampedLine, column: Math.max(1, column) });
    ed.focus();
  }

  /** Reveals a target file & line even if the model finishes switching asynchronously on open. */
  gotoFileLine(path: string, line: number, column = 1): void {
    const norm = path.replace(/\\/g, "/").replace(/^\/+/, "");
    const activeNorm = this.editor?.getModel()?.uri.path.replace(/\\/g, "/").replace(/^\/+/, "");
    if (activeNorm === norm) {
      this.pendingGoto = null;
      this.gotoLine(line, column);
      return;
    }
    this.pendingGoto = { path: norm, line, column };
  }

  /** Consumes any deferred reveal target matching the newly active editor model. */
  consumePendingGoto(modelPath: string): { line: number; column: number } | null {
    const norm = modelPath.replace(/\\/g, "/").replace(/^\/+/, "");
    if (!this.pendingGoto || this.pendingGoto.path !== norm) return null;
    const target = { line: this.pendingGoto.line, column: this.pendingGoto.column };
    this.pendingGoto = null;
    return target;
  }

  /** Replaces the selection (or inserts at the cursor) with `text`; used by the Assistant's "Insert" button. */
  insertText(text: string): boolean {
    const ed = this.editor;
    const sel = ed?.getSelection();
    if (!ed || !sel) return false;
    ed.executeEdits("assistant", [{ range: sel, text, forceMoveMarkers: true }]);
    ed.focus();
    return true;
  }

  focus(): void {
    this.editor?.focus();
  }

  /** Runs a Monaco command by id ("undo", "actions.find", "editor.action.formatDocument"…); used by the Edit and Go menus. */
  trigger(commandId: string): boolean {
    const ed = this.editor;
    if (!ed) return false;
    ed.focus();
    ed.trigger("menu", commandId, null);
    return true;
  }
}
