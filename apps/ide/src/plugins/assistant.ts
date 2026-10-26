import { Sparkles } from "lucide-react";
import { api } from "@/api/client";
import { Plugin } from "@/engine/engine";
import { AssistantPanel } from "@/panels/AssistantPanel";
import { useAssistant } from "@/store/assistant";
import { envOf, useIde } from "@/store/ide";

const SENSITIVE = /(accounts\.real\.json|dev-server-token|dev-accounts|\.env($|\.)|keystore|\.pem$)/i;

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
      methods: ["open", "stop", "clear", "refreshConfig"],
      events: ["answered"]
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
}
