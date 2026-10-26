import type * as Monaco from "monaco-editor";
import onigWasmUrl from "vscode-oniguruma/release/onig.wasm?url";
import { createOnigScanner, createOnigString, loadWASM } from "vscode-oniguruma";
import { INITIAL, Registry, parseRawGrammar, type IGrammar, type StateStack } from "vscode-textmate";

/**
 * Applies the declarative parts of VS Code extensions to Monaco:
 *   - TextMate grammars → Monaco tokens provider (vscode-textmate + oniguruma wasm)
 *   - VS Code color themes → Monaco themes (+ optionally the IDE's CSS variables)
 *   - snippets → completion items
 */

let onigReady: Promise<void> | null = null;
function ensureOnig(): Promise<void> {
  if (!onigReady) {
    onigReady = fetch(onigWasmUrl)
      .then((r) => r.arrayBuffer())
      .then((buf) => loadWASM(buf));
  }
  return onigReady;
}

/** scopeName → url of the grammar file (set by the vsx plugin before wiring). */
const grammarSources = new Map<string, string>();
let registry: Registry | null = null;
const grammarCache = new Map<string, Promise<IGrammar | null>>();

export function registerGrammarSource(scopeName: string, url: string): void {
  grammarSources.set(scopeName, url);
  grammarCache.delete(scopeName);
}

export function clearGrammarSources(): void {
  grammarSources.clear();
  grammarCache.clear();
  registry = null;
}

async function getRegistry(): Promise<Registry> {
  await ensureOnig();
  if (!registry) {
    registry = new Registry({
      onigLib: Promise.resolve({ createOnigScanner, createOnigString }),
      loadGrammar: async (scopeName) => {
        const url = grammarSources.get(scopeName);
        if (!url) return null;
        const res = await fetch(url);
        if (!res.ok) return null;
        const text = await res.text();
        return parseRawGrammar(text, url.split("?")[0]);
      }
    });
  }
  return registry;
}

class TmState implements Monaco.languages.IState {
  constructor(public readonly ruleStack: StateStack) {}
  clone(): TmState {
    return new TmState(this.ruleStack);
  }
  equals(other: Monaco.languages.IState): boolean {
    return other instanceof TmState && other.ruleStack === this.ruleStack;
  }
}

const wired = new Map<string, Monaco.IDisposable[]>(); // languageId → disposables

/** Wires a TextMate grammar as the tokenizer of a Monaco language. */
export async function wireGrammar(monaco: typeof Monaco, languageId: string, scopeName: string): Promise<boolean> {
  const reg = await getRegistry();
  let grammarP = grammarCache.get(scopeName);
  if (!grammarP) {
    grammarP = reg.loadGrammar(scopeName).catch(() => null);
    grammarCache.set(scopeName, grammarP);
  }
  const grammar = await grammarP;
  if (!grammar) return false;
  unwireGrammar(languageId);
  if (!monaco.languages.getLanguages().some((l) => l.id === languageId)) monaco.languages.register({ id: languageId });
  const provider: Monaco.languages.TokensProvider = {
    getInitialState: () => new TmState(INITIAL),
    tokenize: (line, state) => {
      const s = state as TmState;
      const r = grammar.tokenizeLine(line, s.ruleStack);
      return {
        tokens: r.tokens.map((t) => ({ startIndex: t.startIndex, scopes: t.scopes[t.scopes.length - 1] ?? "" })),
        endState: new TmState(r.ruleStack)
      };
    }
  };
  const d1 = monaco.languages.setTokensProvider(languageId, provider);
  // Monaco's bundled languages (re)register their Monarch tokenizer when first used; win that race.
  const d2 = monaco.languages.onLanguage(languageId, () => {
    monaco.languages.setTokensProvider(languageId, provider);
  });
  wired.set(languageId, [d1, d2]);
  return true;
}

export function unwireGrammar(languageId: string): void {
  for (const d of wired.get(languageId) ?? []) d.dispose();
  wired.delete(languageId);
}

export function unwireAllGrammars(): void {
  for (const id of [...wired.keys()]) unwireGrammar(id);
}

// ------------------------------------------------------------------ themes

interface VsTheme {
  name?: string;
  type?: string;
  include?: string;
  colors?: Record<string, string>;
  tokenColors?: Array<{ scope?: string | string[]; settings?: { foreground?: string; background?: string; fontStyle?: string } }>;
  semanticTokenColors?: unknown;
}

/** Fetches a VS Code theme JSON (following one level of "include") and defines it in Monaco. */
export async function defineVsTheme(monaco: typeof Monaco, monacoName: string, url: string, uiTheme: string): Promise<VsTheme> {
  const theme = await loadThemeJson(url);
  const base: Monaco.editor.BuiltinTheme = uiTheme === "vs" || theme.type === "light" ? "vs" : uiTheme === "hc-black" || theme.type === "hc" ? "hc-black" : uiTheme === "hc-light" ? "hc-light" : "vs-dark";
  const rules: Monaco.editor.ITokenThemeRule[] = [];
  for (const tc of theme.tokenColors ?? []) {
    if (!tc.settings) continue;
    const scopes = tc.scope === undefined ? [""] : Array.isArray(tc.scope) ? tc.scope : tc.scope.split(",").map((s) => s.trim());
    for (const scope of scopes) {
      if (!scope) continue; // global settings go through colors
      const rule: Monaco.editor.ITokenThemeRule = { token: scope };
      const fg = hex6(tc.settings.foreground);
      const bg = hex6(tc.settings.background);
      if (fg) rule.foreground = fg;
      if (bg) rule.background = bg;
      if (tc.settings.fontStyle !== undefined) rule.fontStyle = tc.settings.fontStyle;
      if (rule.foreground || rule.background || rule.fontStyle !== undefined) rules.push(rule);
    }
  }
  const colors: Record<string, string> = {};
  for (const [k, v] of Object.entries(theme.colors ?? {})) {
    if (/^(editor|minimap|scrollbar|editorWidget|editorSuggestWidget|editorHoverWidget|editorLineNumber|editorCursor|editorIndentGuide|editorBracketMatch|editorGutter|editorOverviewRuler|editorWhitespace|editorRuler|peekView|input|list|focusBorder|foreground|widget|selection)/.test(k) && typeof v === "string") {
      colors[k] = v.length === 9 ? v.slice(0, 7) : v;
    }
  }
  monaco.editor.defineTheme(monacoName, { base, inherit: true, rules, colors });
  return theme;
}

async function loadThemeJson(url: string): Promise<VsTheme> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`theme not found: ${url}`);
  const theme = parseJsonc(await res.text()) as VsTheme;
  if (theme.include) {
    try {
      const parent = await loadThemeJson(new URL(theme.include, url).toString());
      return { ...parent, ...theme, colors: { ...(parent.colors ?? {}), ...(theme.colors ?? {}) }, tokenColors: [...(parent.tokenColors ?? []), ...(theme.tokenColors ?? [])] };
    } catch {
      return theme;
    }
  }
  return theme;
}

/** Maps workbench colors of a VS Code theme onto the IDE's CSS variables (opt-in). */
export function applyThemeToIde(theme: VsTheme | null): void {
  const root = document.documentElement.style;
  const vars = ["--bg", "--bg-elev", "--bg-panel", "--bg-hover", "--border", "--fg", "--fg-muted", "--accent", "--accent-fg", "color-scheme"];
  if (!theme) {
    for (const v of vars) root.removeProperty(v);
    return;
  }
  const c = theme.colors ?? {};
  const pick = (...keys: string[]) => keys.map((k) => c[k]).find((v) => typeof v === "string")?.slice(0, 7);
  const set = (v: string, val?: string) => (val ? root.setProperty(v, val) : root.removeProperty(v));
  const bg = pick("editor.background");
  const accent = pick("focusBorder", "textLink.foreground", "button.background", "activityBarBadge.background");
  set("--bg", bg);
  set("--bg-panel", pick("sideBar.background", "activityBar.background", "editor.background"));
  set("--bg-elev", pick("editorWidget.background", "panel.background", "sideBarSectionHeader.background", "editor.background"));
  set("--bg-hover", pick("list.hoverBackground", "editor.lineHighlightBackground", "editor.selectionBackground"));
  set("--border", pick("panel.border", "sideBar.border", "editorGroup.border", "contrastBorder", "editorIndentGuide.background"));
  set("--fg", pick("editor.foreground", "foreground"));
  set("--fg-muted", pick("descriptionForeground", "sideBarTitle.foreground", "editorLineNumber.foreground"));
  set("--accent", accent);
  if (accent) {
    set("--accent-fg", isLightHex(accent) ? "#06201c" : "#ffffff");
  } else {
    root.removeProperty("--accent-fg");
  }
  set("color-scheme", bg && isLightHex(bg) ? "light" : "dark");
}

function isLightHex(hex: string): boolean {
  const h = hex6(hex);
  if (!h) return false;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  // Perceived luminance (ITU-R BT.709)
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 > 0.55;
}

function hex6(v?: string): string | undefined {
  if (!v || typeof v !== "string") return undefined;
  const m = /^#([0-9a-fA-F]{6})([0-9a-fA-F]{2})?$/.exec(v.trim());
  if (m) return m[1];
  const short = /^#([0-9a-fA-F]{3})$/.exec(v.trim());
  if (short) return short[1].split("").map((ch) => ch + ch).join("");
  return undefined;
}

// ------------------------------------------------------------------ snippets

const snippetDisposables = new Map<string, Monaco.IDisposable>(); // key → disposable

interface VsSnippet {
  prefix?: string | string[];
  body?: string | string[];
  description?: string;
}

export async function registerSnippets(monaco: typeof Monaco, key: string, languageId: string, url: string): Promise<number> {
  const res = await fetch(url);
  if (!res.ok) return 0;
  const json = parseJsonc(await res.text()) as Record<string, VsSnippet>;
  const items = Object.entries(json).map(([name, s]) => ({
    name,
    prefixes: Array.isArray(s.prefix) ? s.prefix : s.prefix ? [s.prefix] : [name],
    body: Array.isArray(s.body) ? s.body.join("\n") : (s.body ?? ""),
    description: s.description ?? ""
  }));
  if (!monaco.languages.getLanguages().some((l) => l.id === languageId)) monaco.languages.register({ id: languageId });
  snippetDisposables.get(key)?.dispose();
  const d = monaco.languages.registerCompletionItemProvider(languageId, {
    provideCompletionItems: (model, position) => {
      const word = model.getWordUntilPosition(position);
      const range = { startLineNumber: position.lineNumber, endLineNumber: position.lineNumber, startColumn: word.startColumn, endColumn: word.endColumn };
      return {
        suggestions: items.flatMap((it) =>
          it.prefixes.map((p) => ({
            label: p,
            kind: monaco.languages.CompletionItemKind.Snippet,
            detail: it.name,
            documentation: it.description,
            insertText: it.body,
            insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
            range
          }))
        )
      };
    }
  });
  snippetDisposables.set(key, d);
  return items.length;
}

export function unregisterSnippets(prefix: string): void {
  for (const [k, d] of [...snippetDisposables]) {
    if (k.startsWith(prefix)) {
      d.dispose();
      snippetDisposables.delete(k);
    }
  }
}

/** Good-enough JSON-with-comments parser for theme/snippet files. */
export function parseJsonc(text: string): unknown {
  const noBom = text.replace(/^\uFEFF/, "");
  try {
    return JSON.parse(noBom);
  } catch {
    const stripped = noBom
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:"'\\])\/\/[^\n]*/g, "$1")
      .replace(/,\s*([}\]])/g, "$1");
    return JSON.parse(stripped);
  }
}
