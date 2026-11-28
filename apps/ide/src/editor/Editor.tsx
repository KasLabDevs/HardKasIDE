import MonacoEditor, { type BeforeMount, type OnMount } from "@monaco-editor/react";
import type * as Monaco from "monaco-editor";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useEngine } from "@/engine/context";
import type { DebugPlugin } from "@/plugins/debug";
import type { EditorPlugin } from "@/plugins/editor";
import { currentLocation, useDebug } from "@/store/debug";
import { silverDebugLine, useSilverDebug } from "@/store/silverDebug";
import { diagnosticsAtPosition, fixableDiagnosticsInRange, normalizeDiagPath, useDiagnostics } from "@/store/diagnostics";
import { useEditorCursor } from "@/store/editorCursor";
import { useIde } from "@/store/ide";
import { useVsx } from "@/store/vsx";
import { monacoThemeName } from "@/plugins/vsx";
import { analyzeSilverSymbols, getSilverSymbolHover } from "@/utils/silverLinter";
import { extractDocumentSymbols } from "@/utils/symbols";
import { SILVERSCRIPT_ID, getSilverscriptHover, silverscriptCompletions, silverscriptConfiguration, silverscriptMonarch } from "./silverscript";
import { buildMonacoTheme, THEME_NAME } from "./theme";
import { registerVscodeMonarchLanguages } from "./vscodeTokens";
import { configureMonacoLanguageDefaults, syncModelMarkersToStore, syncWorkspaceIntelligence } from "./workspaceIntelligence";

let languagesRegistered = false;

function isTestPath(path: string | undefined): boolean {
  return !!path && /\.(test|spec)\.[cm]?[jt]sx?$/.test(path);
}

export function Editor() {
  const engine = useEngine();
  const activeFile = useIde((s) => s.activeFile);
  const workspaceRoot = useIde((s) => s.workspace?.root);
  const file = useIde((s) => s.openFiles.find((f) => f.path === s.activeFile));
  const updateContent = useIde((s) => s.updateContent);
  const activeVsxTheme = useVsx((s) => s.activeTheme);
  const zoom = useIde((s) => s.zoom);
  const monacoRef = useRef<typeof Monaco | null>(null);
  const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null);
  const bpCollection = useRef<Monaco.editor.IEditorDecorationsCollection | null>(null);
  const markCollection = useRef<Monaco.editor.IEditorDecorationsCollection | null>(null);
  const diagCollection = useRef<Monaco.editor.IEditorDecorationsCollection | null>(null);
  const [mounted, setMounted] = useState(0);
  const disposables = useRef<Monaco.IDisposable[]>([]);
  const themeName = activeVsxTheme ? monacoThemeName(activeVsxTheme) : THEME_NAME;

  useEffect(() => {
    if (!activeFile || activeFile.startsWith("view:")) useEditorCursor.getState().clear();
  }, [activeFile]);

  useEffect(() => {
    return () => {
      for (const d of disposables.current) d.dispose();
      disposables.current = [];
    };
  }, []);

  // Debugger marks: breakpoints (red dots) and the line the debuggee is stopped on.
  const breakpoints = useDebug((s) => s.breakpoints);
  const bpStatus = useDebug((s) => s.status);
  const debugState = useDebug((s) => s.state);
  const frames = useDebug((s) => s.frames);
  const frameIndex = useDebug((s) => s.frame);
  const silverView = useSilverDebug((s) => s.view);
  useEffect(() => {
    const ed = editorRef.current;
    const monaco = monacoRef.current;
    if (!ed || !monaco || !activeFile || activeFile.startsWith("view:")) return;
    const bps: Monaco.editor.IModelDeltaDecoration[] = (breakpoints[activeFile] ?? []).map((line) => {
      const st = bpStatus[activeFile]?.[line];
      return { range: new monaco.Range(line, 1, line, 1), options: { glyphMarginClassName: st && !st.verified ? "hk-bp hk-bp-off" : "hk-bp", glyphMarginHoverMessage: { value: st && !st.verified ? "Breakpoint (no code on this line)" : "Breakpoint" } } };
    });
    bpCollection.current?.clear();
    bpCollection.current = ed.createDecorationsCollection(bps);
    const loc = currentLocation({ state: debugState, frames, frame: frameIndex });
    const marks: Monaco.editor.IModelDeltaDecoration[] = loc && loc.file === activeFile ? [{ range: new monaco.Range(loc.line, 1, loc.line, 1), options: { isWholeLine: true, className: "hk-current-line", glyphMarginClassName: "hk-current-arrow" } }] : [];
    // The SilverScript debugger's line (a .sil file; the test debugger never stops in one).
    const silLine = silverDebugLine(silverView, activeFile);
    if (silLine !== null && marks.length === 0) marks.push({ range: new monaco.Range(silLine, 1, silLine, 1), options: { isWholeLine: true, className: "hk-current-line", glyphMarginClassName: "hk-current-arrow" } });
    markCollection.current?.clear();
    markCollection.current = ed.createDecorationsCollection(marks);
  }, [activeFile, breakpoints, bpStatus, debugState, frames, frameIndex, mounted, silverView]);

  // Eclipse-style diagnostic gutter marks & error line highlights synchronized with useDiagnostics + breakpoints.
  const activeFileDiags = useDiagnostics((s) =>
    activeFile && !activeFile.startsWith("view:") ? s.byFile[normalizeDiagPath(activeFile)] : undefined
  );
  useEffect(() => {
    const ed = editorRef.current;
    const monaco = monacoRef.current;
    if (!ed || !monaco || !activeFile || activeFile.startsWith("view:")) {
      diagCollection.current?.clear();
      return;
    }
    const items = activeFileDiags ?? [];
    if (items.length === 0) {
      diagCollection.current?.clear();
      return;
    }

    const bpLines = new Set(breakpoints[activeFile] ?? []);
    const byLine = new Map<number, typeof items>();
    for (const d of items) {
      const list = byLine.get(d.line) ?? [];
      list.push(d);
      byLine.set(d.line, list);
    }

    const decos: Monaco.editor.IModelDeltaDecoration[] = [];
    for (const [line, list] of byLine.entries()) {
      const hasErr = list.some((d) => d.severity === "error");
      const hasWarn = list.some((d) => d.severity === "warning");
      if (!hasErr && !hasWarn) continue;
      const hasFix = list.some((d) => d.fixes && d.fixes.length > 0);
      const hasBp = bpLines.has(line);
      const glyphClass = hasBp
        ? undefined
        : hasErr
          ? hasFix
            ? "hk-diag-error-fix"
            : "hk-diag-error"
          : hasFix
            ? "hk-diag-warn-fix"
            : "hk-diag-warn";
      const hoverLines = list.map((d) => {
        const prefix = d.severity === "error" ? "**Error**" : d.severity === "warning" ? "**Warning**" : "**Info**";
        const codeTag = d.code ? ` \`${d.code}\`` : "";
        const hintLine = d.hint ? `\n  *${d.hint}*` : "";
        const fixNote = d.fixes && d.fixes.length > 0 ? `\n  💡 *Quick Fix available (\`Ctrl+.\`): ${d.fixes[0].title}*` : "";
        return `- ${prefix}${codeTag}: ${d.message}${hintLine}${fixNote}`;
      });
      decos.push({
        range: new monaco.Range(line, 1, line, 1),
        options: {
          isWholeLine: true,
          className: hasErr ? "hk-line-error" : "hk-line-warn",
          ...(glyphClass
            ? {
                glyphMarginClassName: glyphClass,
                glyphMarginHoverMessage: { value: hoverLines.join("\n") }
              }
            : {}),
          overviewRuler: {
            color: hasErr ? "#ef4444" : "#f59e0b",
            position: monaco.editor.OverviewRulerLane.Right
          }
        }
      });
    }
    diagCollection.current?.clear();
    diagCollection.current = ed.createDecorationsCollection(decos);
  }, [activeFile, activeFileDiags, breakpoints, mounted]);

  // Sync workspace TypeScript/JSX/Silver/HardKas context into Monaco whenever workspace opens or files change.
  useEffect(() => {
    const monaco = monacoRef.current;
    if (!monaco || !mounted) return;
    const plugin = engine.get<EditorPlugin>("editor");
    let timer: ReturnType<typeof setTimeout> | null = null;
    const schedule = (delay = 150) => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        void syncWorkspaceIntelligence(monaco, plugin);
      }, delay);
    };
    schedule(50);

    const offSave = engine.on("fileManager", "fileSaved", () => schedule(180));
    const offTree = engine.on("fileManager", "treeChanged", () => schedule(250));
    const offContent = engine.on("editor", "contentChanged", (p) => {
      if (typeof p === "string" && !p.endsWith(".sil")) schedule(850);
    });
    return () => {
      if (timer) clearTimeout(timer);
      offSave();
      offTree();
      offContent();
    };
  }, [engine, workspaceRoot, mounted]);

  const editorOptions = useMemo<Monaco.editor.IStandaloneEditorConstructionOptions>(
    () => ({
      fontFamily: getComputedStyle(document.documentElement).getPropertyValue("--font-mono").trim() || "monospace",
      fontSize: Math.round((14 * zoom) / 110),
      minimap: { enabled: false },
      automaticLayout: true,
      scrollBeyondLastLine: false,
      glyphMargin: true,
      renderLineHighlight: "line",
      hover: { enabled: true, delay: 180, sticky: true },
      lightbulb: { enabled: "on" as Monaco.editor.ShowLightbulbIconMode },
      bracketPairColorization: { enabled: true },
      guides: { indentation: true, bracketPairs: false },
      tabSize: 2,
      wordWrap: "off",
      smoothScrolling: true,
      padding: { top: 8 }
    }),
    [zoom]
  );

  const beforeMount: BeforeMount = useCallback((monaco) => {
    monacoRef.current = monaco;
    configureMonacoLanguageDefaults(monaco);
    if (languagesRegistered) return;
    languagesRegistered = true;
    registerVscodeMonarchLanguages(monaco);
    monaco.languages.register({ id: SILVERSCRIPT_ID, extensions: [".sil"], aliases: ["SilverScript", "silverscript"] });
    monaco.languages.setMonarchTokensProvider(SILVERSCRIPT_ID, silverscriptMonarch);
    monaco.languages.setLanguageConfiguration(SILVERSCRIPT_ID, silverscriptConfiguration);
    monaco.languages.registerCompletionItemProvider(SILVERSCRIPT_ID, {
      provideCompletionItems: (model, position) => {
        const word = model.getWordUntilPosition(position);
        const range = { startLineNumber: position.lineNumber, endLineNumber: position.lineNumber, startColumn: word.startColumn, endColumn: word.endColumn };
        const symSuggestions: Monaco.languages.CompletionItem[] = [];
        const seenNames = new Set<string>();
        const analysis = analyzeSilverSymbols(model.getValue());
        for (const c of analysis.contracts) {
          for (const sym of [...c.params, ...c.fields]) {
            if (seenNames.has(sym.name)) continue;
            seenNames.add(sym.name);
            symSuggestions.push({
              label: sym.name,
              kind: monaco.languages.CompletionItemKind.Field,
              insertText: sym.name,
              detail: `${sym.type} (${sym.role})`,
              range
            });
          }
          for (const s of c.scopes) {
            if (!seenNames.has(s.name)) {
              seenNames.add(s.name);
              symSuggestions.push({
                label: s.name,
                kind: monaco.languages.CompletionItemKind.Function,
                insertText: s.name,
                detail: `${s.kind} in ${c.name}`,
                range
              });
            }
            for (const sym of [...s.params, ...s.locals]) {
              if (seenNames.has(sym.name)) continue;
              seenNames.add(sym.name);
              symSuggestions.push({
                label: sym.name,
                kind: monaco.languages.CompletionItemKind.Variable,
                insertText: sym.name,
                detail: `${sym.type} (${s.name})`,
                range
              });
            }
          }
        }
        return {
          suggestions: [
            ...symSuggestions,
            ...silverscriptCompletions.map((c) => ({
              label: c.label,
              kind: monaco.languages.CompletionItemKind.Snippet,
              insertText: c.insertText,
              insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
              detail: c.detail,
              range
            }))
          ]
        };
      }
    });
    monaco.languages.registerHoverProvider(SILVERSCRIPT_ID, {
      provideHover: (model, position) => {
        const contents: Monaco.IMarkdownString[] = [];
        const filePath = model.uri.path.replace(/^\/+/, "");
        const diags = diagnosticsAtPosition(filePath, position.lineNumber, position.column);
        for (const d of diags) {
          const icon = d.severity === "error" ? "❌" : d.severity === "warning" ? "⚠️" : "ℹ️";
          const codeTag = d.code ? ` \`[${d.code}]\`` : "";
          const hint = d.hint ? `\n\n*Hint:* ${d.hint}` : "";
          const fixInfo = d.fixes && d.fixes.length > 0 ? `\n\n💡 *Quick Fix (\`Ctrl+.\`):* ${d.fixes[0].title}` : "";
          contents.push({ value: `${icon}${codeTag} ${d.message}${hint}${fixInfo}` });
        }

        const word = model.getWordAtPosition(position);
        const symDoc = getSilverSymbolHover(model.getValue(), position.lineNumber, position.column);
        if (symDoc) {
          contents.push({ value: `\`\`\`silverscript\n${symDoc.signature}\n\`\`\`` });
          contents.push({ value: symDoc.summary });
        } else if (word) {
          const doc = getSilverscriptHover(word.word);
          if (doc) {
            contents.push({ value: `\`\`\`silverscript\n${doc.signature}\n\`\`\`` });
            contents.push({ value: doc.summary });
          }
        }
        if (contents.length === 0) return null;
        const range = word
          ? new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn)
          : new monaco.Range(position.lineNumber, position.column, position.lineNumber, position.column);
        return { range, contents };
      }
    });
    for (const langId of [SILVERSCRIPT_ID, "json", "typescript", "javascript"]) {
      monaco.languages.registerCodeActionProvider(langId, {
        provideCodeActions: (model, range) => {
          const filePath = model.uri.path.replace(/^\/+/, "");
          const matching = fixableDiagnosticsInRange(filePath, range.startLineNumber, range.endLineNumber);
          const actions: Monaco.languages.CodeAction[] = [];
          for (const d of matching) {
            for (const fix of d.fixes ?? []) {
              actions.push({
                title: fix.title,
                kind: "quickfix",
                isPreferred: true,
                edit: {
                  edits: [
                    {
                      resource: model.uri,
                      versionId: model.getVersionId(),
                      textEdit: {
                        range: new monaco.Range(
                          fix.edit.startLineNumber,
                          fix.edit.startColumn,
                          fix.edit.endLineNumber,
                          fix.edit.endColumn
                        ),
                        text: fix.edit.text
                      }
                    }
                  ]
                }
              });
            }
          }
          return { actions, dispose: () => undefined };
        }
      });
    }
    monaco.languages.registerDocumentSymbolProvider(SILVERSCRIPT_ID, {
      provideDocumentSymbols: (model) => {
        const syms = extractDocumentSymbols(model.uri.path, model.getValue());
        const contracts = syms.filter((s) => !s.parentId);
        return contracts.map((c) => {
          const children = syms
            .filter((e) => e.parentId === c.id)
            .map((e) => ({
              name: e.name,
              detail: e.detail ?? "",
              kind: monaco.languages.SymbolKind.Method,
              tags: [],
              range: new monaco.Range(e.line, 1, e.endLine, 1),
              selectionRange: new monaco.Range(e.line, 1, e.line, 1)
            }));
          return {
            name: c.name,
            detail: c.detail ?? "",
            kind: monaco.languages.SymbolKind.Class,
            tags: [],
            range: new monaco.Range(c.line, 1, c.endLine, 1),
            selectionRange: new monaco.Range(c.line, 1, c.line, 1),
            children
          };
        });
      }
    });
    monaco.editor.defineTheme(THEME_NAME, buildMonacoTheme());
  }, []);

  const onMount: OnMount = useCallback(
    (editor, monaco) => {
      monaco.editor.defineTheme(THEME_NAME, buildMonacoTheme());
      if (!useVsx.getState().activeTheme) {
        monaco.editor.setTheme(THEME_NAME);
      }
      const plugin = engine.get<EditorPlugin>("editor");
      plugin.attach(editor, monaco);
      editorRef.current = editor;
      monacoRef.current = monaco;
      setMounted((n) => n + 1);

      const syncCursor = () => {
        const model = editor.getModel();
        const pos = editor.getPosition();
        const filePath = model?.uri.path.replace(/^\/+/, "") ?? null;
        if (!model || !pos || !filePath) {
          useEditorCursor.getState().clear();
          return;
        }
        useEditorCursor.getState().setPosition(filePath, pos.lineNumber, pos.column, model.getLineCount());
      };

      const syncMarkers = () => {
        const model = editor.getModel();
        const filePath = model?.uri.path.replace(/^\/+/, "") ?? null;
        if (!model || !filePath) return;
        const markers = monaco.editor.getModelMarkers({ resource: model.uri });
        let errors = 0;
        let warnings = 0;
        for (const m of markers) {
          if (m.severity === monaco.MarkerSeverity.Error) errors++;
          else if (m.severity === monaco.MarkerSeverity.Warning) warnings++;
        }
        useEditorCursor.getState().setDiagnostics(filePath, errors, warnings);
      };

      syncCursor();
      syncMarkers();

      // Gutter: click toggles a breakpoint, hovering shows where it would go.
      const debug = () => engine.get<DebugPlugin>("debug");
      const hover = editor.createDecorationsCollection([]);
      const activeText = () => {
        const f = useIde.getState().activeFile;
        return f && !f.startsWith("view:") ? f : null;
      };
      for (const d of disposables.current) d.dispose();
      disposables.current = [
        editor.onDidChangeCursorPosition(syncCursor),
        editor.onDidChangeModel(() => {
          const model = editor.getModel();
          if (model) {
            plugin.applyStoredMarkersForModel(model);
            syncModelMarkersToStore(monaco, model);
          }
          syncCursor();
          syncMarkers();
          const modelPath = model?.uri.path ?? "";
          const pending = plugin.consumePendingGoto(modelPath);
          if (pending) requestAnimationFrame(() => plugin.gotoLine(pending.line, pending.column));
        }),
        editor.onDidChangeModelContent(syncCursor),
        monaco.editor.onDidChangeMarkers((uris) => {
          for (const u of uris) {
            const m = monaco.editor.getModel(u);
            if (m) syncModelMarkersToStore(monaco, m);
          }
          const cur = editor.getModel()?.uri.toString();
          if (cur && uris.some((u) => u.toString() === cur)) syncMarkers();
        })
      ];
      editor.onMouseDown((e) => {
        const f = activeText();
        if (f && e.target.type === monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN && e.target.position) void debug().toggleBreakpoint(f, e.target.position.lineNumber);
      });
      editor.onMouseMove((e) => {
        if (e.target.type === monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN && e.target.position) {
          const line = e.target.position.lineNumber;
          hover.set([{ range: new monaco.Range(line, 1, line, 1), options: { glyphMarginClassName: "hk-bp-hover" } }]);
        } else hover.clear();
      });
      editor.onMouseLeave(() => hover.clear());
      editor.addCommand(monaco.KeyCode.F9, () => {
        const f = activeText();
        const line = editor.getPosition()?.lineNumber;
        if (f && line) void debug().toggleBreakpoint(f, line);
      });
      // Breakpoints follow the lines they were set on while the file is edited.
      let syncTimer: ReturnType<typeof setTimeout> | null = null;
      editor.onDidChangeModelContent(() => {
        if (syncTimer) clearTimeout(syncTimer);
        syncTimer = setTimeout(() => {
          const f = activeText();
          const col = bpCollection.current;
          if (!f || !col) return;
          const known = [...(useDebug.getState().breakpoints[f] ?? [])].sort((a, b) => a - b);
          const now = [...new Set(col.getRanges().map((r) => r.startLineNumber))].sort((a, b) => a - b);
          if (known.length === now.length && known.some((l, i) => l !== now[i])) void debug().replaceBreakpoints(f, now);
        }, 400);
      });
      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
        void engine.call("fileManager", "saveCurrentFile");
      });

      // Right-click actions for SilverScript files (a "Compile" entry in the editor menu).
      const isSil = editor.createContextKey<boolean>("hardkasSilverScript", editor.getModel()?.getLanguageId() === "silverscript");
      editor.onDidChangeModel(() => isSil.set(editor.getModel()?.getLanguageId() === "silverscript"));
      const compileCurrent = async (thenDeploy: boolean) => {
        const result = await engine.call<{ ok: boolean } | null>("silverCompiler", "compileCurrent");
        if (thenDeploy && result?.ok) useIde.getState().setActiveSidePlugin("deployRun");
      };
      editor.addAction({
        id: "hardkas.silver.compile",
        label: "Compile SilverScript",
        keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter],
        precondition: "hardkasSilverScript",
        contextMenuGroupId: "0_hardkas",
        contextMenuOrder: 1,
        run: () => void compileCurrent(false)
      });
      editor.addAction({
        id: "hardkas.silver.compileDeploy",
        label: "Compile & Deploy…",
        precondition: "hardkasSilverScript",
        contextMenuGroupId: "0_hardkas",
        contextMenuOrder: 2,
        run: () => void compileCurrent(true)
      });
      // Test files: right-click → run this file's tests (Eclipse "Run As → JUnit Test").
      const isTest = editor.createContextKey<boolean>("hardkasTestFile", isTestPath(editor.getModel()?.uri.path));
      editor.onDidChangeModel(() => isTest.set(isTestPath(editor.getModel()?.uri.path)));
      editor.addAction({
        id: "hardkas.tests.runFile",
        label: "Run tests in this file",
        precondition: "hardkasTestFile",
        contextMenuGroupId: "0_hardkas",
        contextMenuOrder: 1,
        run: () => {
          const current = useIde.getState().activeFile;
          if (current) void engine.call("tests", "runFile", current);
        }
      });
      editor.addAction({
        id: "hardkas.tests.debugFile",
        label: "Debug tests in this file",
        keybindings: [],
        precondition: "hardkasTestFile",
        contextMenuGroupId: "0_hardkas",
        contextMenuOrder: 1.5,
        run: () => {
          const current = useIde.getState().activeFile;
          if (current) void engine.get<DebugPlugin>("debug").debugFile(current);
        }
      });
      editor.addAction({
        id: "hardkas.debug.toggleBreakpoint",
        label: "Toggle breakpoint",
        contextMenuGroupId: "0_hardkas",
        contextMenuOrder: 4,
        run: (ed) => {
          const f = useIde.getState().activeFile;
          const line = ed.getPosition()?.lineNumber;
          if (f && !f.startsWith("view:") && line) void engine.get<DebugPlugin>("debug").toggleBreakpoint(f, line);
        }
      });
      editor.addAction({
        id: "hardkas.tests.runAll",
        label: "Run all tests",
        precondition: "hardkasTestFile",
        contextMenuGroupId: "0_hardkas",
        contextMenuOrder: 2,
        run: () => void engine.call("tests", "run")
      });
      editor.addAction({
        id: "hardkas.silver.openCompiler",
        label: "Open Compiler panel",
        precondition: "hardkasSilverScript",
        contextMenuGroupId: "0_hardkas",
        contextMenuOrder: 3,
        run: () => useIde.getState().setActiveSidePlugin("silverCompiler")
      });
      editor.addAction({
        id: "hardkas.silver.openCovenantGraph",
        label: "Visualize in Covenant Graph",
        precondition: "hardkasSilverScript",
        contextMenuGroupId: "0_hardkas",
        contextMenuOrder: 3.5,
        run: () => void engine.call("covenant", "open")
      });
    },
    [engine]
  );

  if (!file || !activeFile) {
    return (
      <div className="h-full flex items-center justify-center text-fg-muted select-none">
        <div className="text-center space-y-2">
          <div className="text-lg font-semibold text-fg">HardKas IDE</div>
          <div className="text-xs">Open a file from the explorer, or press Ctrl+S to save, Ctrl+Enter to compile.</div>
        </div>
      </div>
    );
  }

  return (
    <MonacoEditor
      key="hardkas-editor"
      path={file.path}
      language={file.language}
      value={file.content}
      theme={themeName}
      beforeMount={beforeMount}
      onMount={onMount}
      onChange={(value) => {
        updateContent(file.path, value ?? "");
        engine.get<EditorPlugin>("editor").notifyChange(file.path);
      }}
      options={editorOptions}
    />
  );
}
