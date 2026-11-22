import clsx from "clsx";
import { ArrowRight, FileJson, Handshake, RadioTower, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/api/client";
import { useEngine } from "@/engine/context";
import type { ConsolePlugin } from "@/plugins/console";
import { formatKas, useEnv } from "@/store/env";
import { useIde } from "@/store/ide";
import { escrowFromAnswer, escrowNextStep, newestEscrowsFirst, readEscrowRecordText, type EscrowRecordView } from "@/utils/escrowRecords";
import { MinerNotice } from "../MinerNotice";
import { CardAnswer, CommandCard, type Outcome } from "./CommandCard";
import { ESCROW_CARDS } from "./cards";
import { buildCommand, commandLine, failureText, readVerdict, resultRows } from "./commandSpec";

const ESCROW_DIR = ".hardkas/escrows";

interface RecordProblem {
  recordPath: string;
  problems: string[];
}

const card = (id: string) => {
  const spec = ESCROW_CARDS.find((c) => c.id === id);
  if (!spec) throw new Error(`no escrow card ${id}`);
  return spec;
};
const CREATE = card("escrow-create");
const STATUS = card("escrow-status");
/** The steps that name an escrow, in lifecycle order; each gets the selected escrow's id. */
const STEPS = [card("escrow-fund"), card("escrow-prepare"), card("escrow-sign"), card("escrow-release"), card("escrow-reconcile")];

/**
 * Escrow: the v2 lifecycle of `hardkas escrow` on the local node. The list is read from the records the CLI writes
 * under .hardkas/escrows (with the same tolerance as the Silver records: schema checked, problems reported); the
 * status panel is the answer of `escrow status`; every step is a command card. No password ever passes through here.
 */
export function EscrowTab() {
  const engine = useEngine();
  const target = useIde((s) => s.target);
  const setTarget = useIde((s) => s.setTarget);
  const node = useEnv((s) => s.node);
  const cli = useEnv((s) => s.cli);

  const [records, setRecords] = useState<EscrowRecordView[]>([]);
  const [problems, setProblems] = useState<RecordProblem[]>([]);
  const [listError, setListError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [status, setStatus] = useState<{ id: string; outcome: Outcome; view: EscrowRecordView | null; problems: string[] } | null>(null);
  const [statusBusy, setStatusBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const files = await api.fs.find(ESCROW_DIR, ".json");
      const found: EscrowRecordView[] = [];
      const bad: RecordProblem[] = [];
      await Promise.all(
        files.map(async (f) => {
          let text: string;
          try {
            text = await api.fs.read(f);
          } catch (e) {
            bad.push({ recordPath: f, problems: [e instanceof Error ? e.message : String(e)] });
            return;
          }
          const parsed = readEscrowRecordText(f, text);
          if (parsed.problems.length > 0) bad.push({ recordPath: f, problems: parsed.problems });
          if (parsed.record) found.push(parsed.record);
        })
      );
      setRecords(newestEscrowsFirst(found));
      setProblems(bad.sort((a, b) => a.recordPath.localeCompare(b.recordPath)));
      setListError(null);
    } catch (e) {
      setListError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // The newest record is selected when nothing is, or when the selected one disappeared.
  useEffect(() => {
    if (records.length === 0) return;
    if (!selected || !records.some((r) => r.id === selected)) setSelected(records[0].id);
  }, [records, selected]);

  const current = useMemo(() => records.find((r) => r.id === selected) ?? null, [records, selected]);

  /** `hardkas escrow status <id> --json`: the record as the CLI reads it, through the same card model as the cards. */
  const showStatus = useCallback(
    async (id: string) => {
      const built = buildCommand(STATUS, { id });
      if (!built.ok) return;
      setStatusBusy(true);
      try {
        const res = await engine.get<ConsolePlugin>("console").runHardkas(built.args);
        const succeeded = res.status === "succeeded";
        const { verdict, label } = readVerdict(res.result, succeeded);
        const failed = verdict === "bad" || !succeeded;
        const parsed = escrowFromAnswer(res.result);
        // The record itself is drawn as rows above; the answer's other fields (ok, or an error's code and message) stay.
        const { escrow: _escrow, ...rest } = parsed?.record ? (res.result as Record<string, unknown>) : { escrow: undefined };
        setStatus({
          id,
          outcome: {
            verdict,
            label,
            rows: resultRows(parsed?.record ? rest : res.result),
            line: commandLine(built.args),
            failure: failed && (res.result == null || (res.result as { ok?: unknown }).ok === false) ? failureText(res.result, res.stderr, res.exitCode) : undefined,
            raw: res.result,
            ok: !failed
          },
          view: parsed?.record ?? null,
          problems: parsed?.problems ?? []
        });
      } finally {
        setStatusBusy(false);
      }
    },
    [engine]
  );

  /** After any step: the records changed on disk, and the answer may name the escrow to select. */
  const afterStep = useCallback(
    (outcome: Outcome) => {
      const raw = outcome.raw as { id?: unknown } | null;
      const id = raw && typeof raw.id === "string" ? raw.id : null;
      void refresh().then(() => {
        if (id) setSelected(id);
        const which = id ?? selected;
        if (which && outcome.ok) void showStatus(which);
      });
    },
    [refresh, selected, showStatus]
  );

  const openRecord = (path: string) => void engine.call("fileManager", "open", path);

  return (
    <div className="space-y-4" data-testid="escrow-tab">
      {target !== "localnet" ? (
        <div className="rounded border border-warn/40 bg-warn/10 p-2 flex items-center justify-between gap-2">
          <span className="text-warn">Escrows run on the Local node (simnet): the simulator has no escrow lifecycle, and mainnet is refused.</span>
          <button type="button" onClick={() => setTarget("localnet")} className="px-2 py-0.5 rounded bg-warn/20 hover:bg-warn/30 text-warn font-semibold text-[12px] cursor-pointer shrink-0">
            Switch to Local Node
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-1.5 text-fg-muted">
          <RadioTower size={12} className="shrink-0" />
          <span className="truncate">
            On the <span className="text-fg">Local node</span> · simnet. A funding or a release confirms only while blocks are mined.
          </span>
        </div>
      )}
      {target === "localnet" && !node?.miner?.running && <MinerNotice compact />}

      {/* ------------------------------------------------------------ the records */}
      <div className="space-y-2">
        <div className="label flex items-center justify-between">
          <span>Escrows in this workspace</span>
          <button type="button" onClick={() => void refresh()} className="p-0.5 rounded text-fg-muted hover:text-fg hover:bg-bg-hover normal-case tracking-normal cursor-pointer" title={`Reload ${ESCROW_DIR}`} aria-label="Reload escrows">
            <RefreshCw size={12} />
          </button>
        </div>
        {listError && <div role="alert" className="text-error break-words">{listError}</div>}
        {problems.length > 0 && (
          <div role="status" className="rounded border border-warn/40 bg-warn/10 p-2 text-[12px] text-warn break-words space-y-0.5">
            <div>
              {problems.length} record{problems.length === 1 ? "" : "s"} under {ESCROW_DIR} could not be read as expected. A newer HardKas CLI may have changed their format; the IDE was tested with {cli?.pinned ?? "0.13.0-rc.1"}.
            </div>
            {problems.map((p) => (
              <div key={p.recordPath} className="font-mono text-fg-muted">
                {p.recordPath}: {p.problems.join("; ")}
              </div>
            ))}
          </div>
        )}
        {records.length === 0 ? (
          <div className="text-fg-muted">No escrow recorded yet ({ESCROW_DIR}). Create one below.</div>
        ) : (
          <ul className="space-y-1" aria-label="Escrows">
            {records.map((r) => {
              const active = r.id === selected;
              return (
                <li key={r.id}>
                  <button
                    type="button"
                    aria-pressed={active}
                    onClick={() => setSelected(r.id)}
                    data-testid={`escrow-row-${r.id}`}
                    className={clsx("w-full text-left rounded border p-2 space-y-0.5 cursor-pointer min-w-0", active ? "border-accent bg-accent/5" : "border-border bg-bg-elev/60 hover:bg-bg-hover/60")}
                  >
                    <div className="flex items-center gap-1.5 min-w-0">
                      <Handshake size={13} className={clsx("shrink-0", active ? "text-accent" : "text-fg-muted")} />
                      <span className="font-semibold text-fg truncate">{r.contract ?? "escrow"}</span>
                      <span className="font-mono text-[12px] text-fg-muted truncate">{r.id.slice(0, 8)}</span>
                      <StateBadge state={r.state} />
                    </div>
                    <div className="text-[12px] text-fg-muted truncate">
                      {amountText(r)} · funding {r.funding.status}
                      {r.release ? ` · release ${r.release.status}` : ""}
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* ------------------------------------------------------------ the selected escrow */}
      {current && (
        <div className="rounded border border-border bg-bg-elev/60 p-2.5 space-y-2" data-testid="escrow-selected">
          <div className="flex items-center justify-between gap-2 min-w-0">
            <span className="flex items-center gap-1.5 font-semibold text-fg truncate">
              <span className="truncate">{current.contract ?? "Escrow"}</span>
              <StateBadge state={current.state} />
            </span>
            {current.recordPath && (
              <button type="button" onClick={() => openRecord(current.recordPath!)} className="text-fg-muted hover:text-accent flex items-center gap-1 shrink-0 cursor-pointer" title={current.recordPath}>
                <FileJson size={13} /> record
              </button>
            )}
          </div>
          <RecordRows r={current} />
          <div className="flex items-start gap-1.5 text-[12px] text-fg-muted pt-1 border-t border-border/60">
            <ArrowRight size={12} className="shrink-0 mt-0.5 text-accent" />
            <span>{escrowNextStep(current)}</span>
          </div>

          <button type="button" className="btn-ghost w-full justify-center" disabled={statusBusy} onClick={() => void showStatus(current.id)} title={commandLine(["escrow", "status", current.id])}>
            <RefreshCw size={12} className={statusBusy ? "animate-spin" : ""} /> {statusBusy ? "Reading…" : "Show status (escrow status)"}
          </button>
          {status && status.id === current.id && (
            <div className="space-y-1.5" data-testid="escrow-status">
              {status.view && (
                <div className="rounded border border-border bg-bg p-2 space-y-0.5">
                  <div className="text-[12px] text-fg-muted">The record as HardKAS reads it (no node is contacted; reconcile asks the node):</div>
                  <RecordRows r={status.view} />
                </div>
              )}
              {status.problems.length > 0 && <div className="text-[12px] text-warn break-words">{status.problems.join("; ")}</div>}
              <CardAnswer outcome={status.outcome} />
            </div>
          )}
        </div>
      )}

      {/* ------------------------------------------------------------ the steps */}
      <div className="border-t border-border pt-3 space-y-2">
        <div>
          <div className="label !mb-0">Lifecycle</div>
          <div className="text-fg-muted mt-0.5 leading-snug">Create, fund, prepare a branch, sign as each required role, release, reconcile. Each step is the real command; a refusal shows its code and message. No password is typed here: an encrypted account signs in the terminal.</div>
        </div>
        <CommandCard spec={CREATE} defaultOpen={records.length === 0} onOutcome={afterStep} />
        {STEPS.map((s) => (
          <CommandCard key={`${s.id}-${selected ?? ""}`} spec={s} preset={selected ? { id: selected, target: selected } : undefined} onOutcome={afterStep} />
        ))}
      </div>
    </div>
  );
}

/** The amounts of an escrow, from its record: the principal, or the two allocations. */
function amountText(r: EscrowRecordView): string {
  if (r.principalSompi) return formatKas(r.principalSompi);
  if (r.buyerAmountSompi && r.sellerAmountSompi) return `${formatKas(r.buyerAmountSompi)} / ${formatKas(r.sellerAmountSompi)}`;
  return "amount not in the record";
}

function StateBadge({ state }: { state: string }) {
  const tone = state === "RELEASED" ? "border-ok/40 text-ok" : state === "CREATED" ? "border-border text-fg-muted" : "border-accent/40 text-accent";
  return <span className={clsx("ml-auto shrink-0 rounded-full border px-1.5 text-[12px] font-mono", tone)}>{state}</span>;
}

/** The facts of a record, each one as the record has it. */
function RecordRows({ r }: { r: EscrowRecordView }) {
  return (
    <div className="space-y-0.5">
      <Row k="id" v={r.id} />
      <Row k="address" v={r.address} />
      {r.networkId && <Row k="network" v={r.networkId} />}
      {r.principalSompi && <Row k="principal" v={`${formatKas(r.principalSompi)} (${r.principalSompi} sompi)`} />}
      {r.buyerAmountSompi && <Row k="buyer" v={`${formatKas(r.buyerAmountSompi)} (${r.buyerAmountSompi} sompi)`} />}
      {r.sellerAmountSompi && <Row k="seller" v={`${formatKas(r.sellerAmountSompi)} (${r.sellerAmountSompi} sompi)`} />}
      {r.feeBudgetSompi && <Row k="fee budget" v={`${r.feeBudgetSompi} sompi`} />}
      <Row k="funding" v={`${r.funding.status}${r.funding.amountSompi ? ` · ${formatKas(r.funding.amountSompi)}` : ""}${r.funding.transactionId ? ` · ${r.funding.transactionId}${r.funding.outputIndex !== undefined ? `:${r.funding.outputIndex}` : ""}` : ""}`} />
      {r.preparedRelease && <Row k="prepared" v={`${r.preparedRelease.branch}${r.preparedRelease.mutualSplit ? ` · buyer ${formatKas(r.preparedRelease.mutualSplit.buyerSompi)} / seller ${formatKas(r.preparedRelease.mutualSplit.sellerSompi)}` : ""}`} />}
      {(r.preparedRelease || r.signatures.length > 0) && <Row k="signed by" v={r.signatures.join(", ") || "nobody yet"} />}
      {r.release && <Row k="release" v={`${r.release.status} · ${r.release.transactionId}${r.release.feeSompi ? ` · fee ${r.release.feeSompi} sompi` : ""}`} />}
      {r.updatedAt && <Row k="updated" v={r.updatedAt} />}
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex gap-2 min-w-0">
      <span className="w-16 shrink-0 text-fg-muted">{k}</span>
      <span className="font-mono text-[12px] truncate tabular-nums" title={v}>
        {v}
      </span>
    </div>
  );
}
