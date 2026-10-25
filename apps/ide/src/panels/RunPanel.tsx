import { Coins, Play, RadioTower, Send, Signature } from "lucide-react";
import { useEffect, useState } from "react";
import { useEngine } from "@/engine/context";
import type { CompilationResult } from "@/plugins/compiler";
import type { RunPlugin } from "@/plugins/sidePlugins";
import { useIde, type ExecutionTarget } from "@/store/ide";

const TARGETS: Array<{ id: ExecutionTarget; label: string; hint: string }> = [
  { id: "simulator", label: "Simulator (in-memory, synthetic)", hint: "Remix's JavaScript VM equivalent. Fast and deterministic." },
  { id: "localnet", label: "Localnet (Docker rusty-kaspad, simnet)", hint: "Real node with local mining. Needs Docker and `hardkas localnet start`." },
  { id: "rpc", label: "RPC (testnet-10 / testnet-11)", hint: "Remote Kaspa node from hardkas.config.ts. Mainnet is blocked by policy." }
];

export function RunPanel() {
  const engine = useEngine();
  const target = useIde((s) => s.target);
  const setTarget = useIde((s) => s.setTarget);
  const [from, setFrom] = useState("alice");
  const [to, setTo] = useState("bob");
  const [amount, setAmount] = useState("10");
  const [planRef, setPlanRef] = useState("");
  const [signedRef, setSignedRef] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [compiled, setCompiled] = useState<CompilationResult | null>(null);

  useEffect(() => engine.on("silverCompiler", "compilationFinished", (r) => setCompiled(r as CompilationResult)), [engine]);

  const run = engine.get<RunPlugin>("deployRun");
  const guard = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(label);
    try {
      return await fn();
    } catch (error) {
      engine.get("terminal");
      await engine.call("terminal", "error", String(error));
    } finally {
      setBusy(null);
    }
  };

  const onPlan = () =>
    guard("plan", async () => {
      const r = await run.plan({ from, to, amount });
      const id = pick(r.result, ["planId", "result.planId", "plan.planId", "artifactId", "result.artifactId"]);
      if (id) setPlanRef(id);
    });
  const onSign = () =>
    guard("sign", async () => {
      const r = await run.sign(planRef, from);
      const id = pick(r.result, ["signedId", "result.signedId", "signed.signedId", "artifactId", "result.artifactId"]);
      if (id) setSignedRef(id);
    });
  const onSend = () => guard("send", () => run.send(signedRef));

  return (
    <div className="p-3 space-y-4 text-xs">
      <div>
        <div className="label">Environment</div>
        <select className="input" value={target} onChange={(e) => setTarget(e.target.value as ExecutionTarget)}>
          {TARGETS.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </select>
        <div className="text-fg-muted mt-1">{TARGETS.find((t) => t.id === target)?.hint}</div>
        <div className="text-warn mt-1">
          Note: the CLI uses the workspace's default target from hardkas.config.ts. Per-command target selection is a pending HardKas feature.
        </div>
      </div>

      <div className="flex gap-2">
        <button className="btn-ghost flex-1 justify-center" disabled={busy !== null} onClick={() => void guard("status", () => run.localnetStatus())}>
          <RadioTower size={14} /> Localnet status
        </button>
        <button className="btn-ghost flex-1 justify-center" disabled={busy !== null} onClick={() => void guard("fund", () => run.localnetFund(from, "1000"))}>
          <Coins size={14} /> Fund {from}
        </button>
      </div>

      <div className="space-y-2">
        <div className="label">Transaction</div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <div className="text-fg-muted mb-0.5">From</div>
            <input className="input" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div>
            <div className="text-fg-muted mb-0.5">To</div>
            <input className="input" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
        </div>
        <div>
          <div className="text-fg-muted mb-0.5">Amount (KAS)</div>
          <input className="input" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </div>
        <button className="btn-primary w-full justify-center" disabled={busy !== null} onClick={() => void onPlan()}>
          <Play size={14} /> {busy === "plan" ? "Planning…" : "1. Plan"}
        </button>
        <input className="input font-mono" placeholder="plan id or path (filled after Plan)" value={planRef} onChange={(e) => setPlanRef(e.target.value)} />
        <button className="btn-ghost w-full justify-center" disabled={busy !== null || !planRef} onClick={() => void onSign()}>
          <Signature size={14} /> {busy === "sign" ? "Signing…" : "2. Sign"}
        </button>
        <input className="input font-mono" placeholder="signed id or path (filled after Sign)" value={signedRef} onChange={(e) => setSignedRef(e.target.value)} />
        <button className="btn-ghost w-full justify-center" disabled={busy !== null || !signedRef} onClick={() => void onSend()}>
          <Send size={14} /> {busy === "send" ? "Sending…" : "3. Send / Simulate"}
        </button>
        <div className="text-fg-muted">Lifecycle: intent → plan artifact → signed artifact → receipt → replay. Everything lands in .hardkas/artifacts.</div>
      </div>

      <div className="space-y-2">
        <div className="label">Compiled contracts</div>
        {!compiled || compiled.contracts.length === 0 ? (
          <div className="text-fg-muted">Compile a .sil file to list its contracts and entry points here.</div>
        ) : (
          compiled.contracts.map((c) => (
            <div key={c.name} className="rounded border border-border bg-bg-elev p-2 space-y-1">
              <div className="font-semibold">{c.name}</div>
              {Array.isArray(c.entries) &&
                c.entries.map((entry, i) => (
                  <button key={i} className="btn-ghost w-full justify-start font-mono" disabled title="Entry calls via hardkas silver spend arrive in phase 3">
                    {entryName(entry)}
                  </button>
                ))}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function entryName(entry: unknown): string {
  if (typeof entry === "string") return entry;
  if (entry && typeof entry === "object" && "name" in entry) return String((entry as { name: unknown }).name);
  return JSON.stringify(entry);
}

/** Picks the first existing dotted path from a JSON result. */
function pick(obj: unknown, paths: string[]): string | null {
  for (const p of paths) {
    let cur: unknown = obj;
    for (const key of p.split(".")) {
      if (!cur || typeof cur !== "object") {
        cur = undefined;
        break;
      }
      cur = (cur as Record<string, unknown>)[key];
    }
    if (typeof cur === "string" && cur) return cur;
  }
  return null;
}
