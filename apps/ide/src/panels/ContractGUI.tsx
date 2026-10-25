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
 * Remix-style ContractGUI for SilverScript:
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
              <div className="flex items-center justify-between">
                <span className="font-semibold text-fg">{c.name}</span>
                <span className="text-fg-muted">{c.entries.length} entr{c.entries.length === 1 ? "y" : "ies"}</span>
              </div>
              {c.address && (
                <div className="font-mono text-[10px] text-fg-muted break-all" title="P2SH address of this contract (locking script hash)">
                  {c.address}
                </div>
              )}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <div className="text-fg-muted mb-0.5">Fund from</div>
                  <select className="input" value={from} onChange={(e) => setFrom(e.target.value)}>
                    {(accounts.length ? accounts : [{ name: "alice" }]).map((a) => (
                      <option key={a.name} value={a.name}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <div className="text-fg-muted mb-0.5">Value (KAS)</div>
                  <input className="input" value={amount} onChange={(e) => setAmount(e.target.value)} />
                </div>
              </div>
              <button
                className="btn-primary w-full justify-center"
                disabled={busy !== null}
                onClick={() => void silver.deploy({ compileRecordPath: compiled.recordPath, from, amountKas: amount, contract: compiled.contracts.length > 1 ? c.name : undefined }).catch(() => undefined)}
                title="hardkas silver deploy <record> --from --amount --wait"
              >
                <Rocket size={13} /> {busy === "deploy" ? "Deploying…" : `Deploy ${c.name}`}
              </button>
            </div>
          ))
        )}
        <div className="flex gap-1">
          <input className="input font-mono" placeholder="At record: .hardkas/artifacts/silver/silverDeploy-….json" value={atPath} onChange={(e) => setAtPath(e.target.value)} />
          <button className="btn-ghost shrink-0" disabled={!atPath} onClick={() => void silver.loadDeployRecord(atPath).catch(() => undefined)} title="Load an existing deploy record (Remix 'At Address')">
            <FolderOpen size={12} />
          </button>
        </div>
        {error && <div className="text-error whitespace-pre-wrap">{error}</div>}
      </div>

      {/* ---------------------------------------------------- deployed instances */}
      <div className="space-y-2">
        <div className="label flex items-center justify-between">
          <span>Deployed contracts · {visible.length}</span>
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
      <button onClick={() => setOpen((o) => !o)} className="w-full flex items-center gap-2 px-2 py-1.5 text-left">
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        {deploy.spent ? <PackageCheck size={13} className="text-fg-muted" /> : <Lock size={13} className="text-accent" />}
        <span className="font-semibold text-fg">{deploy.contract}</span>
        <span className="ml-auto font-mono text-fg">{deploy.spent ? "spent" : formatKas(deploy.valueSompi)}</span>
      </button>
      {open && (
        <div className="px-2 pb-2 space-y-2">
          <div className="font-mono text-[10px] text-fg-muted break-all" title="Contract P2SH address">
            {deploy.address}
          </div>
          <div className="flex items-center justify-between text-[10px] text-fg-muted">
            <span className="font-mono truncate" title={deploy.txId}>
              deploy tx {deploy.txId.slice(0, 16)}… · {deploy.status}
            </span>
            <button className="flex items-center gap-1 hover:text-accent" onClick={() => void engine.call("fileManager", "open", deploy.recordPath)} title="Open deploy record">
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
                  <div className="flex justify-between">
                    <span className="text-ok">
                      {s.contract}.{s.entry} · {s.status}
                    </span>
                    <span className="font-mono">{formatKas(s.outputSompi)}</span>
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

  return (
    <div className="rounded border border-border p-2 space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="font-mono text-fg">
          {entry.name}({entry.params.map((p) => `${p.kind} ${p.name}`).join(", ")})
        </span>
        {entry.dispatchTag && <span className="text-[10px] text-fg-muted">#{entry.dispatchTag}</span>}
      </div>
      {entry.params.map((p, i) => (
        <div key={p.name} className="flex items-center gap-2">
          <span className="w-24 shrink-0 text-fg-muted truncate" title={`${p.kind} ${p.name}`}>
            {p.name} <span className="text-[10px]">({p.kind})</span>
          </span>
          {p.kind === "sig" ? (
            <select className="input" value={values[i]} onChange={(e) => setValues((v) => v.map((x, j) => (j === i ? e.target.value : x)))}>
              {(accounts.length ? accounts : [{ name: "alice" }]).map((a) => (
                <option key={a.name} value={a.name}>
                  sign with {a.name}
                </option>
              ))}
            </select>
          ) : p.kind === "bool" ? (
            <select className="input" value={values[i]} onChange={(e) => setValues((v) => v.map((x, j) => (j === i ? e.target.value : x)))}>
              <option value="">choose…</option>
              <option value="true">true</option>
              <option value="false">false</option>
            </select>
          ) : (
            <input className="input font-mono" placeholder={placeholderFor(p)} value={values[i]} onChange={(e) => setValues((v) => v.map((x, j) => (j === i ? e.target.value : x)))} />
          )}
        </div>
      ))}
      <div className="flex items-center gap-2">
        <span className="w-24 shrink-0 text-fg-muted">to</span>
        {accounts.length > 0 ? (
          <select className="input" value={to} onChange={(e) => setTo(e.target.value)}>
            {accounts.map((a) => (
              <option key={a.name} value={a.address}>
                {a.name} · {a.address.slice(0, 18)}…
              </option>
            ))}
          </select>
        ) : (
          <input className="input font-mono" value={to} onChange={(e) => setTo(e.target.value)} placeholder="kaspasim:…" />
        )}
      </div>
      <div className="flex items-center gap-2">
        <span className="w-24 shrink-0 text-fg-muted">sequence</span>
        <input className="input font-mono" value={sequence} onChange={(e) => setSequence(e.target.value)} placeholder="optional (relative locks)" />
      </div>
      <button className="btn-ghost w-full justify-center text-warn border-warn/40" disabled={disabled || running} onClick={() => void call()} title={`hardkas silver spend ${deploy.recordPath} --entry ${entry.name}`}>
        <Send size={12} /> {running ? "Spending…" : `${entry.name} → spend ${formatKas(deploy.valueSompi)}`}
      </button>
      {err && <div className="text-error whitespace-pre-wrap">{err}</div>}
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
