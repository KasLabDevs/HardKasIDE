import clsx from "clsx";
import { ChevronDown, ChevronRight, Eraser, TerminalSquare } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useEngine } from "@/engine/context";
import type { TerminalPlugin } from "@/plugins/terminal";
import { useIde, type JournalBlock } from "@/store/ide";

/**
 * Terminal: a journal of blocks (log / info / warn / error / command / json) and
 * an input that runs `hardkas <what you type>`.
 */
export function Terminal() {
  const engine = useEngine();
  const journal = useIde((s) => s.journal);
  const clear = useIde((s) => s.clearJournal);
  const [input, setInput] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [journal.length]);

  const submit = () => {
    const line = input.trim();
    if (!line) return;
    setHistory((h) => [line, ...h].slice(0, 50));
    setHistoryIndex(-1);
    setInput("");
    const args = tokenize(line.replace(/^hardkas\s+/, ""));
    const terminal = engine.get<TerminalPlugin>("terminal");
    if (args[0] === "clear") {
      terminal.clear();
      return;
    }
    void terminal.runHardkas(args).catch((error: unknown) => terminal.error(String(error)));
  };

  return (
    <div className="h-full flex flex-col bg-bg border-t border-border font-mono text-xs">
      <div className="h-8 shrink-0 flex items-center justify-between px-3 border-b border-border bg-bg-panel">
        <span className="flex items-center gap-2 text-fg-muted uppercase tracking-wider text-[11px] font-semibold">
          <TerminalSquare size={14} /> Terminal
        </span>
        <button onClick={clear} className="text-fg-muted hover:text-fg" title="Clear">
          <Eraser size={14} />
        </button>
      </div>
      <div className="flex-1 min-h-0 overflow-auto px-3 py-2 space-y-1">
        {journal.length === 0 && <div className="text-fg-muted">Type a hardkas command below, e.g. <span className="text-fg">status --json</span> or <span className="text-fg">accounts list --json</span>.</div>}
        {journal.map((block) => (
          <Block key={block.id} block={block} />
        ))}
        <div ref={bottomRef} />
      </div>
      <div className="h-8 shrink-0 flex items-center gap-2 px-3 border-t border-border">
        <span className="text-accent">hardkas ›</span>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
            if (e.key === "ArrowUp") {
              const next = Math.min(historyIndex + 1, history.length - 1);
              setHistoryIndex(next);
              setInput(history[next] ?? "");
              e.preventDefault();
            }
            if (e.key === "ArrowDown") {
              const next = Math.max(historyIndex - 1, -1);
              setHistoryIndex(next);
              setInput(next === -1 ? "" : (history[next] ?? ""));
              e.preventDefault();
            }
          }}
          placeholder="silver compile contract.sil --json"
          className="flex-1 bg-transparent outline-none text-fg placeholder:text-fg-muted/60"
          spellCheck={false}
        />
      </div>
    </div>
  );
}

function Block({ block }: { block: JournalBlock }) {
  const [open, setOpen] = useState(false);
  const color = {
    log: "text-fg",
    info: "text-info",
    warn: "text-warn",
    error: "text-error",
    command: "text-accent",
    json: "text-fg"
  }[block.kind];

  if (block.kind === "json") {
    return (
      <div className="rounded border border-border bg-bg-elev">
        <button onClick={() => setOpen((o) => !o)} className="w-full flex items-center gap-1.5 px-2 py-1 text-left text-fg-muted hover:text-fg">
          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          <span className="truncate">{block.text}</span>
          <span className="ml-auto text-[10px] opacity-60">{time(block.at)}</span>
        </button>
        {open && <pre className="px-3 pb-2 overflow-auto max-h-80 text-[11px] leading-relaxed whitespace-pre">{JSON.stringify(block.data, null, 2)}</pre>}
      </div>
    );
  }
  return (
    <div className={clsx("whitespace-pre-wrap break-words leading-relaxed", color)}>
      {block.kind === "command" && <span className="text-fg-muted mr-1">$</span>}
      {block.text}
    </div>
  );
}

function time(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour12: false });
}

/** Splits a command line into args, honouring double quotes. */
function tokenize(line: string): string[] {
  const out: string[] = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line))) out.push(m[1] ?? m[2] ?? m[3] ?? "");
  return out;
}
