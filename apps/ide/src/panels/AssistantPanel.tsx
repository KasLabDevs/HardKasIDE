import clsx from "clsx";
import {
  AlertCircle,
  ArrowUp,
  BookOpen,
  Brain,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  Coins,
  Copy,
  ExternalLink,
  Eye,
  FileCode2,
  FileEdit,
  FilePlus2,
  FlaskConical,
  FolderOpen,
  Hammer,
  KeyRound,
  Loader2,
  LogOut,
  Maximize2,
  MessageSquare,
  PanelLeft,
  Paperclip,
  RefreshCw,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Square,
  SquarePen,
  Terminal,
  TerminalSquare,
  TextCursorInput,
  Wand2,
  X,
  XCircle
} from "lucide-react";
import { Fragment, useEffect, useRef, useState } from "react";
import { api, IdeApiError, type AssistantAuthAccount, type AssistantAuthSession, type AssistantAuthStatus, type ModelCooldownInfo, type RankedOpenCodeModel } from "@/api/client";
import { ProviderIcon } from "@/components/ProviderIcons";
import { useEngine } from "@/engine/context";
import type { AssistantPlugin } from "@/plugins/assistant";
import type { EditorPlugin } from "@/plugins/editor";
import { useAssistant, type AgentStep, type AssistantTurn } from "@/store/assistant";
import { envOf, useIde, VIEW_PREFIX } from "@/store/ide";
import { useScripts } from "@/store/scripts";
import { copyText } from "@/utils/clipboard";
import { openDetachedWindow, parseDetachQuery } from "@/utils/detach";
import { promptDialog } from "@/utils/dialog";

const RESEARCH_GPT = "https://chatgpt.com/g/g-6887632bd778819191d51022323293ea-kaspa-research-gpt-for-kaspa-coin-v6";
const DOCS_FOR_AI = "https://docs.kaspa.org/llms.txt";
const OPENCODE_MODELS_PRIVACY = "https://opencode.ai/docs/zen";

/** Suggestions on an empty panel: a short label to read, the full prompt to send. */
type Starter = { label: string; prompt: string; icon: typeof FileCode2 };

const STARTERS: Starter[] = [
  { icon: FileCode2, label: "Explain the open contract", prompt: "Explain what the open contract does and how each entry is spent." },
  { icon: ShieldCheck, label: "Review it for UTXO mistakes", prompt: "Review this contract for mistakes a Toccata/UTXO developer would catch." },
  { icon: FilePlus2, label: "Write an escrow with a timeout refund", prompt: "Write a SilverScript escrow with a timeout refund." },
  { icon: Coins, label: "Fund and spend a covenant on simnet", prompt: "How do I fund and spend a covenant output on simnet with HardKas?" }
];

const AGENT_STARTERS: Starter[] = [
  { icon: TerminalSquare, label: "Check the environment", prompt: "Run 'hardkas --version' in the terminal and check the state of the environment" },
  { icon: FilePlus2, label: "Write and compile an escrow", prompt: "Write an Escrow contract in SilverScript with a refund after a timeout, and compile it" },
  { icon: FilePlus2, label: "Write an auction with its test", prompt: "Write an Auction contract with bids, plus its Vitest test" },
  { icon: FileCode2, label: "Compile every contract", prompt: "Compile and verify every contract in contracts/" },
  { icon: FilePlus2, label: "Write a counter with tests", prompt: "Write a Counter contract with an increment entry and its test suite" }
];

/** One list of suggestions: quiet rows with hover highlight, familiar from Claude Code / Gemini. */
function StarterList({ starters, busy, onPick }: { starters: Starter[]; busy: boolean; onPick: (prompt: string) => void }) {
  return (
    <div className="rounded-xl border border-border/80 bg-bg-panel/40 divide-y divide-border/70 overflow-hidden">
      {starters.map(({ icon: Icon, label, prompt }) => (
        <button
          key={label}
          type="button"
          onClick={() => onPick(prompt)}
          disabled={busy}
          title={prompt}
          className="w-full flex items-center gap-2.5 px-3 py-2 text-left text-fg-muted hover:text-fg hover:bg-bg-hover cursor-pointer transition-colors disabled:opacity-50 group"
        >
          <Icon size={13} className="shrink-0 text-fg-muted group-hover:text-accent transition-colors" />
          <span className="truncate flex-1">{label}</span>
          <ChevronRight size={12} className="shrink-0 opacity-0 group-hover:opacity-60 transition-opacity" />
        </button>
      ))}
    </div>
  );
}

function formatResetShort(retryAt: number, now: number): string {
  const sec = Math.max(0, Math.ceil((retryAt - now) / 1000));
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  if (m < 60) return s > 0 ? `${m}m ${s}s` : `${m}m`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return rm > 0 ? `${h}h ${rm}m` : `${h}h`;
}

function buildRankedOpenCodeList(auth: AssistantAuthStatus | null): RankedOpenCodeModel[] {
  if (auth?.rankedFreeModels && auth.rankedFreeModels.length > 0) return auth.rankedFreeModels;
  const fallbackIds = (auth?.models ?? []).filter((m) => m.startsWith("opencode/"));
  return fallbackIds.map((id, idx) => ({
    id,
    shortId: id.split("/").pop() ?? id,
    name: id.split("/").pop() ?? id,
    rank: idx + 1,
    tier: idx === 0 ? "frontier" : idx < 4 ? "strong" : "balanced",
    summary: id,
    free: true
  }));
}

function useCooldownTicker(cooldowns: ModelCooldownInfo[] | undefined, onExpired: () => void): { now: number; activeCooldowns: ModelCooldownInfo[]; cooldownByModel: Map<string, ModelCooldownInfo> } {
  const [now, setNow] = useState(() => Date.now());
  const expiredFiredRef = useRef(0);
  const rawList = cooldowns ?? [];
  const activeCooldowns = rawList.filter((c) => c.retryAt > now);

  useEffect(() => {
    if (rawList.length === 0) {
      expiredFiredRef.current = 0;
      return;
    }
    const id = setInterval(() => {
      const ts = Date.now();
      setNow(ts);
      const justExpired = rawList.some((c) => c.retryAt <= ts && c.retryAt > expiredFiredRef.current);
      if (justExpired) {
        expiredFiredRef.current = ts;
        onExpired();
      }
    }, 1000);
    return () => clearInterval(id);
  }, [rawList, onExpired]);

  const cooldownByModel = new Map(activeCooldowns.map((c) => [c.model.toLowerCase(), c]));
  return { now, activeCooldowns, cooldownByModel };
}

/** Claude Code / Gemini style Assistant: continuous Ask + Agent thread, inline tools, dockable to left rail, center tab, or standalone window. */
export function AssistantPanel() {
  const engine = useEngine();
  const assistant = engine.get<AssistantPlugin>("assistant");
  const mode = useAssistant((s) => s.mode);
  const setMode = useAssistant((s) => s.setMode);
  const turns = useAssistant((s) => s.turns);
  const busy = useAssistant((s) => s.busy);
  const config = useAssistant((s) => s.config);
  const auth = useAssistant((s) => s.auth);
  const meta = useAssistant((s) => s.meta);
  const includeFile = useAssistant((s) => s.includeFile);
  const setIncludeFile = useAssistant((s) => s.setIncludeFile);
  const settingsOpen = useAssistant((s) => s.settingsOpen);
  const setSettingsOpen = useAssistant((s) => s.setSettingsOpen);
  const activeFile = useIde((s) => s.activeFile);
  const dock = useIde((s) => s.docks.assistant ?? "left");
  const setDock = useIde((s) => s.setDock);
  const openView = useIde((s) => s.openView);
  const isDetached = parseDetachQuery()?.kind === "view";

  const [input, setInput] = useState("");
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (turns.length > 0) {
      endRef.current?.scrollIntoView({ block: "end" });
    }
  }, [turns]);

  const { now, cooldownByModel } = useCooldownTicker(auth?.cooldowns, () => void assistant.refreshAuth(false));
  const rankedFree = buildRankedOpenCodeList(auth);
  const bestReadyFree = rankedFree.find((m) => !cooldownByModel.has(m.id.toLowerCase())) ?? rankedFree[0];

  const chatgptConnected = Boolean(auth?.accounts.some((a) => a.target === "openai"));
  const isChatGptOAuth = config?.provider === "openai" && config?.openaiAuthMode === "oauth";
  const hasValidChatGptModel = /^openai\/\S+$/i.test((config?.model ?? "").trim());
  const notReady =
    isChatGptOAuth && !chatgptConnected
      ? "Sign in with ChatGPT to start"
      : isChatGptOAuth && !hasValidChatGptModel
        ? "Pick an openai/… model for ChatGPT to start"
        : config && !config.model
          ? "Pick a model to start"
          : config && !config.hasKey && config.provider === "anthropic"
            ? "Set ANTHROPIC_API_KEY via command to start"
            : null;

  const isAutoOpenCode = config?.provider === "opencode" && config.model === "opencode/auto";
  const selectedCooldown = config?.provider === "opencode" && config.model ? cooldownByModel.get(config.model.toLowerCase()) : undefined;
  const fallbackReady = config?.provider === "opencode" && config.opencodeAutoFallback !== false && selectedCooldown && bestReadyFree ? bestReadyFree : null;

  const modelName = !config
    ? "…"
    : !config.model
      ? "Select model"
      : isAutoOpenCode
        ? `Auto · ${bestReadyFree?.shortId ?? "best"}`
        : fallbackReady
          ? `Auto · ${fallbackReady.shortId}`
          : (config.model.split("/").pop() ?? config.model);

  const modelStatusNote = isAutoOpenCode && bestReadyFree
    ? `Auto best available free model: #${bestReadyFree.rank} ${bestReadyFree.shortId}`
    : selectedCooldown
      ? `${config?.model?.split("/").pop()} resets in ${formatResetShort(selectedCooldown.retryAt, now)}${fallbackReady ? ` · using #${fallbackReady.rank} ${fallbackReady.shortId}` : ""}`
      : "";
  const docsInfo = meta?.docs
    ? `Kaspa docs ${meta.docs.mode} (~${Math.round(meta.docs.chars / 4000)}k tokens)`
    : config && config.provider !== "opencode" && !isChatGptOAuth && config.docs !== "off"
      ? `Kaspa docs ${config.docs}`
      : "";
  const sharedFile = activeFile && !activeFile.startsWith("view:") ? activeFile.split("/").pop() : null;
  const needsConsent = config?.provider === "opencode" && !config.opencodeConsent;

  const send = (text = input, overrideMode = mode) => {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    setInput("");
    if (overrideMode === "agent") {
      void assistant.runAgent(trimmed);
    } else {
      void assistant.ask(trimmed);
    }
  };

  const toggleMainTab = () => {
    if (dock === "main") {
      setDock("assistant", "left");
    } else {
      setDock("assistant", "main");
      openView("assistant", "Assistant");
    }
  };

  const popOutWindow = () => {
    openDetachedWindow({
      path: `${VIEW_PREFIX}assistant`,
      content: "",
      savedContent: "",
      language: "view",
      kind: "view",
      title: "Assistant"
    });
  };

  /** The Research GPT cannot be called from here (no API, no framing): hand it the question with its context. */
  const askResearchGpt = async () => {
    const ide = useIde.getState();
    const file = ide.openFiles.find((f) => f.path === ide.activeFile && f.kind !== "view");
    const parts = [input.trim() || "Review this Kaspa code and explain it.", `Environment: ${envOf(ide.target).label} (network ${envOf(ide.target).networkId}).`];
    if (includeFile && file && !/(accounts\.real|dev-server-token|keystore|\.env)/i.test(file.path)) parts.push(`File ${file.path}:\n\n${file.content}`);
    await copyText(parts.join("\n\n"));
    window.open(RESEARCH_GPT, "_blank", "noopener,noreferrer");
    useIde.getState().setStatus("Question and context copied: paste it into the Kaspa Research GPT.");
  };

  return (
    <div className="h-full flex flex-col text-xs min-h-0 bg-bg">
      {/* Minimal Claude Code / Gemini top bar: session controls & window placement */}
      <div className="shrink-0 flex items-center gap-1 px-2.5 py-1.5 border-b border-border bg-bg-panel/40">
        <div className="flex items-center gap-1.5 min-w-0">
          <Sparkles size={13} className="text-accent shrink-0" />
          <span className="font-semibold text-fg truncate">Assistant</span>
        </div>
        <button
          type="button"
          onClick={() => assistant.clear()}
          disabled={turns.length === 0 && !busy}
          className="ml-1 inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11.5px] font-medium text-fg-muted hover:text-fg hover:bg-bg-hover cursor-pointer disabled:opacity-40 disabled:cursor-default transition-colors"
          title="New conversation"
          aria-label="New conversation"
        >
          <SquarePen size={12} />
          <span>New</span>
        </button>
        <span className="flex-1" />
        <button
          type="button"
          onClick={() => void askResearchGpt()}
          className="shrink-0 p-1 rounded text-fg-muted hover:text-fg hover:bg-bg-hover cursor-pointer"
          title="Ask Kaspa Research GPT (copies prompt + open file)"
          aria-label="Ask Kaspa Research GPT"
        >
          <BookOpen size={13} />
        </button>
        {!isDetached && (
          <>
            <button
              type="button"
              onClick={toggleMainTab}
              className="shrink-0 p-1 rounded text-fg-muted hover:text-fg hover:bg-bg-hover cursor-pointer"
              title={dock === "main" ? "Dock Assistant to left sidebar" : "Expand Assistant into full editor tab"}
              aria-label={dock === "main" ? "Dock Assistant to left sidebar" : "Expand Assistant into full editor tab"}
            >
              {dock === "main" ? <PanelLeft size={13} /> : <Maximize2 size={13} />}
            </button>
            <button
              type="button"
              onClick={popOutWindow}
              className="shrink-0 p-1 rounded text-fg-muted hover:text-fg hover:bg-bg-hover cursor-pointer"
              title="Open Assistant in a separate window"
              aria-label="Open Assistant in a separate window"
            >
              <ExternalLink size={13} />
            </button>
          </>
        )}
        <button
          type="button"
          onClick={() => setSettingsOpen(!settingsOpen)}
          className={clsx(
            "shrink-0 p-1 rounded cursor-pointer transition-colors",
            settingsOpen ? "text-accent bg-accent/10" : "text-fg-muted hover:text-fg hover:bg-bg-hover"
          )}
          title={[config ? `${config.provider} · ${config.model || "no model"}` : "", docsInfo, "Model & API settings"].filter(Boolean).join("\n")}
          aria-label="Assistant settings"
          aria-pressed={settingsOpen}
        >
          <SlidersHorizontal size={13} />
        </button>
      </div>

      {settingsOpen ? (
        <Settings onClose={() => setSettingsOpen(false)} />
      ) : (
        <>
          {/* Continuous conversation thread (matches Claude Code / Gemini layout in sidebar, tab, or detached window) */}
          <div className="flex-1 min-h-0 overflow-auto px-3 py-2.5">
            <div className="max-w-3xl mx-auto w-full space-y-3">
              {turns.length === 0 && (
                <div className="space-y-3 pt-1">
                  <div className="flex flex-col items-center gap-1 text-center px-2">
                    <div className="w-7 h-7 rounded-full bg-accent/10 border border-accent/30 flex items-center justify-center text-accent">
                      <Sparkles size={14} />
                    </div>
                    <div className="text-[13.5px] font-semibold text-fg">
                      {mode === "agent" ? "What would you like to build?" : "Ask about Kaspa & SilverScript"}
                    </div>
                    <div className="max-w-[40ch] leading-relaxed text-fg-muted text-[12px]">
                      {mode === "agent" ? (
                        "Autonomous workspace agent: reads files, writes SilverScript contracts, compiles, tests and runs HardKas commands with your approval."
                      ) : (
                        <>
                          Grounded in{" "}
                          <a className="text-accent hover:underline" href={DOCS_FOR_AI} target="_blank" rel="noreferrer">
                            docs.kaspa.org
                          </a>{" "}
                          with the active editor file attached as context. Read-only Q&A.
                        </>
                      )}
                    </div>
                  </div>

                  {notReady && !needsConsent && (
                    <button
                      type="button"
                      onClick={() => setSettingsOpen(true)}
                      className="w-full flex items-center gap-2 rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-left text-[12px] text-warn hover:bg-warn/15 cursor-pointer transition-colors"
                    >
                      <KeyRound size={13} className="shrink-0" />
                      <span className="flex-1">{notReady}</span>
                      <span className="underline underline-offset-2 font-medium">Configure</span>
                    </button>
                  )}

                  <StarterList
                    starters={mode === "agent" ? AGENT_STARTERS : STARTERS}
                    busy={busy || Boolean(needsConsent)}
                    onPick={(p) => send(p)}
                  />
                </div>
              )}

              {turns.map((t) => (
                <AssistantTurnItem key={t.id} turn={t} />
              ))}
              <div ref={endRef} />
            </div>
          </div>

          {/* Bottom composer */}
          <div className="shrink-0 px-3 pb-2.5 pt-1">
            <div className="max-w-3xl mx-auto w-full relative">
              {needsConsent && config && <OpenCodeConsent model={config.model} onOwnProvider={() => setSettingsOpen(true)} />}

              {!needsConsent && (
                <div className="rounded-xl border border-border bg-bg-panel/50 transition-colors focus-within:border-accent/60 focus-within:bg-bg">
                  <textarea
                    className="block w-full resize-none bg-transparent px-3 pt-2.5 pb-1.5 text-xs text-fg outline-none placeholder:text-fg-muted min-h-[3rem] max-h-40 [field-sizing:content]"
                    placeholder={mode === "agent" ? "Describe what you want to build or change…" : "Ask about Kaspa or SilverScript…"}
                    title="Enter to send, Shift+Enter for a new line"
                    value={input}
                    rows={2}
                    aria-label={mode === "agent" ? "Goal for the agent" : "Message the assistant"}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        send();
                      }
                    }}
                  />
              <div className="flex flex-wrap items-center gap-1.5 px-2.5 pb-2">
                {/* Inline Mode Switcher */}
                <div role="tablist" aria-label="Assistant mode" className="inline-flex shrink-0 rounded-full border border-border bg-bg p-0.5">
                  {(["chat", "agent"] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      role="tab"
                      aria-selected={mode === m}
                      onClick={() => setMode(m)}
                      className={clsx(
                        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium transition-colors cursor-pointer",
                        mode === m ? "bg-bg-elev text-fg shadow-xs" : "text-fg-muted hover:text-fg"
                      )}
                    >
                      {m === "chat" ? <MessageSquare size={10} /> : <Wand2 size={10} />}
                      <span>{m === "chat" ? "Ask" : "Agent"}</span>
                    </button>
                  ))}
                </div>

                {/* Model Selector Pill */}
                <button
                  type="button"
                  onClick={() => setSettingsOpen(!settingsOpen)}
                  className={clsx(
                    "inline-flex min-w-0 max-w-[10rem] items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] transition-colors cursor-pointer",
                    notReady ? "border-warn/50 bg-warn/10 text-warn" : "border-border text-fg-muted hover:text-fg hover:border-fg-muted/40"
                  )}
                  title={[config ? `${config.provider} · ${config.model || "no model"}` : "", modelStatusNote, docsInfo, "Click to configure model"].filter(Boolean).join("\n")}
                >
                  <ProviderIcon provider={config?.provider} size={11} className="shrink-0" />
                  <span className="truncate">{modelName}</span>
                  <ChevronDown size={10} className="shrink-0 opacity-70" />
                </button>

                {/* Context File Chip */}
                <button
                  type="button"
                  onClick={() => setIncludeFile(!includeFile)}
                  aria-pressed={includeFile}
                  title={sharedFile ? (includeFile ? `${activeFile} is shared as context. Click to exclude.` : `Click to attach ${activeFile} as context.`) : "Open a file to share as context"}
                  className={clsx(
                    "inline-flex min-w-0 max-w-[9rem] items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] transition-colors cursor-pointer",
                    includeFile && sharedFile ? "border-accent/40 bg-accent/10 text-accent" : "border-border text-fg-muted hover:text-fg"
                  )}
                >
                  <Paperclip size={10} className="shrink-0" />
                  <span className={clsx("truncate", !includeFile && sharedFile && "line-through")}>{sharedFile ?? "No file"}</span>
                </button>

                <span className="flex-1" />

                {busy ? (
                  <button
                    type="button"
                    onClick={() => assistant.stop()}
                    title="Stop"
                    aria-label="Stop generating"
                    className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-border bg-bg text-fg hover:bg-bg-hover cursor-pointer"
                  >
                    <Square size={10} className="fill-current" />
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => send()}
                    disabled={!input.trim()}
                    title={mode === "agent" ? "Run in Agent mode (Enter)" : "Send message (Enter)"}
                    aria-label={mode === "agent" ? "Run agent goal" : "Send message"}
                    className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent text-accent-fg transition-all hover:brightness-110 cursor-pointer disabled:cursor-default disabled:bg-bg-elev disabled:text-fg-muted"
                  >
                    <ArrowUp size={13} />
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
        </>
      )}
    </div>
  );
}

/**
 * OpenCode's free models run on OpenCode's servers: the panel sends nothing there until the user agrees once.
 * The agreement is stored with the assistant settings and can be withdrawn there.
 */
function OpenCodeConsent({ model, onOwnProvider }: { model: string; onOwnProvider: () => void }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const accept = async () => {
    setSaving(true);
    setError(null);
    try {
      useAssistant.getState().setConfig(await api.assistant.saveConfig({ opencodeConsent: true }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };
  return (
    <div role="region" aria-label="OpenCode data notice" className="rounded border border-warn/50 bg-warn/10 p-2 space-y-1.5">
      <div className="text-warn font-semibold">The assistant is off until you turn it on</div>
      <div className="text-fg-muted leading-relaxed">
        It runs the OpenCode agent with a free model hosted by OpenCode (<code>{model || "default"}</code>). What you type, the open file you share and the
        workspace files the agent reads are sent to that model to get an answer. Each free model has its own data terms; some keep data or use it to
        improve the model (
        <a className="text-accent hover:underline" href={OPENCODE_MODELS_PRIVACY} target="_blank" rel="noreferrer">
          OpenCode's list
        </a>
        ). The agent cannot read account keys, keystores or <code>.env</code> files.
      </div>
      <div className="flex gap-1">
        <button type="button" className="btn-primary flex-1 justify-center" disabled={saving} onClick={() => void accept()}>
          {saving ? "…" : "Turn on OpenCode"}
        </button>
        <button type="button" className="btn-ghost flex-1 justify-center" onClick={onOwnProvider}>
          Use my own provider
        </button>
      </div>
      {error && (
        <div role="alert" className="text-error break-words">
          {error}
        </div>
      )}
    </div>
  );
}

function formatDuration(startedAt?: number, endedAt?: number): string | null {
  if (!startedAt || !endedAt || endedAt < startedAt) return null;
  const sec = (endedAt - startedAt) / 1000;
  return sec < 10 ? `${sec.toFixed(1)}s` : `${Math.round(sec)}s`;
}

function toolIcon(tool: string) {
  const t = tool.toLowerCase();
  if (t.includes("read") || t.includes("view") || t.includes("inspect")) return Eye;
  if (t.includes("write") || t.includes("edit") || t.includes("patch") || t.includes("create")) return FileEdit;
  if (t.includes("list") || t.includes("glob") || t.includes("find") || t.includes("search")) return FolderOpen;
  if (t.includes("compile") || t.includes("build")) return Hammer;
  if (t.includes("test") || t.includes("vitest")) return FlaskConical;
  if (t.includes("fund") || t.includes("send") || t.includes("wallet") || t.includes("balance")) return Coins;
  if (t.includes("cmd") || t.includes("run") || t.includes("exec") || t.includes("bash") || t.includes("shell") || t.includes("terminal")) return Terminal;
  return Wand2;
}

function stepFilePath(step: AgentStep): string | null {
  if (!step.input) return null;
  if (typeof step.input.path === "string" && step.input.path) return step.input.path;
  if (typeof step.input.file === "string" && step.input.file) return step.input.file;
  return null;
}

/** Single compact Claude Code / Antigravity style tool call row with expandable console output. */
function ToolStepRow({ step, onOpenFile }: { step: AgentStep; onOpenFile: (path: string) => void }) {
  const [toggled, setToggled] = useState<boolean | undefined>(undefined);
  const isOpen = toggled !== undefined ? toggled : step.status === "failed";
  const hasDetails = Boolean(step.output || step.error || step.input);
  const filePath = stepFilePath(step);
  const Icon = toolIcon(step.tool);

  return (
    <div className={clsx(step.status === "failed" && "bg-error/5")}>
      <div
        onClick={() => hasDetails && setToggled(!isOpen)}
        className={clsx(
          "flex items-center gap-2 px-2.5 py-1.5 select-none text-[12px]",
          hasDetails && "cursor-pointer hover:bg-bg-hover/50"
        )}
      >
        <Icon size={12} className="shrink-0 text-fg-muted" />
        <span className="font-medium text-fg truncate flex-1">{step.title}</span>
        {filePath && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onOpenFile(filePath);
            }}
            className="shrink-0 rounded px-1.5 py-0.5 text-[11px] font-mono text-accent hover:bg-accent/10 cursor-pointer transition-colors"
            title={`Open ${filePath}`}
          >
            {filePath.split("/").pop()}
          </button>
        )}
        <span className="shrink-0 flex items-center gap-1">
          {step.status === "running" ? (
            <Loader2 size={12} className="text-accent animate-spin" />
          ) : step.status === "succeeded" ? (
            <Check size={12} className="text-ok" />
          ) : (
            <XCircle size={12} className="text-error" />
          )}
          {hasDetails && (
            <span className="text-fg-muted">
              {isOpen ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
            </span>
          )}
        </span>
      </div>

      {isOpen && hasDetails && (
        <div className="px-2.5 pb-2 pt-1 border-t border-border/50 space-y-1.5 bg-bg/70">
          {filePath && (
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-fg-muted font-mono truncate">{filePath}</span>
              <button
                type="button"
                onClick={() => onOpenFile(filePath)}
                className="flex items-center gap-1 text-accent hover:underline cursor-pointer shrink-0 ml-2"
              >
                <FileCode2 size={11} /> Open
              </button>
            </div>
          )}
          {step.error && (
            <pre className="font-mono text-[11.5px] text-error bg-error/10 border border-error/20 p-2 rounded whitespace-pre-wrap break-all max-h-40 overflow-auto">
              {step.error}
            </pre>
          )}
          {step.output && !step.error && (
            <pre className="font-mono text-[11.5px] text-fg-muted bg-bg border border-border/60 p-2 rounded whitespace-pre-wrap break-all max-h-40 overflow-auto">
              {step.output}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

/** Inline workspace command / write approval prompt shown inside the active turn. */
function ConfirmCard({
  command,
  onConfirm
}: {
  command: string;
  onConfirm: (approved: boolean, allForRun?: boolean) => void;
}) {
  return (
    <div role="alertdialog" aria-label="The agent asks for permission" className="rounded-lg border border-warn/50 bg-warn/5 p-3 space-y-2">
      <div className="flex items-center gap-2 text-warn font-semibold text-xs">
        <TerminalSquare size={14} /> Allow this action in the workspace?
      </div>
      <pre className="font-mono text-[12px] text-fg bg-bg border border-border rounded p-2 whitespace-pre-wrap break-all max-h-32 overflow-auto">
        {command}
      </pre>
      <p className="text-[11.5px] text-fg-muted leading-relaxed">
        The agent proposed it; it may come from a file or a page it read. It runs with your user and the workspace as the current folder.
      </p>
      <div className="flex flex-wrap gap-1.5">
        <button type="button" className="btn-primary text-xs" onClick={() => onConfirm(true)}>
          <Check size={12} /> Allow once
        </button>
        <button
          type="button"
          className="btn-ghost text-xs"
          onClick={() => onConfirm(true, true)}
          title="Allow this and every later command of this turn without asking"
        >
          Allow all in turn
        </button>
        <button type="button" className="btn-ghost text-xs text-error" onClick={() => onConfirm(false)}>
          <XCircle size={12} /> Skip
        </button>
      </div>
    </div>
  );
}

/** Renders either a user prompt card or an assistant turn with collapsible reasoning, inline steps, confirmation, and markdown. */
function AssistantTurnItem({ turn }: { turn: AssistantTurn }) {
  const engine = useEngine();
  const assistant = engine.get<AssistantPlugin>("assistant");
  const [thoughtToggled, setThoughtToggled] = useState<boolean | undefined>(undefined);

  const openFile = (filePath: string) => {
    void engine.call("fileManager", "open", filePath).catch((e) => console.error(e));
  };

  if (turn.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[92%] rounded-xl border border-border/80 bg-bg-elev/80 px-3 py-2 text-fg space-y-1">
          {(turn.mode === "agent" || turn.attachedFile) && (
            <div className="flex items-center gap-1.5 text-[11px] text-fg-muted">
              <span className="inline-flex items-center gap-1 font-medium text-accent">
                {turn.mode === "agent" ? <Wand2 size={10} /> : <MessageSquare size={10} />}
                {turn.mode === "agent" ? "Agent" : "Ask"}
              </span>
              {turn.attachedFile && (
                <span className="inline-flex items-center gap-1 rounded bg-bg px-1.5 py-0.5 font-mono text-[10.5px]">
                  <Paperclip size={9} />
                  {turn.attachedFile.split("/").pop()}
                </span>
              )}
            </div>
          )}
          <div className="whitespace-pre-wrap break-words leading-relaxed">{turn.content}</div>
        </div>
      </div>
    );
  }

  const thoughts = turn.thoughts ?? [];
  const steps = turn.steps ?? [];
  const thoughtsAutoOpen = Boolean(turn.streaming && !turn.content && steps.length === 0);
  const thoughtsOpen = thoughtToggled !== undefined ? thoughtToggled : thoughtsAutoOpen;
  const duration = formatDuration(turn.startedAt, turn.endedAt);

  return (
    <div className="space-y-2.5">
      {thoughts.length > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setThoughtToggled(!thoughtsOpen)}
            className="inline-flex items-center gap-1.5 text-[11.5px] text-fg-muted hover:text-fg cursor-pointer transition-colors"
          >
            <Brain size={12} className={clsx(turn.streaming && thoughtsAutoOpen ? "text-accent animate-pulse" : "text-fg-muted")} />
            <span>{turn.streaming && thoughtsAutoOpen ? "Thinking…" : "Thought process"}</span>
            {thoughtsOpen ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
          </button>
          {thoughtsOpen && (
            <div className="mt-1.5 border-l-2 border-border pl-2.5 space-y-1 text-[11.5px] text-fg-muted leading-relaxed whitespace-pre-wrap">
              {thoughts.map((thought, idx) => (
                <div key={idx}>{thought}</div>
              ))}
            </div>
          )}
        </div>
      )}

      {steps.length > 0 && (
        <div className="rounded-lg border border-border/80 bg-bg-panel/40 divide-y divide-border/60 overflow-hidden">
          {steps.map((step, idx) => (
            <ToolStepRow key={step.id || idx} step={step} onOpenFile={openFile} />
          ))}
        </div>
      )}

      {turn.pendingConfirm && (
        <ConfirmCard
          command={turn.pendingConfirm.command}
          onConfirm={(approved, allForRun) => void assistant.answerConfirm(approved, allForRun)}
        />
      )}

      {turn.content ? (
        <Markdown text={turn.content} streaming={turn.streaming} />
      ) : turn.streaming && !turn.pendingConfirm && thoughts.length === 0 && steps.length === 0 ? (
        <div className="inline-flex items-center gap-1.5 text-fg-muted">
          <Loader2 size={12} className="animate-spin text-accent" />
          <span>{turn.mode === "agent" ? "Working…" : "Thinking…"}</span>
        </div>
      ) : null}

      {turn.error && (
        <div className="rounded-lg border border-error/40 bg-error/10 px-2.5 py-2 text-error whitespace-pre-wrap break-words">
          {turn.error}
        </div>
      )}

      {!turn.streaming && (steps.length > 0 || (duration && !turn.error) || (turn.ok === false && (!turn.error || steps.length > 0))) && (
        <div className="flex items-center gap-2 text-[11px] text-fg-muted pt-0.5">
          {turn.ok === false ? (
            <span className="inline-flex items-center gap-1 text-warn">
              <AlertCircle size={11} /> Stopped before completing
            </span>
          ) : (
            <span className="inline-flex items-center gap-1">
              <CheckCircle2 size={11} className="text-ok" /> Done
            </span>
          )}
          {steps.length > 0 && <span>· {steps.length} {steps.length === 1 ? "tool" : "tools"}</span>}
          {duration && <span>· {duration}</span>}
        </div>
      )}
    </div>
  );
}

/** Small markdown subset: fenced code (with actions), inline code, bold, bullet lines. */
function Markdown({ text, streaming }: { text: string; streaming?: boolean }) {
  const parts = text.split(/(```[^\n]*\n[\s\S]*?(?:```|$))/g).filter((p) => p !== "");
  return (
    <div className="space-y-2 text-fg leading-relaxed">
      {parts.map((p, i) => {
        const m = /^```([^\n]*)\n([\s\S]*?)(```)?$/.exec(p);
        if (m) return <CodeBlock key={i} lang={m[1].trim()} code={m[2].replace(/\n$/, "")} complete={Boolean(m[3]) || !streaming} />;
        return (
          <div key={i} className="whitespace-pre-wrap break-words">
            {renderInline(p.trim())}
          </div>
        );
      })}
    </div>
  );
}

function renderInline(s: string) {
  return s.split(/(`[^`\n]+`|\*\*[^*\n]+\*\*)/g).map((t, i) => {
    if (t.startsWith("`") && t.endsWith("`") && t.length > 2) return <code key={i} className="rounded bg-bg-elev px-1 py-0.5 font-mono text-[12px] text-accent">{t.slice(1, -1)}</code>;
    if (t.startsWith("**") && t.endsWith("**") && t.length > 4) return <strong key={i}>{t.slice(2, -2)}</strong>;
    return <Fragment key={i}>{t}</Fragment>;
  });
}

function CodeBlock({ lang, code, complete }: { lang: string; code: string; complete: boolean }) {
  const engine = useEngine();
  const [copied, setCopied] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const noteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isSil = /^(silver|sil)/i.test(lang) || /pragma\s+silverscript/.test(code);

  useEffect(() => {
    return () => {
      if (noteTimerRef.current) clearTimeout(noteTimerRef.current);
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    };
  }, []);

  const say = (t: string) => {
    setNote(t);
    if (noteTimerRef.current) clearTimeout(noteTimerRef.current);
    noteTimerRef.current = setTimeout(() => setNote(null), 2200);
  };
  const copy = async () => {
    setCopied(await copyText(code));
    if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    copyTimerRef.current = setTimeout(() => setCopied(false), 1500);
  };
  const insert = () => {
    const ok = engine.get<EditorPlugin>("editor").insertText(code);
    say(ok ? "Inserted at the cursor" : "Open a file in the editor first");
  };
  const save = async () => {
    const suggested = isSil ? "contracts/assistant.sil" : /^(bash|sh|shell|powershell|ps1)/i.test(lang) ? "scripts/assistant.sh" : "assistant-snippet.txt";
    const path = await promptDialog("Save this code as (path inside the project):", suggested, { title: "Save code snippet", confirmLabel: "Save" });
    if (!path) return;
    try {
      await engine.call("fileManager", "createFile", path, code + "\n");
      say(`Saved ${path}`);
    } catch (e) {
      say(e instanceof IdeApiError ? e.message : String(e));
    }
  };

  return (
    <div className="rounded border border-border bg-bg overflow-hidden">
      <div className="flex items-center gap-1 px-2 py-1 border-b border-border bg-bg-elev text-[12px] text-fg-muted">
        <span className="uppercase tracking-wide">{lang || "code"}</span>
        {note && <span className="text-accent ml-1">{note}</span>}
        <span className="ml-auto flex items-center gap-0.5">
          <button type="button" onClick={() => void copy()} className="p-1 rounded hover:text-fg hover:bg-bg-hover cursor-pointer" title="Copy" aria-label="Copy code">
            {copied ? <Check size={12} className="text-ok" /> : <Copy size={12} />}
          </button>
          {complete && (
            <>
              <button type="button" onClick={insert} className="p-1 rounded hover:text-fg hover:bg-bg-hover cursor-pointer" title="Insert at the cursor in the editor" aria-label="Insert code into the editor">
                <TextCursorInput size={12} />
              </button>
              <button type="button" onClick={() => void save()} className="p-1 rounded hover:text-fg hover:bg-bg-hover cursor-pointer" title="Save as a new file" aria-label="Save code as a file">
                <FilePlus2 size={12} />
              </button>
            </>
          )}
        </span>
      </div>
      <pre className="overflow-auto px-2 py-1.5 font-mono text-[12px] leading-relaxed max-h-72">{code}</pre>
    </div>
  );
}

function accountName(target: string): string {
  return target === "openai" ? "ChatGPT" : target === "opencode" ? "OpenCode" : target;
}

function OAuthSignInSection({
  target,
  title,
  subtitle,
  buttonLabel,
  installed,
  connectedAccount,
  blockingAccount,
  onConnected,
  onLoggedOut
}: {
  target: "opencode" | "openai";
  title: string;
  subtitle: string;
  buttonLabel: string;
  installed: boolean;
  connectedAccount?: AssistantAuthAccount;
  blockingAccount?: AssistantAuthAccount;
  onConnected: (models: string[]) => void;
  onLoggedOut: (loggedOutTarget: "opencode" | "openai") => void;
}) {
  const engine = useEngine();
  const assistant = engine.get<AssistantPlugin>("assistant");
  const [session, setSession] = useState<AssistantAuthSession | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setSession(null);
    setError(null);
    setBusy(false);
  }, [target]);

  useEffect(() => {
    if (!session || (session.status !== "starting" && session.status !== "pending")) return;
    let cancelled = false;
    const timer = setInterval(() => {
      void api.assistant
        .pollAuthLogin(session.id)
        .then(async (next) => {
          if (cancelled) return;
          setSession(next);
          if (next.status === "succeeded") {
            await assistant.refreshAuth(true);
            onConnected(useAssistant.getState().auth?.models ?? []);
          } else if (next.status === "failed") {
            setError(next.error ?? "Login failed.");
          }
        })
        .catch(() => undefined);
    }, 1800);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [session, assistant, onConnected]);

  const start = async () => {
    if (blockingAccount) return;
    setBusy(true);
    setError(null);
    try {
      const s = await api.assistant.startAuthLogin(target);
      setSession(s);
      if (s.status === "succeeded") {
        await assistant.refreshAuth(true);
        onConnected(useAssistant.getState().auth?.models ?? []);
      } else if (s.status === "failed") {
        setError(s.error ?? "Login failed.");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const openAndCopy = async () => {
    if (!session) return;
    if (session.code) {
      setCopied(await copyText(session.code));
      setTimeout(() => setCopied(false), 2000);
    }
    if (session.url) window.open(session.url, "_blank", "noopener,noreferrer");
  };

  const cancel = async () => {
    if (!session) return;
    await api.assistant.cancelAuthLogin(session.id).catch(() => undefined);
    setSession(null);
  };

  const logout = async (logoutTarget: "opencode" | "openai" = target) => {
    setBusy(true);
    setError(null);
    try {
      const status = await api.assistant.logoutAuth(logoutTarget);
      useAssistant.getState().setAuth({ installed: status.installed, accounts: status.accounts, models: status.models });
      onLoggedOut(logoutTarget);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const waiting = session && (session.status === "starting" || session.status === "pending");
  const blocked = !connectedAccount && Boolean(blockingAccount);
  const blockerLabel = blockingAccount ? accountName(blockingAccount.target) : "";

  return (
    <div className="rounded-lg border border-border bg-bg p-2.5 sm:p-3 space-y-2.5">
      <div className="flex flex-wrap items-start justify-between gap-2.5">
        <div className="flex items-start gap-2.5 min-w-0 flex-1 basis-[150px]">
          <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border bg-bg-panel/80 text-fg">
            <ProviderIcon provider={target} size={15} colored />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5 text-xs font-semibold text-fg">
              <span>{title}</span>
              {connectedAccount && (
                <span className="inline-flex items-center gap-1 rounded-full bg-ok/15 border border-ok/35 px-2 py-0.5 text-[10.5px] font-medium text-ok">
                  <Check size={10} /> Signed in
                </span>
              )}
            </div>
            <p className="text-[11px] text-fg-muted mt-0.5 leading-relaxed">{subtitle}</p>
          </div>
        </div>
        {connectedAccount ? (
          <button type="button" className="btn-ghost text-xs shrink-0" disabled={busy} onClick={() => void logout(target)}>
            <LogOut size={12} /> Sign out
          </button>
        ) : !waiting ? (
          <button
            type="button"
            className="btn-primary text-xs shrink-0"
            disabled={busy || !installed || blocked}
            onClick={() => void start()}
            title={!installed ? "OpenCode CLI is not installed" : blocked ? `Sign out of ${blockerLabel} first` : undefined}
          >
            {busy ? <Loader2 size={12} className="animate-spin" /> : <ProviderIcon provider={target} size={13} />} {buttonLabel}
          </button>
        ) : null}
      </div>

      {connectedAccount && connectedAccount.label !== target && (
        <div className="text-[11px] text-fg-muted font-mono truncate">Account: {connectedAccount.label}</div>
      )}

      {blocked && blockingAccount && (
        <div role="status" className="rounded-md border border-warn/40 bg-warn/10 px-2.5 py-2 flex flex-wrap items-center justify-between gap-2 text-[11px]">
          <span className="text-warn">
            Signed in to <strong>{blockerLabel}</strong>. Sign out first to sign in here.
          </span>
          {(blockingAccount.target === "opencode" || blockingAccount.target === "openai") && (
            <button
              type="button"
              className="btn-ghost border border-warn/40 text-xs px-2 py-0.5 text-fg hover:bg-warn/15 shrink-0"
              disabled={busy}
              onClick={() => void logout(blockingAccount.target as "opencode" | "openai")}
            >
              <LogOut size={11} /> Sign out of {blockerLabel}
            </button>
          )}
        </div>
      )}

      {waiting && (
        <div className="rounded-md border border-accent/40 bg-accent/5 p-2.5 space-y-2">
          <div className="flex items-center gap-2 text-[11.5px] text-fg">
            <Loader2 size={12} className="animate-spin text-accent shrink-0" />
            <span>
              {session.code
                ? "Complete sign-in in your browser using this code:"
                : "Finish signing in via the browser window (or click below if it didn't open):"}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {session.code && (
              <code className="rounded border border-border bg-bg-panel px-2.5 py-1 font-mono text-xs font-bold tracking-wider text-accent select-all">
                {session.code}
              </code>
            )}
            {session.url && (
              <button type="button" className="btn-primary text-xs" onClick={() => void openAndCopy()}>
                <ExternalLink size={12} /> {copied ? "Code copied · Opening…" : session.code ? "Copy code & open login" : "Open login page"}
              </button>
            )}
            <button type="button" className="btn-ghost text-xs ml-auto" onClick={() => void cancel()}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {error && <div role="alert" className="text-[11px] text-error break-words">{error}</div>}
    </div>
  );
}

function Settings({ onClose }: { onClose: () => void }) {
  const engine = useEngine();
  const assistant = engine.get<AssistantPlugin>("assistant");
  const config = useAssistant((s) => s.config);
  const auth = useAssistant((s) => s.auth);
  const defaults = useAssistant((s) => s.defaults);
  const keyCommands = useAssistant((s) => s.keyCommands);
  const keyStates = useAssistant((s) => s.keyStates);
  const [provider, setProvider] = useState<"opencode" | "anthropic" | "openai">(config?.provider ?? "opencode");
  const [openaiMode, setOpenaiMode] = useState<"oauth" | "api">(config?.openaiAuthMode === "oauth" ? "oauth" : "api");
  const [baseUrl, setBaseUrl] = useState(config?.baseUrl ?? "");
  const [model, setModel] = useState(config?.model ?? "");
  const [docs, setDocs] = useState<"off" | "core" | "full">(config?.docs ?? "core");
  const [apiKey, setApiKey] = useState("");
  const [showAnthropicUrl, setShowAnthropicUrl] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [copiedCmd, setCopiedCmd] = useState(false);
  const [refreshingKey, setRefreshingKey] = useState(false);
  const [refreshingModels, setRefreshingModels] = useState(false);
  const [autoFallback, setAutoFallback] = useState<boolean>(config?.opencodeAutoFallback !== false);
  const [resettingCooldowns, setResettingCooldowns] = useState(false);
  const [docsInfo, setDocsInfo] = useState<string>("");
  const { now: cooldownNow, activeCooldowns, cooldownByModel } = useCooldownTicker(auth?.cooldowns, () => void assistant.refreshAuth(false));

  useEffect(() => {
    void assistant.refreshConfig(false);
  }, [assistant]);

  useEffect(() => {
    if (provider !== "anthropic") return;
    const onFocus = () => void assistant.refreshConfig(false);
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [provider, assistant]);

  useEffect(() => {
    if (docs === "off") {
      setDocsInfo("No Kaspa docs are added to the prompt.");
      return;
    }
    let cancelled = false;
    setDocsInfo("checking docs.kaspa.org…");
    api.assistant
      .docs(docs)
      .then((d) => !cancelled && setDocsInfo(`${d.mode === "full" ? "Full corpus" : "Core pack"}: ~${d.approxTokens.toLocaleString()} tokens per question${d.stale ? " (cached copy, docs.kaspa.org unreachable)" : ""}`))
      .catch((e: unknown) => !cancelled && setDocsInfo(e instanceof Error ? e.message : "docs.kaspa.org unreachable"));
    return () => {
      cancelled = true;
    };
  }, [docs]);

  // Read per-provider key status so Anthropic shows OS keyring / env state even before saving provider switch.
  const sameProvider = config?.provider === provider;
  const envName = provider === "anthropic" ? "ANTHROPIC_API_KEY" : "OPENAI_API_KEY";
  const resolvedKeyInfo =
    provider === "anthropic"
      ? keyStates?.anthropic ?? (sameProvider ? config : null)
      : provider === "openai"
        ? keyStates?.openai ?? (sameProvider ? config : null)
        : null;
  const keyState = !resolvedKeyInfo
    ? null
    : resolvedKeyInfo.keySource === "env"
      ? { text: `from ${envName}${resolvedKeyInfo.keyHint ? ` (${resolvedKeyInfo.keyHint})` : ""}`, warn: false }
      : resolvedKeyInfo.keySource === "keychain"
        ? { text: `saved ${resolvedKeyInfo.keyHint}`, warn: false }
        : resolvedKeyInfo.keySource === "file"
          ? { text: "still in a settings file: reset via command or set the variable", warn: true }
          : null;

  const trimmedBase = baseUrl.trim().replace(/\/+$/, "");
  const defaultAnthropicUrl = defaults?.anthropic.baseUrl ?? "https://api.anthropic.com";
  const isWinPlatform = typeof navigator !== "undefined" ? /win/i.test(navigator.platform || navigator.userAgent) : false;
  const fallbackKeyCmd = isWinPlatform ? 'setx ANTHROPIC_API_KEY "sk-ant-..."' : 'export ANTHROPIC_API_KEY="sk-ant-..."';
  const baseKeyCmd = keyCommands?.anthropic.command ?? fallbackKeyCmd;
  const hasCustomAnthropicUrl = Boolean(trimmedBase && trimmedBase !== defaultAnthropicUrl);
  const baseUrlCmd = hasCustomAnthropicUrl
    ? (keyCommands?.anthropic.liveDetection ?? isWinPlatform)
      ? `setx ANTHROPIC_BASE_URL "${trimmedBase}"`
      : `export ANTHROPIC_BASE_URL="${trimmedBase}"`
    : "";
  const anthropicCommand = baseUrlCmd ? `${baseKeyCmd}\n${baseUrlCmd}` : baseKeyCmd;
  const supportsLiveEnvDetection = keyCommands?.anthropic.liveDetection ?? isWinPlatform;

  const openCodeAcct = auth?.accounts.find((a) => a.target === "opencode");
  const openAiAcct = auth?.accounts.find((a) => a.target === "openai");

  const pickProvider = (p: "opencode" | "anthropic" | "openai") => {
    setProvider(p);
    setMsg(null);
    if (p === "openai") {
      // Default to ChatGPT browser login when already signed in or when no custom local endpoint is saved.
      const nextMode = config?.provider === "openai" && config.openaiAuthMode ? config.openaiAuthMode : openAiAcct || !config?.hasKey ? "oauth" : "api";
      setOpenaiMode(nextMode);
    }
    if (defaults) {
      setBaseUrl(defaults[p].baseUrl);
      if (p === "openai" && (openAiAcct || (config?.provider === "openai" && config.openaiAuthMode === "oauth"))) {
        const firstOai = (auth?.models ?? []).find((m) => m.startsWith("openai/"));
        setModel(firstOai ?? "");
      } else {
        setModel(defaults[p].model);
      }
    }
  };

  const save = async (extra?: { clearKey?: boolean; overrideModel?: string; overrideOpenaiMode?: "oauth" | "api" }) => {
    try {
      const nextOpenaiMode = extra?.overrideOpenaiMode ?? openaiMode;
      const nextModel = (extra?.overrideModel ?? model).trim();
      if (provider === "openai" && nextOpenaiMode === "oauth" && !/^openai\/\S+$/i.test(nextModel)) {
        setMsg("Pick or enter an openai/… model id first so ChatGPT never falls back to OpenCode's default model.");
        return;
      }
      const saved = await api.assistant.saveConfig({
        provider,
        baseUrl,
        model: nextModel,
        docs,
        ...(provider === "opencode" ? { opencodeAutoFallback: autoFallback } : {}),
        ...(provider === "openai" ? { openaiAuthMode: nextOpenaiMode } : {}),
        ...(usesKeyInput && apiKey ? { apiKey } : {}),
        ...(extra?.clearKey ? { clearKey: true } : {})
      });
      setApiKey("");
      useAssistant.getState().setConfig(saved);
      setMsg(extra?.clearKey ? "API key removed" : "Saved");
      await assistant.refreshConfig();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    }
  };

  const testKey = async () => {
    if (provider === "opencode") return;
    setTesting(true);
    setMsg(null);
    try {
      const res = await api.assistant.testConnection({
        provider,
        baseUrl,
        ...(provider === "openai" && apiKey ? { apiKey } : {})
      });
      setMsg(res.ok ? `✓ ${res.message}` : `✕ ${res.message}`);
    } catch (e) {
      setMsg(`✕ ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setTesting(false);
    }
  };

  const refreshKeyStatus = async () => {
    setRefreshingKey(true);
    await assistant.refreshConfig(false);
    setRefreshingKey(false);
  };

  const copyCommand = async () => {
    if (await copyText(anthropicCommand)) {
      setCopiedCmd(true);
      setTimeout(() => setCopiedCmd(false), 1600);
    }
  };

  const openKeyTerminal = () => {
    useScripts.getState().openShellTerminal();
    setMsg(`Terminal opened below — run the ${supportsLiveEnvDetection ? "setx" : "export"} command with your key, then click Refresh.`);
  };

  const refreshModels = async () => {
    setRefreshingModels(true);
    await assistant.refreshAuth(true);
    setRefreshingModels(false);
  };

  const resetAllCooldowns = async () => {
    setResettingCooldowns(true);
    await assistant.clearCooldowns();
    setResettingCooldowns(false);
    setMsg("Rate-limit cooldown timers cleared");
  };

  const rankedOpenCode = buildRankedOpenCodeList(auth);
  const bestReadyFree = rankedOpenCode.find((m) => !cooldownByModel.has(m.id.toLowerCase())) ?? rankedOpenCode[0];
  const liveOpenAiOAuthModels = (auth?.models ?? []).filter((m) => m.startsWith("openai/"));

  const suggestions =
    provider === "opencode"
      ? rankedOpenCode.map((m) => m.id)
      : provider === "anthropic"
        ? ["claude-sonnet-5-5", "claude-opus-5-5", "claude-haiku-5-5"]
        : openaiMode === "oauth"
          ? liveOpenAiOAuthModels.slice(0, 6)
          : ["llama3.2", "qwen2.5-coder", "gpt-4.1"];

  const usesKeyInput = provider === "openai" && openaiMode === "api";
  const usesDocsContext = provider === "anthropic" || usesKeyInput;
  const canRemoveKey =
    (provider === "anthropic" || usesKeyInput) &&
    (resolvedKeyInfo?.keySource === "keychain" || resolvedKeyInfo?.keySource === "file");

  return (
    <div className="flex-1 min-h-0 overflow-auto p-2.5 sm:p-5">
      <div className="max-w-lg mx-auto w-full rounded-xl border border-border bg-bg-panel/80 p-3 sm:p-4 space-y-3 sm:space-y-4 shadow-sm">
        <div className="flex items-start justify-between gap-3 border-b border-border/70 pb-3">
          <div>
            <h3 className="text-[13px] font-semibold text-fg">Model &amp; Provider Settings</h3>
            <p className="text-[11.5px] text-fg-muted mt-0.5">Sign in with an account or configure an API key / local endpoint.</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close settings"
            className="p-1 rounded text-fg-muted hover:text-fg hover:bg-bg-hover cursor-pointer shrink-0"
          >
            <X size={14} />
          </button>
        </div>

        <div className="space-y-1.5">
          <div className="label">Provider</div>
          <div role="tablist" aria-label="AI provider" className="inline-flex flex-wrap gap-1 rounded-lg border border-border bg-bg p-1 w-full sm:w-auto">
            {(["opencode", "openai", "anthropic"] as const).map((p) => (
              <button
                key={p}
                type="button"
                role="tab"
                aria-selected={provider === p}
                onClick={() => pickProvider(p)}
                className={clsx(
                  "inline-flex flex-1 sm:flex-initial items-center justify-center gap-1.5 rounded-md px-3 py-1 text-[11.5px] font-medium cursor-pointer transition-colors",
                  provider === p ? "bg-accent/15 text-accent border border-accent/40" : "text-fg-muted hover:text-fg hover:bg-bg-hover/60 border border-transparent"
                )}
              >
                <ProviderIcon provider={p} size={13} colored={provider !== p} />
                <span>{p === "opencode" ? "OpenCode" : p === "openai" ? "ChatGPT / OpenAI" : "Claude (Anthropic)"}</span>
              </button>
            ))}
          </div>
        </div>

        {provider === "opencode" && (
          <OAuthSignInSection
            target="opencode"
            title="OpenCode Account"
            subtitle="Free zero-retention models work right away. Sign in with OpenCode to connect your account for higher limits."
            buttonLabel="Sign in"
            installed={auth?.installed ?? true}
            connectedAccount={openCodeAcct}
            blockingAccount={openAiAcct}
            onConnected={(models) => {
              const first = models.find((m) => m.startsWith("opencode/"));
              if (first && !model) setModel(first);
              void save({ overrideModel: model || first });
            }}
            onLoggedOut={(loggedOut) => setMsg(`Signed out of ${accountName(loggedOut)}`)}
          />
        )}

        {provider === "openai" && (
          <div className="space-y-3">
            <div className="inline-flex rounded-lg border border-border bg-bg p-0.5 text-[11px]">
              {(
                [
                  { id: "oauth", label: "ChatGPT Login (no API key)" },
                  { id: "api", label: "API Key / Local (Ollama)" }
                ] as const
              ).map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => {
                    setOpenaiMode(m.id);
                    setMsg(null);
                  }}
                  className={clsx(
                    "rounded-md px-2.5 py-1 font-medium cursor-pointer transition-colors",
                    openaiMode === m.id ? "bg-bg-elev text-fg" : "text-fg-muted hover:text-fg"
                  )}
                >
                  {m.label}
                </button>
              ))}
            </div>

            {openaiMode === "oauth" && (
              <OAuthSignInSection
                target="openai"
                title="ChatGPT Account"
                subtitle="Uses your ChatGPT Plus / Pro subscription via OpenAI browser login — no API key required."
                buttonLabel="Sign in"
                installed={auth?.installed ?? true}
                connectedAccount={openAiAcct}
                blockingAccount={openCodeAcct}
                onConnected={(models) => {
                  const first = models.find((m) => m.startsWith("openai/")) ?? "";
                  const nextModel = model.startsWith("openai/") ? model : first;
                  if (nextModel) {
                    setModel(nextModel);
                    void save({ overrideModel: nextModel, overrideOpenaiMode: "oauth" });
                  } else {
                    setMsg("Signed in with ChatGPT. Click Refresh models or enter an openai/… model id, then click Save.");
                  }
                }}
                onLoggedOut={(loggedOut) => {
                  setMsg(`Signed out of ${accountName(loggedOut)}`);
                  if (loggedOut === "openai") void save({ overrideOpenaiMode: "api" });
                }}
              />
            )}
          </div>
        )}

        {provider === "anthropic" && (
          <div className="rounded-lg border border-border bg-bg p-3 flex items-start gap-2.5 text-[11.5px]">
            <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-[#D97757]/35 bg-[#D97757]/10">
              <ProviderIcon provider="anthropic" size={15} colored />
            </div>
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
                <span className="font-semibold text-fg leading-snug">API key required by Anthropic</span>
                <a
                  href="https://console.anthropic.com/settings/keys"
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-accent hover:underline shrink-0"
                >
                  Get API key <ExternalLink size={11} />
                </a>
              </div>
              <p className="text-[11px] text-fg-muted leading-relaxed">
                Anthropic does not permit personal Claude.ai logins in third-party IDEs. Set the <code className="font-mono text-fg">ANTHROPIC_API_KEY</code> environment variable via terminal command below — HardKas IDE detects it automatically.
              </p>
            </div>
          </div>
        )}

        {((provider === "openai" && openaiMode === "api") || (provider === "anthropic" && showAnthropicUrl)) && (
          <div className="space-y-1">
            <label htmlFor="assistant-base-url" className="label">Base URL</label>
            <input
              id="assistant-base-url"
              className="input font-mono w-full"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              spellCheck={false}
            />
          </div>
        )}

        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <label htmlFor="assistant-model-input" className="label flex items-center gap-1.5">
              <span>Model</span>
              {provider === "opencode" && rankedOpenCode.length > 0 && (
                <span className="normal-case tracking-normal font-normal text-[10.5px] text-fg-muted">
                  ({rankedOpenCode.length} free · best → lightest)
                </span>
              )}
            </label>
            {(provider === "opencode" || (provider === "openai" && openaiMode === "oauth")) && (
              <button
                type="button"
                onClick={() => void refreshModels()}
                disabled={refreshingModels}
                className="inline-flex items-center gap-1 text-[11px] text-fg-muted hover:text-fg cursor-pointer"
                title="Refresh available OpenCode models"
              >
                <RefreshCw size={10} className={refreshingModels ? "animate-spin" : ""} /> Refresh models
              </button>
            )}
          </div>
          <input
            id="assistant-model-input"
            className="input font-mono w-full"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            spellCheck={false}
            placeholder={provider === "openai" && openaiMode === "oauth" ? "openai/gpt-5.1-codex (required)" : "model id"}
          />
          {provider === "opencode" ? (
            <div className="space-y-2 pt-0.5">
              <div className="flex flex-wrap gap-1.5">
                <button
                  type="button"
                  onClick={() => setModel("opencode/auto")}
                  className={clsx(
                    "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-[11px] cursor-pointer transition-colors",
                    model.trim() === "opencode/auto"
                      ? "border-accent/60 bg-accent/15 text-accent font-medium"
                      : "border-border bg-bg text-fg-muted hover:text-fg hover:border-fg-muted/40"
                  )}
                  title={
                    bestReadyFree
                      ? `Always use highest-capability ready free model (currently #${bestReadyFree.rank} ${bestReadyFree.shortId}) and auto-restore top models on reset`
                      : "Automatically pick the strongest available free model"
                  }
                >
                  <Sparkles size={10} className="shrink-0 text-accent" />
                  <span>auto</span>
                  {bestReadyFree && (
                    <span className="text-[10px] opacity-80">→ #{bestReadyFree.rank} {bestReadyFree.shortId}</span>
                  )}
                </button>
                {rankedOpenCode.map((item) => {
                  const selected = model.trim() === item.id;
                  const cd = cooldownByModel.get(item.id.toLowerCase());
                  const ctxText = item.contextWindow
                    ? item.contextWindow >= 1_000_000
                      ? `${Math.round(item.contextWindow / 100_000) / 10}M ctx`
                      : `${Math.round(item.contextWindow / 1000)}K ctx`
                    : "";
                  const tip = [
                    `#${item.rank} ${item.name} · ${item.tier.toUpperCase()}${ctxText ? ` · ${ctxText}` : ""}`,
                    item.summary,
                    cd ? `Cooldown: ${cd.reason} · resets in ${formatResetShort(cd.retryAt, cooldownNow)}` : "Ready"
                  ].join("\n");
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setModel(item.id)}
                      className={clsx(
                        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-[11px] cursor-pointer transition-colors",
                        selected
                          ? "border-accent/60 bg-accent/15 text-accent"
                          : cd
                            ? "border-warn/40 bg-warn/10 text-warn/90 hover:border-warn/60"
                            : "border-border bg-bg text-fg-muted hover:text-fg hover:border-fg-muted/40"
                      )}
                      title={tip}
                    >
                      <span className="text-[10px] opacity-70">#{item.rank}</span>
                      <span>{item.shortId}</span>
                      {cd && (
                        <span className="inline-flex items-center gap-0.5 text-[10px] text-warn tabular-nums">
                          <Clock size={9} />
                          {formatResetShort(cd.retryAt, cooldownNow)}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>

              <label className="flex items-center gap-2 text-[11px] text-fg-muted cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={autoFallback}
                  onChange={(e) => setAutoFallback(e.target.checked)}
                  className="accent-[var(--accent)] rounded"
                />
                <span>Auto-switch to best available free model on rate limit &amp; restore on reset</span>
              </label>

              {activeCooldowns.length > 0 && (
                <div className="rounded border border-warn/40 bg-warn/10 px-2.5 py-1.5 flex flex-wrap items-center justify-between gap-2 text-[11px] text-warn">
                  <span className="inline-flex items-center gap-1.5 tabular-nums">
                    <Clock size={11} className="shrink-0" />
                    <span>
                      {activeCooldowns.length} {activeCooldowns.length === 1 ? "model" : "models"} cooling down
                      {bestReadyFree ? ` · active best: #${bestReadyFree.rank} ${bestReadyFree.shortId}` : ""}
                    </span>
                  </span>
                  <button
                    type="button"
                    onClick={() => void resetAllCooldowns()}
                    disabled={resettingCooldowns}
                    className="underline underline-offset-2 hover:text-fg cursor-pointer shrink-0"
                  >
                    {resettingCooldowns ? "Resetting…" : "Reset timers"}
                  </button>
                </div>
              )}
            </div>
          ) : (
            suggestions.length > 0 && (
              <div className="flex flex-wrap gap-1.5 pt-0.5">
                {suggestions.map((s) => {
                  const short = s.split("/").pop() ?? s;
                  const selected = model.trim() === s;
                  return (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setModel(s)}
                      className={clsx(
                        "rounded-full border px-2 py-0.5 font-mono text-[11px] cursor-pointer transition-colors",
                        selected ? "border-accent/60 bg-accent/15 text-accent" : "border-border bg-bg text-fg-muted hover:text-fg hover:border-fg-muted/40"
                      )}
                      title={s}
                    >
                      {short}
                    </button>
                  );
                })}
              </div>
            )
          )}
        </div>

        {provider === "anthropic" && (
          <div className="space-y-2">
            <div className="label flex flex-wrap items-center justify-between gap-2">
              <span>Environment variable (ANTHROPIC_API_KEY)</span>
              {keyState ? (
                <span className={clsx("normal-case tracking-normal font-mono text-[11px]", keyState.warn ? "text-warn" : "text-ok")}>
                  {keyState.text}
                </span>
              ) : (
                <span className="normal-case tracking-normal text-[11px] text-fg-muted">not configured</span>
              )}
            </div>

            <div className="rounded-lg border border-border bg-bg p-2.5 space-y-2">
              <div className="text-[11px] text-fg-muted">
                {supportsLiveEnvDetection
                  ? 'Replace "sk-ant-..." with your API key and run this command in any terminal (detected automatically without restarting):'
                  : 'Replace "sk-ant-..." with your API key and export it in your shell before launching HardKas IDE:'}
              </div>
              <pre
                aria-label="Anthropic API key command"
                className="rounded border border-border/80 bg-bg-panel px-2.5 py-1.5 font-mono text-[11px] text-fg whitespace-pre-wrap break-all select-all"
              >
                {anthropicCommand}
              </pre>
              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => void copyCommand()}
                  className="btn-primary px-2.5 py-1 text-[11px] font-medium"
                  title="Copy command to clipboard"
                >
                  {copiedCmd ? <Check size={11} /> : <Copy size={11} />}
                  {copiedCmd ? "Copied" : "Copy command"}
                </button>
                <button
                  type="button"
                  onClick={openKeyTerminal}
                  className="btn-ghost border border-border px-2.5 py-1 text-[11px]"
                  title="Open an integrated Terminal tab below"
                >
                  <Terminal size={11} /> Open Terminal
                </button>
                <button
                  type="button"
                  onClick={() => void refreshKeyStatus()}
                  disabled={refreshingKey}
                  className="btn-ghost border border-border px-2.5 py-1 text-[11px]"
                  title="Re-check ANTHROPIC_API_KEY environment variable"
                >
                  <RefreshCw size={11} className={refreshingKey ? "animate-spin" : ""} /> Refresh
                </button>
                <button
                  type="button"
                  className="btn-ghost border border-border px-2.5 py-1 text-[11px]"
                  disabled={testing}
                  onClick={() => void testKey()}
                  title="Verify the detected ANTHROPIC_API_KEY connection"
                >
                  {testing ? <Loader2 size={11} className="animate-spin" /> : "Test"}
                </button>
              </div>
            </div>

            <div className="flex items-center justify-between gap-2 text-[11px] text-fg-muted">
              <span>
                Bound to <code className="font-mono">{resolvedKeyInfo?.keyBoundTo ? resolvedKeyInfo.keyBoundTo : "this host"}</code>
              </span>
              <button type="button" className="text-accent hover:underline cursor-pointer shrink-0" onClick={() => setShowAnthropicUrl(!showAnthropicUrl)}>
                {showAnthropicUrl ? "Hide URL" : "Custom URL"}
              </button>
            </div>
          </div>
        )}

        {usesKeyInput && (
          <div className="space-y-1.5">
            <div className="label flex items-center justify-between">
              <label htmlFor="assistant-api-key">API key</label>
              {keyState && <span className={clsx("normal-case tracking-normal", keyState.warn ? "text-warn" : "text-ok")}>{keyState.text}</span>}
            </div>
            {sameProvider && config?.keySource === "env" ? (
              <div className="text-[11.5px] text-fg-muted">
                Using <code className="font-mono">{envName}</code> from environment. Unset it to manage the key here.
              </div>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                <input
                  id="assistant-api-key"
                  className="input font-mono flex-1 min-w-[140px]"
                  type="password"
                  autoComplete="off"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder={sameProvider && config?.hasKey ? "leave empty to keep saved key" : "paste API key (optional for Ollama / LM Studio)"}
                />
                <button
                  type="button"
                  className="btn-ghost border border-border px-2.5 text-xs shrink-0"
                  disabled={testing}
                  onClick={() => void testKey()}
                  title="Verify API key / endpoint connection"
                >
                  {testing ? <Loader2 size={12} className="animate-spin" /> : "Test"}
                </button>
              </div>
            )}
            <div className="flex items-center justify-between gap-2 text-[11px] text-fg-muted">
              <span>
                Stored in OS keyring · bound to <code className="font-mono">{sameProvider && config?.keyBoundTo ? config.keyBoundTo : "this host"}</code>
              </span>
            </div>
          </div>
        )}

        {usesDocsContext && (
          <div className="space-y-1">
            <label htmlFor="assistant-docs-mode" className="label flex items-center gap-1">
              <BookOpen size={11} /> Kaspa docs context
            </label>
            <select
              id="assistant-docs-mode"
              className="input w-full"
              value={docs}
              onChange={(e) => setDocs(e.target.value as typeof docs)}
            >
              <option value="core">Core pack: Agent Brief, SilverScript, getting started</option>
              <option value="full">Full docs corpus (larger context)</option>
              <option value="off">Off</option>
            </select>
            <div className="text-[11px] text-fg-muted">{docsInfo}</div>
          </div>
        )}

        {msg && <div className={clsx("text-[11.5px] font-medium", msg.startsWith("✕") ? "text-error" : "text-accent")}>{msg}</div>}

        <div className="border-t border-border/70 pt-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1.5">
            {canRemoveKey && (
              <button
                type="button"
                className="btn-ghost text-fg-muted hover:text-error px-2.5 py-1 text-xs"
                onClick={() => void save({ clearKey: true })}
                title="Delete the saved key"
              >
                Remove key
              </button>
            )}
            {provider === "opencode" && config?.opencodeConsent && (
              <button
                type="button"
                className="btn-ghost text-fg-muted hover:text-error px-2.5 py-1 text-xs"
                onClick={() => void api.assistant.saveConfig({ opencodeConsent: false }).then((c) => useAssistant.getState().setConfig(c))}
                title="Stop sending anything to OpenCode until you turn it on again"
              >
                Disable OpenCode
              </button>
            )}
          </div>

          <div className="flex items-center gap-2 ml-auto">
            <button type="button" className="btn-ghost border border-border px-3.5 py-1 text-xs" onClick={onClose}>
              Close
            </button>
            <button type="button" className="btn-primary px-4 py-1 text-xs font-semibold" onClick={() => void save()}>
              Save
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
