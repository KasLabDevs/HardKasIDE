import clsx from "clsx";
import { ChevronDown, ChevronRight, FileJson, FolderOpen, Lock, PackageCheck, Rocket, Send } from "lucide-react";
import { useEffect, useState } from "react";
import { useEngine } from "@/engine/context";
import type { SilverPlugin } from "@/plugins/silver";
import { formatKas, useEnv } from "@/store/env";
import { useSilver, type DeployRecord, type SilEntry, type SilParam } from "@/store/silver";
import { useIde } from "@/store/ide";
import { hexToBytes } from "@/utils/kaspaAddress";

/**
 * Contract GUI for SilverScript:
 *   - compiled contracts → Deploy (fund the P2SH output on localnet)
 *   - deployed instances → one button per entry, typed inputs, account signatures
 */
export function ContractGUI() {
  const engine = useEngine();
  const silver = engine.get<SilverPlugin>("silverContracts");
  const compiled = useSilver((s) => s.compiled);
  const deployments = useSilver((s) => s.deployments);
  const busy = useSilver((s) => s.busy);
  const error = useSilver((s) => s.error);
  const accounts = useEnv((s) => s.accounts);
  const target = useIde((s) => s.target);
  const [from, setFrom] = useState("alice");
  const [amount, setAmount] = useState("5");
  const [atPath, setAtPath] = useState("");
  const [showSpent, setShowSpent] = useState(false);

  useEffect(() => {
    if (accounts.length > 0 && !accounts.some((a) => a.name === from)) setFrom(accounts[0].name);
  }, [accounts, from]);

  const visible = deployments.filter((d) => showSpent || !d.spent);

  return (
    <div className="space-y-3">
      {target !== "localnet" && (
        <div className="text-warn">Contracts deploy and spend on the Local node (Docker rusty-kaspad, simnet). Switch the environment to Local node so balances match.</div>
      )}

      {/* ---------------------------------------------------- compiled → deploy */}
      <div className="space-y-2">
        <div className="label">Compiled contract</div>
        {!compiled ? (
          <div className="text-fg-muted">Compile a .sil file (Compiler panel or Ctrl+Enter) to deploy it here.</div>
        ) : (
          compiled.contracts.map((c) => (
            <div key={c.name} className="rounded border border-border bg-bg-elev p-2 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold text-fg truncate">{c.name}</span>
                <span className="text-fg-muted shrink-0 tabular-nums">{c.entries.length} entr{c.entries.length === 1 ? "y" : "ies"}</span>
              </div>
              {c.address && (
                <div className="font-mono text-[10px] text-fg-muted break-all" title="P2SH address of this contract (locking script hash)">
                  {c.address}
                </div>
              )}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <div className="text-fg-muted mb-0.5">Fund from</div>
                  <select aria-label="Fund contract from account" className="input" value={from} onChange={(e) => setFrom(e.target.value)}>
                    {(accounts.length ? accounts : [{ name: "alice" }]).map((a) => (
                      <option key={a.name} value={a.name}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <div className="text-fg-muted mb-0.5">Value (KAS)</div>
                  <input aria-label="Contract value in KAS" className="input tabular-nums" value={amount} onChange={(e) => setAmount(e.target.value)} />
                </div>
              </div>
              <button
                type="button"
                className="btn-primary w-full justify-center truncate"
                disabled={busy !== null}
                onClick={() => void silver.deploy({ compileRecordPath: compiled.recordPath, from, amountKas: amount, contract: compiled.contracts.length > 1 ? c.name : undefined }).catch(() => undefined)}
                title="hardkas silver deploy <record> --from --amount --wait"
              >
                <Rocket size={13} className="shrink-0" /> <span className="truncate">{busy === "deploy" ? "Deploying…" : `Deploy ${c.name}`}</span>
              </button>
            </div>
          ))
        )}
        <div className="flex gap-1">
          <input aria-label="Deploy record path" className="input font-mono" placeholder="At record: .hardkas/artifacts/silver/silverDeploy-….json" value={atPath} onChange={(e) => setAtPath(e.target.value)} />
          <button
            type="button"
            className="btn-ghost shrink-0"
            disabled={!atPath}
            onClick={() => void silver.loadDeployRecord(atPath).catch(() => undefined)}
            title="Load an existing deploy record ('At address')"
            aria-label="Load deploy record"
          >
            <FolderOpen size={12} />
          </button>
        </div>
        {error && <div role="alert" className="text-error whitespace-pre-wrap break-words">{error}</div>}
      </div>

      {/* ---------------------------------------------------- deployed instances */}
      <div className="space-y-2">
        <div className="label flex items-center justify-between">
          <span className="tabular-nums">Deployed contracts · {visible.length}</span>
          <label className="normal-case tracking-normal flex items-center gap-1 cursor-pointer">
            <input type="checkbox" checked={showSpent} onChange={(e) => setShowSpent(e.target.checked)} /> show spent
          </label>
        </div>
        {visible.length === 0 && <div className="text-fg-muted">No deployed contract outputs yet.</div>}
        {visible.map((d) => (
          <Instance key={d.contentHash} deploy={d} />
        ))}
      </div>
    </div>
  );
}

function Instance({ deploy }: { deploy: DeployRecord }) {
  const engine = useEngine();
  const silver = engine.get<SilverPlugin>("silverContracts");
  const busy = useSilver((s) => s.busy);
  const spends = useSilver((s) => s.spends);
  const [open, setOpen] = useState(!deploy.spent);
  const mySpends = spends.filter((s) => s.deployContentHash === deploy.contentHash);

  return (
    <div className={clsx("rounded border bg-bg-elev", deploy.spent ? "border-border opacity-70" : "border-accent/40")}>
      <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="w-full flex items-center gap-2 px-2 py-1.5 text-left cursor-pointer min-w-0">
        {open ? <ChevronDown size={12} className="shrink-0" /> : <ChevronRight size={12} className="shrink-0" />}
        {deploy.spent ? <PackageCheck size={13} className="text-fg-muted shrink-0" /> : <Lock size={13} className="text-accent shrink-0" />}
        <span className="font-semibold text-fg truncate">{deploy.contract}</span>
        <span className="ml-auto font-mono text-fg tabular-nums shrink-0">{deploy.spent ? "spent" : formatKas(deploy.valueSompi)}</span>
      </button>
      {open && (
        <div className="px-2 pb-2 space-y-2">
          <div className="font-mono text-[10px] text-fg-muted break-all" title="Contract P2SH address">
            {deploy.address}
          </div>
          <div className="flex items-center justify-between gap-2 text-[10px] text-fg-muted">
            <span className="font-mono truncate" title={deploy.txId}>
              deploy tx {deploy.txId.slice(0, 16)}… · {deploy.status}
            </span>
            <button type="button" className="flex items-center gap-1 hover:text-accent shrink-0 cursor-pointer" onClick={() => void engine.call("fileManager", "open", deploy.recordPath)} title="Open deploy record">
              <FileJson size={11} /> record
            </button>
          </div>
          {!deploy.abi && <div className="text-warn">Compile record not readable: entries unknown.</div>}
          {!deploy.spent && deploy.abi?.entries.map((entry) => <EntryCall key={entry.name} deploy={deploy} entry={entry} disabled={busy !== null} onCall={(args, to, sequence) => silver.spend({ deploy, entry: entry.name, to, args, sequence })} />)}
          {mySpends.length > 0 && (
            <div className="space-y-1">
              <div className="text-fg-muted">Spends</div>
              {mySpends.map((s) => (
                <div key={s.txId} className="rounded border border-border p-1.5 text-[10px] space-y-0.5">
                  <div className="flex justify-between gap-2">
                    <span className="text-ok truncate">
                      {s.contract}.{s.entry} · {s.status}
                    </span>
                    <span className="font-mono tabular-nums shrink-0">{formatKas(s.outputSompi)}</span>
                  </div>
                  <div className="font-mono text-fg-muted truncate" title={s.txId}>
                    tx {s.txId}
                  </div>
                  <div className="font-mono text-fg-muted truncate" title={s.to}>
                    → {s.to}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function EntryCall({ deploy, entry, disabled, onCall }: { deploy: DeployRecord; entry: SilEntry; disabled: boolean; onCall: (args: unknown[], to: string, sequence?: string) => Promise<unknown> }) {
  const accounts = useEnv((s) => s.accounts);
  const [values, setValues] = useState<string[]>(() => entry.params.map((p) => (p.kind === "sig" ? "alice" : "")));
  const [to, setTo] = useState<string>("");
  const [sequence, setSequence] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    if (!to && accounts.length > 0) setTo(accounts.find((a) => a.name === "bob")?.address ?? accounts[0].address);
  }, [accounts, to]);

  const call = async () => {
    setErr(null);
    let args: unknown[];
    try {
      args = entry.params.map((p, i) => toArg(p, values[i] ?? ""));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      return;
    }
    if (!to) {
      setErr("Recipient address is required");
      return;
    }
    setRunning(true);
    try {
      await onCall(args, to, sequence || undefined);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  };

  const sigText = `${entry.name}(${entry.params.map((p) => `${p.kind} ${p.name}`).join(", ")})`;

  return (
    <div className="rounded border border-border p-2 space-y-1.5">
      <div className="flex items-center justify-between gap-2 min-w-0">
        <span className="font-mono text-fg truncate" title={sigText}>
          {sigText}
        </span>
        {entry.dispatchTag && <span className="text-[10px] text-fg-muted shrink-0 tabular-nums">#{entry.dispatchTag}</span>}
      </div>
      {entry.params.map((p, i) => (
        <div key={p.name} className="flex items-center gap-2">
          <span className="w-24 shrink-0 text-fg-muted truncate" title={`${p.kind} ${p.name}`}>
            {p.name} <span className="text-[10px]">({p.kind})</span>
          </span>
          {p.kind === "sig" ? (
            <select aria-label={`${p.name} signature account`} className="input" value={values[i]} onChange={(e) => setValues((v) => v.map((x, j) => (j === i ? e.target.value : x)))}>
              {(accounts.length ? accounts : [{ name: "alice" }]).map((a) => (
                <option key={a.name} value={a.name}>
                  sign with {a.name}
                </option>
              ))}
            </select>
          ) : p.kind === "bool" ? (
            <select aria-label={`${p.name} boolean`} className="input" value={values[i]} onChange={(e) => setValues((v) => v.map((x, j) => (j === i ? e.target.value : x)))}>
              <option value="">choose…</option>
              <option value="true">true</option>
              <option value="false">false</option>
            </select>
          ) : (
            <input aria-label={`${p.name} (${p.kind})`} className="input font-mono" placeholder={placeholderFor(p)} value={values[i]} onChange={(e) => setValues((v) => v.map((x, j) => (j === i ? e.target.value : x)))} />
          )}
        </div>
      ))}
      <div className="flex items-center gap-2">
        <span className="w-24 shrink-0 text-fg-muted">to</span>
        {accounts.length > 0 ? (
          <select aria-label="Recipient account" className="input" value={to} onChange={(e) => setTo(e.target.value)}>
            {accounts.map((a) => (
              <option key={a.name} value={a.address}>
                {a.name} · {a.address.slice(0, 18)}…
              </option>
            ))}
          </select>
        ) : (
          <input aria-label="Recipient address" className="input font-mono" value={to} onChange={(e) => setTo(e.target.value)} placeholder="kaspasim:…" />
        )}
      </div>
      <div className="flex items-center gap-2">
        <span className="w-24 shrink-0 text-fg-muted">sequence</span>
        <input aria-label="Transaction sequence" className="input font-mono" value={sequence} onChange={(e) => setSequence(e.target.value)} placeholder="optional (relative locks)" />
      </div>
      <button
        type="button"
        className="btn-ghost w-full justify-center text-warn border-warn/40 truncate"
        disabled={disabled || running}
        onClick={() => void call()}
        title={`hardkas silver spend ${deploy.recordPath} --entry ${entry.name}`}
      >
        <Send size={12} className="shrink-0" /> <span className="truncate tabular-nums">{running ? "Spending…" : `${entry.name} → spend ${formatKas(deploy.valueSompi)}`}</span>
      </button>
      {err && <div role="alert" className="text-error whitespace-pre-wrap break-words">{err}</div>}
    </div>
  );
}

function placeholderFor(p: SilParam): string {
  switch (p.kind) {
    case "int":
      return "integer, e.g. 1000000000";
    case "pubkey":
    case "bytes":
      return "hex bytes, e.g. 3e1b14…";
    default:
      return p.kind;
  }
}

/** Builds a CLI entry argument from a typed input. */
function toArg(p: SilParam, raw: string): unknown {
  const v = raw.trim();
  switch (p.kind) {
    case "sig":
      if (!v) throw new Error(`${p.name}: choose the signing account`);
      return { kind: "signature", account: v };
    case "int":
      if (!/^-?\d+$/.test(v)) throw new Error(`${p.name}: expected an integer`);
      return { kind: "int", value: Number(v) };
    case "bool":
      if (v !== "true" && v !== "false") throw new Error(`${p.name}: expected true or false`);
      return { kind: "bool", value: v === "true" };
    default:
      if (!v) throw new Error(`${p.name}: expected hex bytes`);
      return { kind: "bytes", value: hexToBytes(v) };
  }
}
