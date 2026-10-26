import { ArrowDown, FileJson, ScrollText, Search } from "lucide-react";
import { useEffect, useState } from "react";
import { useEngine } from "@/engine/context";
import type { ConsolePlugin } from "@/plugins/console";
import type { IndexPlugin } from "@/plugins/indexView";
import { formatKas } from "@/store/env";
import { useIde } from "@/store/ide";
import { shortKind, useIndex } from "@/store/indexStore";
import { storeGet } from "@/utils/storeApi";
import { CopyBtn, KindChip, shorten, useRelativePath, when } from "./common";

interface TxArtifact {
  artifact_id: string;
  schema: string;
  created_at: string | null;
  mode: string | null;
  network_id: string | null;
  file_path: string | null;
  /** found through the lineage (it led to this transaction) rather than by the tx id itself */
  viaLineage?: boolean;
  summary: { status?: string; from?: string; to?: string; amountSompi?: string; feeSompi?: string; mass?: string; workflowId?: string };
}
interface TxEvent {
  event_id: string;
  kind: string;
  domain: string;
  timestamp: string;
  workflow_id: string | null;
  artifact_id: string | null;
  source_subsystem: string | null;
}
interface TxData {
  txId: string;
  artifacts: TxArtifact[];
  events: TxEvent[];
}

/** One transaction end to end: the plan, signed tx, submission and receipt the index holds for it, and its events. */
export function TransactionsTab() {
  const engine = useEngine();
  const plugin = engine.get<IndexPlugin>("queryIndex");
  const txId = useIndex((s) => s.txId);
  const set = useIndex((s) => s.set);
  const [draft, setDraft] = useState(txId);
  const [data, setData] = useState<TxData | null>(null);
  const [recent, setRecent] = useState<Array<{ txId: string; at: string; schema: string }>>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const rel = useRelativePath();
  const workspace = useIde((s) => s.workspace);

  useEffect(() => {
    storeGet<{ recent: Array<{ txId: string; at: string; schema: string }> }>("tx")
      .then((r) => setRecent(r.recent))
      .catch(() => undefined);
  }, []);

  useEffect(() => setDraft(txId), [txId]);

  useEffect(() => {
    if (!txId) {
      setData(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    storeGet<TxData>("tx", { id: txId })
      .then((d) => !cancelled && setData(d))
      .catch((e: unknown) => !cancelled && (setError(e instanceof Error ? e.message : String(e)), setData(null)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [txId]);

  const go = (id: string) => set({ txId: id.trim() });
  const explain = () => {
    useIde.getState().setTerminalOpen(true);
    void engine.get<ConsolePlugin>("console").runHardkas(["explain", "--tx", txId]);
  };

  return (
    <div className="h-full overflow-auto p-4 space-y-4">
      <form
        className="flex gap-2 max-w-3xl"
        onSubmit={(e) => {
          e.preventDefault();
          go(draft);
        }}
      >
        <div className="relative flex-1">
          <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-fg-muted" />
          <input aria-label="Transaction id" className="input !pl-7 font-mono" placeholder="paste a transaction id" value={draft} onChange={(e) => setDraft(e.target.value)} />
        </div>
        <button type="submit" className="btn-primary" disabled={!draft.trim()}>
          Look up
        </button>
      </form>

      {!txId && (
        <div className="space-y-2">
          <div className="label">Recent transactions</div>
          {recent.length === 0 && <div className="text-fg-muted">The index has no transactions yet.</div>}
          <div className="grid gap-1 max-w-3xl">
            {recent.map((r) => (
              <button key={r.txId} type="button" onClick={() => go(r.txId)} className="flex items-center gap-3 rounded border border-border bg-bg-elev px-2 py-1.5 text-left hover:bg-bg-hover cursor-pointer">
                <span className="font-mono text-[11px] truncate flex-1" title={r.txId}>
                  {shorten(r.txId, 26, 8)}
                </span>
                <span className="text-fg-muted tabular-nums shrink-0">{when(r.at)}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {loading && <div className="text-fg-muted">Looking it up…</div>}
      {error && <div role="alert" className="text-error">{error}</div>}

      {data && txId && (
        <div className="space-y-4 max-w-3xl">
          <div className="flex items-center gap-2 min-w-0">
            <span className="label mb-0">Transaction</span>
            <span className="font-mono text-[11px] truncate" title={data.txId}>
              {data.txId}
            </span>
            <CopyBtn text={data.txId} label="Copy transaction id" />
            <button type="button" className="btn-ghost ml-auto" onClick={explain} title="hardkas explain --tx: a narrative of how this transaction came to be (shown in the Console)">
              <ScrollText size={12} /> Explain
            </button>
          </div>

          {data.artifacts.length === 0 && <div className="text-fg-muted">The index holds no artifact for this transaction. If it was sent recently, sync the index from the Overview tab.</div>}

          <ol className="space-y-1">
            {data.artifacts.map((a, i) => (
              <li key={a.artifact_id}>
                {i > 0 && (
                  <div className="flex justify-center text-fg-muted">
                    <ArrowDown size={12} />
                  </div>
                )}
                <div className="rounded border border-border bg-bg-elev p-2 space-y-1">
                  <div className="flex items-center gap-2 min-w-0">
                    <KindChip schema={a.schema} />
                    <span className="text-fg-muted tabular-nums">{when(a.created_at)}</span>
                    <span className="text-fg-muted">{a.mode ?? ""}</span>
                    {a.viaLineage && <span className="text-[10px] text-fg-muted border border-border rounded px-1" title="Found through the lineage: it is what this transaction was built from">via lineage</span>}
                    <span className="font-mono text-[10px] text-fg-muted truncate ml-auto" title={a.artifact_id}>
                      {shorten(a.artifact_id, 14)}
                    </span>
                    <button type="button" className="p-0.5 rounded text-fg-muted hover:text-accent hover:bg-bg-hover cursor-pointer" title="Inspect in the Artifacts tab" aria-label="Inspect artifact" onClick={() => plugin.showArtifact(a.artifact_id)}>
                      <Search size={12} />
                    </button>
                    {rel(a.file_path) && workspace && (
                      <button type="button" className="p-0.5 rounded text-fg-muted hover:text-accent hover:bg-bg-hover cursor-pointer" title="Open the file" aria-label="Open file" onClick={() => void engine.call("fileManager", "open", rel(a.file_path))}>
                        <FileJson size={12} />
                      </button>
                    )}
                  </div>
                  <Facts s={a.summary} />
                </div>
              </li>
            ))}
          </ol>

          <div className="space-y-1">
            <div className="label">Events · {data.events.length}</div>
            {data.events.length === 0 && <div className="text-fg-muted">No events are tied to this transaction id.</div>}
            {data.events.length > 0 && (
              <div className="rounded border border-border overflow-hidden">
                {data.events.map((e) => (
                  <div key={e.event_id} className="grid grid-cols-[8.5rem_6rem_1fr_auto] gap-2 px-2 py-1 border-b border-border/40 last:border-0">
                    <span className="text-fg-muted tabular-nums">{when(e.timestamp)}</span>
                    <span className="text-fg-muted">{e.domain}</span>
                    <span className="text-fg truncate">{e.kind}</span>
                    {e.artifact_id && (
                      <button type="button" className="font-mono text-[10px] text-fg-muted hover:text-accent cursor-pointer" title={`${shortKind(e.kind)} → open artifact`} onClick={() => plugin.showArtifact(e.artifact_id!)}>
                        {shorten(e.artifact_id, 10)}
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Facts({ s }: { s: TxArtifact["summary"] }) {
  const rows: Array<[string, string]> = [];
  if (s.status) rows.push(["status", String(s.status)]);
  if (s.from) rows.push(["from", String(s.from)]);
  if (s.to) rows.push(["to", String(s.to)]);
  if (s.amountSompi) rows.push(["amount", formatKas(String(s.amountSompi))]);
  if (s.feeSompi) rows.push(["fee", formatKas(String(s.feeSompi))]);
  if (s.mass) rows.push(["mass", String(s.mass)]);
  if (s.workflowId) rows.push(["workflow", String(s.workflowId)]);
  if (rows.length === 0) return null;
  return (
    <dl className="grid grid-cols-[4.5rem_1fr] gap-x-2 gap-y-0.5">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-fg-muted">{k}</dt>
          <dd className="font-mono text-[11px] break-all">{v}</dd>
        </div>
      ))}
    </dl>
  );
}
