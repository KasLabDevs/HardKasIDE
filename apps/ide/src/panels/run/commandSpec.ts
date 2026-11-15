/**
 * The model behind the command cards of Deploy & Run: a declarative description of one `hardkas` command (its words,
 * its fields), the pure function that turns what the person typed into an argument list, and the readers that turn
 * the command's JSON answer into rows. No React in here, so it is all testable.
 *
 * Rules the builder keeps, because the IDE server runs the command for a browser page:
 *   - a JSON field is never put on the command line: it goes to a file under `.hardkas/ide/scratch/` and the command
 *     gets the file's path (the runner refuses `& | < > ^ % !` on Windows and a JSON text is full of quotes);
 *   - a plain value that would be read as an option (starts with `-`) or holds a control character is refused here,
 *     with a message, instead of reaching the CLI.
 */

export type FieldKind = "text" | "path" | "json" | "select" | "flag";

export interface FieldSpec {
  id: string;
  label: string;
  kind: FieldKind;
  /** `arg`: a positional argument. `option`: `flag value` (or just `flag` for a `flag` field). */
  as: "arg" | "option";
  /** The option's name, "--tests". Required for `option`. */
  flag?: string;
  required?: boolean;
  placeholder?: string;
  hint?: string;
  /** `select`: the allowed values. */
  choices?: ReadonlyArray<{ value: string; label: string }>;
  /** `path`: which workspace files to suggest (a regular expression, as text). */
  suggest?: string;
  /** `json`: text the field starts with, a working example. */
  sample?: string;
  /** The value the field starts with. */
  initial?: string;
  /** `text`: a long value (hex, a script): shown in a taller box. */
  multiline?: boolean;
  /** A positional that takes several values: the text is split at commas and spaces, one argument each. */
  list?: boolean;
}

export interface CommandSpec {
  id: string;
  title: string;
  /** One sentence: what this command tells you. */
  summary: string;
  /** The command words after `hardkas`, "kcc20 encode-state". */
  words: ReadonlyArray<string>;
  fields: ReadonlyArray<FieldSpec>;
  /** HardKAS itself labels this command alpha: the card says so. */
  alpha?: boolean;
  /** Label of the run button. */
  action?: string;
  /** The command never sends anything and never needs a node: it reads, decodes, checks. Shown as a small badge. */
  offline?: boolean;
}

export interface ScratchFile {
  path: string;
  content: string;
}

export type BuildResult =
  | { ok: true; args: string[]; files: ScratchFile[] }
  | { ok: false; error: string; fieldId?: string };

export const SCRATCH_DIR = ".hardkas/ide/scratch";

// What the runner would refuse anyway (control characters; the Windows shell's specials), said here in plain words.
const CONTROL = /[\0-\x1f\x7f]/;
const SHELL_SPECIAL = /[&|<>^%!]/;

/** A value that is safe to put on the command line as a plain word, else why not. */
export function checkWord(label: string, value: string, positional: boolean): string | null {
  if (CONTROL.test(value)) return `${label}: line breaks and control characters are not allowed here.`;
  if (SHELL_SPECIAL.test(value)) return `${label}: the characters & | < > ^ % ! are not allowed in a value typed here.`;
  if (positional && value.startsWith("-")) return `${label}: a value cannot start with "-" (it would be read as an option).`;
  return null;
}

const slug = (s: string): string => s.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase() || "x";

/** Where a JSON field of a card is written. One file per card and field: running it again overwrites it. */
export function scratchPath(cardId: string, fieldId: string): string {
  return `${SCRATCH_DIR}/${slug(cardId)}-${slug(fieldId)}.json`;
}

/** JSON text, normalised (stable two-space form), or the parse error in a sentence. */
export function parseJsonText(label: string, text: string): { ok: true; text: string } | { ok: false; error: string } {
  try {
    return { ok: true, text: `${JSON.stringify(JSON.parse(text), null, 2)}\n` };
  } catch (e) {
    return { ok: false, error: `${label}: not valid JSON (${e instanceof Error ? e.message : String(e)}).` };
  }
}

export function buildCommand(spec: CommandSpec, values: Readonly<Record<string, string>>): BuildResult {
  const positional: string[] = [];
  const options: string[] = [];
  const files: ScratchFile[] = [];
  for (const f of spec.fields) {
    const raw = (values[f.id] ?? "").trim();
    if (f.kind === "flag") {
      if (raw === "true" && f.flag) options.push(f.flag);
      continue;
    }
    if (!raw) {
      if (f.required) return { ok: false, error: `${f.label} is required.`, fieldId: f.id };
      continue;
    }
    let word = raw;
    if (f.kind === "json") {
      const parsed = parseJsonText(f.label, raw);
      if (!parsed.ok) return { ok: false, error: parsed.error, fieldId: f.id };
      word = scratchPath(spec.id, f.id);
      files.push({ path: word, content: parsed.text });
    } else {
      if (f.kind === "select" && f.choices && !f.choices.some((c) => c.value === raw)) {
        return { ok: false, error: `${f.label}: "${raw}" is not one of the choices.`, fieldId: f.id };
      }
      const bad = checkWord(f.label, raw, f.as === "arg");
      if (bad) return { ok: false, error: bad, fieldId: f.id };
    }
    if (f.as === "arg") {
      if (f.list) positional.push(...word.split(/[\s,]+/).filter(Boolean));
      else positional.push(word);
    } else if (f.flag) options.push(f.flag, word);
  }
  return { ok: true, args: [...spec.words, ...positional, ...options, "--json"], files };
}

/** The command as a person would type it: `hardkas kcc20 check .hardkas/ide/scratch/kcc20-check-transfer.json`. */
export function commandLine(args: ReadonlyArray<string>): string {
  const quote = (a: string) => (/^[\w@%+=:,./\\-]+$/.test(a) ? a : `"${a.replace(/"/g, '\\"')}"`);
  return ["hardkas", ...args.filter((a) => a !== "--json").map(quote)].join(" ");
}

/** Starting values of a card: each field's `initial`, or its `sample` for JSON. */
export function initialValues(spec: CommandSpec): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of spec.fields) out[f.id] = f.initial ?? (f.kind === "json" ? (f.sample ?? "") : "");
  return out;
}

// ----- reading the answer -------------------------------------------------------------------------------------

export type Verdict = "ok" | "bad" | "info";

/**
 * What the command said about itself. HardKAS commands that judge something say it in a field named `verdict`
 * ("STRUCTURALLY_VALID", "REJECTED"), or in a boolean (`valid`, `kcc20Valid`, `verified`, `ok`, `passed`). The card colours
 * itself by that; a command that just prints information is "info". The exit code decides when there is no verdict field.
 */
export function readVerdict(result: unknown, succeeded: boolean): { verdict: Verdict; label?: string } {
  const r = result && typeof result === "object" && !Array.isArray(result) ? (result as Record<string, unknown>) : undefined;
  if (r) {
    if (typeof r.verdict === "string") {
      const v = r.verdict;
      const good = /^(STRUCTURALLY_VALID|VALID|OK|PASS(ED)?|VERIFIED|MATCH(ES)?|ACCEPTED)$/i.test(v);
      const label = v.replace(/_/g, " ").toLowerCase();
      return { verdict: good ? "ok" : "bad", label };
    }
    if (r.ok === false) return { verdict: "bad", label: typeof r.code === "string" ? r.code : "failed" };
    if (r.ok === true) return { verdict: "ok", label: "ok" };
    for (const key of ["valid", "kcc20Valid", "verified", "reproduced", "passed", "matches"]) {
      if (typeof r[key] === "boolean") {
        const word = key.replace(/^kcc20/, "").toLowerCase(); // "kcc20Valid" -> "valid"
        return { verdict: r[key] ? "ok" : "bad", label: r[key] ? word : `not ${word}` };
      }
    }
  }
  return { verdict: succeeded ? "info" : "bad" };
}

export interface ResultRow {
  key: string;
  value: string;
  /** Long text (hex, a script): shown on its own line, copyable, not squeezed beside the key. */
  long: boolean;
  /** An object or a list: shown as JSON, folded. */
  nested: boolean;
}

const LONG_AT = 48;

/** The top level of the answer as rows: scalars as text, objects and lists as folded JSON. Only what is there. */
export function resultRows(result: unknown): ResultRow[] {
  if (result === null || result === undefined) return [];
  if (typeof result !== "object") return [{ key: "result", value: String(result), long: String(result).length > LONG_AT, nested: false }];
  if (Array.isArray(result)) return [{ key: "items", value: JSON.stringify(result, null, 2), long: true, nested: true }];
  const rows: ResultRow[] = [];
  for (const [key, v] of Object.entries(result as Record<string, unknown>)) {
    if (v !== null && typeof v === "object") {
      const empty = Array.isArray(v) ? v.length === 0 : Object.keys(v).length === 0;
      rows.push({ key, value: empty ? (Array.isArray(v) ? "none" : "empty") : JSON.stringify(v, null, 2), long: !empty, nested: !empty });
    } else {
      const text = v === null ? "null" : String(v);
      rows.push({ key, value: text, long: text.length > LONG_AT || text.includes("\n"), nested: false });
    }
  }
  return rows;
}

/** One sentence for a failed run: the command's own message when it gave one, else the tail of what it printed. */
export function failureText(result: unknown, stderr: string | undefined, exitCode: number | null): string {
  const r = result && typeof result === "object" && !Array.isArray(result) ? (result as Record<string, unknown>) : undefined;
  const code = typeof r?.code === "string" ? r.code : undefined;
  const message = typeof r?.message === "string" ? r.message : typeof r?.reason === "string" ? r.reason : typeof r?.error === "string" ? r.error : undefined;
  if (message) return code ? `${code}: ${message}` : message;
  const tail = (stderr ?? "").trim().split(/\r?\n/).filter(Boolean).slice(-3).join("\n");
  if (tail) return tail;
  return exitCode === null ? "The command did not finish." : `The command failed (exit code ${exitCode}).`;
}

/**
 * Which partly-signed-transaction operations the runtime offers, from the answer of `hardkas pskt capabilities`.
 * HardKAS says it plainly when the runtime cannot do one (PSKT_OPERATION_UNSUPPORTED): the IDE asks first and says
 * so, instead of showing forms that can only fail.
 */
export function psktSupport(result: unknown): { known: boolean; supported: string[]; unsupported: string[]; provider?: string } {
  const r = result && typeof result === "object" && !Array.isArray(result) ? (result as Record<string, unknown>) : undefined;
  const ops = r?.operations && typeof r.operations === "object" && !Array.isArray(r.operations) ? (r.operations as Record<string, unknown>) : undefined;
  const provider = typeof r?.providerId === "string" ? r.providerId : undefined;
  if (!ops) return { known: false, supported: [], unsupported: [], provider };
  const names = Object.keys(ops);
  return { known: true, supported: names.filter((n) => ops[n] === true), unsupported: names.filter((n) => ops[n] !== true), provider };
}
