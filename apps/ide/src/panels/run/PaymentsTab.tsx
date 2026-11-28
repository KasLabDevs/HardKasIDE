import { AlertTriangle, CheckCircle2, Coins, FileJson, History, Pickaxe, Play, RadioTower, RefreshCw, Send, Signature, Zap } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useEngine } from "@/engine/context";
import type { ConsolePlugin } from "@/plugins/console";
import type { EnvironmentPlugin } from "@/plugins/environment";
import type { PlanOutcome, RunPlugin, SendOutcome, SignOutcome, TxStatus } from "@/plugins/run";
import { formatKas, useEnv } from "@/store/env";
import { envOf, useIde } from "@/store/ide";
import { CardGroup, CommandCard } from "./CommandCard";
import { PSKT_CARDS, TX_CARDS } from "./cards";
import { psktSupport } from "./commandSpec";

/** L1 payments: plan, sign and send between the project's accounts, then the tools to read what was made. */
export function PaymentsTab() {
  const engine = useEngine();
  const target = useIde((s) => s.target);
  const accounts = useEnv((s) => s.accounts);
  const [from, setFrom] = useState("alice");
  const [to, setTo] = useState("bob");
  const [amount, setAmount] = useState("10");
  const [plan, setPlan] = useState<PlanOutcome | null>(null);
  const [signed, setSigned] = useState<SignOutcome | null>(null);
  const [sent, setSent] = useState<SendOutcome | null>(null);
  const [txStatus, setTxStatus] = useState<TxStatus | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = engine.get<RunPlugin>("deployRun");
  const env = engine.get<EnvironmentPlugin>("environment");
  const where = envOf(target);

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
    <div className="space-y-4" data-testid="l1-transfers-section">
      <div className="flex items-center gap-1.5 text-fg-muted">
        <RadioTower size={12} className="shrink-0" />
        <span className="truncate">
          Sending on <span className="text-fg">{where.label}</span> · {where.networkId}. Change it in the top bar.
        </span>
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

      <div className="rounded border border-border bg-bg-elev/60 p-2.5 space-y-3">
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

      <div className="border-t border-border pt-3">
        <CardGroup title="Read a transaction" note="What HardKAS knows about a payment, plan or receipt you already have." specs={TX_CARDS} />
      </div>
      <div className="border-t border-border pt-3">
        <PsktGroup />
      </div>
    </div>
  );
}

/**
 * PSKT (one plan, several signers). It asks the runtime what it can do first: when HardKAS reports that the runtime
 * supports no PSKT operation, the forms are folded behind that fact instead of being offered as if they worked.
 */
function PsktGroup() {
  const engine = useEngine();
  const [support, setSupport] = useState<ReturnType<typeof psktSupport> | null>(null);
  const [showAnyway, setShowAnyway] = useState(false);

  useEffect(() => {
    let alive = true;
    engine
      .get<ConsolePlugin>("console")
      .runHardkas(["pskt", "capabilities", "--json"], { quiet: true })
      .then((r) => alive && setSupport(psktSupport(r.result)))
      .catch(() => alive && setSupport({ known: false, supported: [], unsupported: [] }));
    return () => {
      alive = false;
    };
  }, [engine]);

  const none = support?.known === true && support.supported.length === 0;
  const group = <CardGroup title="Partly signed transactions (PSKT)" note="Share one plan between several signers: export, inspect, merge, finalize, extract." specs={PSKT_CARDS} />;
  if (!none) return group;
  return (
    <div className="space-y-2" data-testid="pskt-unavailable">
      <div className="label !mb-0">Partly signed transactions (PSKT)</div>
      <div role="status" className="rounded border border-warn/40 bg-warn/5 p-2 space-y-1">
        <div className="flex items-center gap-1.5 font-semibold text-warn">
          <AlertTriangle size={13} className="shrink-0" /> Not available in this runtime
        </div>
        <p className="text-fg-muted leading-snug">
          HardKAS asked the runtime ({support?.provider ?? "wasm"}) and it supports none of: {support?.unsupported.join(", ")}. Every PSKT command would answer PSKT_OPERATION_UNSUPPORTED. This is a limit of that runtime (the Kaspa WASM build), not of your project.
        </p>
        <button type="button" className="text-accent hover:underline cursor-pointer" onClick={() => setShowAnyway((s) => !s)} aria-expanded={showAnyway}>
          {showAnyway ? "Hide the commands" : "Show the commands anyway"}
        </button>
      </div>
      {showAnyway && <div className="space-y-2">{PSKT_CARDS.map((s) => <CommandCard key={s.id} spec={s} />)}</div>}
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
