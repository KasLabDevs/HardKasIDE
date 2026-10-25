import MonacoEditor, { type BeforeMount, type OnMount } from "@monaco-editor/react";
import type * as Monaco from "monaco-editor";
import { useCallback, useRef } from "react";
import { useEngine } from "@/engine/context";
import type { EditorPlugin } from "@/plugins/editor";
import { useIde } from "@/store/ide";
import { SILVERSCRIPT_ID, silverscriptCompletions, silverscriptConfiguration, silverscriptMonarch } from "./silverscript";
import { buildMonacoTheme, THEME_NAME } from "./theme";

let languagesRegistered = false;

export function Editor() {
  const engine = useEngine();
  const activeFile = useIde((s) => s.activeFile);
  const file = useIde((s) => s.openFiles.find((f) => f.path === s.activeFile));
  const updateContent = useIde((s) => s.updateContent);
  const monacoRef = useRef<typeof Monaco | null>(null);

  const beforeMount: BeforeMount = useCallback((monaco) => {
    monacoRef.current = monaco;
    if (languagesRegistered) return;
    languagesRegistered = true;
    monaco.languages.register({ id: SILVERSCRIPT_ID, extensions: [".sil"], aliases: ["SilverScript", "silverscript"] });
    monaco.languages.setMonarchTokensProvider(SILVERSCRIPT_ID, silverscriptMonarch);
    monaco.languages.setLanguageConfiguration(SILVERSCRIPT_ID, silverscriptConfiguration);
    monaco.languages.registerCompletionItemProvider(SILVERSCRIPT_ID, {
      provideCompletionItems: (model, position) => {
        const word = model.getWordUntilPosition(position);
        const range = { startLineNumber: position.lineNumber, endLineNumber: position.lineNumber, startColumn: word.startColumn, endColumn: word.endColumn };
        return {
          suggestions: silverscriptCompletions.map((c) => ({
            label: c.label,
            kind: monaco.languages.CompletionItemKind.Snippet,
            insertText: c.insertText,
            insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
            detail: c.detail,
            range
          }))
        };
      }
    });
    monaco.editor.defineTheme(THEME_NAME, buildMonacoTheme());
  }, []);

  const onMount: OnMount = useCallback(
    (editor, monaco) => {
      const plugin = engine.get<EditorPlugin>("editor");
      plugin.attach(editor, monaco);
      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
        void engine.call("fileManager", "saveCurrentFile");
      });

      // Right-click actions for SilverScript files (like Remix's "Compile" entry in the editor menu).
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
      editor.addAction({
        id: "hardkas.silver.openCompiler",
        label: "Open Compiler panel",
        precondition: "hardkasSilverScript",
        contextMenuGroupId: "0_hardkas",
        contextMenuOrder: 3,
        run: () => useIde.getState().setActiveSidePlugin("silverCompiler")
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
      theme={THEME_NAME}
      beforeMount={beforeMount}
      onMount={onMount}
      onChange={(value) => {
        updateContent(file.path, value ?? "");
        engine.get<EditorPlugin>("editor").notifyChange(file.path);
      }}
      options={{
        fontFamily: getComputedStyle(document.documentElement).getPropertyValue("--font-mono") || "monospace",
        fontSize: 13,
        minimap: { enabled: false },
        automaticLayout: true,
        scrollBeyondLastLine: false,
        glyphMargin: true,
        renderLineHighlight: "line",
        tabSize: 2,
        wordWrap: "off",
        smoothScrolling: true,
        padding: { top: 8 }
      }}
    />
  );
}
