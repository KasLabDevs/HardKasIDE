import { api } from "@/api/client";
import { Plugin } from "@/engine/engine";
import { useEnv } from "@/store/env";
import { useExplorer, type DagInfo, type MempoolEntry, type MinerInfo, type UtxoRow } from "@/store/explorer";
import { useIde } from "@/store/ide";
import type { ConsolePlugin } from "./console";

/**
 * Node explorer for the Local node: DAG (DAA score, sink, tips), mempool, blocks the CPU miner found and the UTXOs
 * of any address. Everything comes from `hardkas rpc …` (the node's own answers) and from the miner container's log.
 * The Servers view calls start() while it is on screen, so nothing polls in the background otherwise.
 */
export class ExplorerPlugin extends Plugin {
  private timer: ReturnType<typeof setInterval> | null = null;
  private viewers = 0;
  private inFlight = false;

  constructor() {
    super({
      name: "explorer",
      displayName: "Node explorer",
      location: "none",
      methods: ["start", "stop", "refresh", "loadUtxos"],
      events: ["updated"]
    });
  }

  onDeactivation(): void {
    this.viewers = 0;
    this.halt();
    useExplorer.getState().reset();
  }

  private console(): ConsolePlugin {
    return this.engine.get<ConsolePlugin>("console");
  }

  /** A view that shows the explorer calls this; polling runs while at least one is mounted. */
  start(): void {
    this.viewers += 1;
    if (this.timer) return;
    void this.refresh();
    this.timer = setInterval(() => {
      if (typeof document !== "undefined" && document.hidden) return;
      void this.refresh();
    }, 4000);
  }

  stop(): void {
    this.viewers = Math.max(0, this.viewers - 1);
    if (this.viewers === 0) this.halt();
  }

  private halt(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async refresh(): Promise<void> {
    if (this.inFlight) return;
    const store = useExplorer.getState();
    const node = useEnv.getState().node;
    const busyOp = useEnv.getState().nodeBusy;
    // Nothing to ask while the node is down or being changed: show what we last knew, flagged as stale by updatedAt.
    if (useIde.getState().workspace === null || busyOp || !node?.rpcReady) {
      if (!node?.rpcReady) store.patch({ error: node ? "The local node is not running. Start it from the card above." : null });
      return;
    }
    this.inFlight = true;
    store.patch({ busy: true });
    try {
      const [dag, pool, miner] = await Promise.all([this.readDag(), this.readMempool(), this.readMiner()]);
      if (dag) {
        store.patch({ dag });
        store.pushDaa(dag.virtualDaaScore);
      }
      store.patch({ mempool: pool ?? store.mempool, miner: miner ?? useExplorer.getState().miner, error: dag ? null : "The node did not answer rpc dag", updatedAt: Date.now() });
      this.emit("updated");
    } catch (e) {
      store.patch({ error: e instanceof Error ? e.message : String(e) });
    } finally {
      this.inFlight = false;
      useExplorer.getState().patch({ busy: false });
    }
  }

  private async readDag(): Promise<DagInfo | null> {
    const [dag, info] = await Promise.all([this.console().runHardkas(["rpc", "dag", "--json"], { quiet: true }), this.console().runHardkas(["rpc", "info", "--json"], { quiet: true })]);
    const d = (dag.result as { dag?: Record<string, unknown> } | null)?.dag;
    if (dag.status !== "succeeded" || !d) return null;
    const i = (info.result as { info?: Record<string, unknown> } | null)?.info;
    return {
      networkId: String(d.networkId ?? "simnet"),
      virtualDaaScore: Number(d.virtualDaaScore ?? 0),
      tipHashes: arr(d.tipHashes),
      virtualParentHashes: arr(d.virtualParentHashes),
      sink: String(d.sink ?? ""),
      isSynced: typeof i?.isSynced === "boolean" ? i.isSynced : undefined,
      serverVersion: typeof i?.serverVersion === "string" ? i.serverVersion : undefined
    };
  }

  private async readMempool(): Promise<MempoolEntry[] | null> {
    const run = await this.console().runHardkas(["rpc", "mempool", "--json"], { quiet: true });
    const entries = (run.result as { entries?: unknown[] } | null)?.entries;
    if (run.status !== "succeeded" || !Array.isArray(entries)) return null;
    return entries.map((raw) => {
      const e = (raw ?? {}) as Record<string, unknown>;
      const fee = e.feeSompi ?? e.fee;
      return { txId: String(e.txId ?? e.transactionId ?? e.id ?? ""), feeSompi: typeof fee === "string" || typeof fee === "number" ? String(fee) : undefined, raw };
    });
  }

  private async readMiner(): Promise<MinerInfo | null> {
    try {
      const j = await api.node.blocks(30);
      return { exists: j.exists, running: j.running, perSecond: j.perSecond, windowBlocks: j.windowBlocks, routeFull: j.routeFull ?? 0, blocks: j.blocks ?? [] };
    } catch {
      return null;
    }
  }

  /** Every UTXO the node holds for an address (can be thousands for a mining account): totals plus the biggest rows. */
  async loadUtxos(address: string): Promise<void> {
    const store = useExplorer.getState();
    store.patch({ utxosBusy: true, utxosError: null });
    try {
      const run = await this.console().runHardkas(["rpc", "utxos", address, "--json"], { quiet: true });
      const r = run.result as { utxos?: Array<Record<string, unknown>>; totalSompi?: string; message?: string } | null;
      if (run.status !== "succeeded" || !r?.utxos) throw new Error(r?.message ?? "rpc utxos failed");
      const rows: UtxoRow[] = r.utxos
        .map((u) => {
          const o = u.outpoint as { transactionId?: string; index?: number } | undefined;
          return { txId: String(o?.transactionId ?? ""), index: Number(o?.index ?? 0), amountSompi: String(u.amountSompi ?? "0"), daa: Number(u.blockDaaScore ?? 0), coinbase: Boolean(u.isCoinbase) };
        })
        .sort((a, b) => (BigInt(b.amountSompi) > BigInt(a.amountSompi) ? 1 : BigInt(b.amountSompi) < BigInt(a.amountSompi) ? -1 : b.daa - a.daa));
      store.patch({ utxos: { address, totalSompi: String(r.totalSompi ?? "0"), count: rows.length, rows: rows.slice(0, 40), loadedAt: Date.now() } });
    } catch (e) {
      store.patch({ utxosError: e instanceof Error ? e.message : String(e) });
    } finally {
      useExplorer.getState().patch({ utxosBusy: false });
    }
  }
}

const arr = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : []);
