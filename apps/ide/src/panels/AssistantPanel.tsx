import clsx from "clsx";
import {
  AlertCircle,
  ArrowUp,
  BookOpen,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Coins,
  Copy,
  ExternalLink,
  FileCode2,
  FilePlus2,
  TerminalSquare,
  KeyRound,
  Loader2,
  MessageSquare,
  Paperclip,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  Square,
  TextCursorInput,
  Trash2,
  Wand2,
  XCircle
} from "lucide-react";
import { Fragment, useEffect, useRef, useState } from "react";
import { api, IdeApiError } from "@/api/client";
import { useEngine } from "@/engine/context";
import type { AssistantPlugin } from "@/plugins/assistant";
import type { EditorPlugin } from "@/plugins/editor";
import { useAssistant, type ChatTurn, type AgentRun } from "@/store/assistant";
import { envOf, useIde } from "@/store/ide";
import { copyText } from "@/utils/clipboard";
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

/** One list of suggestions: bordered rows, quiet until hovered. */
function StarterList({ starters, busy, onPick }: { starters: Starter[]; busy: boolean; onPick: (prompt: string) => void }) {
  return (
    <div className="rounded-md border border-border divide-y divide-border overflow-hidden">
      {starters.map(({ icon: Icon, label, prompt }) => (
        <button
          key={label}
          type="button"
          onClick={() => onPick(prompt)}
          disabled={busy}
          title={prompt}
          className="w-full flex items-center gap-2 px-2.5 py-2 text-left text-fg-muted hover:text-fg hover:bg-bg-hover cursor-pointer transition-colors disabled:opacity-50 group"
        >
          <Icon size={13} className="shrink-0 text-fg-muted group-hover:text-accent transition-colors" />
          <span className="truncate">{label}</span>
        </button>
      ))}
    </div>
  );
}

/** Chat with any LLM about Kaspa and SilverScript, or run an autonomous agent with real workspace tools. */
export function AssistantPanel() {
  const engine = useEngine();
  const assistant = engine.get<AssistantPlugin>("assistant");
  const mode = useAssistant((s) => s.mode);
  const setMode = useAssistant((s) => s.setMode);
  const turns = useAssistant((s) => s.turns);
  const busy = useAssistant((s) => s.busy);
  const agentRun = useAssistant((s) => s.agentRun);
  const config = useAssistant((s) => s.config);
  const meta = useAssistant((s) => s.meta);
  const includeFile = useAssistant((s) => s.includeFile);
  const setIncludeFile = useAssistant((s) => s.setIncludeFile);
  const settingsOpen = useAssistant((s) => s.settingsOpen);
  const setSettingsOpen = useAssistant((s) => s.setSettingsOpen);
  const activeFile = useIde((s) => s.activeFile);
  const [input, setInput] = useState("");
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [turns, agentRun?.steps, agentRun?.thoughts, agentRun?.summary]);

  const notReady = config && !config.model ? "Pick a model to start" : config && !config.hasKey && config.provider === "anthropic" ? "Add your API key to start" : null;
  const modelName = config ? (config.model ? config.model.split("/").pop() : "no model") : "…";
  const docsInfo = meta?.docs ? `Kaspa docs ${meta.docs.mode} (~${Math.round(meta.docs.chars / 4000)}k tokens)` : config && config.provider !== "opencode" && config.docs !== "off" ? `Kaspa docs ${config.docs}` : "";
  const sharedFile = activeFile && !activeFile.startsWith("view:") ? activeFile.split("/").pop() : null;
  const needsConsent = config?.provider === "opencode" && !config.opencodeConsent;

  const send = (text = input) => {
    if (!text.trim() || busy) return;
    setInput("");
    if (mode === "agent") {
      void assistant.runAgent(text);
    } else {
      void assistant.ask(text);
    }
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
    <div className="h-full flex flex-col text-xs min-h-0">
      {/* One toolbar: the mode on the left, the model (opens the settings) and the panel actions on the right. */}
      <div className="shrink-0 flex items-center gap-1.5 px-2 py-1.5 border-b border-border">
        <div role="tablist" aria-label="Assistant mode" className="inline-flex shrink-0 rounded-md border border-border bg-bg-panel p-0.5">
          {(["chat", "agent"] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="tab"
              aria-selected={mode === m}
              onClick={() => setMode(m)}
              className={clsx(
                "flex items-center gap-1 rounded px-2 py-0.5 text-[11px] font-medium transition-colors cursor-pointer",
                mode === m ? "bg-bg-elev text-fg" : "text-fg-muted hover:text-fg"
              )}
            >
              {m === "chat" ? <MessageSquare size={11} /> : <Wand2 size={11} />}
              {m === "chat" ? "Chat" : "Agent"}
            </button>
          ))}
        </div>
        <span className="flex-1" />
        <button
          type="button"
          onClick={() => setSettingsOpen(!settingsOpen)}
          className={clsx(
            "inline-flex min-w-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] transition-colors cursor-pointer",
            settingsOpen ? "border-accent/60 text-accent" : "border-border text-fg-muted hover:text-fg hover:border-fg-muted/40"
          )}
          title={[config ? `${config.provider} · ${config.model || "no model"}` : "", docsInfo, "Assistant settings"].filter(Boolean).join("\n")}
          aria-label="Assistant settings"
          aria-pressed={settingsOpen}
        >
          <Sparkles size={11} className="shrink-0" />
          <span className="truncate">{modelName}</span>
          <ChevronDown size={11} className="shrink-0" />
        </button>
        {mode === "chat" && (
          <button type="button" onClick={() => void askResearchGpt()} className="shrink-0 p-1 rounded text-fg-muted hover:text-fg hover:bg-bg-hover cursor-pointer" title="Ask the Kaspa Research GPT instead: copies your question and its context, then opens the GPT" aria-label="Ask the Kaspa Research GPT instead">
            <ExternalLink size={13} />
          </button>
        )}
        <button
          type="button"
          onClick={() => (mode === "agent" ? assistant.resetAgent() : assistant.clear())}
          className="shrink-0 p-1 rounded text-fg-muted hover:text-fg hover:bg-bg-hover cursor-pointer disabled:opacity-40 disabled:cursor-default"
          title={mode === "agent" ? "New task" : "Clear chat"}
          aria-label={mode === "agent" ? "New task" : "Clear chat"}
          disabled={mode === "agent" ? !agentRun : turns.length === 0}
        >
          {mode === "agent" ? <RotateCcw size={13} /> : <Trash2 size={13} />}
        </button>
      </div>

      {settingsOpen && <Settings onClose={() => setSettingsOpen(false)} />}

      <div className="flex-1 min-h-0 overflow-auto px-3 py-2 space-y-3">
        {mode === "agent" ? (
          <AgentView
            agentRun={agentRun}
            busy={busy}
            onRunStarter={(goal) => void assistant.runAgent(goal)}
            onReset={() => assistant.resetAgent()}
          />
        ) : (
          <>
            {turns.length === 0 && (
              <div className="space-y-3 pt-5">
                <div className="flex flex-col items-center gap-1 text-center">
                  <MessageSquare size={18} className="text-accent" />
                  <div className="text-[13px] font-medium text-fg">Ask about Kaspa</div>
                  <div className="max-w-[34ch] leading-relaxed text-fg-muted">
                    SilverScript, Toccata and HardKas, grounded in <a className="text-accent hover:underline" href={DOCS_FOR_AI} target="_blank" rel="noreferrer">docs.kaspa.org</a>, with the open file as context. It only chats: nothing runs.
                  </div>
                </div>
                {notReady && !needsConsent && (
                  <button type="button" onClick={() => setSettingsOpen(true)} className="w-full flex items-center gap-2 rounded-md border border-warn/40 bg-warn/10 px-2.5 py-1.5 text-left text-[11px] text-warn hover:bg-warn/15 cursor-pointer transition-colors">
                    <KeyRound size={12} className="shrink-0" />
                    <span className="flex-1">{notReady}</span>
                    <span className="underline underline-offset-2">Settings</span>
                  </button>
                )}
                <StarterList starters={STARTERS} busy={busy || needsConsent} onPick={(p) => send(p)} />
              </div>
            )}
            {turns.map((t) => (
              <Turn key={t.id} turn={t} />
            ))}
          </>
        )}
        <div ref={endRef} />
      </div>

      <div className="shrink-0 p-2">
        {needsConsent && config && <OpenCodeConsent model={config.model} onOwnProvider={() => setSettingsOpen(true)} />}
        {!needsConsent && (
          /* One composer box: the text, then a row with the shared file and the send button. */
          <div className="rounded-lg border border-border bg-bg transition-colors focus-within:border-accent/60">
            <textarea
              className="block w-full resize-none bg-transparent px-2.5 pt-2 pb-1 text-xs text-fg outline-none placeholder:text-fg-muted min-h-[2.75rem] max-h-40 [field-sizing:content]"
              placeholder={mode === "agent" ? "Describe a goal for the agent" : "Ask about Kaspa or SilverScript"}
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
            <div className="flex items-center gap-1.5 px-2 pb-1.5">
              <button
                type="button"
                onClick={() => setIncludeFile(!includeFile)}
                aria-pressed={includeFile}
                title={sharedFile ? (includeFile ? `${activeFile} is shared as context. Click to stop sharing it.` : `Click to share ${activeFile} as context.`) : "Open a file to share it as context"}
                className={clsx(
                  "inline-flex min-w-0 max-w-[70%] items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] transition-colors cursor-pointer",
                  includeFile && sharedFile ? "border-accent/40 bg-accent/10 text-accent" : "border-border text-fg-muted hover:text-fg"
                )}
              >
                <Paperclip size={11} className="shrink-0" />
                <span className={clsx("truncate", !includeFile && sharedFile && "line-through")}>{sharedFile ?? "No file open"}</span>
              </button>
              <span className="flex-1" />
              {busy ? (
                <button type="button" onClick={() => assistant.stop()} title="Stop" aria-label="Stop generating" className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-border text-fg hover:bg-bg-hover cursor-pointer">
                  <Square size={12} />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => send()}
                  disabled={!input.trim()}
                  title={mode === "agent" ? "Run the agent (Enter)" : "Send (Enter)"}
                  aria-label={mode === "agent" ? "Run agent goal" : "Send message"}
                  className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent text-accent-fg transition-all hover:brightness-110 cursor-pointer disabled:cursor-default disabled:bg-bg-elev disabled:text-fg-muted"
                >
                  {mode === "agent" ? <Wand2 size={13} /> : <ArrowUp size={14} />}
                </button>
              )}
            </div>
          </div>
        )}
      </div>
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

function AgentView({
  agentRun,
  busy,
  onRunStarter,
  onReset
}: {
  agentRun: AgentRun | null;
  busy: boolean;
  onRunStarter: (goal: string) => void;
  onReset: () => void;
}) {
  const engine = useEngine();
  const [openStepIds, setOpenStepIds] = useState<Record<string, boolean>>({});

  const onConfirm = (approved: boolean, allForRun = false) => engine.get<AssistantPlugin>("assistant").answerConfirm(approved, allForRun);

  const toggleStep = (id: string) => {
    setOpenStepIds((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const openFile = async (filePath: string) => {
    try {
      await engine.call("fileManager", "open", filePath);
    } catch (e) {
      console.error(e);
    }
  };

  if (!agentRun) {
    return (
      <div className="space-y-3 pt-5">
        <div className="flex flex-col items-center gap-1 text-center">
          <Wand2 size={18} className="text-accent" />
          <div className="text-[13px] font-medium text-fg">Give the agent a goal</div>
          <div className="max-w-[34ch] leading-relaxed text-fg-muted">
            It works on the workspace by itself: writes files, runs HardKas commands, compiles and tests. Each step shows here as it happens; commands ask you first.
          </div>
        </div>
        <StarterList starters={AGENT_STARTERS} busy={busy} onPick={onRunStarter} />
      </div>
    );
  }

  return (
    <div className="space-y-3 pt-1">
      {/* Active Goal Header */}
      <div className="rounded-lg border border-border bg-bg-elev p-3 space-y-2">
        <div className="flex items-start justify-between gap-2">
          <div className="space-y-1 min-w-0 flex-1">
            <div className="text-[10px] uppercase font-semibold text-fg-muted tracking-wider">Goal</div>
            <div className="font-medium text-fg text-xs break-words">{agentRun.goal}</div>
          </div>
          <div className="shrink-0">
            {agentRun.running ? (
              <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-accent/10 border border-accent/30 text-accent text-[11px] font-medium">
                <Loader2 size={11} className="animate-spin" /> Running
              </span>
            ) : agentRun.ok ? (
              <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-ok/10 border border-ok/30 text-ok text-[11px] font-medium">
                <CheckCircle2 size={11} /> Finished
              </span>
            ) : (
              <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-error/10 border border-error/30 text-error text-[11px] font-medium">
                <XCircle size={11} /> Stopped
              </span>
            )}
          </div>
        </div>
      </div>

      {/* An action waiting for approval (a terminal command, a file change or a HardKas tool call): the run is paused
          until one of these buttons is pressed. */}
      {agentRun.pendingConfirm && (
        <div role="alertdialog" aria-label="The agent asks for permission" className="rounded-lg border border-warn/50 bg-warn/5 p-3 space-y-2">
          <div className="flex items-center gap-2 text-warn font-semibold text-xs">
            <TerminalSquare size={14} /> Allow this action in the workspace?
          </div>
          <pre className="font-mono text-[11px] text-fg bg-bg border border-border rounded p-2 whitespace-pre-wrap break-all max-h-32 overflow-auto">{agentRun.pendingConfirm.command}</pre>
          <p className="text-[10px] text-fg-muted leading-relaxed">
            The agent proposed it; it may come from a file or a page it read. It runs with your user and the workspace as the current folder.
          </p>
          <div className="flex flex-wrap gap-1.5">
            <button type="button" className="btn-primary text-xs" onClick={() => void onConfirm(true)}>
              <Check size={12} /> Run
            </button>
            <button type="button" className="btn-ghost text-xs" onClick={() => void onConfirm(true, true)} title="Run this and every later command of this run without asking">
              Run all in this run
            </button>
            <button type="button" className="btn-ghost text-xs text-error" onClick={() => void onConfirm(false)}>
              <XCircle size={12} /> Skip
            </button>
          </div>
        </div>
      )}

      {/* Live Agent Thoughts (if any) */}
      {agentRun.thoughts.length > 0 && (
        <div className="rounded-lg border border-border/80 bg-bg p-2.5 space-y-1 text-fg-muted text-[11px] italic">
          <div className="not-italic font-semibold text-[10px] uppercase tracking-wider text-accent flex items-center gap-1">
            <span>💭</span> Reasoning
          </div>
          {agentRun.thoughts.slice(-2).map((thought, idx) => (
            <div key={idx} className="whitespace-pre-wrap leading-relaxed">
              {thought}
            </div>
          ))}
        </div>
      )}

      {/* Steps Timeline */}
      <div className="space-y-2">
        <div className="text-[10px] uppercase font-semibold text-fg-muted tracking-wider px-1">
          Steps ({agentRun.steps.length})
        </div>

        <div className="space-y-1.5">
          {agentRun.steps.map((step, idx) => {
            const isOpen = Boolean(openStepIds[step.id] || (step.status === "failed" && openStepIds[step.id] !== false));
            const hasDetails = Boolean(step.output || step.error || step.input);
            const filePath =
              step.input && typeof step.input.path === "string"
                ? String(step.input.path)
                : step.input && typeof step.input.file === "string"
                ? String(step.input.file)
                : null;

            return (
              <div
                key={step.id || idx}
                className={clsx(
                  "rounded-md border text-xs transition-colors overflow-hidden",
                  step.status === "running"
                    ? "border-accent/40 bg-accent/5"
                    : step.status === "failed"
                    ? "border-error/40 bg-error/5"
                    : "border-border bg-bg-elev/60"
                )}
              >
                <div
                  onClick={() => hasDetails && toggleStep(step.id)}
                  className={clsx(
                    "flex items-center gap-2 px-2.5 py-1.5 select-none",
                    hasDetails && "cursor-pointer hover:bg-bg-hover/50"
                  )}
                >
                  {step.status === "running" ? (
                    <Loader2 size={13} className="text-accent animate-spin shrink-0" />
                  ) : step.status === "succeeded" ? (
                    <div className="w-4 h-4 rounded-full bg-ok/20 text-ok border border-ok/40 flex items-center justify-center shrink-0">
                      <Check size={10} strokeWidth={3} />
                    </div>
                  ) : (
                    <div className="w-4 h-4 rounded-full bg-error/20 text-error border border-error/40 flex items-center justify-center shrink-0">
                      <XCircle size={10} strokeWidth={3} />
                    </div>
                  )}

                  <span className="font-medium text-fg truncate flex-1">{step.title}</span>

                  <span className="font-mono text-[10px] px-1.5 py-0.2 rounded bg-bg border border-border text-fg-muted shrink-0">
                    {step.tool}
                  </span>

                  {hasDetails && (
                    <button
                      type="button"
                      aria-label="Expand step details"
                      className="text-fg-muted hover:text-fg p-0.5"
                    >
                      {isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                    </button>
                  )}
                </div>

                {isOpen && hasDetails && (
                  <div className="px-2.5 pb-2 pt-1 border-t border-border/50 space-y-1.5 bg-bg/60">
                    {filePath && (
                      <div className="flex items-center justify-between py-0.5">
                        <span className="text-[10px] text-fg-muted font-mono">{filePath}</span>
                        <button
                          type="button"
                          onClick={() => openFile(filePath)}
                          className="flex items-center gap-1 text-[10px] text-accent hover:underline cursor-pointer"
                        >
                          <FileCode2 size={11} /> Open in editor
                        </button>
                      </div>
                    )}
                    {step.error && (
                      <pre className="font-mono text-[10px] text-error bg-error/10 border border-error/20 p-2 rounded whitespace-pre-wrap break-all max-h-40 overflow-auto">
                        {step.error}
                      </pre>
                    )}
                    {step.output && !step.error && (
                      <pre className="font-mono text-[10px] text-fg-muted bg-bg border border-border/60 p-2 rounded whitespace-pre-wrap break-all max-h-40 overflow-auto">
                        {step.output}
                      </pre>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Done summary */}
      {agentRun.summary && (
        <div
          className={clsx(
            "rounded-lg border p-3 space-y-2 text-xs",
            agentRun.ok ? "border-ok/40 bg-ok/5" : "border-warn/40 bg-warn/5"
          )}
        >
          <div className="flex items-center gap-2 font-semibold">
            {agentRun.ok ? (
              <span className="text-ok flex items-center gap-1.5">
                <CheckCircle2 size={14} /> The agent finished; check its steps and run the tests yourself
              </span>
            ) : (
              <span className="text-warn flex items-center gap-1.5">
                <AlertCircle size={14} /> The run ended without finishing the goal
              </span>
            )}
          </div>
          <div className="text-fg leading-relaxed">
            <Markdown text={agentRun.summary} />
          </div>
          <button
            type="button"
            onClick={onReset}
            className="btn-primary w-full justify-center mt-1"
          >
            <Wand2 size={13} /> New task
          </button>
        </div>
      )}
    </div>
  );
}

function Turn({ turn }: { turn: ChatTurn }) {
  if (turn.role === "user") {
    return (
      <div className="rounded bg-bg-hover px-2.5 py-1.5 text-fg whitespace-pre-wrap break-words">{turn.content}</div>
    );
  }
  return (
    <div className="space-y-1.5">
      {turn.content ? <Markdown text={turn.content} streaming={turn.streaming} /> : turn.streaming ? <div className="text-fg-muted animate-pulse">thinking…</div> : null}
      {turn.error && <div className="rounded border border-error/40 bg-error/10 px-2 py-1.5 text-error whitespace-pre-wrap break-words">{turn.error}</div>}
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
    if (t.startsWith("`") && t.endsWith("`") && t.length > 2) return <code key={i} className="rounded bg-bg-elev px-1 py-0.5 font-mono text-[11px] text-accent">{t.slice(1, -1)}</code>;
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
      <div className="flex items-center gap-1 px-2 py-1 border-b border-border bg-bg-elev text-[10px] text-fg-muted">
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
      <pre className="overflow-auto px-2 py-1.5 font-mono text-[11px] leading-relaxed max-h-72">{code}</pre>
    </div>
  );
}

function Settings({ onClose }: { onClose: () => void }) {
  const engine = useEngine();
  const assistant = engine.get<AssistantPlugin>("assistant");
  const config = useAssistant((s) => s.config);
  const defaults = useAssistant((s) => s.defaults);
  const [provider, setProvider] = useState<"opencode" | "anthropic" | "openai">(config?.provider ?? "opencode");
  const [baseUrl, setBaseUrl] = useState(config?.baseUrl ?? "");
  const [model, setModel] = useState(config?.model ?? "");
  const [docs, setDocs] = useState<"off" | "core" | "full">(config?.docs ?? "core");
  const [apiKey, setApiKey] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [docsInfo, setDocsInfo] = useState<string>("");

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

  const pickProvider = (p: "opencode" | "anthropic" | "openai") => {
    setProvider(p);
    if (defaults) {
      setBaseUrl(defaults[p].baseUrl);
      setModel(defaults[p].model);
    }
  };

  const save = async (extra?: { clearKey?: boolean }) => {
    try {
      const saved = await api.assistant.saveConfig({ provider, baseUrl, model, docs, ...(apiKey ? { apiKey } : {}), ...extra });
      setApiKey("");
      useAssistant.getState().setConfig(saved);
      setMsg(extra?.clearKey ? "API key removed" : "Saved");
      await assistant.refreshConfig();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    }
  };

  // OpenCode's free models need no account; `opencode models` lists them all. The first three are the ones whose
  // provider keeps nothing and does not train on it; big-pickle may use data to improve the model (opencode.ai/docs/zen).
  const suggestions =
    provider === "opencode"
      ? ["opencode/deepseek-v4.1-flash-free", "opencode/glm-5.3-flash-free", "opencode/minimax-m3.1-flash-free", "opencode/big-pickle"]
      : provider === "anthropic"
        ? ["claude-sonnet-5-5", "claude-opus-5-5", "claude-haiku-5-5"]
        : ["llama3.2", "qwen2.5-coder", "gpt-4.1"];

  return (
    <div className="shrink-0 border-b border-border bg-bg-elev p-3 space-y-2.5">
      <div className="grid grid-cols-3 gap-1">
        {(["opencode", "anthropic", "openai"] as const).map((p) => (
          <button key={p} type="button" onClick={() => pickProvider(p)} className={clsx("rounded border px-2 py-1 cursor-pointer", provider === p ? "border-accent text-accent" : "border-border text-fg-muted hover:text-fg")}>
            {p === "opencode" ? "OpenCode (free)" : p === "anthropic" ? "Anthropic (Claude)" : "OpenAI-compatible"}
          </button>
        ))}
      </div>
      <div className="text-[10px] text-fg-muted">
        {provider === "opencode"
          ? "The OpenCode agent, hosted by the IDE over ACP with the HardKas tools. Free models, no key: your prompts and the files the agent reads go to OpenCode's hosted models. The first three suggested models keep nothing; big-pickle may use data to improve the model. Reads run without asking; edits, commands and HardKas actions that change something ask for your approval."
          : provider === "anthropic"
            ? "Claude through the Anthropic API."
            : "OpenAI, OpenRouter, LM Studio, or a local Ollama at http://localhost:11434/v1 (no key needed)."}
      </div>
      {provider !== "opencode" && (
        <div>
          <div className="label">Base URL</div>
          <input className="input font-mono" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} spellCheck={false} />
        </div>
      )}
      <div>
        <div className="label">Model</div>
        <input className="input font-mono" value={model} onChange={(e) => setModel(e.target.value)} list="assistant-models" spellCheck={false} placeholder="model id" />
        <datalist id="assistant-models">
          {suggestions.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
      </div>
      {provider !== "opencode" && (
      <div>
        <div className="label flex items-center justify-between">
          <span>API key</span>
          {config?.hasKey && <span className="normal-case tracking-normal text-ok">saved {config.keyHint}</span>}
        </div>
        <input className="input font-mono" type="password" autoComplete="off" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder={config?.hasKey ? "leave empty to keep the saved key" : "paste your key"} />
        <div className="text-[10px] text-fg-muted mt-1">Stored in ~/.hardkas-ide/assistant.json on this machine and used only by ide-server. It is never sent back to the browser.</div>
      </div>
      )}
      {provider !== "opencode" && (
      <div>
        <div className="label flex items-center gap-1">
          <BookOpen size={11} /> Kaspa docs as context
        </div>
        <select className="input" value={docs} onChange={(e) => setDocs(e.target.value as typeof docs)}>
          <option value="core">Core pack: Agent Brief, SilverScript, getting started</option>
          <option value="full">Full docs corpus (larger, costs more per question)</option>
          <option value="off">Off</option>
        </select>
        <div className="text-[10px] text-fg-muted mt-1">{docsInfo}</div>
      </div>
      )}
      <div className="flex gap-1">
        <button type="button" className="btn-primary flex-1 justify-center" onClick={() => void save()}>
          Save
        </button>
        {config?.hasKey && (
          <button type="button" className="btn-ghost" onClick={() => void save({ clearKey: true })} title="Delete the saved key">
            Remove key
          </button>
        )}
        {config?.opencodeConsent && (
          <button
            type="button"
            className="btn-ghost"
            onClick={() => void api.assistant.saveConfig({ opencodeConsent: false }).then((c) => useAssistant.getState().setConfig(c))}
            title="Stop sending anything to OpenCode until you turn it on again"
          >
            Turn off OpenCode
          </button>
        )}
        <button type="button" className="btn-ghost" onClick={onClose}>
          Close
        </button>
      </div>
      {msg && <div className="text-[11px] text-accent">{msg}</div>}
    </div>
  );
}
