import clsx from "clsx";
import {
  AlertCircle,
  BookOpen,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Copy,
  ExternalLink,
  FileCode2,
  FilePlus2,
  KeyRound,
  Loader2,
  MessageSquare,
  Send,
  Settings2,
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

const RESEARCH_GPT = "https://chatgpt.com/g/g-6887632bd778819191d51022323293ea-kaspa-research-gpt-for-kaspa-coin-v6";
const DOCS_FOR_AI = "https://docs.kaspa.org/llms.txt";

const STARTERS = [
  "Explain what the open contract does and how each entry is spent.",
  "Review this contract for mistakes a Toccata/UTXO developer would catch.",
  "Write a SilverScript escrow with a timeout refund.",
  "How do I fund and spend a covenant output on simnet with HardKas?"
];

const AGENT_STARTERS = [
  "Crea un contrato Escrow con refund por timeout en SilverScript y compílalo",
  "Crea un contrato Auction con pujas y su test en Vitest",
  "Compila y verifica todos los contratos en el directorio contracts/",
  "Escribe un contrato Counter con incremento y su test suite"
];

/** Chat with any LLM about Kaspa and SilverScript, or run an autonomous agent with real workspace tools. */
export function AssistantPanel() {
  const engine = useEngine();
  const assistant = engine.get<AssistantPlugin>("assistant");
  const mode = useAssistant((s) => s.mode);
  const setMode = useAssistant((s) => s.setMode);
  const turns = useAssistant((s) => s.turns);
  const busy = useAssistant((s) => s.busy);
  const agentRun = useAssistant((s) => s.agentRun);
  const resetAgentRun = useAssistant((s) => s.resetAgentRun);
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

  const notReady = config && !config.model ? "Pick a model in the settings." : config && !config.hasKey && config.provider === "anthropic" ? "Add your API key to start (gear icon)." : null;

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
      <div className="shrink-0 flex items-center gap-2 px-3 py-1.5 border-b border-border text-fg-muted">
        <span className="truncate flex-1" title={config ? `${config.provider} · ${config.model}` : ""}>
          {config ? (config.model ? `${config.model}` : "no model") : "…"}
          {meta?.docs ? <span className="ml-1 text-[10px]">· Kaspa docs {meta.docs.mode} (~{Math.round(meta.docs.chars / 4000)}k tok)</span> : config?.docs !== "off" && config ? <span className="ml-1 text-[10px]">· Kaspa docs {config.docs}</span> : null}
        </span>
        <button type="button" onClick={() => (mode === "agent" ? resetAgentRun() : assistant.clear())} className="p-1 rounded hover:text-fg hover:bg-bg-hover cursor-pointer" title={mode === "agent" ? "Reset agent" : "Clear chat"} aria-label={mode === "agent" ? "Reset agent" : "Clear chat"} disabled={mode === "agent" ? !agentRun : turns.length === 0}>
          <Trash2 size={13} />
        </button>
        <button type="button" onClick={() => setSettingsOpen(!settingsOpen)} className={clsx("p-1 rounded cursor-pointer", settingsOpen ? "text-accent bg-bg-hover" : "hover:text-fg hover:bg-bg-hover")} title="Assistant settings" aria-label="Assistant settings" aria-pressed={settingsOpen}>
          <Settings2 size={13} />
        </button>
      </div>

      {/* Mode Switcher */}
      <div className="shrink-0 flex items-center justify-between px-3 py-1 border-b border-border bg-bg-elev/40">
        <div className="inline-flex rounded p-0.5 bg-bg border border-border">
          <button
            type="button"
            onClick={() => setMode("chat")}
            className={clsx(
              "flex items-center gap-1.5 px-2.5 py-1 rounded text-[11px] font-medium transition-colors cursor-pointer",
              mode === "chat" ? "bg-bg-elev text-accent font-semibold shadow-sm" : "text-fg-muted hover:text-fg"
            )}
          >
            <MessageSquare size={12} />
            Chat
          </button>
          <button
            type="button"
            onClick={() => setMode("agent")}
            className={clsx(
              "flex items-center gap-1.5 px-2.5 py-1 rounded text-[11px] font-medium transition-colors cursor-pointer",
              mode === "agent" ? "bg-accent/15 text-accent font-semibold shadow-sm" : "text-fg-muted hover:text-fg"
            )}
          >
            <Wand2 size={12} />
            Agent Mode
            <span className="text-[9px] px-1 py-0.2 rounded bg-accent/20 text-accent font-mono uppercase tracking-wider">Beta</span>
          </button>
        </div>
        {mode === "agent" && agentRun && (
          <button
            type="button"
            onClick={() => resetAgentRun()}
            className="text-[11px] text-fg-muted hover:text-fg hover:underline cursor-pointer"
          >
            Nueva tarea
          </button>
        )}
      </div>

      {settingsOpen && <Settings onClose={() => setSettingsOpen(false)} />}

      <div className="flex-1 min-h-0 overflow-auto px-3 py-2 space-y-3">
        {mode === "agent" ? (
          <AgentView
            agentRun={agentRun}
            busy={busy}
            onRunStarter={(goal) => void assistant.runAgent(goal)}
            onReset={() => resetAgentRun()}
          />
        ) : (
          <>
            {turns.length === 0 && (
              <div className="space-y-3 pt-2">
                <div className="text-fg-muted leading-relaxed">
                  Ask about Kaspa, Toccata and SilverScript. Answers are grounded in the official docs at <a className="text-accent hover:underline" href={DOCS_FOR_AI} target="_blank" rel="noreferrer">docs.kaspa.org</a>, and the open file is shared as context. It only chats: nothing runs unless you copy it.
                </div>
                {notReady && (
                  <button type="button" className="btn-primary w-full justify-center" onClick={() => setSettingsOpen(true)}>
                    <KeyRound size={13} /> {notReady}
                  </button>
                )}
                <div className="space-y-1">
                  {STARTERS.map((s) => (
                    <button key={s} type="button" onClick={() => send(s)} disabled={busy} className="w-full text-left rounded border border-border bg-bg-elev px-2 py-1.5 text-fg-muted hover:text-fg hover:border-accent/50 cursor-pointer disabled:opacity-50">
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {turns.map((t) => (
              <Turn key={t.id} turn={t} />
            ))}
          </>
        )}
        <div ref={endRef} />
      </div>

      <div className="shrink-0 border-t border-border p-2 space-y-1.5">
        <label className="flex items-center gap-1.5 text-[11px] text-fg-muted cursor-pointer select-none">
          <input type="checkbox" checked={includeFile} onChange={(e) => setIncludeFile(e.target.checked)} />
          <span className="truncate">Share the open file{activeFile && !activeFile.startsWith("view:") ? `: ${activeFile.split("/").pop()}` : " (none open)"}</span>
        </label>
        <div className="flex items-end gap-1">
          <textarea
            className="input resize-none min-h-[54px] max-h-40"
            placeholder={
              mode === "agent"
                ? "Objetivo para el agente autónomo (ej: 'Crea un contrato Escrow y compílalo')… Enter para ejecutar"
                : "Ask about Kaspa or SilverScript…  (Enter to send, Shift+Enter for a new line)"
            }
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
          {busy ? (
            <button type="button" className="btn-ghost shrink-0 h-[54px]" onClick={() => assistant.stop()} title="Stop" aria-label="Stop generating">
              <Square size={14} />
            </button>
          ) : (
            <button
              type="button"
              className={clsx("shrink-0 h-[54px]", mode === "agent" ? "btn-primary bg-accent/90 hover:bg-accent" : "btn-primary")}
              onClick={() => send()}
              disabled={!input.trim()}
              title={mode === "agent" ? "Ejecutar Agente" : "Send"}
              aria-label={mode === "agent" ? "Run agent goal" : "Send message"}
            >
              {mode === "agent" ? <Wand2 size={14} /> : <Send size={14} />}
            </button>
          )}
        </div>
        {mode === "chat" && (
          <button type="button" onClick={() => void askResearchGpt()} className="w-full flex items-center justify-center gap-1.5 rounded border border-dashed border-border py-1 text-[11px] text-fg-muted hover:text-fg hover:border-accent/50 cursor-pointer" title="ChatGPT custom GPTs have no API and cannot be embedded: this copies your question with its context and opens the GPT">
            <ExternalLink size={11} /> Ask the Kaspa Research GPT instead (copies your question)
          </button>
        )}
      </div>
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
      <div className="space-y-4 pt-1">
        <div className="rounded-lg border border-accent/30 bg-accent/5 p-3 space-y-2">
          <div className="flex items-center gap-2 text-accent font-semibold text-xs">
            <Wand2 size={14} /> Modo Agente Autónomo
          </div>
          <p className="text-fg-muted leading-relaxed text-[11px]">
            El agente tiene control autónomo sobre el espacio de trabajo: escribe código, compila con <code className="font-mono text-accent">silverc</code>, ejecuta tests y repara errores automáticamente en bucle cerrado.
          </p>
          <div className="flex flex-wrap gap-1.5 pt-1">
            {["write_file", "compile_silverscript", "run_tests", "fund_account"].map((t) => (
              <span key={t} className="px-1.5 py-0.5 rounded border border-border bg-bg-elev font-mono text-[10px] text-fg-muted">
                ⚡ {t}
              </span>
            ))}
          </div>
        </div>

        <div className="space-y-1.5">
          <div className="text-[11px] font-medium text-fg-muted uppercase tracking-wider">Tareas de inicio sugeridas</div>
          {AGENT_STARTERS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => onRunStarter(s)}
              disabled={busy}
              className="w-full text-left rounded border border-border bg-bg-elev px-2.5 py-2 text-fg hover:border-accent/50 hover:bg-bg-hover cursor-pointer transition-colors disabled:opacity-50 group flex items-center justify-between"
            >
              <span className="truncate pr-2">{s}</span>
              <Wand2 size={12} className="opacity-0 group-hover:opacity-100 text-accent transition-opacity shrink-0" />
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3 pt-1">
      {/* Active Goal Header */}
      <div className="rounded-lg border border-border bg-bg-elev p-3 space-y-2">
        <div className="flex items-start justify-between gap-2">
          <div className="space-y-1 min-w-0 flex-1">
            <div className="text-[10px] uppercase font-semibold text-fg-muted tracking-wider">Objetivo en curso</div>
            <div className="font-medium text-fg text-xs break-words">{agentRun.goal}</div>
          </div>
          <div className="shrink-0">
            {agentRun.running ? (
              <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-accent/10 border border-accent/30 text-accent text-[11px] font-medium">
                <Loader2 size={11} className="animate-spin" /> Ejecutando
              </span>
            ) : agentRun.ok ? (
              <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-ok/10 border border-ok/30 text-ok text-[11px] font-medium">
                <CheckCircle2 size={11} /> Verificado
              </span>
            ) : (
              <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-error/10 border border-error/30 text-error text-[11px] font-medium">
                <XCircle size={11} /> Detenido
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Live Agent Thoughts (if any) */}
      {agentRun.thoughts.length > 0 && (
        <div className="rounded-lg border border-border/80 bg-bg p-2.5 space-y-1 text-fg-muted text-[11px] italic">
          <div className="not-italic font-semibold text-[10px] uppercase tracking-wider text-accent flex items-center gap-1">
            <span>💭</span> Razonamiento
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
          Línea de ejecución ({agentRun.steps.length} {agentRun.steps.length === 1 ? "paso" : "pasos"})
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
                          <FileCode2 size={11} /> Abrir en editor
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
                <CheckCircle2 size={14} /> Contrato y pruebas verificados
              </span>
            ) : (
              <span className="text-warn flex items-center gap-1.5">
                <AlertCircle size={14} /> Ejecución finalizada con observaciones
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
            <Wand2 size={13} /> Iniciar nueva tarea
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
    const path = window.prompt("Save this code as (path inside the project):", suggested);
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
  const [provider, setProvider] = useState<"anthropic" | "openai">(config?.provider ?? "anthropic");
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

  const pickProvider = (p: "anthropic" | "openai") => {
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

  const suggestions = provider === "anthropic" ? ["claude-sonnet-5-5", "claude-opus-5-5", "claude-haiku-5-5"] : ["llama3.2", "qwen2.5-coder", "gpt-4.1"];

  return (
    <div className="shrink-0 border-b border-border bg-bg-elev p-3 space-y-2.5">
      <div className="grid grid-cols-2 gap-1">
        {(["anthropic", "openai"] as const).map((p) => (
          <button key={p} type="button" onClick={() => pickProvider(p)} className={clsx("rounded border px-2 py-1 cursor-pointer", provider === p ? "border-accent text-accent" : "border-border text-fg-muted hover:text-fg")}>
            {p === "anthropic" ? "Anthropic (Claude)" : "OpenAI-compatible"}
          </button>
        ))}
      </div>
      <div className="text-[10px] text-fg-muted">
        {provider === "anthropic" ? "Claude through the Anthropic API." : "OpenAI, OpenRouter, LM Studio, or a local Ollama at http://localhost:11434/v1 (no key needed)."}
      </div>
      <div>
        <div className="label">Base URL</div>
        <input className="input font-mono" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} spellCheck={false} />
      </div>
      <div>
        <div className="label">Model</div>
        <input className="input font-mono" value={model} onChange={(e) => setModel(e.target.value)} list="assistant-models" spellCheck={false} placeholder="model id" />
        <datalist id="assistant-models">
          {suggestions.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
      </div>
      <div>
        <div className="label flex items-center justify-between">
          <span>API key</span>
          {config?.hasKey && <span className="normal-case tracking-normal text-ok">saved {config.keyHint}</span>}
        </div>
        <input className="input font-mono" type="password" autoComplete="off" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder={config?.hasKey ? "leave empty to keep the saved key" : "paste your key"} />
        <div className="text-[10px] text-fg-muted mt-1">Stored in ~/.hardkas-ide/assistant.json on this machine and used only by ide-server. It is never sent back to the browser.</div>
      </div>
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
      <div className="flex gap-1">
        <button type="button" className="btn-primary flex-1 justify-center" onClick={() => void save()}>
          Save
        </button>
        {config?.hasKey && (
          <button type="button" className="btn-ghost" onClick={() => void save({ clearKey: true })} title="Delete the saved key">
            Remove key
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
