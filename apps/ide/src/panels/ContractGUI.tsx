import clsx from "clsx";
import { Check, ChevronDown, ChevronRight, FileCode2, FileJson, FolderOpen, Lock, PackageCheck, Rocket, Send, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "@/api/client";
import { useEngine } from "@/engine/context";
import type { CompilerPlugin } from "@/plugins/compiler";
import type { SilverPlugin } from "@/plugins/silver";
import { formatKas, useEnv } from "@/store/env";
import { useSilver, type DeployRecord, type SilContractAbi, type SilEntry, type SilParam } from "@/store/silver";
import { useIde } from "@/store/ide";
import { hexToBytes, pubkeyFromAddress } from "@/utils/kaspaAddress";
import { generateTypeChain } from "@/utils/typechain";

/**
 * Contract GUI for SilverScript:
 *   - compiled contracts → Deploy (fund the P2SH output on localnet) with visual constructor args
 *   - deployed instances → one button per entry, typed inputs, account signatures
 *   - TypeChain SDK generator for TypeScript
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
  const setTarget = useIde((s) => s.setTarget);
  const [from, setFrom] = useState("alice");
  const [amount, setAmount] = useState("5");
  const [atPath, setAtPath] = useState("");
  const [showSpent, setShowSpent] = useState(false);
  const [constructorValues, setConstructorValues] = useState<Record<string, Record<string, string>>>({});
  const [sdkNotice, setSdkNotice] = useState<string | null>(null);

  useEffect(() => {
    if (accounts.length > 0 && !accounts.some((a) => a.name === from)) setFrom(accounts[0].name);
  }, [accounts, from]);

  const visible = deployments.filter((d) => showSpent || !d.spent);

  const handleGenerateSdk = async (c: SilContractAbi) => {
    try {
      const code = generateTypeChain(c, compiled?.sourcePath);
      const outPath = `contracts/${c.name}.ts`;
      await api.fs.write(outPath, code);
      await engine.call("fileManager", "refresh");
      await engine.call("fileManager", "open", outPath);
      setSdkNotice(`Generated ${outPath} (TypeChain)`);
      setTimeout(() => setSdkNotice(null), 3500);
    } catch (e) {
      useSilver.getState().setError(e instanceof Error ? e.message : String(e));
    }
  };

  const handleDeploy = async (c: SilContractAbi) => {
    if (!compiled) return;
    const params = c.constructorParams ?? [];
    if (params.length > 0) {
      const currentVals = constructorValues[c.name] ?? {};
      // Every constructor value comes from the form: an empty field is an error, never a silent default.
      const args = params.map((p, idx) => {
        if (p.kind === "pubkey") {
          const chosenAccountName = currentVals[p.name] ?? (accounts[idx]?.name ?? accounts[0]?.name ?? "alice");
          const acct = accounts.find((a) => a.name === chosenAccountName) ?? accounts[0];
          const pk = acct ? pubkeyFromAddress(acct.address) : null;
          if (!pk) throw new Error(`Could not derive Schnorr pubkey for account ${chosenAccountName}`);
          return { kind: "bytes", value: pk };
        }
        return toArg(p, currentVals[p.name] ?? "");
      });

      // Recompile with the constructor arguments through the compiler plugin: it writes the args file next to the
      // source, refreshes the tree and emits the compile events the other panels listen to.
      const source = compiled.sourcePath ?? `contracts/${c.name}.sil`;
      const compileRes = await engine.get<CompilerPlugin>("silverCompiler").compile(source, { args: JSON.stringify(args) });
      if (!compileRes.ok) throw new Error(compileRes.errorText || "Compilation with constructor arguments failed");
      const recordToDeploy = useSilver.getState().compiled?.recordPath ?? compiled.recordPath;
      await silver.deploy({ compileRecordPath: recordToDeploy, from, amountKas: amount, contract: compiled.contracts.length > 1 ? c.name : undefined });
      return;
    }

    await silver.deploy({ compileRecordPath: compiled.recordPath, from, amountKas: amount, contract: compiled.contracts.length > 1 ? c.name : undefined });
  };

  return (
    <div className="space-y-3">
      {target !== "localnet" && (
        <div className="rounded border border-warn/40 bg-warn/10 p-2 text-xs flex items-center justify-between gap-2">
          <span className="text-warn">Contracts deploy on Local node (rusty-kaspad).</span>
          <button
            type="button"
            onClick={() => setTarget("localnet")}
            className="px-2 py-0.5 rounded bg-warn/20 hover:bg-warn/30 text-warn font-semibold text-[10px] cursor-pointer shrink-0"
          >
            Switch to Local Node
          </button>
        </div>
      )}

      {/* ---------------------------------------------------- compiled → deploy */}
      <div className="space-y-2">
        <div className="label">Compiled contract</div>
        {!compiled ? (
          <div className="text-fg-muted">Compile a .sil file (Compiler panel or Ctrl+Enter) to deploy it here.</div>
        ) : (
          compiled.contracts.map((c) => (
            <div key={c.name} className="rounded border border-border bg-bg-elev p-2.5 space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold text-fg truncate">{c.name}</span>
                <span className="text-fg-muted shrink-0 tabular-nums">{c.entries.length} entr{c.entries.length === 1 ? "y" : "ies"}</span>
              </div>
              {c.address && (
                <div className="font-mono text-[10px] text-fg-muted break-all" title="P2SH address of this contract (locking script hash)">
                  {c.address}
                </div>
              )}

              {/* Constructor Arguments Selector (Auto Schnorr Keys) */}
              {c.constructorParams && c.constructorParams.length > 0 && (
                <div className="space-y-1.5 p-2 rounded bg-bg border border-border/80">
                  <div className="text-[11px] font-semibold text-fg flex items-center justify-between">
                    <span>Constructor Arguments</span>
                    <span className="text-[10px] text-accent font-mono flex items-center gap-1">
                      <Sparkles size={11} /> Auto Schnorr Keys
                    </span>
                  </div>
                  {c.constructorParams.map((p, idx) => (
                    <div key={p.name} className="flex items-center gap-2">
                      <span className="w-24 shrink-0 text-fg-muted truncate text-[11px]" title={`${p.kind} ${p.name}`}>
                        {p.name} <span className="text-[10px]">({p.kind})</span>
                      </span>
                      {p.kind === "pubkey" ? (
                        <select
                          aria-label={`Constructor argument ${p.name}`}
                          className="input text-xs"
                          value={constructorValues[c.name]?.[p.name] ?? accounts[idx]?.name ?? accounts[0]?.name ?? "alice"}
                          onChange={(e) =>
                            setConstructorValues((prev) => ({
                              ...prev,
                              [c.name]: { ...(prev[c.name] ?? {}), [p.name]: e.target.value }
                            }))
                          }
                        >
                          {(accounts.length ? accounts : [{ name: "alice", address: "" }, { name: "bob", address: "" }]).map((a) => (
                            <option key={a.name} value={a.name}>
                              {a.name} {a.address ? `(${a.address.slice(0, 14)}...)` : ""}
                            </option>
                          ))}
                        </select>
                      ) : p.kind === "int" ? (
                        <input
                          aria-label={`Constructor argument ${p.name}`}
                          className="input font-mono text-xs"
                          placeholder="integer e.g. 1000000000"
                          value={constructorValues[c.name]?.[p.name] ?? ""}
                          onChange={(e) =>
                            setConstructorValues((prev) => ({
                              ...prev,
                              [c.name]: { ...(prev[c.name] ?? {}), [p.name]: e.target.value }
                            }))
                          }
                        />
                      ) : (
                        <input
                          aria-label={`Constructor argument ${p.name}`}
                          className="input font-mono text-xs"
                          placeholder={p.kind}
                          value={constructorValues[c.name]?.[p.name] ?? ""}
                          onChange={(e) =>
                            setConstructorValues((prev) => ({
                              ...prev,
                              [c.name]: { ...(prev[c.name] ?? {}), [p.name]: e.target.value }
                            }))
                          }
                        />
                      )}
                    </div>
                  ))}
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

              <div className="flex gap-1.5 pt-0.5">
                <button
                  type="button"
                  className="btn-primary flex-1 justify-center truncate"
                  disabled={busy !== null}
                  onClick={() => void handleDeploy(c).catch((e) => useSilver.getState().setError(e instanceof Error ? e.message : String(e)))}
                  title="Deploy contract to localnet"
                >
                  <Rocket size={13} className="shrink-0" /> <span className="truncate">{busy === "deploy" ? "Deploying…" : `Deploy ${c.name}`}</span>
                </button>
                <button
                  type="button"
                  className="btn-ghost shrink-0 px-2.5 text-accent hover:text-accent-hover"
                  onClick={() => void handleGenerateSdk(c)}
                  title="Generate strongly-typed TypeScript SDK (TypeChain) for this contract"
                >
                  <FileCode2 size={13} /> SDK
                </button>
              </div>

              {sdkNotice && (
                <div role="status" className="text-ok text-[11px] flex items-center gap-1">
                  <Check size={11} /> {sdkNotice}
                </div>
              )}
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
