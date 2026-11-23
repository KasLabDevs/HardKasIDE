import { api } from "@/api/client";
import { Plugin } from "@/engine/engine";
import { formatKas, useEnv } from "@/store/env";
import { useExplorer, type DagInfo, type MempoolEntry, type MinerInfo, type UtxoRow, type WatchFeedItem, type WatchState } from "@/store/explorer";
import { useIde } from "@/store/ide";
import { parseHistoryResult } from "@/utils/nodeHistory";
import { applyWatchEvent, describeWatchEvent, LineBuffer, parseWatchLine } from "@/utils/watchLines";
import type { ConsolePlugin } from "./console";

const WATCH_FEED_MAX = 40;

/**
 * Node explorer for the Local node: DAG (DAA score, sink, tips), mempool, blocks the CPU miner found, the UTXOs of any
 * address (`hardkas rpc utxos`, or kept live by `hardkas watch`) and the history of an address (`hardkas history`).
 * Everything comes from the CLI's own answers and from the miner container's log. The Servers view calls start()
 * while it is on screen, so nothing polls in the background otherwise, and the watch job is stopped when the view
 * leaves the screen, the node stops or the plugin deactivates.
 */
export class ExplorerPlugin extends Plugin {
  private timer: ReturnType<typeof setInterval> | null = null;
  private viewers = 0;
  private inFlight = false;
  private offs: Array<() => void> = [];
  /** The running `hardkas watch` job, if any: its id and the SSE stream following it. */
  private watchJob: { id: string; address: string; stream: { close(): void }; buffer: LineBuffer } | null = null;
  private onPageHide = () => {
    // The browser is leaving: the server would otherwise keep `hardkas watch` running with nobody listening.
    const id = this.watchJob?.id;
    if (id) void api.jobs.kill(id, { keepalive: true }).catch(() => {});
  };

  constructor() {
    super({
      name: "explorer",
      displayName: "Node explorer",
      location: "none",
      methods: ["start", "stop", "refresh", "loadUtxos", "loadHistory", "historyPage", "startWatch", "stopWatch"],
      events: ["updated", "watchChanged"]
    });
  }

  onActivation(): void {
    this.offs.push(
      useEnv.subscribe((s, prev) => {
        if (prev.node?.rpcReady && !s.node?.rpcReady && this.watchJob) void this.stopWatch("node stopped");
      })
    );
    if (typeof window !== "undefined") window.addEventListener("pagehide", this.onPageHide);
  }

  onDeactivation(): void {
    this.viewers = 0;
    this.halt();
    void this.stopWatch("explorer closed");
    for (const off of this.offs) off();
    this.offs = [];
    if (typeof window !== "undefined") window.removeEventListener("pagehide", this.onPageHide);
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
    if (this.viewers === 0) {
      this.halt();
      // Off screen: no reading of any kind, the live watch included (its toggle shows why it stopped).
      if (this.watchJob) void this.stopWatch("the explorer left the screen");
    }
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
        .sort((a, b) => (BigInt(b.amountSompi) > BigInt(a.amountSompi) ? 1 : BigInt(b.amountSompi) < BigInt(a.amountSompi) ? -1 : (b.daa ?? 0) - (a.daa ?? 0)));
      // A live watch on this address keeps its own list (the node's full one, without DAA scores): the reading only
      // fills in the DAA score and coinbase flag of the outputs it knows, so the watch keeps applying to one list.
      const live = useExplorer.getState();
      if (live.watch && live.watch.address === address && live.watch.status === "live" && live.utxos?.address === address) {
        const read = new Map(rows.map((row) => [`${row.txId}:${row.index}`, row]));
        const merged = live.utxos.rows.map((row) => {
          const r = read.get(`${row.txId}:${row.index}`);
          return r ? { ...row, daa: r.daa, coinbase: r.coinbase } : row;
        });
        store.patch({ utxos: { ...live.utxos, rows: merged, loadedAt: Date.now() } });
        return;
      }
      store.patch({ utxos: { address, totalSompi: String(r.totalSompi ?? "0"), count: rows.length, rows: rows.slice(0, 40), source: "rpc", loadedAt: Date.now() } });
    } catch (e) {
      store.patch({ utxosError: e instanceof Error ? e.message : String(e) });
    } finally {
      useExplorer.getState().patch({ utxosBusy: false });
    }
  }

  // ---- history: `hardkas history <address> --json`, one page at a time ----

  /** The first page of an address's history over the node's default window (the last 1000 chain blocks). */
  async loadHistory(address: string): Promise<void> {
    useExplorer.getState().patch({ historyTrail: [] });
    await this.readHistoryPage(address, undefined);
  }

  /** The next or the previous page of the history shown. */
  async historyPage(direction: "next" | "prev"): Promise<void> {
    const s = useExplorer.getState();
    const view = s.history;
    if (!view || s.historyBusy) return;
    if (direction === "next") {
      if (!view.nextCursor) return;
      s.patch({ historyTrail: [...s.historyTrail, view.cursor] });
      await this.readHistoryPage(view.address, view.nextCursor);
    } else {
      if (s.historyTrail.length === 0) return;
      const trail = [...s.historyTrail];
      const cursor = trail.pop();
      s.patch({ historyTrail: trail });
      await this.readHistoryPage(view.address, cursor);
    }
  }

  private async readHistoryPage(address: string, cursor: string | undefined): Promise<void> {
    const store = useExplorer.getState();
    store.patch({ historyBusy: true, historyError: null });
    try {
      const args = ["history", address, ...(cursor ? ["--cursor", cursor] : []), "--json"];
      const run = await this.console().runHardkas(args, { quiet: true });
      const parsed = parseHistoryResult(run.result, { cursor });
      if (parsed.view) {
        store.patch({ history: parsed.view });
        return;
      }
      // A refusal comes as a JSON envelope (parsed.error quotes it); a CLI that lacks the command only writes stderr.
      const stderrLast = run.stderr?.trim().split("\n").filter(Boolean).pop();
      throw new Error(run.result ? parsed.error : (stderrLast ?? parsed.error));
    } catch (e) {
      store.patch({ historyError: e instanceof Error ? e.message : String(e) });
    } finally {
      useExplorer.getState().patch({ historyBusy: false });
    }
  }

  // ---- watch: `hardkas watch <address> --json` as a long-lived job, its lines applied to the UTXO list ----

  /** Starts (or restarts, for another address) the live watch. One watch at a time. */
  async startWatch(address: string): Promise<void> {
    if (this.watchJob) await this.stopWatch(this.watchJob.address === address ? "restarted" : "watching another address");
    if (!useEnv.getState().node?.rpcReady) {
      this.patchWatch({ address, jobId: null, status: "failed", feed: [], events: 0, startedAt: Date.now(), error: "The local node is not running." });
      return;
    }
    const startedAt = Date.now();
    this.patchWatch({ address, jobId: null, status: "starting", feed: [], events: 0, startedAt });
    let job;
    try {
      job = await api.jobs.run(["watch", address, "--json"]);
    } catch (e) {
      this.patchWatch({ address, jobId: null, status: "failed", feed: [], events: 0, startedAt, error: e instanceof Error ? e.message : String(e) });
      return;
    }
    this.console().info(`Watching ${address} on the local node (hardkas watch, job ${job.id}).`);
    const buffer = new LineBuffer();
    const stderr: string[] = [];
    const stream = api.jobs.open(job.id, (type, data) => {
      if (this.watchJob?.id !== job.id) return;
      if (type === "stdout") for (const line of buffer.push(data)) this.applyWatchLine(line, address);
      else if (data.trim()) stderr.push(data.trim());
    });
    this.watchJob = { id: job.id, address, stream, buffer };
    this.patchWatch({ jobId: job.id });
    stream.done
      .then((done) => {
        if (this.watchJob?.id !== job.id) return;
        for (const line of buffer.flush()) this.applyWatchLine(line, address);
        this.watchJob = null;
        const w = useExplorer.getState().watch;
        const ended = w?.endReason;
        const failed = done.status !== "succeeded";
        const message = failed ? (stderr.filter((l) => !/^stopped by the IDE/.test(l)).pop() ?? `hardkas watch exited with code ${done.exitCode}`) : undefined;
        this.patchWatch({ status: failed ? "failed" : "stopped", endReason: ended ?? (failed ? "failed" : "ended"), ...(message ? { error: message } : {}) });
        if (failed) this.console().error(`hardkas watch ${address}: ${message}`);
      })
      .catch(() => {
        if (this.watchJob?.id !== job.id) return;
        this.watchJob = null;
        this.patchWatch({ status: "failed", endReason: "stream closed", error: "The job stream closed unexpectedly." });
      });
  }

  /** Stops the watch job (DELETE /api/jobs/:id kills the CLI); the list shown stays as it was. */
  async stopWatch(reason = "toggle off"): Promise<void> {
    const job = this.watchJob;
    if (!job) return;
    this.watchJob = null;
    job.stream.close();
    this.patchWatch({ status: "stopped", endReason: reason });
    try {
      await api.jobs.kill(job.id);
    } catch {
      // the job may already be over
    }
    this.console().info(`Stopped watching ${job.address} (${reason}).`);
  }

  private applyWatchLine(line: string, address: string): void {
    const event = parseWatchLine(line);
    if (!event) return;
    const store = useExplorer.getState();
    const current = store.watch;
    if (!current || current.address !== address) return;
    const set = applyWatchEvent(store.utxos && store.utxos.address === address ? store.utxos : null, event, address);
    const item: WatchFeedItem = { at: event.at, kind: event.event, text: describeWatchEvent(event, (s) => formatKas(s)), ...("txid" in event ? { txid: event.txid } : {}) };
    const counted = event.event === "added" || event.event === "removed" || event.event === "matured" || event.event === "resync";
    const patch: Partial<WatchState> = {
      feed: [...current.feed, item].slice(-WATCH_FEED_MAX),
      events: current.events + (counted ? 1 : 0)
    };
    if (event.event === "snapshot") {
      patch.status = "live";
      patch.network = event.network;
      patch.balance = event.balance;
    } else if (event.event === "error" && event.fatal) {
      patch.error = `${event.code}: ${event.message}`;
    } else if (event.event === "end") {
      patch.endReason = event.reason;
    }
    if (set && (counted || event.event === "snapshot")) {
      store.patch({ utxos: { ...set, source: "watch", loadedAt: Date.now() }, utxosError: null });
    }
    this.patchWatch(patch);
    this.emit("watchChanged", event);
  }

  private patchWatch(p: Partial<WatchState>): void {
    const s = useExplorer.getState();
    const base: WatchState = s.watch ?? { address: "", jobId: null, status: "stopped", feed: [], events: 0, startedAt: Date.now() };
    s.patch({ watch: { ...base, ...p } });
  }
}

const arr = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : []);
