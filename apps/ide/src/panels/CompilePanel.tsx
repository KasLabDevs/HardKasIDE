import { GitFork, Hammer, KeyRound, Wand2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useEngine } from "@/engine/context";
import type { AssistantPlugin } from "@/plugins/assistant";
import type { CompilationResult, CompilerPlugin } from "@/plugins/compiler";
import { useAssistant } from "@/store/assistant";
import { useEnv } from "@/store/env";
import { useIde } from "@/store/ide";
import { bytesToHex, pubkeyFromAddress } from "@/utils/kaspaAddress";

const ARGS_PLACEHOLDER = `[
  { "kind": "bytes", "value": [ ...32 bytes of a pubkey... ] },
  { "kind": "int", "value": 1000000000 }
]`;

export function CompilePanel() {
  const engine = useEngine();
  const activeFile = useIde((s) => s.activeFile);
  const [result, setResult] = useState<CompilationResult | null>(null);
  const [status, setStatus] = useState<{ title: string; type: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [auto, setAuto] = useState(false);
  const [args, setArgs] = useState("");
  const [argsError, setArgsError] = useState<string | null>(null);
  const accounts = useEnv((s) => s.accounts);
  const [pubkeyAccount, setPubkeyAccount] = useState("alice");

  /** Appends `{kind:"bytes", value:[…]}` with the account's x-only pubkey (decoded from its P2PK address). */
  const insertPubkey = () => {
    const acct = accounts.find((a) => a.name === pubkeyAccount);
    const pk = acct ? pubkeyFromAddress(acct.address) : null;
    if (!pk) {
      setArgsError(`${pubkeyAccount}: no P2PK address on this network (switch the target to localnet and refresh accounts)`);
      return;
    }
    setArgsError(null);
    let list: unknown[] = [];
    try {
      list = args.trim() ? (JSON.parse(args) as unknown[]) : [];
      if (!Array.isArray(list)) list = [];
    } catch {
      list = [];
    }
    list.push({ kind: "bytes", value: pk });
    setArgs(JSON.stringify(list, null, 2));
    engine.get<CompilerPlugin>("silverCompiler");
    void engine.call("console", "info", `pubkey of ${pubkeyAccount}: ${bytesToHex(pk)} (x-only, from ${acct?.address})`);
  };

  useEffect(() => {
    const offs = [
      engine.on("silverCompiler", "compilationFinished", (r) => setResult(r as CompilationResult)),
      engine.on("silverCompiler", "compilationFailed", (r) => setResult(r as CompilationResult)),
      engine.on("silverCompiler", "statusChanged", (s) => setStatus(s as { title: string; type: string }))
    ];
    return () => offs.forEach((off) => off());
  }, [engine]);

  const isSil = activeFile?.endsWith(".sil") ?? false;

  // Prefill constructor args from `<name>.constructor-args.json` when switching .sil files.
  useEffect(() => {
    if (!isSil || !activeFile) return;
    let cancelled = false;
    engine
      .get<CompilerPlugin>("silverCompiler")
      .readArgs(activeFile)
      .then((content) => {
        if (!cancelled) setArgs(content ?? "");
      });
    return () => {
      cancelled = true;
    };
  }, [engine, activeFile, isSil]);

  const compile = async () => {
    setArgsError(null);
    if (args.trim()) {
      try {
        JSON.parse(args);
      } catch (e) {
        setArgsError(`Constructor args must be valid JSON: ${(e as Error).message}`);
        return;
      }
    }
    setBusy(true);
    try {
      await engine.get<CompilerPlugin>("silverCompiler").compileCurrent({ args });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="p-3 space-y-4 text-xs">
      <div>
        <div className="label">Compiler</div>
        <div className="text-fg">silverc v1.0.0 (language 0.1.0), managed by hardkas</div>
        <div className="text-fg-muted mt-0.5">Runs <code>hardkas silver compile &lt;file&gt; [--args &lt;file&gt;] --json</code> in the workspace.</div>
      </div>

      <label className="flex items-center gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={auto}
          onChange={(e) => {
            setAuto(e.target.checked);
            engine.get<CompilerPlugin>("silverCompiler").setAutoCompile(e.target.checked);
          }}
        />
        <span>Auto compile .sil on change</span>
      </label>

      <div>
        <label htmlFor="compile-constructor-args" className="label">Constructor args</label>
        <textarea
          id="compile-constructor-args"
          className="input font-mono h-28 resize-y"
          placeholder={ARGS_PLACEHOLDER}
          value={args}
          onChange={(e) => setArgs(e.target.value)}
          spellCheck={false}
          disabled={!isSil}
        />
        <div className="flex gap-1 mt-1">
          <select aria-label="Account for public key" className="input" value={pubkeyAccount} onChange={(e) => setPubkeyAccount(e.target.value)} disabled={!isSil}>
            {(accounts.length ? accounts : [{ name: "alice" }]).map((a) => (
              <option key={a.name} value={a.name}>
                {a.name}
              </option>
            ))}
          </select>
          <button type="button" className="btn-ghost shrink-0" disabled={!isSil} onClick={insertPubkey} title="Append this account's x-only public key as a pubkey constructor argument">
            <KeyRound size={12} /> add pubkey
          </button>
        </div>
        <div className="text-fg-muted mt-1">
          JSON list of <code>{"{kind, value}"}</code>, one per constructor parameter, in order. A <code>pubkey</code> parameter takes an account's key: pick it above. Saved next to the contract as{" "}
          <code className="break-all">{activeFile && isSil ? engine.get<CompilerPlugin>("silverCompiler").argsFileFor(activeFile).split("/").pop() : "<name>.constructor-args.json"}</code>.
        </div>
        {argsError && <div role="alert" className="text-error mt-1">{argsError}</div>}
      </div>

      <button type="button" className="btn-primary w-full justify-center truncate" disabled={!isSil || busy} onClick={() => void compile()}>
        <Hammer size={14} className="shrink-0" />
        <span className="truncate">{busy ? "Compiling…" : isSil ? `Compile ${activeFile?.split("/").pop()}` : "Open a .sil file to compile"}</span>
      </button>

      {status && (
        <div role="status" aria-live="polite" className={status.type === "error" ? "text-error" : status.type === "success" ? "text-ok" : "text-info"}>
          {status.title}
        </div>
      )}

      {result && (
        <div className="space-y-2">
          <div className="label">Last compilation</div>
          <div className="text-fg-muted truncate font-mono text-[11px]" title={result.file}>
            {result.file}
          </div>
          {result.ok ? (
            <>
              {result.contracts.length > 0 ? (
                result.contracts.map((c) => (
                  <div key={c.name} className="rounded border border-border bg-bg-elev p-2 space-y-1">
                    <div className="font-semibold text-fg truncate">{c.name}</div>
                    {c.address && (
                      <div className="font-mono text-[11px] text-fg-muted break-all" title="P2SH address">
                        {c.address}
                      </div>
                    )}
                    {Array.isArray(c.entries) && <div className="text-fg-muted tabular-nums">{c.entries.length} entry point(s)</div>}
                  </div>
                ))
              ) : (
                <div className="text-fg-muted">Compiled, but no contract list was found in the JSON output. See the terminal for the raw record.</div>
              )}
              <button
                type="button"
                onClick={() => void engine.call("covenant", "open")}
                className="btn-ghost w-full justify-center text-accent text-xs mt-1 cursor-pointer border border-accent/30 bg-accent/5 hover:bg-accent/10"
              >
                <GitFork size={13} /> Show in Covenant graph
              </button>
            </>
          ) : (
            <div className="space-y-1.5">
              <pre role="alert" className="rounded border border-error/40 bg-bg-elev p-2 text-error whitespace-pre-wrap break-words overflow-auto max-h-60">{result.errorText}</pre>
              <button
                type="button"
                onClick={() => {
                  useIde.getState().revealPlugin("assistant", "Assistant");
                  useAssistant.getState().setMode("agent");
                  const assistant = engine.get<AssistantPlugin>("assistant");
                  void assistant.runAgent(`Fix this compile error in ${result.file}:\n${result.errorText}`);
                }}
                className="btn-primary w-full justify-center bg-accent/90 hover:bg-accent text-xs cursor-pointer shadow-sm"
              >
                <Wand2 size={13} /> Fix with AI
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
