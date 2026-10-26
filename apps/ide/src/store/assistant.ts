import { create } from "zustand";
import type { AssistantConfigView } from "@/api/client";

/** Assistant chat state. History is kept in localStorage (browser only; the API key lives on the server). */

export interface ChatTurn {
  id: number;
  role: "user" | "assistant";
  content: string;
  streaming?: boolean;
  error?: string;
}

export interface AnswerMeta {
  model: string;
  docs: { mode: string; chars: number; stale: boolean } | null;
}

const KEY = "hardkas-ide.assistant.chat";
const MAX_SAVED = 40;

function load(): ChatTurn[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "[]") as ChatTurn[];
    return raw.map((t) => ({ ...t, streaming: false }));
  } catch {
    return [];
  }
}

function persist(turns: ChatTurn[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(turns.filter((t) => !t.streaming).slice(-MAX_SAVED)));
  } catch {
    // storage unavailable: history lasts for the session only
  }
}

let seq = Date.now();

interface AssistantState {
  turns: ChatTurn[];
  busy: boolean;
  config: AssistantConfigView | null;
  defaults: Record<"anthropic" | "openai", { baseUrl: string; model: string }> | null;
  meta: AnswerMeta | null;
  includeFile: boolean;
  settingsOpen: boolean;
  push(role: ChatTurn["role"], content: string, streaming?: boolean): number;
  append(id: number, text: string): void;
  finish(id: number, error?: string): void;
  clear(): void;
  setBusy(b: boolean): void;
  setConfig(c: AssistantConfigView, defaults?: AssistantState["defaults"]): void;
  setMeta(m: AnswerMeta | null): void;
  setIncludeFile(v: boolean): void;
  setSettingsOpen(v: boolean): void;
}

export const useAssistant = create<AssistantState>((set) => ({
  turns: load(),
  busy: false,
  config: null,
  defaults: null,
  meta: null,
  includeFile: true,
  settingsOpen: false,
  push: (role, content, streaming) => {
    const id = ++seq;
    set((s) => {
      const turns = [...s.turns, { id, role, content, streaming }];
      persist(turns);
      return { turns };
    });
    return id;
  },
  append: (id, text) => set((s) => ({ turns: s.turns.map((t) => (t.id === id ? { ...t, content: t.content + text } : t)) })),
  finish: (id, error) =>
    set((s) => {
      const turns = s.turns.map((t) => (t.id === id ? { ...t, streaming: false, error } : t));
      persist(turns);
      return { turns };
    }),
  clear: () => {
    persist([]);
    set({ turns: [], meta: null });
  },
  setBusy: (busy) => set({ busy }),
  setConfig: (config, defaults) => set((s) => ({ config, defaults: defaults ?? s.defaults })),
  setMeta: (meta) => set({ meta }),
  setIncludeFile: (includeFile) => set({ includeFile }),
  setSettingsOpen: (settingsOpen) => set({ settingsOpen })
}));
