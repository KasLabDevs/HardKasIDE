import { Sparkles } from "lucide-react";
import { api } from "@/api/client";
import { Plugin } from "@/engine/engine";
import { AssistantPanel } from "@/panels/AssistantPanel";
import type { ConsolePlugin } from "@/plugins/console";
import { useAssistant } from "@/store/assistant";
import { envOf, languageForPath, useIde } from "@/store/ide";

const SENSITIVE = /(accounts\.real\.json|dev-server-token|dev-accounts|\.env($|\.)|keystore|\.pem$)/i;

/**
 * Shows a file the agent wrote: opens it when it is not open, reloads it when it is open and clean,
 * and leaves it alone when it has unsaved edits (the user's buffer always wins over the disk).
 */
async function reloadIfClean(path: string): Promise<void> {
  const open = useIde.getState().openFiles.find((f) => f.path === path);
  if (open && open.content !== open.savedContent) return;
  try {
    const content = await api.fs.read(path);
    if (open && content === open.savedContent) return;
    useIde.getState().upsertOpenFile({ path, content, savedContent: content, language: languageForPath(path) });
  } catch {
    // deleted meanwhile, or not readable: nothing to show
  }
}

function recentHistory(excludeId?: number): Array<{ role: "user" | "assistant"; content: string }> {
  return useAssistant
    .getState()
    .turns.filter((t) => t.id !== excludeId && !t.streaming && !t.error && t.content.trim().length > 0)
    .slice(-10)
    .map((t) => ({ role: t.role, content: t.content }));
}

/**
 * Claude Code / Gemini-style AI workbench assistant: unified multi-turn Ask + Agent sessions grounded in
 * official Kaspa docs (docs.kaspa.org/llms.txt). Keys stay on ide-server; commands require explicit approval.
 */
export class AssistantPlugin extends Plugin {
  view = AssistantPanel;
  private abort: AbortController | null = null;

  constructor() {
    super({
      name: "assistant",
      displayName: "Assistant",
      description: "AI chat and autonomous coding agent grounded in Kaspa docs",
      location: "sidePanel",
      icon: Sparkles,
      order: 18,
      methods: ["open", "stop", "clear", "resetAgent", "refreshConfig", "refreshAuth", "runAgent", "answerConfirm"],
      events: ["answered", "agentFinished"]
    });
  }

  async onActivation(): Promise<void> {
    // Load persisted config/auth asynchronously so plugin activation never delays IDE first paint.
    void this.refreshConfig();
  }

  onDeactivation(): void {
    this.abort?.abort();
  }

  open(): void {
    useIde.getState().revealPlugin("assistant", "Assistant");
  }

  stop(): void {
    this.abort?.abort();
  }

  clear(): void {
    this.abort?.abort();
    useAssistant.getState().clear();
  }

  /** Kept for backward compatibility; clears the current conversation cleanly. */
  resetAgent(): void {
    this.clear();
  }

  async refreshAuth(refreshModels = false): Promise<void> {
    try {
      const auth = await api.assistant.authStatus(refreshModels);
      useAssistant.getState().setAuth({
        installed: auth.installed,
        accounts: auth.accounts,
        models: auth.models,
        rankedFreeModels: auth.rankedFreeModels,
        cooldowns: auth.cooldowns
      });
    } catch {
      // ide-server down or opencode unavailable: Settings surfaces auth status when opened
    }
  }

  async clearCooldowns(model?: string): Promise<void> {
    try {
      await api.assistant.clearCooldowns(model);
      await this.refreshAuth(false);
    } catch {
      // ignore
    }
  }

  async refreshConfig(refreshModels = false): Promise<void> {
    try {
      const { config, defaults, keyCommands, keyStates } = await api.assistant.config();
      useAssistant.getState().setConfig(config, defaults, keyCommands ?? null, keyStates ?? null);
      void this.refreshAuth(refreshModels);
    } catch {
      // ide-server down: the panel surfaces configuration errors when sending
    }
  }

  /** Approves or declines the terminal command the active agent turn is waiting on. */
  async answerConfirm(approved: boolean, allForRun = false): Promise<void> {
    const st = useAssistant.getState();
    const activeTurn = [...st.turns].reverse().find((t) => t.pendingConfirm);
    const pending = activeTurn?.pendingConfirm;
    if (!activeTurn || !pending) return;
    st.setConfirm(activeTurn.id, null);
    try {
      await api.assistant.agentConfirm(pending.id, approved, allForRun);
    } catch (e) {
      this.engine.get<ConsolePlugin>("console").error(`Could not answer the agent: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  /** Sends `text` (plus the open file when enabled) and streams a read-only answer into the session. */
  async ask(text: string): Promise<void> {
    const st = useAssistant.getState();
    const prompt = text.trim();
    if (!prompt || st.busy) return;

    const historyBefore = recentHistory();
    const ide = useIde.getState();
    const active = ide.openFiles.find((f) => f.path === ide.activeFile);
    const file = st.includeFile && active && active.kind !== "view" && !SENSITIVE.test(active.path) ? { path: active.path, content: active.content } : null;
    const answerId = st.startTurnPair("chat", prompt, file?.path ?? null);

    this.abort = new AbortController();
    let failed: string | undefined;
    try {
      await api.assistant.chat(
        {
          messages: [...historyBefore, { role: "user", content: prompt }],
          context: { workspace: ide.workspace?.name ?? undefined, environment: `${envOf(ide.target).label} (network ${envOf(ide.target).networkId})`, file }
        },
        this.abort.signal,
        (event, data) => {
          if (event === "meta") useAssistant.getState().setMeta({ model: String(data.model ?? ""), docs: (data.docs as { mode: string; chars: number; stale: boolean } | null) ?? null });
          else if (event === "delta") useAssistant.getState().append(answerId, String(data.text ?? ""));
          else if (event === "error") failed = String(data.message ?? "The assistant failed.");
        }
      );
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "AbortError")) failed = e instanceof Error ? e.message : String(e);
    } finally {
      useAssistant.getState().finishTurn(answerId, { error: failed, ok: !failed });
      this.abort = null;
      if (useAssistant.getState().config?.provider === "opencode") void this.refreshAuth(false);
      this.emit("answered");
    }
  }

  /** Runs an autonomous agent turn inside the unified conversation, preserving prior context. */
  async runAgent(goal: string): Promise<void> {
    const st = useAssistant.getState();
    const g = goal.trim();
    if (!g || st.busy) return;

    const historyBefore = recentHistory();
    const ide = useIde.getState();
    const active = ide.openFiles.find((f) => f.path === ide.activeFile);
    const file = st.includeFile && active && active.kind !== "view" && !SENSITIVE.test(active.path) ? { path: active.path, content: active.content } : null;
    const answerId = st.startTurnPair("agent", g, file?.path ?? null);

    this.abort = new AbortController();
    let failed: string | undefined;
    let finalSummary: string | null = null;
    let succeeded = false;

    try {
      await api.assistant.agent(
        {
          goal: g,
          history: historyBefore,
          context: { workspace: ide.workspace?.name ?? undefined, environment: `${envOf(ide.target).label} (network ${envOf(ide.target).networkId})`, file }
        },
        this.abort.signal,
        (event, data) => {
          if (event === "thought" && typeof data.text === "string") {
            useAssistant.getState().addThought(answerId, data.text);
          } else if (event === "confirm" && typeof data.id === "string" && typeof data.command === "string") {
            useAssistant.getState().setConfirm(answerId, { id: data.id, command: data.command });
          } else if (event === "step") {
            const stepId = String(data.id ?? `step_${Date.now()}`);
            const toolName = String(data.tool ?? "");
            const stepStatus = (data.status as "running" | "succeeded" | "failed") || "running";
            const currentTurn = useAssistant.getState().turns.find((t) => t.id === answerId);
            if (currentTurn?.pendingConfirm?.id === `confirm_${stepId}`) {
              useAssistant.getState().setConfirm(answerId, null);
            }
            useAssistant.getState().upsertStep(answerId, {
              id: stepId,
              title: String(data.title ?? ""),
              tool: toolName,
              status: stepStatus,
              input: data.input as Record<string, unknown> | undefined,
              output: typeof data.output === "string" ? data.output : undefined,
              error: typeof data.error === "string" ? data.error : undefined
            });

            if (stepStatus === "succeeded" && toolName === "write_file" && data.input && typeof (data.input as Record<string, unknown>).path === "string") {
              const editedPath = String((data.input as Record<string, unknown>).path).replace(/^[\/\\]+/, "");
              void reloadIfClean(editedPath);
            }
          } else if (event === "done") {
            finalSummary = String(data.summary ?? "");
            succeeded = Boolean(data.ok);
          } else if (event === "error") {
            failed = String(data.message ?? "Agent execution failed.");
          }
        }
      );

      try {
        const { tree } = await api.fs.tree();
        ide.setTree(tree);
        for (const f of useIde.getState().openFiles) {
          if (f.kind !== "view") await reloadIfClean(f.path);
        }
      } catch {
        // ignore tree refresh failure
      }
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "AbortError")) {
        failed = e instanceof Error ? e.message : String(e);
      }
    } finally {
      const aborted = Boolean(this.abort?.signal.aborted);
      useAssistant.getState().finishTurn(answerId, {
        content: finalSummary ?? (aborted ? "Stopped by user." : succeeded ? "Done." : ""),
        error: failed ?? (aborted ? "Stopped by user." : undefined),
        ok: succeeded && !failed && !aborted
      });
      this.abort = null;
      if (useAssistant.getState().config?.provider === "opencode") void this.refreshAuth(false);
      this.emit("agentFinished");
    }
  }
}
