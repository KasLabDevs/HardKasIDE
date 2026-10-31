import clsx from "clsx";
import { Pickaxe, Square, Zap } from "lucide-react";
import { useEngine } from "@/engine/context";
import type { EnvironmentPlugin } from "@/plugins/environment";
import { useEnv } from "@/store/env";
import { useIde } from "@/store/ide";

/**
 * Blocks on the local simnet exist only while HardKas' CPU miner runs, and it runs only while `localnet fund`
 * is funding (unless kept). So a deploy or spend sent with the miner stopped never confirms, and a miner left
 * running flat out floods the node ("route is full") and slows confirmations down. This card says which of
 * the two is happening and offers the fix: a short burst, or start/stop.
 */
export function MinerNotice({ compact = false }: { compact?: boolean }) {
  const engine = useEngine();
  const env = engine.get<EnvironmentPlugin>("environment");
  const target = useIde((s) => s.target);
  const node = useEnv((s) => s.node);
  const busy = useEnv((s) => s.minerBusy);
  const nodeBusy = useEnv((s) => s.nodeBusy);
  const accounts = useEnv((s) => s.accounts);
  const error = useEnv((s) => s.error);

  if (target !== "localnet" || !node?.rpcReady) return null;
  const miner = node.miner;
  const running = miner?.running === true;
  const account = accounts[0]?.name ?? "alice";
  const disabled = busy !== null || nodeBusy !== null;

  const act = (fn: () => Promise<void>) => void fn().catch(() => undefined); // the plugin stores the error

  return (
    <div role="status" className={clsx("rounded border p-2 space-y-1.5 text-xs", running ? "border-ok/40 bg-ok/5" : "border-warn/50 bg-warn/10")}>
      <div className="flex items-center justify-between gap-2">
        <span className={clsx("flex items-center gap-1.5 font-semibold", running ? "text-ok" : "text-warn")}>
          <Pickaxe size={13} className={busy ? "animate-spin" : ""} />
          {busy === "burst" ? "Mining a burst…" : busy === "start" ? "Starting the miner…" : busy === "stop" ? "Stopping the miner…" : running ? "Miner running: blocks are being mined" : miner ? "Miner stopped: nothing confirms" : "No miner yet: nothing confirms"}
        </span>
        {!compact && miner && <span className="text-[10px] text-fg-muted font-mono">{miner.status || (running ? "running" : "stopped")}</span>}
      </div>
      {!compact && (
        <p className="text-[10px] text-fg-muted leading-relaxed">
          {running
            ? "A miner running flat out floods the node and confirmations slow down (the miner log shows \"route is full\"). Stop it once your transactions are in; mine a burst when you need blocks."
            : miner
              ? "Deploys and spends reach the mempool but stay there until a block is mined. Mine a burst (about one KAS to " + account + ") or start the miner."
              : "HardKas creates the miner the first time an account is funded. Fund one from Accounts, or mine a burst."}
        </p>
      )}
      <div className="flex gap-1">
        <button type="button" className="btn-primary flex-1 justify-center !py-1" disabled={disabled} onClick={() => act(() => env.mineBurst(account))} title={`hardkas localnet fund ${account} --amount 1 (mines until one more KAS matures, then stops)`}>
          <Zap size={12} /> Mine a burst
        </button>
        {running ? (
          <button type="button" className="btn-ghost flex-1 justify-center !py-1" disabled={disabled} onClick={() => act(() => env.stopMiner())} title="docker stop hardkas-toccata-miner">
            <Square size={12} /> Stop miner
          </button>
        ) : (
          miner && (
            <button type="button" className="btn-ghost flex-1 justify-center !py-1" disabled={disabled} onClick={() => act(() => env.startMiner())} title="docker start hardkas-toccata-miner (mines to the last funded account until stopped)">
              <Pickaxe size={12} /> Start miner
            </button>
          )
        )}
      </div>
      {error && busy === null && <div role="alert" className="text-error text-[10px] break-words">{error}</div>}
    </div>
  );
}
