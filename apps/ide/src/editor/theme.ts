import type { editor } from "monaco-editor";

/** Builds the Monaco theme matching VS Code Dark Modern / Dark+ syntax highlighting on top of index.css chrome. */
export function buildMonacoTheme(): editor.IStandaloneThemeData {
  const css = getComputedStyle(document.documentElement);
  const v = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
  const bg = v("--bg", "#1f1f1f");
  const elev = v("--bg-elev", "#252526");

  return {
    base: "vs-dark",
    inherit: true,
    rules: [
      { token: "", foreground: "CCCCCC" },
      { token: "invalid", foreground: "F44747" },
      { token: "emphasis", fontStyle: "italic" },
      { token: "strong", fontStyle: "bold" },
      { token: "comment", foreground: "6A9955" },
      { token: "comment.doc", foreground: "6A9955" },
      { token: "keyword", foreground: "569CD6" },
      { token: "keyword.flow", foreground: "C586C0" },
      { token: "keyword.control", foreground: "C586C0" },
      { token: "keyword.json", foreground: "569CD6" },
      { token: "storage", foreground: "569CD6" },
      { token: "constant", foreground: "569CD6" },
      { token: "constant.language", foreground: "569CD6" },
      { token: "type", foreground: "4EC9B0" },
      { token: "type.identifier", foreground: "4EC9B0" },
      { token: "type.primitive", foreground: "4EC9B0" },
      { token: "identifier", foreground: "9CDCFE" },
      { token: "identifier.function", foreground: "DCDCAA" },
      { token: "support.function", foreground: "DCDCAA" },
      { token: "function", foreground: "DCDCAA" },
      { token: "variable", foreground: "9CDCFE" },
      { token: "variable.parameter", foreground: "9CDCFE" },
      { token: "variable.predefined", foreground: "4FC1FF" },
      { token: "key", foreground: "9CDCFE" },
      { token: "string", foreground: "CE9178" },
      { token: "string.quote", foreground: "CE9178" },
      { token: "string.escape", foreground: "D7BA7D" },
      { token: "string.escape.invalid", foreground: "F44747" },
      { token: "string.invalid", foreground: "F44747" },
      { token: "string.key.json", foreground: "9CDCFE" },
      { token: "string.value.json", foreground: "CE9178" },
      { token: "string.yaml", foreground: "CE9178" },
      { token: "number", foreground: "B5CEA8" },
      { token: "number.hex", foreground: "B5CEA8" },
      { token: "number.octal", foreground: "B5CEA8" },
      { token: "number.binary", foreground: "B5CEA8" },
      { token: "number.float", foreground: "B5CEA8" },
      { token: "regexp", foreground: "D16969" },
      { token: "regexp.escape", foreground: "D7BA7D" },
      { token: "regexp.escape.control", foreground: "569CD6" },
      { token: "annotation", foreground: "DCDCAA" },
      { token: "operator", foreground: "D4D4D4" },
      { token: "delimiter", foreground: "D4D4D4" },
      { token: "delimiter.bracket", foreground: "D4D4D4" },
      { token: "delimiter.html", foreground: "808080" },
      { token: "delimiter.xml", foreground: "808080" },
      { token: "tag", foreground: "569CD6" },
      { token: "metatag.html", foreground: "569CD6" },
      { token: "metatag.xml", foreground: "569CD6" },
      { token: "metatag.content.html", foreground: "9CDCFE" },
      { token: "attribute.name", foreground: "9CDCFE" },
      { token: "attribute.value", foreground: "CE9178" },
      { token: "attribute.value.number.css", foreground: "B5CEA8" },
      { token: "attribute.value.unit.css", foreground: "B5CEA8" },
      { token: "attribute.value.hex.css", foreground: "CE9178" }
    ],
    colors: {
      "editor.background": bg,
      "editor.foreground": "#CCCCCC",
      "editorLineNumber.foreground": "#6E7681",
      "editorLineNumber.activeForeground": "#CCCCCC",
      "editor.lineHighlightBackground": "#2A2D2E66",
      "editor.lineHighlightBorder": "#282828",
      "editor.selectionBackground": "#264F78",
      "editor.inactiveSelectionBackground": "#3A3D41",
      "editor.selectionHighlightBackground": "#ADD6FF26",
      "editorCursor.foreground": "#AEAFAD",
      "editorIndentGuide.background1": "#404040",
      "editorIndentGuide.activeBackground1": "#707070",
      "editorBracketHighlight.foreground1": "#FFD700",
      "editorBracketHighlight.foreground2": "#DA70D6",
      "editorBracketHighlight.foreground3": "#179FFF",
      "editorBracketHighlight.foreground4": "#FFD700",
      "editorBracketHighlight.foreground5": "#DA70D6",
      "editorBracketHighlight.foreground6": "#179FFF",
      "editorBracketMatch.background": "#0064001A",
      "editorBracketMatch.border": "#888888",
      "editorWidget.background": elev,
      "editorSuggestWidget.background": elev,
      "editorSuggestWidget.border": "#454545",
      "minimap.background": bg
    }
  };
}

export const THEME_NAME = "hardkas-dark";
