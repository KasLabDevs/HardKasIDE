import clsx from "clsx";
import { BookOpen, Check, Copy, ExternalLink, FilePlus2, KeyRound, Send, Settings2, Square, Trash2, TextCursorInput } from "lucide-react";
import { Fragment, useEffect, useRef, useState } from "react";
import { api, IdeApiError } from "@/api/client";
import { useEngine } from "@/engine/context";
import type { AssistantPlugin } from "@/plugins/assistant";
import type { EditorPlugin } from "@/plugins/editor";
import { useAssistant, type ChatTurn } from "@/store/assistant";
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

/** Chat with any LLM about Kaspa and SilverScript, grounded in docs.kaspa.org. Chat only: you decide what to run or paste. */
export function AssistantPanel() {
  const engine = useEngine();
  const assistant = engine.get<AssistantPlugin>("assistant");
  const turns = useAssistant((s) => s.turns);
  const busy = useAssistant((s) => s.busy);
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
  }, [turns]);

  const notReady = config && !config.model ? "Pick a model in the settings." : config && !config.hasKey && config.provider === "anthropic" ? "Add your API key to start (gear icon)." : null;

  const send = (text = input) => {
    if (!text.trim() || busy) return;
    setInput("");
    void assistant.ask(text);
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
        <button type="button" onClick={() => assistant.clear()} className="p-1 rounded hover:text-fg hover:bg-bg-hover cursor-pointer" title="Clear chat" aria-label="Clear chat" disabled={turns.length === 0}>
          <Trash2 size={13} />
        </button>
        <button type="button" onClick={() => setSettingsOpen(!settingsOpen)} className={clsx("p-1 rounded cursor-pointer", settingsOpen ? "text-accent bg-bg-hover" : "hover:text-fg hover:bg-bg-hover")} title="Assistant settings" aria-label="Assistant settings" aria-pressed={settingsOpen}>
          <Settings2 size={13} />
        </button>
      </div>

      {settingsOpen && <Settings onClose={() => setSettingsOpen(false)} />}

      <div className="flex-1 min-h-0 overflow-auto px-3 py-2 space-y-3">
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
            placeholder="Ask about Kaspa or SilverScript…  (Enter to send, Shift+Enter for a new line)"
            value={input}
            rows={2}
            aria-label="Message the assistant"
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
            <button type="button" className="btn-primary shrink-0 h-[54px]" onClick={() => send()} disabled={!input.trim()} title="Send" aria-label="Send message">
              <Send size={14} />
            </button>
          )}
        </div>
        <button type="button" onClick={() => void askResearchGpt()} className="w-full flex items-center justify-center gap-1.5 rounded border border-dashed border-border py-1 text-[11px] text-fg-muted hover:text-fg hover:border-accent/50 cursor-pointer" title="ChatGPT custom GPTs have no API and cannot be embedded: this copies your question with its context and opens the GPT">
          <ExternalLink size={11} /> Ask the Kaspa Research GPT instead (copies your question)
        </button>
      </div>
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
  const isSil = /^(silver|sil)/i.test(lang) || /pragma\s+silverscript/.test(code);

  const say = (t: string) => {
    setNote(t);
    setTimeout(() => setNote(null), 2200);
  };
  const copy = async () => {
    setCopied(await copyText(code));
    setTimeout(() => setCopied(false), 1500);
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
