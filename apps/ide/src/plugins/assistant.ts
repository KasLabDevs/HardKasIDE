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

/**
 * Chat assistant, model-agnostic and grounded in the official Kaspa docs (docs.kaspa.org/llms.txt).
 * It can only chat: it never runs commands or edits files; code in answers has Copy / Insert / Save buttons
 * and the user decides. Keys stay on ide-server; the browser only ever sees "hasKey".
 */
export class AssistantPlugin extends Plugin {
  view = AssistantPanel;
  private abort: AbortController | null = null;

  constructor() {
    super({
      name: "assistant",
      displayName: "Assistant",
      description: "Chat about Kaspa and SilverScript, grounded in the official docs",
      location: "sidePanel",
      icon: Sparkles,
      order: 18,
      methods: ["open", "stop", "clear", "resetAgent", "refreshConfig", "runAgent", "answerConfirm"],
      events: ["answered", "agentFinished"]
    });
  }

  async onActivation(): Promise<void> {
    await this.refreshConfig();
  }

  onDeactivation(): void {
    this.abort?.abort();
  }

  open(): void {
    useIde.getState().revealPlugin("assistant", "Assistant");
  }

  async refreshConfig(): Promise<void> {
    try {
      const { config, defaults } = await api.assistant.config();
      useAssistant.getState().setConfig(config, defaults);
    } catch {
      // ide-server down: the panel shows the connection problem when you send
    }
  }

  stop(): void {
    this.abort?.abort();
  }

  clear(): void {
    this.abort?.abort();
    useAssistant.getState().clear();
  }

  /** Approves or declines the terminal command the agent is waiting on. */
  async answerConfirm(approved: boolean, allForRun = false): Promise<void> {
    const st = useAssistant.getState();
    const pending = st.agentRun?.pendingConfirm;
    if (!pending) return;
    st.setAgentConfirm(null);
    try {
      await api.assistant.agentConfirm(pending.id, approved, allForRun);
    } catch (e) {
      this.engine.get<ConsolePlugin>("console").error(`Could not answer the agent: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  /** Clears the agent run; a run still streaming is stopped first so its late events cannot land in the next run. */
  resetAgent(): void {
    this.abort?.abort();
    useAssistant.getState().resetAgentRun();
  }

  /** Sends `text` (plus the open file when enabled) and streams the answer into the chat. */
  async ask(text: string): Promise<void> {
    const st = useAssistant.getState();
    const prompt = text.trim();
    if (!prompt || st.busy) return;

    st.push("user", prompt);
    const answerId = st.push("assistant", "", true);
    st.setBusy(true);

    const ide = useIde.getState();
    const active = ide.openFiles.find((f) => f.path === ide.activeFile);
    const file = st.includeFile && active && active.kind !== "view" && !SENSITIVE.test(active.path) ? { path: active.path, content: active.content } : null;
    const history = useAssistant
      .getState()
      .turns.filter((t) => t.id !== answerId && !t.error && t.content.trim())
      .map((t) => ({ role: t.role, content: t.content }));

    this.abort = new AbortController();
    let failed: string | undefined;
    try {
      await api.assistant.chat(
        {
          messages: history,
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
      useAssistant.getState().finish(answerId, failed);
      useAssistant.getState().setBusy(false);
      this.abort = null;
      this.emit("answered");
    }
  }

  /** Runs the autonomous agent for a given goal. Executes tools, handles self-healing, and updates steps. */
  async runAgent(goal: string): Promise<void> {
    const st = useAssistant.getState();
    const g = goal.trim();
    if (!g || st.busy) return;

    st.startAgentRun(g);

    const ide = useIde.getState();
    const active = ide.openFiles.find((f) => f.path === ide.activeFile);
    const file = st.includeFile && active && active.kind !== "view" && !SENSITIVE.test(active.path) ? { path: active.path, content: active.content } : null;

    this.abort = new AbortController();
    let failed: string | undefined;
    let finalSummary: string | null = null;
    let succeeded = false;

    try {
      await api.assistant.agent(
        {
          goal: g,
          context: { workspace: ide.workspace?.name ?? undefined, environment: `${envOf(ide.target).label} (network ${envOf(ide.target).networkId})`, file }
        },
        this.abort.signal,
        (event, data) => {
          if (event === "thought" && typeof data.text === "string") {
            useAssistant.getState().addAgentThought(data.text);
          } else if (event === "confirm" && typeof data.id === "string" && typeof data.command === "string") {
            // The run is paused on the server until answerConfirm is called (or Stop aborts it).
            useAssistant.getState().setAgentConfirm({ id: data.id, command: data.command });
          } else if (event === "step") {
            const stepId = String(data.id ?? `step_${Date.now()}`);
            const toolName = String(data.tool ?? "");
            const stepStatus = (data.status as "running" | "succeeded" | "failed") || "running";
            const st = useAssistant.getState();
            if (st.agentRun?.pendingConfirm?.id === `confirm_${stepId}`) st.setAgentConfirm(null);
            useAssistant.getState().upsertAgentStep({
              id: stepId,
              title: String(data.title ?? ""),
              tool: toolName,
              status: stepStatus,
              input: data.input as Record<string, unknown> | undefined,
              output: typeof data.output === "string" ? data.output : undefined,
              error: typeof data.error === "string" ? data.error : undefined
            });

            // A file the agent wrote reloads in the editor if it is open and clean; unsaved edits are never replaced.
            if (stepStatus === "succeeded" && toolName === "write_file" && data.input && typeof (data.input as any).path === "string") {
              const editedPath = String((data.input as any).path).replace(/^[\/\\]+/, "");
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
      // The agent may have created files or run commands that write: refresh the tree and the clean open files.
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
      useAssistant.getState().finishAgentRun(finalSummary || failed || (this.abort?.signal.aborted ? "Agent run stopped by user." : "Agent finished."), succeeded && !failed);
      this.abort = null;
      this.emit("agentFinished");
    }
  }
}
