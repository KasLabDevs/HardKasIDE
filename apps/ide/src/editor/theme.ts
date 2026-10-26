import type { editor } from "monaco-editor";

/** Builds the Monaco theme from the CSS variables in index.css. */
export function buildMonacoTheme(): editor.IStandaloneThemeData {
  const css = getComputedStyle(document.documentElement);
  const v = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
  const bg = v("--bg", "#0b0f14");
  const fg = v("--fg", "#d7e0ea");
  const muted = v("--fg-muted", "#8696a7");
  const accent = v("--accent", "#49eacb");
  const warn = v("--warn", "#f5b942");
  const info = v("--info", "#7cc4ff");
  const ok = v("--ok", "#4ade80");
  const border = v("--border", "#1f2a37");
  const hover = v("--bg-hover", "#182230");

  return {
    base: "vs-dark",
    inherit: true,
    rules: [
      { token: "keyword", foreground: accent.slice(1), fontStyle: "bold" },
      { token: "type", foreground: info.slice(1) },
      { token: "support.function", foreground: warn.slice(1) },
      { token: "string", foreground: ok.slice(1) },
      { token: "number", foreground: warn.slice(1) },
      { token: "comment", foreground: muted.slice(1), fontStyle: "italic" },
      { token: "operator", foreground: fg.slice(1) },
      { token: "delimiter", foreground: muted.slice(1) }
    ],
    colors: {
      "editor.background": bg,
      "editor.foreground": fg,
      "editorLineNumber.foreground": muted,
      "editorLineNumber.activeForeground": fg,
      "editor.lineHighlightBackground": hover,
      "editor.selectionBackground": border,
      "editorCursor.foreground": accent,
      "editorIndentGuide.background1": border,
      "editorWidget.background": v("--bg-elev", "#111821"),
      "editorSuggestWidget.background": v("--bg-elev", "#111821"),
      "editorSuggestWidget.border": border,
      "minimap.background": bg
    }
  };
}

export const THEME_NAME = "hardkas-dark";
