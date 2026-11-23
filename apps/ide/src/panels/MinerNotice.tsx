import clsx from "clsx";
import { Pickaxe, Square, Zap } from "lucide-react";
import { useEngine } from "@/engine/context";
import type { EnvironmentPlugin } from "@/plugins/environment";
import { useEnv } from "@/store/env";
import { useIde } from "@/store/ide";

/**
 * Blocks on the local simnet exist only while HardKas' CPU miner runs, and it runs only while `localnet fund`
 * is funding (unless kept). So a deploy or spend sent with the miner stopped never confirms, and a miner left
 * running flat out floods the node ("route is full") and slows confirmations down. By default the IDE mines a
 * short burst by itself whenever something is sent (`autoMine`); this card shows the state in one line, the
 * switch, and the manual buttons for when the switch is off.
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
  const autoMine = useEnv((s) => s.autoMine);
  const setAutoMine = useEnv((s) => s.setAutoMine);

  if (target !== "localnet" || !node?.rpcReady) return null;
  const miner = node.miner;
  const running = miner?.running === true;
  const account = accounts[0]?.name ?? "alice";
  const disabled = busy !== null || nodeBusy !== null;
  // With auto-mining on, a stopped miner is the normal resting state, not a warning.
  const calm = running || autoMine;

  const act = (fn: () => Promise<void>) => void fn().catch(() => undefined); // the plugin stores the error

  const headline =
    busy === "burst" ? "Mining blocks…" : busy === "start" ? "Starting the miner…" : busy === "stop" ? "Stopping the miner…" : running ? "Mining blocks" : autoMine ? "Blocks are mined when something is sent" : "No blocks: nothing confirms until you mine";

  return (
    <div role="status" className={clsx("rounded border p-2 space-y-1.5 text-xs", calm ? "border-border bg-bg-elev" : "border-warn/50 bg-warn/10")}>
      <div className="flex items-center justify-between gap-2">
        <span className={clsx("flex items-center gap-1.5 font-semibold", running || busy ? "text-ok" : calm ? "text-fg" : "text-warn")}>
          <Pickaxe size={13} className={busy ? "animate-spin" : ""} />
          {headline}
        </span>
        {!compact && miner && <span className="text-[12px] text-fg-muted font-mono">{miner.status || (running ? "running" : "stopped")}</span>}
      </div>
      <label className="flex items-start gap-2 cursor-pointer text-[12px] text-fg-muted">
        <input type="checkbox" className="mt-0.5" checked={autoMine} onChange={(e) => setAutoMine(e.target.checked)} />
        <span>
          Mine automatically when something is sent
          {!compact && <span className="block text-fg-muted/80">A short burst to {account} each time a deploy, spend or payment waits for a block; it stops by itself.</span>}
        </span>
      </label>
      {!compact && running && <p className="text-[12px] text-fg-muted leading-relaxed">A miner left running floods the node and confirmations slow down. Stop it once your transactions are in.</p>}
      <div className="flex gap-1">
        <button type="button" className={clsx("flex-1 justify-center !py-1", autoMine ? "btn-ghost" : "btn-primary")} disabled={disabled} onClick={() => act(() => env.mineBurst(account))} title={`hardkas localnet fund ${account} --amount 1 --stop-miner: mines until one more KAS matures (a minute or two), then stops`}>
          <Zap size={12} /> Mine blocks now
        </button>
        {running ? (
          <button type="button" className="btn-ghost flex-1 justify-center !py-1" disabled={disabled} onClick={() => act(() => env.stopMiner())} title="docker stop hardkas-toccata-miner">
            <Square size={12} /> Stop miner
          </button>
        ) : (
          miner && (
            <button type="button" className="btn-ghost flex-1 justify-center !py-1" disabled={disabled} onClick={() => act(() => env.startMiner())} title="docker start hardkas-toccata-miner: mines to the last funded account until stopped">
              <Pickaxe size={12} /> Keep mining
            </button>
          )
        )}
      </div>
      {error && busy === null && <div role="alert" className="text-error text-[12px] break-words">{error}</div>}
    </div>
  );
}
