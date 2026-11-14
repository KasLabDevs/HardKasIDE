import clsx from "clsx";
import { ArrowRightLeft, CheckCircle2, ChevronDown, ChevronRight, Coins, FileJson, GitBranch, History, Pickaxe, Play, RadioTower, RefreshCw, Send, Signature, Zap } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useEngine } from "@/engine/context";
import type { EnvironmentPlugin } from "@/plugins/environment";
import type { PlanOutcome, RunPlugin, SendOutcome, SignOutcome, TxStatus } from "@/plugins/run";
import { formatKas, useEnv } from "@/store/env";
import { ENVIRONMENTS, useIde, type ExecutionTarget } from "@/store/ide";
import { useSilver } from "@/store/silver";
import { groupCovenantChains } from "@/utils/silverRecords";
import { NodeBusyCover } from "@/shell/NodeOpProgress";
import { ContractGUI } from "./ContractGUI";
import { CovenantChainSection } from "./CovenantGUI";

const TARGETS = ENVIRONMENTS.map((e) => ({ id: e.id, label: `${e.label} · ${e.networkId}`, hint: e.description }));

export function RunPanel() {
  const engine = useEngine();
  const target = useIde((s) => s.target);
  const setTarget = useIde((s) => s.setTarget);

  const accounts = useEnv((s) => s.accounts);
  const covenants = useSilver((s) => s.covenants);
  const covenantChains = useMemo(() => groupCovenantChains(covenants), [covenants]);
  const [sectionMode, setSectionMode] = useState<"all" | "covenants" | "transfers">("all");
  const [transfersOpen, setTransfersOpen] = useState(true);
  const userToggledTransfersRef = useRef(false);
  const [from, setFrom] = useState("alice");
  const [to, setTo] = useState("bob");
  const [amount, setAmount] = useState("10");
  const [plan, setPlan] = useState<PlanOutcome | null>(null);
  const [signed, setSigned] = useState<SignOutcome | null>(null);
  const [sent, setSent] = useState<SendOutcome | null>(null);
  const [txStatus, setTxStatus] = useState<TxStatus | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (userToggledTransfersRef.current || plan || signed || sent || error) return;
    setTransfersOpen(covenantChains.length === 0);
  }, [covenantChains.length, plan, signed, sent, error]);

  const run = engine.get<RunPlugin>("deployRun");
  const env = engine.get<EnvironmentPlugin>("environment");

  const loadAccounts = useCallback(async () => {
    try {
      await env.refreshAccounts();
    } catch (e) {
      setError(String(e));
    }
  }, [env]);

  useEffect(() => {
    if (accounts.length > 0 && !accounts.some((a) => a.name === from)) setFrom(accounts[0].name);
    if (accounts.length > 1 && !accounts.some((a) => a.name === to)) setTo(accounts[1].name);
  }, [accounts, from, to]);

  const guard = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const doPlan = () =>
    guard("plan", async () => {
      setSigned(null);
      setSent(null);
      setPlan(await run.plan({ from, to, amount, target }));
    });
  const doSign = () =>
    guard("sign", async () => {
      if (!plan) return;
      setSent(null);
      setSigned(await run.sign(plan.planPath, from, target));
    });
  const doSend = () =>
    guard("send", async () => {
      if (!signed) return;
      setTxStatus(null);
      setSent(await run.send(signed.signedPath, target));
    });
  const doStatus = () =>
    guard("status", async () => {
      const txId = sent?.receipt?.txId ?? signed?.txId;
      if (!txId) return;
      const network = sent?.receipt?.networkId ?? (target === "simulator" ? "simulated" : target === "localnet" ? "simnet" : "testnet-10");
      setTxStatus(await run.txStatus(txId, network));
    });
  const doAll = () =>
    guard("all", async () => {
      setSigned(null);
      setSent(null);
      setTxStatus(null);
      const p = await run.plan({ from, to, amount, target });
      setPlan(p);
      const s = await run.sign(p.planPath, from, target);
      setSigned(s);
      setSent(await run.send(s.signedPath, target));
    });

  const openInEditor = (path: string) => void engine.call("fileManager", "open", path);
  const accountSelect = (label: string, value: string, onChange: (v: string) => void) =>
    accounts.length > 0 ? (
      <select aria-label={label} className="input" value={value} onChange={(e) => onChange(e.target.value)}>
        {accounts.map((a) => (
          <option key={a.name} value={a.name}>
            {a.name} ({a.kind})
          </option>
        ))}
      </select>
    ) : (
      <input aria-label={label} className="input" value={value} onChange={(e) => onChange(e.target.value)} placeholder="account name or address" />
    );

  return (
    <div className="p-3 space-y-4 text-xs relative min-h-full">
      {target === "localnet" && <NodeBusyCover label="The local node is changing…" />}
      <div>
        <label htmlFor="run-env-select" className="label">Environment</label>
        <select id="run-env-select" className="input" value={target} onChange={(e) => setTarget(e.target.value as ExecutionTarget)}>
          {TARGETS.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </select>
        <div className="text-fg-muted mt-1">{TARGETS.find((t) => t.id === target)?.hint}</div>
      </div>

      <button type="button" className="btn-ghost w-full justify-center" onClick={() => void engine.call("runHistory", "open")} title="Payments, deploys and contract calls, with a tab per contract">
        <History size={14} /> Run history
      </button>

      <div className="flex gap-2">
        <button type="button" className="btn-ghost flex-1 justify-center" disabled={busy !== null} onClick={() => void guard("status", async () => void (await run.localnetStatus()))}>
          <RadioTower size={14} /> Localnet status
        </button>
        <button type="button" className="btn-ghost flex-1 justify-center truncate" disabled={busy !== null} onClick={() => void guard("fund", async () => void (await run.localnetFund(from, "100")))}>
          <Coins size={14} className="shrink-0" /> <span className="truncate">{busy === "fund" ? "Funding…" : `Fund ${from}`}</span>
        </button>
      </div>

      {busy === "fund" && target === "localnet" && (
        <div role="status" className="rounded bg-accent/10 border border-accent/30 p-2 space-y-1">
          <div className="flex items-center gap-1.5 text-[12px] text-accent font-medium">
            <Pickaxe size={12} className="animate-spin" /> Funding on the local node…
          </div>
          <div className="text-[12px] text-fg-muted">hardkas localnet fund --treasury: transfers exact KAS from the localnet Treasury (only mines coinbases if the Treasury needs reserve).</div>
        </div>
      )}

      {/* Visual parity switcher: Transfers vs Toccata Covenants v1 */}
      <div
        className="grid grid-cols-3 gap-0.5 rounded border border-border bg-bg-elev p-0.5 text-[12px]"
        role="tablist"
        aria-label="Deploy & Run view filter"
        data-testid="deploy-run-mode-bar"
      >
        <button
          type="button"
          role="tab"
          aria-selected={sectionMode === "all"}
          data-testid="run-mode-all"
          onClick={() => setSectionMode("all")}
          className={clsx(
            "rounded px-1.5 py-1 font-medium cursor-pointer transition-colors truncate",
            sectionMode === "all" ? "bg-accent/15 text-accent" : "text-fg-muted hover:text-fg"
          )}
        >
          All
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={sectionMode === "covenants"}
          data-testid="run-mode-covenants"
          onClick={() => setSectionMode("covenants")}
          className={clsx(
            "rounded px-1.5 py-1 font-medium cursor-pointer transition-colors flex items-center justify-center gap-1 truncate",
            sectionMode === "covenants" ? "bg-accent/15 text-accent" : "text-fg-muted hover:text-fg"
          )}
        >
          <GitBranch size={11} className="shrink-0" />
          <span className="truncate">Covenants</span>
          {covenantChains.length > 0 && (
            <span className="px-1 rounded-full bg-accent/20 text-accent text-[12px] font-mono tabular-nums">
              {covenantChains.length}
            </span>
          )}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={sectionMode === "transfers"}
          data-testid="run-mode-transfers"
          onClick={() => setSectionMode("transfers")}
          className={clsx(
            "rounded px-1.5 py-1 font-medium cursor-pointer transition-colors flex items-center justify-center gap-1 truncate",
            sectionMode === "transfers" ? "bg-accent/15 text-accent" : "text-fg-muted hover:text-fg"
          )}
        >
          <ArrowRightLeft size={11} className="shrink-0" />
          <span className="truncate">Transfers</span>
        </button>
      </div>

      {(sectionMode === "all" || sectionMode === "transfers") && (
        <div className="rounded border border-border bg-bg-elev/60" data-testid="l1-transfers-section">
          {sectionMode === "all" ? (
            <button
              type="button"
              aria-expanded={transfersOpen}
              onClick={() => {
                userToggledTransfersRef.current = true;
                setTransfersOpen((o) => !o);
              }}
              className="w-full flex items-center gap-1.5 px-2.5 py-1.5 text-left cursor-pointer hover:bg-bg-hover/60 rounded-t min-w-0"
            >
              {transfersOpen ? <ChevronDown size={12} className="shrink-0 text-fg-muted" /> : <ChevronRight size={12} className="shrink-0 text-fg-muted" />}
              <ArrowRightLeft size={12} className="shrink-0 text-fg-muted" />
              <span className="label !mb-0 shrink-0">L1 Transfers</span>
              <span className="ml-auto text-[12px] font-mono text-fg-muted truncate tabular-nums">
                {from} → {to} · {amount} KAS
              </span>
            </button>
          ) : null}

          {(sectionMode === "transfers" || transfersOpen) && (
            <div className={clsx("p-2.5 space-y-3", sectionMode === "all" && "border-t border-border/70")}>
              <div className="space-y-2">
                <div className="label flex items-center justify-between">
                  <span>Accounts</span>
                  <button type="button" onClick={() => void loadAccounts()} className="p-0.5 rounded text-fg-muted hover:text-fg hover:bg-bg-hover normal-case tracking-normal cursor-pointer" title="Reload accounts" aria-label="Reload accounts">
                    <RefreshCw size={12} />
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <div className="text-fg-muted mb-0.5">From</div>
                    {accountSelect("From account", from, setFrom)}
                  </div>
                  <div>
                    <div className="text-fg-muted mb-0.5">To</div>
                    {accountSelect("To account", to, setTo)}
                  </div>
                </div>
                <div>
                  <label htmlFor="run-amount-input" className="block text-fg-muted mb-0.5">Amount (KAS)</label>
                  <input id="run-amount-input" className="input tabular-nums" value={amount} onChange={(e) => setAmount(e.target.value)} />
                </div>
              </div>

              <div className="space-y-2">
                <div className="label">Lifecycle</div>
                <button type="button" className="btn-primary w-full justify-center" disabled={busy !== null} onClick={() => void doAll()}>
                  <Zap size={14} /> {busy === "all" ? "Running…" : "Plan → Sign → Send"}
                </button>
                <div className="grid grid-cols-3 gap-1">
                  <button type="button" className="btn-ghost justify-center" disabled={busy !== null} onClick={() => void doPlan()}>
                    <Play size={12} /> {busy === "plan" ? "…" : "Plan"}
                  </button>
                  <button type="button" className="btn-ghost justify-center" disabled={busy !== null || !plan} onClick={() => void doSign()}>
                    <Signature size={12} /> {busy === "sign" ? "…" : "Sign"}
                  </button>
                  <button type="button" className="btn-ghost justify-center" disabled={busy !== null || !signed} onClick={() => void doSend()}>
                    <Send size={12} /> {busy === "send" ? "…" : "Send"}
                  </button>
                </div>
                {error && <div role="alert" className="text-error whitespace-pre-wrap break-words">{error}</div>}

                {plan && (
                  <Step title="Plan" done onOpen={() => openInEditor(plan.planPath)}>
                    <Row k="planId" v={plan.planId} />
                    <Row k="amount" v={formatKas(plan.amountSompi)} />
                    <Row k="est. fee" v={`${plan.estimatedFeeSompi} sompi`} />
                  </Step>
                )}
                {signed && (
                  <Step title="Signed" done onOpen={() => openInEditor(signed.signedPath)}>
                    <Row k="signedId" v={signed.signedId} />
                    <Row k="txId" v={signed.txId} />
                  </Step>
                )}
                {sent?.receipt && (
                  <Step
                    title={`${sent.receipt.schema.includes("Submission") ? "Submitted" : "Receipt"} · ${sent.receipt.status}`}
                    done
                    onOpen={sent.receiptPath ? () => openInEditor(sent.receiptPath!) : undefined}
                  >
                    <Row k="txId" v={sent.receipt.txId} />
                    <Row k="fee" v={`${sent.receipt.feeSompi ?? "?"} sompi${sent.receipt.mass ? ` · mass ${sent.receipt.mass}` : ""}`} />
                    <Row k="network" v={`${sent.receipt.networkId ?? ""} (${sent.receipt.mode ?? ""})`} />
                    {sent.receipt.submitPoint?.sinkBlueScore && <Row k="accepted@" v={`blue score ${sent.receipt.submitPoint.sinkBlueScore} · DAA ${sent.receipt.submitPoint.virtualDaaScore ?? "?"}`} />}
                    {/simul/i.test(`${sent.receipt.mode ?? ""} ${sent.receipt.networkId ?? ""}`) ? (
                      // A Simulator receipt is synthetic: no node ever saw this transaction, so there is nothing to ask.
                      <div className="text-[12px] text-fg-muted pt-1">Simulator receipt: synthetic, no node to ask.</div>
                    ) : (
                      <button type="button" className="btn-ghost w-full justify-center mt-1" disabled={busy !== null} onClick={() => void doStatus()}>
                        <RadioTower size={12} /> {busy === "status" ? "Asking the node…" : "Check status on the node"}
                      </button>
                    )}
                    {txStatus && (
                      <div className="pt-1 space-y-0.5">
                        <Row k="state" v={txStatus.state + (txStatus.isFinal ? " (final)" : "")} />
                        {txStatus.confirmations && <Row k="confirm." v={`${txStatus.confirmations.blue ?? "?"} ${txStatus.confirmations.unit ?? ""} · DAA ${txStatus.confirmations.daa ?? "?"}`} />}
                      </div>
                    )}
                    <div className="text-fg-muted pt-1">Artifact saved under .hardkas/artifacts and listed in Lineage and Index.</div>
                  </Step>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {sectionMode !== "transfers" && (
        <>
          <div className="space-y-2 border-t border-border pt-3">
            <CovenantChainSection alwaysShowHeader />
          </div>

          <div className="space-y-2 border-t border-border pt-3">
            <div className="label">SilverScript contracts</div>
            <ContractGUI includeCovenants={false} />
          </div>
        </>
      )}
    </div>
  );
}

function Step({ title, done, onOpen, children }: { title: string; done?: boolean; onOpen?: () => void; children: React.ReactNode }) {
  return (
    <div className="rounded border border-border bg-bg-elev p-2 space-y-0.5">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 font-semibold text-fg truncate">
          {done && <CheckCircle2 size={13} className="text-ok shrink-0" />} <span className="truncate">{title}</span>
        </span>
        {onOpen && (
          <button type="button" onClick={onOpen} className="text-fg-muted hover:text-accent flex items-center gap-1 shrink-0 cursor-pointer" title="Open artifact JSON">
            <FileJson size={13} /> open
          </button>
        )}
      </div>
      {children}
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex gap-2 min-w-0">
      <span className="w-14 shrink-0 text-fg-muted">{k}</span>
      <span className="font-mono text-[12px] truncate tabular-nums" title={v}>
        {v}
      </span>
    </div>
  );
}

