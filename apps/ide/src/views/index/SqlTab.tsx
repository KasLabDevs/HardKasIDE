import clsx from "clsx";
import { Clipboard, History, Play } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { storeGet, storePost } from "@/utils/storeApi";
import { copyText } from "@/utils/clipboard";
import { CopyBtn } from "./common";

interface SqlResult {
  columns: string[];
  rows: Array<Record<string, unknown>>;
  total: number;
  truncated: boolean;
  ms: number;
}
interface TableInfo {
  name: string;
  columns: Array<{ name: string; type: string }>;
  rows: number;
}

const EXAMPLES: Array<[string, string]> = [
  ["Artifacts by kind", "select schema, count(*) as n\nfrom artifacts\ngroup by schema\norder by n desc"],
  ["Latest receipts", "select created_at, mode, network_id, tx_id, file_path\nfrom artifacts\nwhere schema like 'hardkas.txReceipt%'\norder by created_at desc\nlimit 20"],
  ["Transactions and the kinds of artifact they have", "select tx_id, group_concat(distinct schema) as kinds, count(*) as artifacts\nfrom artifacts\nwhere tx_id is not null\ngroup by tx_id\norder by max(created_at) desc\nlimit 25"],
  ["Artifacts per day", "select substr(created_at, 1, 10) as day, count(*) as n\nfrom artifacts\ngroup by day\norder by day desc"],
  ["Events by domain and kind", "select domain, kind, count(*) as n\nfrom events\ngroup by domain, kind\norder by n desc"],
  ["Longest lineage chains", "select descendant_id, max(depth) as depth\nfrom lineage_closure\ngroup by descendant_id\norder by depth desc\nlimit 15"],
  ["Traces still marked running", "select trace_id, workflow_id, started_at\nfrom traces\nwhere status = 'running' and ended_at is null"]
];
const HISTORY_KEY = "hardkas-ide.sql-history";

const cell = (v: unknown): string => (v === null ? "NULL" : typeof v === "object" ? JSON.stringify(v) : String(v));

function toCsv(r: SqlResult): string {
  const esc = (v: unknown) => {
    const s = cell(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [r.columns.join(","), ...r.rows.map((row) => r.columns.map((c) => esc(row[c])).join(","))].join("\n");
}

/** Read-only SQL over the index. One statement, up to 500 rows, stopped after 6 seconds. */
export function SqlTab() {
  const [sql, setSql] = useState(EXAMPLES[0][1]);
  const [result, setResult] = useState<SqlResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [tables, setTables] = useState<TableInfo[]>([]);
  const [history, setHistory] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(HISTORY_KEY) ?? "[]") as string[];
    } catch {
      return [];
    }
  });
  const [copied, setCopied] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    storeGet<{ tables: TableInfo[] }>("schema")
      .then((r) => setTables(r.tables))
      .catch(() => undefined);
  }, []);

  const run = async () => {
    if (running) return;
    setRunning(true);
    setError(null);
    try {
      const r = await storePost<SqlResult & { ok: boolean }>("sql", { sql });
      setResult(r);
      const next = [sql, ...history.filter((h) => h !== sql)].slice(0, 20);
      setHistory(next);
      try {
        localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
      } catch {
        // history is a convenience
      }
    } catch (e) {
      setResult(null);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  };

  const insert = (text: string) => {
    const el = area.current;
    if (!el) return setSql((s) => `${s} ${text}`);
    const start = el.selectionStart;
    const end = el.selectionEnd;
    setSql(sql.slice(0, start) + text + sql.slice(end));
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + text.length, start + text.length);
    });
  };

  return (
    <div className="h-full flex min-w-0">
      <aside className="w-52 shrink-0 border-r border-border bg-bg-panel overflow-auto p-2 space-y-2">
        <div className="label">Tables</div>
        {tables.map((t) => (
          <details key={t.name} className="rounded">
            <summary className="cursor-pointer flex items-center gap-1 hover:text-accent" onClick={() => insert(t.name)} title="Click to put the name in the query">
              <span className="font-mono text-[11px]">{t.name}</span>
              <span className="ml-auto text-[10px] text-fg-muted tabular-nums">{t.rows}</span>
            </summary>
            <ul className="pl-3 mt-0.5">
              {t.columns.map((c) => (
                <li key={c.name}>
                  <button type="button" className="font-mono text-[10px] text-fg-muted hover:text-accent cursor-pointer text-left" onClick={() => insert(c.name)} title={c.type}>
                    {c.name}
                  </button>
                </li>
              ))}
            </ul>
          </details>
        ))}
      </aside>

      <div className="flex-1 min-w-0 flex flex-col">
        <div className="shrink-0 p-3 border-b border-border space-y-2">
          <textarea
            ref={area}
            aria-label="SQL query"
            spellCheck={false}
            className="input font-mono text-[12px] h-32 resize-y"
            value={sql}
            onChange={(e) => setSql(e.target.value)}
            onKeyDown={(e) => {
              if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
                e.preventDefault();
                void run();
              }
            }}
          />
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className="btn-primary" disabled={running || !sql.trim()} onClick={() => void run()} title="Ctrl+Enter">
              <Play size={12} /> {running ? "Running…" : "Run"}
            </button>
            <select aria-label="Example queries" className="input !w-auto max-w-64" value="" onChange={(e) => e.target.value !== "" && setSql(EXAMPLES[Number(e.target.value)][1])}>
              <option value="">Examples…</option>
              {EXAMPLES.map(([label], i) => (
                <option key={label} value={i}>
                  {label}
                </option>
              ))}
            </select>
            <select aria-label="Previous queries" className="input !w-auto max-w-56" value="" onChange={(e) => e.target.value !== "" && setSql(history[Number(e.target.value)])} disabled={history.length === 0}>
              <option value="">History ({history.length})</option>
              {history.map((h, i) => (
                <option key={i} value={i}>
                  {h.replace(/\s+/g, " ").slice(0, 60)}
                </option>
              ))}
            </select>
            <span className="text-fg-muted flex items-center gap-1">
              <History size={11} /> read-only
            </span>
            {result && (
              <button
                type="button"
                className="btn-ghost ml-auto"
                onClick={() =>
                  void copyText(toCsv(result)).then(() => {
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1400);
                  })
                }
              >
                <Clipboard size={12} /> {copied ? "Copied" : "Copy as CSV"}
              </button>
            )}
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-auto">
          {error && (
            <div role="alert" className="p-3 text-error whitespace-pre-wrap break-words">
              {error}
            </div>
          )}
          {result && (
            <>
              <div className="px-3 py-1.5 text-fg-muted tabular-nums">
                {result.total.toLocaleString()} row{result.total === 1 ? "" : "s"}
                {result.truncated ? ` · showing the first ${result.rows.length}` : ""} · {result.ms} ms
              </div>
              {result.columns.length === 0 ? (
                <div className="px-3 text-fg-muted">The query returned no rows.</div>
              ) : (
                <table className="min-w-full text-[11px]">
                  <thead className="sticky top-0 bg-bg-panel">
                    <tr>
                      {result.columns.map((c) => (
                        <th key={c} className="text-left font-semibold text-fg-muted px-3 py-1 border-b border-border whitespace-nowrap">
                          {c}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {result.rows.map((row, i) => (
                      <tr key={i} className="hover:bg-bg-hover/50">
                        {result.columns.map((c) => (
                          <td key={c} className={clsx("px-3 py-1 border-b border-border/40 font-mono max-w-[26rem] truncate", row[c] === null && "text-fg-muted/60 italic")} title={cell(row[c])}>
                            {cell(row[c])}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </>
          )}
          {!result && !error && (
            <div className="p-4 text-fg-muted flex items-center gap-1">
              Write a query and press Ctrl+Enter. Click a table or column on the left to put its name in the query. <CopyBtn text={sql} label="Copy the query" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
