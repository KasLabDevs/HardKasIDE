import { create } from "zustand";
import { extraLanguages } from "./ide";

/** Installed VS Code extensions (Open VSX) and what we apply from them. */

export interface VsxTheme {
  label: string;
  uiTheme: string;
  path: string;
}
export interface VsxGrammar {
  language?: string;
  scopeName: string;
  path: string;
  embeddedLanguages?: Record<string, string>;
}
export interface VsxLanguage {
  id: string;
  extensions?: string[];
  aliases?: string[];
  filenames?: string[];
  configuration?: string;
}
export interface VsxSnippet {
  language: string;
  path: string;
}
export interface InstalledVsx {
  id: string;
  namespace: string;
  name: string;
  version: string;
  displayName: string;
  description: string;
  publisher?: string;
  icon?: string;
  installedAt: string;
  contributes: { themes: VsxTheme[]; grammars: VsxGrammar[]; languages: VsxLanguage[]; snippets: VsxSnippet[] };
  unsupported: string[];
  enabled: boolean;
}

export interface VsxSearchHit {
  id: string;
  namespace: string;
  name: string;
  version: string;
  displayName: string;
  description: string;
  downloadCount?: number;
  verified?: boolean;
  icon?: string;
  timestamp?: string;
}

const THEME_KEY = "hardkas-ide.vsx.theme";
const UI_KEY = "hardkas-ide.vsx.applyUi";

interface VsxState {
  installed: InstalledVsx[];
  /** "extId::Theme label" of the active editor theme, or null for the HardKas theme. */
  activeTheme: string | null;
  applyUi: boolean;
  /** file extension (".rs") → language id, from installed languages. */
  extToLanguage: Record<string, string>;
  busy: string | null;
  error: string | null;
  setInstalled(list: InstalledVsx[]): void;
  setActiveTheme(id: string | null): void;
  setApplyUi(v: boolean): void;
  setBusy(b: string | null): void;
  setError(e: string | null): void;
}

export const useVsx = create<VsxState>((set) => ({
  installed: [],
  activeTheme: localStorage.getItem(THEME_KEY),
  applyUi: localStorage.getItem(UI_KEY) === "1",
  extToLanguage: {},
  busy: null,
  error: null,
  setInstalled: (installed) => {
    const extToLanguage: Record<string, string> = {};
    for (const e of installed) {
      if (!e.enabled) continue;
      for (const l of e.contributes.languages) for (const ext of l.extensions ?? []) extToLanguage[ext.toLowerCase()] = l.id;
    }
    for (const k of Object.keys(extraLanguages)) delete extraLanguages[k];
    Object.assign(extraLanguages, extToLanguage);
    set({ installed, extToLanguage });
  },
  setActiveTheme: (activeTheme) => {
    try {
      if (activeTheme) localStorage.setItem(THEME_KEY, activeTheme);
      else localStorage.removeItem(THEME_KEY);
    } catch {
      // ignore
    }
    set({ activeTheme });
  },
  setApplyUi: (applyUi) => {
    try {
      localStorage.setItem(UI_KEY, applyUi ? "1" : "0");
    } catch {
      // ignore
    }
    set({ applyUi });
  },
  setBusy: (busy) => set({ busy }),
  setError: (error) => set({ error })
}));

export function themeId(extId: string, label: string): string {
  return `${extId}::${label}`;
}
