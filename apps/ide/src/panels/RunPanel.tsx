import { CheckCircle2, Coins, FileJson, History, Play, RadioTower, RefreshCw, Send, Signature, Zap } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useEngine } from "@/engine/context";
import type { Account, PlanOutcome, RunPlugin, SendOutcome, SignOutcome, TxStatus } from "@/plugins/run";
import { formatKas } from "@/store/env";
import { ENVIRONMENTS, useIde, type ExecutionTarget } from "@/store/ide";
import { NodeBusyCover } from "@/shell/NodeOpProgress";
import { ContractGUI } from "./ContractGUI";

const TARGETS = ENVIRONMENTS.map((e) => ({ id: e.id, label: `${e.label} · ${e.networkId}`, hint: e.description }));

export function RunPanel() {
  const engine = useEngine();
  const target = useIde((s) => s.target);
  const setTarget = useIde((s) => s.setTarget);
  const workspace = useIde((s) => s.workspace);

  const [accounts, setAccounts] = useState<Account[]>([]);
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

  const loadAccounts = useCallback(async () => {
    try {
      const list = await run.accounts();
      setAccounts(list);
      if (list.length > 0 && !list.some((a) => a.name === from)) setFrom(list[0].name);
      if (list.length > 1 && !list.some((a) => a.name === to)) setTo(list[1].name);
    } catch (e) {
      setError(String(e));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run]);

  useEffect(() => {
    if (workspace?.hasConfig) void loadAccounts();
  }, [workspace?.root, workspace?.hasConfig, loadAccounts]);

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
        <button type="button" className="btn-ghost flex-1 justify-center truncate" disabled={busy !== null} onClick={() => void guard("fund", async () => void (await run.localnetFund(from, "1000")))}>
          <Coins size={14} className="shrink-0" /> <span className="truncate">Fund {from}</span>
        </button>
      </div>

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
            <button type="button" className="btn-ghost w-full justify-center mt-1" disabled={busy !== null} onClick={() => void doStatus()}>
              <RadioTower size={12} /> {busy === "status" ? "Asking the node…" : "Check status on the node"}
            </button>
            {txStatus && (
              <div className="pt-1 space-y-0.5">
                <Row k="state" v={txStatus.state + (txStatus.isFinal ? " (final)" : "")} />
                {txStatus.confirmations && <Row k="confirm." v={`${txStatus.confirmations.blue ?? "?"} ${txStatus.confirmations.unit ?? ""} · DAA ${txStatus.confirmations.daa ?? "?"}`} />}
              </div>
            )}
            <div className="text-fg-muted pt-1">Artifact saved under .hardkas/artifacts and listed in the Artifacts panel.</div>
          </Step>
        )}
      </div>

      <div className="space-y-2 border-t border-border pt-3">
        <div className="label">SilverScript contracts</div>
        <ContractGUI />
      </div>
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
      <span className="font-mono text-[11px] truncate tabular-nums" title={v}>
        {v}
      </span>
    </div>
  );
}

