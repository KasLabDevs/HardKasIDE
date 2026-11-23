import clsx from "clsx";
import { AlertTriangle, Check, CheckCircle2, ChevronDown, ChevronRight, Copy, KeyRound, Loader2, Play, Send, ShieldCheck, XCircle } from "lucide-react";
import { useMemo, useState } from "react";
import { useEngine } from "@/engine/context";
import type { ConsolePlugin } from "@/plugins/console";
import type { FileManagerPlugin } from "@/plugins/fileManager";
import { flattenTreePaths } from "@/shell/commandPaletteModel";
import { useEnv } from "@/store/env";
import { useIde } from "@/store/ide";
import { useSilver } from "@/store/silver";
import { copyText } from "@/utils/clipboard";
import { buildCommand, commandLine, encryptedSigners, failureText, initialValues, readVerdict, resultRows, type CommandSpec, type FieldSpec, type ResultRow, type Verdict } from "./commandSpec";

/** What one run of a command came to: its verdict, its rows, the exact command line, and why it failed when it did. */
export interface Outcome {
  verdict: Verdict;
  label?: string;
  rows: ResultRow[];
  line: string;
  failure?: string;
  raw: unknown;
  /** The command exited 0 and gave no bad verdict. */
  ok: boolean;
}

/** The outcome of a finished run (`console.runHardkas`), read the way every card reads it. */
export function outcomeOf(args: ReadonlyArray<string>, res: { status: string; exitCode: number | null; result: unknown; stderr?: string }): Outcome {
  const succeeded = res.status === "succeeded";
  const { verdict, label } = readVerdict(res.result, succeeded);
  const failed = verdict === "bad" || !succeeded;
  return {
    verdict,
    label,
    // A refusal (exit 1 with a verdict) still carries its facts: show them, plus why.
    rows: resultRows(res.result),
    line: commandLine(args),
    // An error envelope ({ ok: false, code, message }) or no answer at all: say it as a sentence above the rows.
    failure: failed && (res.result == null || (res.result as { ok?: unknown }).ok === false) ? failureText(res.result, res.stderr, res.exitCode) : undefined,
    raw: res.result,
    ok: !failed
  };
}

/**
 * One `hardkas` command as a card: its fields, a run button, and the answer read back as a verdict and rows.
 * `preset` gives some fields their starting value (a card keyed by what it presets starts over when it changes);
 * `onOutcome` hears every answer, so a view can reload what the command changed.
 */
export function CommandCard({ spec, defaultOpen = false, preset, onOutcome }: { spec: CommandSpec; defaultOpen?: boolean; preset?: Readonly<Record<string, string>>; onOutcome?: (outcome: Outcome) => void }) {
  const engine = useEngine();
  const tree = useIde((s) => s.tree);
  const compiled = useSilver((s) => s.compiled);
  const covenants = useSilver((s) => s.covenants);
  const deployments = useSilver((s) => s.deployments);
  const accounts = useEnv((s) => s.accounts);

  const [open, setOpen] = useState(defaultOpen);
  const [values, setValues] = useState<Record<string, string>>(() => initialValues(spec, preset));
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [problem, setProblem] = useState<{ fieldId?: string; text: string } | null>(null);

  const set = (id: string, v: string) => {
    setValues((cur) => ({ ...cur, [id]: v }));
    setProblem((p) => (p?.fieldId === id ? null : p));
  };

  const files = useMemo(() => {
    const all = flattenTreePaths(tree, true).filter((p) => !p.startsWith(".hardkas/ide/scratch/"));
    const records = [compiled?.recordPath, ...covenants.map((c) => c.recordPath), ...deployments.map((d) => d.recordPath)].filter((p): p is string => !!p);
    return [...new Set([...records, ...all])];
  }, [tree, compiled, covenants, deployments]);

  // A signing step with an encrypted account: the IDE never takes a password, so the command stays in the terminal.
  const blockedSigners = useMemo(() => encryptedSigners(spec, values, accounts), [spec, values, accounts]);
  const blockedLine = useMemo(() => {
    if (blockedSigners.length === 0) return null;
    const built = buildCommand(spec, values);
    return built.ok ? commandLine(built.args) : null;
  }, [blockedSigners, spec, values]);

  const run = async () => {
    const built = buildCommand(spec, values);
    if (!built.ok) {
      setOutcome(null); // the answer on screen is not the answer to what is typed now
      setProblem({ fieldId: built.fieldId, text: built.error });
      return;
    }
    if (blockedSigners.length > 0) return;
    setProblem(null);
    setBusy(true);
    setOutcome(null);
    try {
      const fm = engine.get<FileManagerPlugin>("fileManager");
      for (const f of built.files) await fm.writeFile(f.path, f.content);
      const res = await engine.get<ConsolePlugin>("console").runHardkas(built.args);
      const outcome = outcomeOf(built.args, res);
      setOutcome(outcome);
      onOutcome?.(outcome);
      if (spec.sends) void engine.call("silverContracts", "refreshDeployments").catch(() => undefined);
    } catch (e) {
      setProblem({ text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  const bodyId = `card-${spec.id}`;
  return (
    <section className="rounded border border-border bg-bg-elev/60" data-testid={`card-${spec.id}`}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-1.5 px-2.5 py-2 text-left cursor-pointer hover:bg-bg-hover/60 rounded min-w-0"
      >
        {open ? <ChevronDown size={12} className="shrink-0 text-fg-muted" /> : <ChevronRight size={12} className="shrink-0 text-fg-muted" />}
        <span className="font-semibold text-fg truncate">{spec.title}</span>
        {spec.alpha && <span className="shrink-0 rounded-full border border-warn/40 px-1.5 text-[12px] text-warn">alpha</span>}
        {spec.experimental && <ExperimentalBadge />}
        {outcome && <VerdictDot verdict={outcome.verdict} />}
      </button>

      {open && (
        <div id={bodyId} className="px-2.5 pb-2.5 space-y-2 border-t border-border/70 pt-2">
          <Summary text={spec.summary} caveat={spec.caveat} />
          {spec.offline && (
            <div className="flex items-center gap-1 text-[12px] text-fg-muted">
              <ShieldCheck size={12} className="text-ok shrink-0" /> Reads and checks only: sends nothing, signs nothing.
            </div>
          )}
          {spec.sends && (
            <div className="flex items-center gap-1 text-[12px] text-fg-muted">
              <Send size={12} className="text-accent shrink-0" /> Signs with the named development account and sends to the node. No password is taken here.
            </div>
          )}

          {spec.fields.map((f) => (
            <Field key={f.id} cardId={spec.id} field={f} value={values[f.id] ?? ""} onChange={(v) => set(f.id, v)} files={files} accounts={accounts} invalid={problem?.fieldId === f.id} />
          ))}

          {blockedSigners.length > 0 && (
            <div role="status" className="rounded border border-warn/40 bg-warn/5 p-2 space-y-1 text-[12px]" data-testid={`card-${spec.id}-terminal`}>
              <div className="flex items-center gap-1.5 font-semibold text-warn">
                <KeyRound size={12} className="shrink-0" /> {blockedSigners.join(", ")} {blockedSigners.length === 1 ? "is an encrypted account" : "are encrypted accounts"}
              </div>
              <p className="text-fg-muted leading-snug">The IDE never takes a keystore password. Run this in a terminal; HardKAS asks for the password there. Development accounts need none.</p>
              {blockedLine && <code className="block font-mono break-all rounded bg-bg p-1.5 select-all">{blockedLine}</code>}
            </div>
          )}

          <button type="button" className="btn-primary w-full justify-center" disabled={busy || blockedSigners.length > 0} onClick={() => void run()}>
            {busy ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />} {busy ? "Running…" : (spec.action ?? "Run")}
          </button>

          {problem && (
            <div role="alert" className="text-error whitespace-pre-wrap break-words">
              {problem.text}
            </div>
          )}

          {outcome && <Answer outcome={outcome} />}
        </div>
      )}
    </section>
  );
}

/** The first sentence of a text and the rest, so a card can say one line and keep the explanation behind "More". */
export function splitSummary(text: string): { lead: string; rest: string } {
  const m = /^(.*?[.!?])(\s+)(?=[A-Z`(])/s.exec(text);
  if (!m) return { lead: text, rest: "" };
  return { lead: m[1], rest: text.slice(m[0].length).trim() };
}

/** One line of summary; the rest of it (and HardKAS's caveat) behind a "More" toggle. */
function Summary({ text, caveat }: { text: string; caveat?: string }) {
  const [more, setMore] = useState(false);
  const { lead, rest } = splitSummary(text);
  const hasMore = rest.length > 0 || Boolean(caveat);
  return (
    <div className="space-y-1">
      <p className="text-fg-muted leading-snug">
        {lead}
        {hasMore && (
          <button type="button" onClick={() => setMore((m) => !m)} className="ml-1.5 text-accent hover:underline cursor-pointer" aria-expanded={more}>
            {more ? "Less" : "More"}
          </button>
        )}
      </p>
      {more && rest && <p className="text-fg-muted leading-snug">{rest}</p>}
      {more && caveat && <p className="text-[12px] text-warn leading-snug">{caveat}</p>}
    </div>
  );
}

/** HardKAS labels the command experimental: said the same way everywhere. */
export function ExperimentalBadge({ title }: { title?: string }) {
  return (
    <span className="shrink-0 rounded-full border border-warn/40 px-1.5 text-[12px] text-warn" title={title}>
      experimental
    </span>
  );
}

function VerdictDot({ verdict }: { verdict: Verdict }) {
  if (verdict === "ok") return <CheckCircle2 size={13} className="ml-auto shrink-0 text-ok" aria-label="last run: ok" />;
  if (verdict === "bad") return <XCircle size={13} className="ml-auto shrink-0 text-error" aria-label="last run: failed" />;
  return <Check size={13} className="ml-auto shrink-0 text-fg-muted" aria-label="last run: done" />;
}

function Field({
  cardId,
  field,
  value,
  onChange,
  files,
  accounts,
  invalid
}: {
  cardId: string;
  field: FieldSpec;
  value: string;
  onChange: (v: string) => void;
  files: string[];
  accounts: ReadonlyArray<{ name: string; kind: string }>;
  invalid: boolean;
}) {
  const id = `${cardId}-${field.id}`;
  const listId = `${id}-files`;
  const suggestions = useMemo(() => {
    if (field.kind !== "path" || !field.suggest) return [];
    const re = new RegExp(field.suggest, "i");
    return files.filter((p) => re.test(p)).slice(0, 80);
  }, [field.kind, field.suggest, files]);

  if (field.kind === "flag") {
    return (
      <label htmlFor={id} className="flex items-start gap-2 cursor-pointer">
        <input id={id} type="checkbox" className="mt-0.5" checked={value === "true"} onChange={(e) => onChange(e.target.checked ? "true" : "")} />
        <span>
          <span className="text-fg">{field.label}</span>
          {field.hint && <span className="block text-fg-muted">{field.hint}</span>}
        </span>
      </label>
    );
  }

  const common = { id, className: clsx("input", invalid && "!border-error"), "aria-invalid": invalid || undefined, "aria-required": field.required || undefined };
  return (
    <div>
      <label htmlFor={id} className="block text-fg-muted mb-0.5">
        {field.label}
        {field.required && <span className="text-accent"> *</span>}
      </label>
      {field.kind === "select" ? (
        <select {...common} value={value} onChange={(e) => onChange(e.target.value)}>
          {!field.required && <option value="">(default)</option>}
          {field.choices?.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
      ) : field.kind === "account" && accounts.length > 0 ? (
        // The workspace's accounts by name (the development accounts the node seeded need no password). A starting
        // value that is not one of them stays visible as such: the command gets exactly what is shown, and HardKAS
        // says ACCOUNT_NOT_FOUND if it has to.
        <select {...common} value={value} onChange={(e) => onChange(e.target.value)}>
          <option value="">{field.required ? "choose an account" : "(none)"}</option>
          {value && !accounts.some((a) => a.name === value) && <option value={value}>{value} (not an account of this workspace)</option>}
          {accounts.map((a) => (
            <option key={a.name} value={a.name}>
              {a.name} ({a.kind})
            </option>
          ))}
        </select>
      ) : field.kind === "json" || field.multiline ? (
        <textarea
          {...common}
          className={clsx(common.className, "font-mono text-[12px] resize-y", field.kind === "json" ? "min-h-40" : "min-h-14 break-all")}
          rows={field.kind === "json" ? 10 : 3}
          spellCheck={false}
          value={value}
          placeholder={field.placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : (
        <>
          <input {...common} list={field.kind === "path" ? listId : undefined} spellCheck={false} autoComplete="off" value={value} placeholder={field.kind === "account" ? "account name (no accounts loaded yet)" : field.placeholder} onChange={(e) => onChange(e.target.value)} />
          {field.kind === "path" && (
            <datalist id={listId}>
              {suggestions.map((p) => (
                <option key={p} value={p} />
              ))}
            </datalist>
          )}
        </>
      )}
      {field.hint && <div className="text-[12px] text-fg-muted mt-0.5">{field.hint}</div>}
    </div>
  );
}

/** The answer of a run: its verdict, its rows (long values copyable, objects folded) and the exact command line. */
export function Answer({ outcome }: { outcome: Outcome }) {
  const [copied, setCopied] = useState<string | null>(null);
  const copy = async (key: string, text: string) => {
    if (await copyText(text)) {
      setCopied(key);
      window.setTimeout(() => setCopied((c) => (c === key ? null : c)), 1200);
    }
  };
  const tone = outcome.verdict === "ok" ? "border-ok/40 bg-ok/5" : outcome.verdict === "bad" ? "border-error/40 bg-error/5" : "border-border bg-bg";
  return (
    <div className={clsx("rounded border p-2 space-y-1.5", tone)} role="status" aria-live="polite">
      <div className="flex items-center gap-1.5 font-semibold">
        {outcome.verdict === "ok" && <CheckCircle2 size={14} className="text-ok shrink-0" />}
        {outcome.verdict === "bad" && <AlertTriangle size={14} className="text-error shrink-0" />}
        {outcome.verdict === "info" && <Check size={14} className="text-fg-muted shrink-0" />}
        <span className={clsx(outcome.verdict === "ok" && "text-ok", outcome.verdict === "bad" && "text-error")}>
          {outcome.label ? outcome.label : outcome.verdict === "bad" ? "Failed" : "Done"}
        </span>
      </div>

      {outcome.failure && <div className="text-error whitespace-pre-wrap break-words">{outcome.failure}</div>}

      {outcome.rows.length > 0 && (
        <dl className="space-y-1">
          {outcome.rows.map((r) => (
            <div key={r.key} className="min-w-0">
              {r.nested ? (
                <details>
                  <summary className="cursor-pointer text-fg-muted hover:text-fg">{r.key}</summary>
                  <pre className="mt-1 max-h-60 overflow-auto rounded bg-bg p-1.5 font-mono text-[12px] whitespace-pre-wrap break-all">{r.value}</pre>
                </details>
              ) : r.long ? (
                <div>
                  <dt className="flex items-center justify-between text-fg-muted">
                    {r.key}
                    <button type="button" className="inline-flex items-center gap-1 hover:text-accent cursor-pointer" onClick={() => void copy(r.key, r.value)} aria-label={`Copy ${r.key}`}>
                      {copied === r.key ? <Check size={12} /> : <Copy size={12} />} {copied === r.key ? "copied" : "copy"}
                    </button>
                  </dt>
                  <dd className="font-mono text-[12px] break-all rounded bg-bg p-1.5 max-h-32 overflow-auto">{r.value}</dd>
                </div>
              ) : (
                <div className="flex gap-2 min-w-0">
                  <dt className="w-24 shrink-0 text-fg-muted truncate" title={r.key}>
                    {r.key}
                  </dt>
                  <dd className="font-mono text-[12px] break-all min-w-0">{r.value}</dd>
                </div>
              )}
            </div>
          ))}
        </dl>
      )}

      <div className="flex items-center gap-1 pt-1 border-t border-border/60 text-[12px] text-fg-muted min-w-0">
        <code className="font-mono truncate min-w-0" title={outcome.line}>
          {outcome.line}
        </code>
        <button type="button" className="shrink-0 inline-flex items-center gap-1 hover:text-accent cursor-pointer" onClick={() => void copy("cmd", outcome.line)} aria-label="Copy the command">
          {copied === "cmd" ? <Check size={12} /> : <Copy size={12} />}
        </button>
      </div>
    </div>
  );
}

/** The answer of a card, drawn by other views too (the escrow status panel). */
export function CardAnswer({ outcome }: { outcome: Outcome }) {
  return <Answer outcome={outcome} />;
}

/** A stack of cards under a short heading. */
export function CardGroup({ title, note, specs, openFirst = false }: { title: string; note?: string; specs: ReadonlyArray<CommandSpec>; openFirst?: boolean }) {
  return (
    <div className="space-y-2">
      <div>
        <div className="label !mb-0">{title}</div>
        {note && <Summary text={note} />}
      </div>
      {/* Two columns once the panel is wide (Deploy & Run as a tab in the editor area), one in a side panel. */}
      <div className="grid gap-2 @3xl:grid-cols-2 items-start">
        {specs.map((s, i) => (
          <CommandCard key={s.id} spec={s} defaultOpen={openFirst && i === 0} />
        ))}
      </div>
    </div>
  );
}
