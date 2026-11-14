import clsx from "clsx";
import { ArrowDownToLine, ArrowRightToLine, ArrowUpFromLine, Bug, Copy, Play, ShieldAlert, Square, StepForward } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { api, type SilverRunnerInfo } from "@/api/client";
import { useDebug } from "@/store/debug";
import { useSilverDebug } from "@/store/silverDebug";
import { copyText } from "@/utils/clipboard";
import { confirmDialog } from "@/utils/dialog";
import { bytesToHex, pubkeyFromAddress } from "@/utils/kaspaAddress";

interface Param {
  type: string;
  name: string;
}

/** Entries of a .sil source with their parameters, read from the text (`entry f(sig s, int n)`). */
export function silverEntries(source: string): Array<{ name: string; params: Param[] }> {
  const out: Array<{ name: string; params: Param[] }> = [];
  const re = /\b(?:entrypoint\s+function|entry)\s+([A-Za-z_]\w*)\s*\(([^)]*)\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source.replace(/\/\/.*$/gm, ""))) !== null) {
    const params = m[2]
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean)
      .map((p) => {
        const parts = p.split(/\s+/);
        return { type: parts.slice(0, -1).join(" "), name: parts[parts.length - 1] };
      });
    out.push({ name: m[1], params });
  }
  return out;
}

/** One entry argument in the constructor-args file format the server expects. */
export function argValue(param: Param, raw: string, account: string): unknown {
  if (param.type === "sig") return { kind: "sig", account };
  if (param.type === "int" || param.type === "temporal") return { kind: "int", value: raw.trim() };
  if (param.type === "bool") return { kind: "bool", value: raw === "true" };
  if (param.type === "pubkey" || param.type.startsWith("byte")) return { kind: "bytes", value: raw.trim() };
  return { kind: "text", value: raw };
}

interface Props {
  file: string;
  source: string;
  /** The constructor-args JSON of the Compile panel. */
  argsJson: string;
  jumpToLine: (file: string, line: number, column?: number) => Promise<void>;
}

/**
 * Step debugger for SilverScript: runs an entry on the SilverScript runner (cli-debugger, the Kaspa script engine)
 * line by line. Breakpoints are the editor's gutter dots on the .sil file.
 */
export function SilverDebugger({ file, source, argsJson, jumpToLine }: Props) {
  const view = useSilverDebug((s) => s.view);
  const setView = useSilverDebug((s) => s.set);
  const breakpoints = useDebug((s) => s.breakpoints[file]);
  const entries = useMemo(() => silverEntries(source), [source]);
  const [runner, setRunner] = useState<SilverRunnerInfo | null>(null);
  const [entry, setEntry] = useState("");
  const [values, setValues] = useState<Record<string, string>>({});
  const [accounts, setAccounts] = useState<string[]>([]);
  const [addresses, setAddresses] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expr, setExpr] = useState("");
  const [showKeys, setShowKeys] = useState(false);

  useEffect(() => {
    api.silverDebug.runner().then(setRunner).catch(() => setRunner(null));
    api.devkeys.list().then(setAccounts).catch(() => setAccounts([]));
    api.devkeys.addresses().then(setAddresses).catch(() => setAddresses({}));
    api.silverDebug.get().then(setView).catch(() => undefined);
  }, [setView]);

  const current = entries.find((e) => e.name === entry) ?? entries[0];
  const live = view && view.file === file && (view.state === "paused" || view.state === "failed");

  // A gutter breakpoint added during a session goes to the runner too (cli-debugger can add breakpoints, not remove them).
  const [sent, setSent] = useState<number[]>([]);
  useEffect(() => {
    if (!live) {
      if (sent.length) setSent([]);
      return;
    }
    const fresh = (breakpoints ?? []).filter((l) => !sent.includes(l));
    if (fresh.length === 0) return;
    setSent([...sent, ...fresh]);
    void (async () => {
      for (const l of fresh) await api.silverDebug.command("break", l).catch(() => undefined);
    })();
  }, [breakpoints, live]); // eslint-disable-line react-hooks/exhaustive-deps

  // Follow the debuggee in the editor.
  useEffect(() => {
    if (view && view.file === file && view.line && (view.state === "paused" || view.state === "failed")) void jumpToLine(file, view.line, 1);
  }, [view?.line, view?.state, view?.file, file]); // eslint-disable-line react-hooks/exhaustive-deps

  const run = async (label: string, fn: () => Promise<void>) => {
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

  const approve = () =>
    run("approve", async () => {
      if (!runner?.sha256) return;
      const ok = await confirmDialog(
        `Run this SilverScript runner?\n\n${runner.path}\nsha256 ${runner.sha256}\n\nUpstream publishes no cli-debugger binary, so this is a local build HardKas cannot verify. Approve it only if you built it yourself (or trust who did). A different binary needs a new approval.`,
        { title: "Unverified local runner", confirmLabel: "Approve this build" }
      );
      if (ok) setRunner(await api.silverDebug.approve(runner.sha256));
    });

  const start = () =>
    run("start", async () => {
      if (!current) throw new Error("This file has no entry to debug.");
      let ctor: unknown[] = [];
      if (argsJson.trim()) {
        const parsed = JSON.parse(argsJson) as unknown;
        if (!Array.isArray(parsed)) throw new Error("The constructor arguments must be a JSON array.");
        ctor = parsed;
      }
      const args = current.params.map((p) => argValue(p, values[`${current.name}.${p.name}`] ?? "", values[`${current.name}.${p.name}`] || accounts[0] || ""));
      setSent([...(breakpoints ?? [])]);
      setView(await api.silverDebug.start({ file, entry: current.name, constructorArgs: ctor, args, breakpoints: breakpoints ?? [] }));
    });

  const cmd = (c: Parameters<typeof api.silverDebug.command>[0], arg?: string | number) => run(c, async () => setView(await api.silverDebug.command(c, arg)));
  const stop = () => run("stop", async () => setView(await api.silverDebug.stop()));

  const sections = useMemo(() => {
    const by = new Map<string, NonNullable<typeof view>["variables"]>();
    for (const v of view?.variables ?? []) by.set(v.section, [...(by.get(v.section) ?? []), v]);
    return [...by.entries()];
  }, [view?.variables]);

  return (
    <div className="rounded border border-border bg-bg-panel p-2.5 space-y-2 text-[11px]">
      <div className="flex items-center justify-between">
        <span className="font-semibold text-fg flex items-center gap-1.5">
          <Bug size={13} className="text-accent shrink-0" /> SilverScript debugger
        </span>
        {view && view.file === file && view.state !== "idle" && (
          <span className={clsx("font-mono text-[10px] uppercase", view.state === "failed" ? "text-error" : view.state === "finished" ? "text-ok" : "text-fg-muted")}>
            {view.state === "paused" ? `line ${view.line}` : view.state === "failed" ? "rejected" : view.state === "finished" ? "passed" : view.state}
          </span>
        )}
      </div>

      {runner && !runner.available && <div className="text-fg-muted">{runner.message}</div>}

      {runner?.available && !runner.approved && (
        <div className="rounded border border-warn/50 bg-warn/10 p-2 space-y-1">
          <div className="flex items-center gap-1.5 font-semibold text-warn">
            <ShieldAlert size={12} /> Unverified local runner
          </div>
          <div className="text-fg-muted break-all font-mono text-[10px]">{runner.path}</div>
          <div className="text-fg-muted break-all font-mono text-[10px]">sha256 {runner.sha256}</div>
          <button type="button" className="btn-ghost w-full justify-center" disabled={busy !== null} onClick={() => void approve()}>
            Approve this build
          </button>
        </div>
      )}

      {runner?.available && runner.approved && (
        <>
          {!live && (
            <div className="space-y-1.5">
              <select aria-label="Entry to debug" className="select py-1 font-mono" value={current?.name ?? ""} onChange={(e) => setEntry(e.target.value)}>
                {entries.length === 0 && <option value="">No entry in this file</option>}
                {entries.map((e) => (
                  <option key={e.name} value={e.name}>
                    {e.name}({e.params.map((p) => `${p.type} ${p.name}`).join(", ")})
                  </option>
                ))}
              </select>
              {current?.params.map((p) => {
                const key = `${current.name}.${p.name}`;
                return (
                  <label key={key} className="flex items-center gap-2">
                    <span className="w-28 shrink-0 font-mono text-fg-muted truncate" title={`${p.type} ${p.name}`}>
                      {p.type} {p.name}
                    </span>
                    {p.type === "sig" ? (
                      <select className="select py-0.5 font-mono" value={values[key] ?? accounts[0] ?? ""} onChange={(e) => setValues({ ...values, [key]: e.target.value })} aria-label={`${p.name}: signing account`}>
                        {accounts.length === 0 && <option value="">no simnet dev accounts</option>}
                        {accounts.map((a) => (
                          <option key={a} value={a}>
                            signed by {a}
                          </option>
                        ))}
                      </select>
                    ) : p.type === "bool" ? (
                      <input type="checkbox" checked={values[key] === "true"} onChange={(e) => setValues({ ...values, [key]: String(e.target.checked) })} aria-label={p.name} />
                    ) : (
                      <input className="input py-0.5 font-mono" value={values[key] ?? ""} placeholder={p.type === "int" ? "0" : p.type === "pubkey" || p.type.startsWith("byte") ? "0x…" : ""} onChange={(e) => setValues({ ...values, [key]: e.target.value })} aria-label={p.name} />
                    )}
                  </label>
                );
              })}
              <div className="text-[10px] text-fg-muted">
                Breakpoints: click the gutter of {file.split("/").pop()} ({(breakpoints ?? []).length} set). Constructor arguments come from the box above.
              </div>
              <button type="button" className="btn-primary w-full justify-center" disabled={busy !== null || !current} onClick={() => void start()}>
                <Play size={12} /> {busy === "start" ? "Compiling and signing…" : `Debug ${current?.name ?? ""}`}
              </button>
            </div>
          )}

          {live && (
            <div className="flex items-center gap-1 flex-wrap">
              <button type="button" className="btn-ghost px-2 py-1" disabled={busy !== null || view.state !== "paused"} onClick={() => void cmd("continue")} title="Continue to the next breakpoint (c)">
                <Play size={12} /> Continue
              </button>
              <button type="button" className="btn-ghost px-2 py-1" disabled={busy !== null || view.state !== "paused"} onClick={() => void cmd("next")} title="Step over (n)">
                <StepForward size={12} /> Over
              </button>
              <button type="button" className="btn-ghost px-2 py-1" disabled={busy !== null || view.state !== "paused"} onClick={() => void cmd("step")} title="Step into (s)">
                <ArrowDownToLine size={12} /> Into
              </button>
              <button type="button" className="btn-ghost px-2 py-1" disabled={busy !== null || view.state !== "paused"} onClick={() => void cmd("finish")} title="Step out (finish)">
                <ArrowUpFromLine size={12} /> Out
              </button>
              <button type="button" className="btn-ghost px-2 py-1" disabled={busy !== null || view.state !== "paused"} onClick={() => void cmd("stepOpcode")} title="Step one opcode (si)">
                <ArrowRightToLine size={12} /> Opcode
              </button>
              <button type="button" className="btn-ghost px-2 py-1 text-error" disabled={busy !== null} onClick={() => void stop()} title="Stop">
                <Square size={12} /> Stop
              </button>
            </div>
          )}

          {view && view.file === file && view.state === "finished" && (
            <div className="rounded border border-ok/40 bg-ok/5 p-2 text-ok">The entry ran to the end: every require passed.</div>
          )}
          {view && view.file === file && view.error && (
            <button type="button" className="w-full text-left rounded border border-error/40 bg-error/10 p-2 cursor-pointer" onClick={() => view.error?.line && void jumpToLine(file, view.error.line, view.error.column ?? 1)}>
              <div className="text-error font-semibold">Rejected{view.error.line ? ` at line ${view.error.line}` : ""}</div>
              <div className="text-fg">{view.error.message}</div>
            </button>
          )}

          {view && view.file === file && view.state !== "idle" && view.state !== "stopped" && (
            <div className="space-y-1.5">
              {sections.map(([section, vars]) => (
                <div key={section}>
                  <div className="text-[10px] font-semibold uppercase text-fg-muted">{section}</div>
                  {vars.map((v) => (
                    <div key={`${section}.${v.name}`} className="flex gap-2 font-mono text-[10px] min-w-0">
                      <span className="text-accent shrink-0">{v.name}</span>
                      <span className="text-fg-muted shrink-0">{v.type}</span>
                      <span className="text-fg truncate" title={v.value}>
                        {v.value}
                      </span>
                    </div>
                  ))}
                </div>
              ))}
              {view.stack.length > 0 && (
                <div>
                  <div className="text-[10px] font-semibold uppercase text-fg-muted">Stack</div>
                  {view.stack.map((s, i) => (
                    <div key={i} className="font-mono text-[10px] text-fg truncate" title={s}>
                      [{i}] {s}
                    </div>
                  ))}
                </div>
              )}
              {live && (
                <form
                  className="flex gap-1"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (expr.trim()) void cmd("eval", expr);
                  }}
                >
                  <input className="input py-0.5 font-mono" placeholder="evaluate, e.g. currentBalance - withdrawSompi" value={expr} onChange={(e) => setExpr(e.target.value)} aria-label="Expression to evaluate" />
                  <button type="submit" className="btn-ghost px-2" disabled={busy !== null || !expr.trim()}>
                    Eval
                  </button>
                </form>
              )}
              {view.output && /=/.test(view.output) && !/^\s*\d+\s*\|/m.test(view.output) && <pre className="font-mono text-[10px] bg-bg border border-border rounded p-1.5 whitespace-pre-wrap">{view.output}</pre>}
            </div>
          )}

          <div className="text-[10px] text-fg-muted">
            Runs the Kaspa script engine on a test transaction (one input of this contract): it checks the contract's logic, not that a node would accept a real spend. Runner: unverified local build.
          </div>
        </>
      )}

      {/* Useful without the runner too: pubkey constructor arguments take these keys. */}
      <button type="button" className="text-[10px] text-accent hover:underline cursor-pointer" onClick={() => setShowKeys((v) => !v)}>
        {showKeys ? "Hide" : "Show"} the dev accounts' public keys (for pubkey arguments)
      </button>
      {showKeys && (
        <div className="space-y-0.5">
          {Object.entries(addresses).map(([name, address]) => {
            const pk = pubkeyFromAddress(address);
            if (!pk) return null;
            const hex = `0x${bytesToHex(pk)}`;
            return (
              <div key={name} className="flex items-center gap-1 font-mono text-[10px] min-w-0">
                <span className="text-accent shrink-0 w-10">{name}</span>
                <span className="truncate text-fg-muted" title={hex}>
                  {hex}
                </span>
                <button type="button" className="shrink-0 text-fg-muted hover:text-fg cursor-pointer" onClick={() => void copyText(hex)} aria-label={`Copy ${name}'s public key`}>
                  <Copy size={11} />
                </button>
              </div>
            );
          })}
          {Object.keys(addresses).length === 0 && <div className="text-[10px] text-fg-muted">No simnet dev accounts in this project yet (start the local node once to create them).</div>}
          <div className="text-[10px] text-fg-muted">Paste one as {'{"kind":"pubkey","value":"0x…"}'} in the constructor arguments.</div>
        </div>
      )}

      {error && <div role="alert" className="text-error break-words">{error}</div>}
    </div>
  );
}
