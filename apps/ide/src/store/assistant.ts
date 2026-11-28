import { create } from "zustand";
import type { AssistantAuthStatus, AssistantConfigView, AssistantKeyCommands, AssistantKeyState } from "@/api/client";

/**
 * Unified Assistant conversation state (Claude Code / Gemini style):
 * Ask (read-only) and Agent (autonomous tools) turns live together in a continuous thread
 * persisted in localStorage; API keys always stay on ide-server.
 */

export interface AgentStep {
  id: string;
  title: string;
  tool: string;
  status: "running" | "succeeded" | "failed";
  input?: Record<string, unknown>;
  output?: string;
  error?: string;
}

export interface AssistantTurn {
  id: number;
  role: "user" | "assistant";
  mode: "chat" | "agent";
  content: string;
  attachedFile?: string | null;
  streaming?: boolean;
  thoughts?: string[];
  steps?: AgentStep[];
  pendingConfirm?: { id: string; command: string } | null;
  error?: string;
  ok?: boolean;
  startedAt?: number;
  endedAt?: number;
}

export interface AnswerMeta {
  model: string;
  docs: { mode: string; chars: number; stale: boolean } | null;
}

const KEY = "hardkas-ide.assistant.thread.v2";
const MODE_KEY = "hardkas-ide.assistant.mode";
const MAX_SAVED = 40;

function sanitizeStep(s: unknown): AgentStep | null {
  if (!s || typeof s !== "object") return null;
  const r = s as Record<string, unknown>;
  if (typeof r.id !== "string" || typeof r.title !== "string" || typeof r.tool !== "string") return null;
  const status = r.status === "succeeded" || r.status === "failed" ? r.status : "failed";
  return {
    id: r.id,
    title: r.title,
    tool: r.tool,
    status,
    input: r.input && typeof r.input === "object" && !Array.isArray(r.input) ? (r.input as Record<string, unknown>) : undefined,
    output: typeof r.output === "string" ? r.output : undefined,
    error: typeof r.error === "string" ? r.error : undefined
  };
}

function load(): AssistantTurn[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((t): t is Record<string, unknown> => !!t && typeof t === "object" && (t.role === "user" || t.role === "assistant") && typeof t.content === "string")
      .map((t, i) => ({
        id: typeof t.id === "number" ? t.id : i + 1,
        role: t.role as "user" | "assistant",
        mode: t.mode === "agent" ? "agent" : "chat",
        content: t.content as string,
        attachedFile: typeof t.attachedFile === "string" ? t.attachedFile : undefined,
        streaming: false,
        thoughts: Array.isArray(t.thoughts) ? t.thoughts.filter((x): x is string => typeof x === "string") : undefined,
        steps: Array.isArray(t.steps) ? t.steps.map(sanitizeStep).filter((x): x is AgentStep => x !== null) : undefined,
        pendingConfirm: null,
        error: typeof t.error === "string" ? t.error : undefined,
        ok: typeof t.ok === "boolean" ? t.ok : undefined,
        startedAt: typeof t.startedAt === "number" ? t.startedAt : undefined,
        endedAt: typeof t.endedAt === "number" ? t.endedAt : undefined
      }));
  } catch {
    return [];
  }
}

function loadMode(): "chat" | "agent" {
  try {
    const saved = localStorage.getItem(MODE_KEY);
    return saved === "chat" ? "chat" : "agent";
  } catch {
    return "agent";
  }
}

function persist(turns: AssistantTurn[]): void {
  try {
    const clean = turns
      .filter((t) => !t.streaming)
      .slice(-MAX_SAVED)
      .map(({ pendingConfirm: _pc, ...rest }) => rest);
    localStorage.setItem(KEY, JSON.stringify(clean));
  } catch {
    // storage unavailable: history lasts for the session only
  }
}

let seq = Date.now();

interface AssistantState {
  mode: "chat" | "agent";
  turns: AssistantTurn[];
  busy: boolean;
  config: AssistantConfigView | null;
  auth: AssistantAuthStatus | null;
  defaults: Record<"opencode" | "anthropic" | "openai", { baseUrl: string; model: string }> | null;
  keyCommands: AssistantKeyCommands | null;
  keyStates: Record<"anthropic" | "openai", AssistantKeyState> | null;
  meta: AnswerMeta | null;
  includeFile: boolean;
  settingsOpen: boolean;
  setMode(m: "chat" | "agent"): void;
  startTurnPair(mode: "chat" | "agent", prompt: string, attachedFile?: string | null): number;
  append(id: number, text: string): void;
  addThought(id: number, thought: string): void;
  upsertStep(id: number, step: AgentStep): void;
  setConfirm(id: number, confirm: { id: string; command: string } | null): void;
  finishTurn(id: number, opts: { content?: string; error?: string; ok?: boolean }): void;
  clear(): void;
  setBusy(b: boolean): void;
  setConfig(
    c: AssistantConfigView,
    defaults?: AssistantState["defaults"],
    keyCommands?: AssistantState["keyCommands"],
    keyStates?: AssistantState["keyStates"]
  ): void;
  setAuth(auth: AssistantAuthStatus | null): void;
  setMeta(m: AnswerMeta | null): void;
  setIncludeFile(v: boolean): void;
  setSettingsOpen(v: boolean): void;
}

export const useAssistant = create<AssistantState>((set) => ({
  mode: loadMode(),
  turns: load(),
  busy: false,
  config: null,
  auth: null,
  defaults: null,
  keyCommands: null,
  keyStates: null,
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

  startTurnPair: (mode, prompt, attachedFile) => {
    const userId = ++seq;
    const answerId = ++seq;
    set((s) => {
      const next: AssistantTurn[] = [
        ...s.turns,
        { id: userId, role: "user", mode, content: prompt, attachedFile: attachedFile ?? undefined },
        {
          id: answerId,
          role: "assistant",
          mode,
          content: "",
          streaming: true,
          thoughts: mode === "agent" ? [] : undefined,
          steps: mode === "agent" ? [] : undefined,
          pendingConfirm: null,
          startedAt: Date.now()
        }
      ];
      return { turns: next, busy: true };
    });
    return answerId;
  },

  append: (id, text) =>
    set((s) => ({
      turns: s.turns.map((t) => (t.id === id ? { ...t, content: t.content + text } : t))
    })),

  addThought: (id, thought) =>
    set((s) => ({
      turns: s.turns.map((t) => (t.id === id ? { ...t, thoughts: [...(t.thoughts ?? []), thought] } : t))
    })),

  upsertStep: (id, step) =>
    set((s) => ({
      turns: s.turns.map((t) => {
        if (t.id !== id) return t;
        const steps = t.steps ?? [];
        const idx = steps.findIndex((x) => x.id === step.id);
        const nextSteps = idx >= 0 ? steps.map((x, i) => (i === idx ? { ...x, ...step } : x)) : [...steps, step];
        return { ...t, steps: nextSteps };
      })
    })),

  setConfirm: (id, confirm) =>
    set((s) => ({
      turns: s.turns.map((t) => (t.id === id ? { ...t, pendingConfirm: confirm } : t))
    })),

  finishTurn: (id, { content, error, ok }) =>
    set((s) => {
      const turns = s.turns.map((t) =>
        t.id === id
          ? {
              ...t,
              content: content !== undefined ? content : t.content,
              streaming: false,
              pendingConfirm: null,
              error,
              ok: ok ?? !error,
              endedAt: Date.now()
            }
          : t
      );
      persist(turns);
      return { turns, busy: false };
    }),

  clear: () => {
    persist([]);
    set({ turns: [], busy: false });
  },

  setBusy: (busy) => set({ busy }),
  setConfig: (config, defaults, keyCommands, keyStates) =>
    set((s) => ({
      config,
      defaults: defaults ?? s.defaults,
      keyCommands: keyCommands ?? s.keyCommands,
      keyStates: keyStates ?? s.keyStates
    })),
  setAuth: (auth) => set({ auth }),
  setMeta: (meta) => set({ meta }),
  setIncludeFile: (includeFile) => set({ includeFile }),
  setSettingsOpen: (settingsOpen) => set({ settingsOpen })
}));
