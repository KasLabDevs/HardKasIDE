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

export interface AgentStep {
  id: string;
  title: string;
  tool: string;
  status: "running" | "succeeded" | "failed";
  input?: Record<string, unknown>;
  output?: string;
  error?: string;
}

export interface AgentRun {
  goal: string;
  steps: AgentStep[];
  thoughts: string[];
  summary: string | null;
  running: boolean;
  ok?: boolean;
}

const KEY = "hardkas-ide.assistant.chat";
const MODE_KEY = "hardkas-ide.assistant.mode";
const MAX_SAVED = 40;

function load(): ChatTurn[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "[]") as ChatTurn[];
    return raw.map((t) => ({ ...t, streaming: false }));
  } catch {
    return [];
  }
}

function loadMode(): "chat" | "agent" {
  try {
    return (localStorage.getItem(MODE_KEY) as "chat" | "agent") || "chat";
  } catch {
    return "chat";
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
  mode: "chat" | "agent";
  turns: ChatTurn[];
  busy: boolean;
  agentRun: AgentRun | null;
  config: AssistantConfigView | null;
  defaults: Record<"anthropic" | "openai", { baseUrl: string; model: string }> | null;
  meta: AnswerMeta | null;
  includeFile: boolean;
  settingsOpen: boolean;
  setMode(m: "chat" | "agent"): void;
  push(role: ChatTurn["role"], content: string, streaming?: boolean): number;
  append(id: number, text: string): void;
  finish(id: number, error?: string): void;
  clear(): void;
  setBusy(b: boolean): void;
  setConfig(c: AssistantConfigView, defaults?: AssistantState["defaults"]): void;
  setMeta(m: AnswerMeta | null): void;
  setIncludeFile(v: boolean): void;
  setSettingsOpen(v: boolean): void;
  startAgentRun(goal: string): void;
  addAgentThought(thought: string): void;
  upsertAgentStep(step: AgentStep): void;
  finishAgentRun(summary: string, ok: boolean): void;
  resetAgentRun(): void;
}

export const useAssistant = create<AssistantState>((set) => ({
  mode: loadMode(),
  turns: load(),
  busy: false,
  agentRun: null,
  config: null,
  defaults: null,
  meta: null,
  includeFile: true,
  settingsOpen: false,
  setMode: (mode) => {
    try {
      localStorage.setItem(MODE_KEY, mode);
    } catch {
      // ignore
    }
    set({ mode });
  },
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
  setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
  startAgentRun: (goal) =>
    set({
      busy: true,
      agentRun: { goal, steps: [], thoughts: [], summary: null, running: true }
    }),
  addAgentThought: (thought) =>
    set((s) => {
      if (!s.agentRun) return {};
      return {
        agentRun: { ...s.agentRun, thoughts: [...s.agentRun.thoughts, thought] }
      };
    }),
  upsertAgentStep: (step) =>
    set((s) => {
      if (!s.agentRun) return {};
      const exists = s.agentRun.steps.some((st) => st.id === step.id);
      const steps = exists
        ? s.agentRun.steps.map((st) => (st.id === step.id ? { ...st, ...step } : st))
        : [...s.agentRun.steps, step];
      return { agentRun: { ...s.agentRun, steps } };
    }),
  finishAgentRun: (summary, ok) =>
    set((s) => {
      if (!s.agentRun) return { busy: false };
      return {
        busy: false,
        agentRun: { ...s.agentRun, summary, ok, running: false }
      };
    }),
  resetAgentRun: () => set({ agentRun: null, busy: false })
}));
