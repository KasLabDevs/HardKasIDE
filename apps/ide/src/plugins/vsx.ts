import type * as Monaco from "monaco-editor";
import { api } from "@/api/client";
import { applyThemeToIde, clearGrammarSources, defineVsTheme, registerGrammarSource, registerSnippets, unregisterSnippets, unwireAllGrammars, wireGrammar } from "@/editor/textmate";
import { Plugin } from "@/engine/engine";
import { themeId, useVsx, type InstalledVsx, type VsxSearchHit } from "@/store/vsx";
import type { ConsolePlugin } from "./console";
import type { EditorPlugin } from "./editor";

/**
 * VS Code extensions (Open VSX): search, install, enable/disable, uninstall, and
 * apply what we can run without an extension host — themes, grammars, languages, snippets.
 */
export class VsxPlugin extends Plugin {
  private offs: Array<() => void> = [];

  constructor() {
    super({
      name: "vsx",
      displayName: "VS Code extensions",
      description: "Themes, grammars and snippets from Open VSX",
      location: "none",
      methods: ["search", "install", "uninstall", "setEnabled", "applyTheme", "refresh", "themes"],
      events: ["changed", "themeChanged"]
    });
  }

  onActivation(): void {
    void this.refresh().then(() => this.applyAll());
    this.offs.push(this.on("editor", "editorMounted", () => void this.applyAll()));
  }

  onDeactivation(): void {
    for (const off of this.offs) off();
    this.offs = [];
    unwireAllGrammars();
    unregisterSnippets("");
    clearGrammarSources();
  }

  private monaco(): typeof Monaco | null {
    return this.engine.get<EditorPlugin>("editor").getMonaco();
  }

  async refresh(): Promise<InstalledVsx[]> {
    const list = await api.vsx.installed();
    useVsx.getState().setInstalled(list);
    this.emit("changed", list);
    return list;
  }

  search(q: string): Promise<{ total: number; hits: VsxSearchHit[] }> {
    return api.vsx.search(q);
  }

  async install(namespace: string, name: string): Promise<InstalledVsx> {
    const store = useVsx.getState();
    store.setBusy(`${namespace}.${name}`);
    store.setError(null);
    try {
      const ext = await api.vsx.install(namespace, name);
      await this.refresh();
      await this.applyAll();
      const c = ext.contributes;
      const parts = [c.themes.length && `${c.themes.length} theme(s)`, c.grammars.length && `${c.grammars.length} grammar(s)`, c.snippets.length && `${c.snippets.length} snippet set(s)`].filter(Boolean);
      this.engine.get<ConsolePlugin>("console").info(`Installed ${ext.displayName} v${ext.version}: ${parts.join(", ") || "nothing applicable"}${ext.unsupported.length ? ` · not supported: ${ext.unsupported.join(", ")}` : ""}`);
      // First theme of a theme-only extension becomes active, like VS Code offers.
      if (c.themes.length > 0 && c.grammars.length === 0) await this.applyTheme(themeId(ext.id, c.themes[0].label));
      return ext;
    } catch (e) {
      store.setError(e instanceof Error ? e.message : String(e));
      throw e;
    } finally {
      useVsx.getState().setBusy(null);
    }
  }

  async uninstall(id: string): Promise<void> {
    await api.vsx.uninstall(id);
    const { activeTheme } = useVsx.getState();
    if (activeTheme?.startsWith(id + "::")) await this.applyTheme(null);
    await this.refresh();
    await this.applyAll();
  }

  async setEnabled(id: string, enabled: boolean): Promise<void> {
    await api.vsx.setEnabled(id, enabled);
    await this.refresh();
    await this.applyAll();
  }

  /** Every theme available from enabled extensions. */
  themes(): Array<{ id: string; label: string; ext: InstalledVsx; uiTheme: string }> {
    return useVsx.getState().installed.flatMap((e) => (e.enabled ? e.contributes.themes.map((t) => ({ id: themeId(e.id, t.label), label: t.label, ext: e, uiTheme: t.uiTheme })) : []));
  }

  /** Switches the editor theme; null restores the HardKas theme. */
  async applyTheme(id: string | null): Promise<void> {
    const monaco = this.monaco();
    const store = useVsx.getState();
    store.setActiveTheme(id);
    if (!id) {
      monaco?.editor.setTheme("hardkas-dark");
      applyThemeToIde(null);
      this.emit("themeChanged", null);
      return;
    }
    const t = this.themes().find((x) => x.id === id);
    if (!t || !monaco) return;
    const theme = t.ext.contributes.themes.find((x) => x.label === t.label)!;
    const name = monacoThemeName(id);
    try {
      const json = await defineVsTheme(monaco, name, api.vsx.fileUrl(t.ext.id, theme.path), theme.uiTheme);
      monaco.editor.setTheme(name);
      applyThemeToIde(store.applyUi ? json : null);
      this.emit("themeChanged", id);
    } catch (e) {
      store.setError(e instanceof Error ? e.message : String(e));
    }
  }

  async setApplyUi(v: boolean): Promise<void> {
    useVsx.getState().setApplyUi(v);
    await this.applyTheme(useVsx.getState().activeTheme);
  }

  /** (Re)applies grammars, languages, snippets and the active theme from enabled extensions. */
  async applyAll(): Promise<void> {
    const monaco = this.monaco();
    if (!monaco) return;
    const { installed, activeTheme } = useVsx.getState();
    unwireAllGrammars();
    unregisterSnippets("");
    clearGrammarSources();
    for (const e of installed) {
      if (!e.enabled) continue;
      for (const g of e.contributes.grammars) registerGrammarSource(g.scopeName, api.vsx.fileUrl(e.id, g.path));
    }
    for (const e of installed) {
      if (!e.enabled) continue;
      for (const l of e.contributes.languages) {
        const known = monaco.languages.getLanguages().some((x) => x.id === l.id);
        monaco.languages.register({ id: l.id, extensions: l.extensions, aliases: known ? undefined : l.aliases, filenames: l.filenames });
      }
      for (const g of e.contributes.grammars) {
        if (!g.language) continue; // injection grammars
        try {
          await wireGrammar(monaco, g.language, g.scopeName);
        } catch {
          // grammar failed to load: keep Monaco's own tokenizer
        }
      }
      for (const [i, s] of e.contributes.snippets.entries()) {
        try {
          await registerSnippets(monaco, `${e.id}#${i}`, s.language, api.vsx.fileUrl(e.id, s.path));
        } catch {
          // skip bad snippet files
        }
      }
    }
    if (activeTheme) await this.applyTheme(activeTheme);
  }
}

export function monacoThemeName(id: string): string {
  return "vsx-" + id.replace(/[^a-zA-Z0-9]/g, "-").toLowerCase();
}
