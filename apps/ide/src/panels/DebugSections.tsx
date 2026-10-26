import clsx from "clsx";
import { ChevronDown, ChevronRight, CircleDot, Plus, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useEngine } from "@/engine/context";
import type { DebugPlugin } from "@/plugins/debug";
import { useDebug, type DebugVariable } from "@/store/debug";

export function Tool({ icon, label, onClick, disabled, accent, danger }: { icon: React.ReactNode; label: string; onClick: () => void; disabled?: boolean; accent?: boolean; danger?: boolean }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={clsx(
        "flex-1 h-8 grid place-items-center rounded border border-border cursor-pointer transition-colors disabled:opacity-40 disabled:cursor-not-allowed",
        accent ? "text-ok hover:bg-bg-hover" : danger ? "text-error hover:bg-bg-hover" : "text-fg hover:bg-bg-hover"
      )}
    >
      {icon}
    </button>
  );
}

export function Section({ title, count, children, defaultOpen = true, actions }: { title: string; count?: number; children: React.ReactNode; defaultOpen?: boolean; actions?: React.ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="border-b border-border">
      <div className="flex items-center justify-between pr-2">
        <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="flex-1 flex items-center gap-1 px-3 py-1.5 text-left cursor-pointer label mb-0">
          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />} {title}
          {count !== undefined && <span className="normal-case tracking-normal text-fg-muted tabular-nums">· {count}</span>}
        </button>
        {actions}
      </div>
      {open && <div className="px-3 pb-2">{children}</div>}
    </section>
  );
}

export function CallStack() {
  const engine = useEngine();
  const plugin = engine.get<DebugPlugin>("debug");
  const frames = useDebug((s) => s.frames);
  const current = useDebug((s) => s.frame);
  return (
    <Section title="Call stack" count={frames.length}>
      <ul>
        {frames.map((f, i) => (
          <li key={f.id}>
            <button
              type="button"
              onClick={() => plugin.selectFrame(i)}
              className={clsx("w-full flex items-center gap-2 px-1.5 py-0.5 rounded text-left cursor-pointer", i === current ? "bg-bg-hover text-fg" : f.file ? "text-fg-muted hover:text-fg hover:bg-bg-hover" : "text-fg-muted/50 hover:bg-bg-hover")}
              title={f.file ? `${f.file}:${f.line}` : f.url}
            >
              <span className="font-mono truncate">{f.name}</span>
              <span className="ml-auto font-mono text-[10px] shrink-0 tabular-nums">{f.file ? `${f.file.split("/").pop()}:${f.line}` : "external"}</span>
            </button>
          </li>
        ))}
      </ul>
    </Section>
  );
}

export function Variables({ plugin }: { plugin: DebugPlugin }) {
  const frame = useDebug((s) => s.frames[s.frame]);
  if (!frame) return null;
  const scopes = frame.scopes.filter((sc) => sc.objectId && sc.type !== "script");
  return (
    <Section title="Variables">
      {scopes.length === 0 && <div className="text-fg-muted">No variables in this frame.</div>}
      {scopes.map((sc, i) => (
        <ScopeNode key={`${frame.id}:${sc.type}:${i}`} label={`${sc.type[0].toUpperCase()}${sc.type.slice(1)}${sc.name ? `: ${sc.name}` : ""}`} objectId={sc.objectId!} plugin={plugin} defaultOpen={sc.type === "local" || (sc.type === "block" && i === 0)} />
      ))}
    </Section>
  );
}

function ScopeNode({ label, objectId, plugin, defaultOpen }: { label: string; objectId: string; plugin: DebugPlugin; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const cache = useDebug((s) => s.vars[objectId]);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (open && !cache) void plugin.loadVariables(objectId).catch((e: unknown) => setErr(e instanceof Error ? e.message : String(e)));
  }, [open, cache, objectId, plugin]);
  return (
    <div className="mb-1">
      <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="flex items-center gap-1 text-fg-muted hover:text-fg cursor-pointer">
        {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />} {label}
      </button>
      {open && (
        <div className="pl-3">
          {err && <div className="text-error">{err}</div>}
          {!cache && !err && <div className="text-fg-muted">loading…</div>}
          {cache?.length === 0 && <div className="text-fg-muted">empty</div>}
          {cache?.map((v) => <VarRow key={v.name} v={v} plugin={plugin} />)}
        </div>
      )}
    </div>
  );
}

function VarRow({ v, plugin }: { v: DebugVariable; plugin: DebugPlugin }) {
  const [open, setOpen] = useState(false);
  const kids = useDebug((s) => (v.objectId ? s.vars[v.objectId] : undefined));
  useEffect(() => {
    if (open && v.objectId && !kids) void plugin.loadVariables(v.objectId).catch(() => undefined);
  }, [open, kids, v.objectId, plugin]);
  const expandable = !!v.objectId && v.type !== "function";
  return (
    <div>
      <div className="flex items-baseline gap-1 min-w-0">
        {expandable ? (
          <button type="button" aria-label={open ? `Collapse ${v.name}` : `Expand ${v.name}`} aria-expanded={open} onClick={() => setOpen((o) => !o)} className="shrink-0 text-fg-muted hover:text-fg cursor-pointer self-center">
            {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
          </button>
        ) : (
          <span className="w-[11px] shrink-0" />
        )}
        <span className="text-info font-mono shrink-0">{v.name}</span>
        <span className="text-fg-muted">:</span>
        <span className={clsx("font-mono truncate", v.type === "string" ? "text-warn" : v.value === "undefined" || v.value === "null" ? "text-fg-muted" : "text-fg")} title={v.value}>
          {v.value}
        </span>
      </div>
      {open && expandable && (
        <div className="pl-4">
          {!kids && <div className="text-fg-muted">loading…</div>}
          {kids?.map((c) => <VarRow key={c.name} v={c} plugin={plugin} />)}
        </div>
      )}
    </div>
  );
}

export function Watches({ plugin }: { plugin: DebugPlugin }) {
  const watches = useDebug((s) => s.watches);
  const results = useDebug((s) => s.watchResults);
  const paused = useDebug((s) => s.state === "paused");
  const [draft, setDraft] = useState("");
  const add = () => {
    plugin.addWatch(draft);
    setDraft("");
  };
  return (
    <Section title="Watch" count={watches.length}>
      <div className="flex gap-1 mb-1">
        <input aria-label="Add watch expression" className="input font-mono" placeholder="expression, e.g. alice.address" value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} />
        <button type="button" className="btn-ghost shrink-0" onClick={add} disabled={!draft.trim()} aria-label="Add watch">
          <Plus size={12} />
        </button>
      </div>
      {watches.map((w) => {
        const r = results[w];
        return (
          <div key={w} className="group flex items-baseline gap-1 min-w-0">
            <span className="font-mono text-info shrink-0">{w}</span>
            <span className="text-fg-muted">=</span>
            <span className={clsx("font-mono truncate flex-1", r?.error ? "text-error" : "text-fg")} title={r?.error ?? r?.value}>
              {!paused ? "…" : r ? (r.error ? r.error : r.value) : "…"}
            </span>
            <button type="button" aria-label={`Remove watch ${w}`} className="opacity-0 group-hover:opacity-100 focus:opacity-100 text-fg-muted hover:text-error cursor-pointer" onClick={() => plugin.removeWatch(w)}>
              <X size={11} />
            </button>
          </div>
        );
      })}
      {watches.length === 0 && <div className="text-fg-muted">Expressions you add are evaluated every time the debugger stops.</div>}
    </Section>
  );
}

export function Breakpoints({ plugin }: { plugin: DebugPlugin }) {
  const breakpoints = useDebug((s) => s.breakpoints);
  const status = useDebug((s) => s.status);
  const files = Object.keys(breakpoints).sort();
  const total = files.reduce((n, f) => n + breakpoints[f].length, 0);
  const open = (file: string, line: number) => void plugin.call("fileManager", "open", file).then(() => plugin.call("editor", "gotoLine", line)).catch(() => undefined);
  return (
    <Section
      title="Breakpoints"
      count={total}
      actions={
        total > 0 ? (
          <button type="button" className="text-[10px] text-fg-muted hover:text-error cursor-pointer" onClick={() => void plugin.clearBreakpoints()}>
            remove all
          </button>
        ) : undefined
      }
    >
      {total === 0 && <div className="text-fg-muted">Click the gutter left of a line number in the editor (or press F9) to add one.</div>}
      {files.map((f) => (
        <div key={f} className="mb-1">
          <div className="font-mono text-[10px] text-fg-muted truncate" title={f}>
            {f}
          </div>
          {breakpoints[f].map((line) => {
            const st = status[f]?.[line];
            return (
              <div key={line} className="group flex items-center gap-1.5">
                <CircleDot size={11} className={st && !st.verified ? "text-fg-muted" : "text-error"} />
                <button type="button" className="font-mono hover:text-accent cursor-pointer tabular-nums" onClick={() => open(f, st?.actual ?? line)}>
                  line {line}
                  {st?.verified && st.actual !== undefined && st.actual !== line ? ` → ${st.actual}` : ""}
                </button>
                {st && !st.verified && <span className="text-[10px] text-fg-muted">no code on this line</span>}
                <button type="button" aria-label={`Remove breakpoint ${f}:${line}`} className="ml-auto opacity-0 group-hover:opacity-100 focus:opacity-100 text-fg-muted hover:text-error cursor-pointer" onClick={() => void plugin.toggleBreakpoint(f, line)}>
                  <X size={11} />
                </button>
              </div>
            );
          })}
        </div>
      ))}
    </Section>
  );
}

export function Output() {
  const output = useDebug((s) => s.output);
  const ref = useRef<HTMLPreElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [output.length]);
  return (
    <Section title="Test output" count={output.length} defaultOpen={false}>
      <pre ref={ref} className="max-h-56 overflow-auto rounded border border-border bg-bg p-2 text-[10px] leading-snug whitespace-pre-wrap break-words">
        {output.length === 0 && <span className="text-fg-muted">Nothing yet.</span>}
        {output.map((l, i) => (
          <span key={i} className={l.stream === "stderr" ? "text-warn" : l.stream === "debug" ? "text-info" : "text-fg"}>
            {l.stream === "debug" ? `» ${l.text}\n` : l.text}
          </span>
        ))}
      </pre>
    </Section>
  );
}
