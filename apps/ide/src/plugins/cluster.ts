import { Plugin } from "@/engine/engine";
import { useCluster, type ClusterStatus, type Sample } from "@/store/cluster";

/**
 * Local cluster controller: extra simnet nodes next to the HardKAS node, started and stopped through Docker by ide-server.
 * The Servers view calls start() while the Cluster card is on screen; nothing polls otherwise.
 */
export class ClusterPlugin extends Plugin {
  private timer: ReturnType<typeof setInterval> | null = null;
  private viewers = 0;
  private logTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    super({
      name: "cluster",
      displayName: "Cluster",
      location: "none",
      methods: ["start", "stop", "refresh", "add", "scale", "action", "openLog", "closeLog"],
      events: ["updated"]
    });
  }

  onDeactivation(): void {
    this.viewers = 0;
    this.halt();
    this.closeLog();
    useCluster.getState().set({ status: null, samples: {}, error: null });
  }

  start(): void {
    this.viewers += 1;
    if (this.timer) return;
    void this.refresh();
    this.timer = setInterval(() => {
      if (typeof document !== "undefined" && document.hidden) return;
      void this.refresh();
    }, 3000);
  }

  stop(): void {
    this.viewers = Math.max(0, this.viewers - 1);
    if (this.viewers === 0) this.halt();
  }

  private halt(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async request<T>(path: string, body?: unknown): Promise<T> {
    // A request that never answers (the dev proxy can hang when the server restarts) must not freeze the panel for good.
    const timeout = AbortSignal.timeout(path === "/add" || path === "/scale" || path === "/node" ? 150_000 : 8_000);
    const res = await fetch(`/api/cluster${path}`, body === undefined ? { signal: timeout } : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: timeout });
    const json = (await res.json()) as { ok: boolean; message?: string } & T;
    if (!json.ok) throw new Error(json.message ?? `cluster request failed (${res.status})`);
    return json;
  }

  async refresh(): Promise<void> {
    const s = useCluster.getState();
    if (s.loading) return;
    s.set({ loading: true });
    try {
      const status = await this.request<ClusterStatus & { ok: boolean }>("");
      const now = Date.now();
      const samples: Record<string, Sample[]> = { ...useCluster.getState().samples };
      for (const n of status.nodes) {
        if (!n.chain) continue;
        const list = [...(samples[n.name] ?? []), [now, Math.max(n.chain.blocks, n.chain.headers)] as Sample];
        samples[n.name] = list.slice(-12);
      }
      useCluster.getState().set({ status, samples, error: null, updatedAt: now });
      this.emit("updated");
    } catch (e) {
      useCluster.getState().set({ error: e instanceof Error ? e.message : String(e) });
    } finally {
      useCluster.getState().set({ loading: false });
    }
  }

  private async change(label: string, path: string, body: unknown): Promise<void> {
    const s = useCluster.getState();
    if (s.busy) return;
    s.set({ busy: label, error: null });
    try {
      await this.request(path, body);
    } catch (e) {
      useCluster.getState().set({ error: e instanceof Error ? e.message : String(e) });
    } finally {
      useCluster.getState().set({ busy: null });
      await this.refresh();
    }
  }

  add(count = 1): Promise<void> {
    return this.change(count === 1 ? "Adding a node…" : `Adding ${count} nodes…`, "/add", { count });
  }

  scale(replicas: number): Promise<void> {
    return this.change(`Scaling to ${replicas} extra node${replicas === 1 ? "" : "s"}…`, "/scale", { replicas });
  }

  action(name: string, action: "start" | "stop" | "restart" | "remove"): Promise<void> {
    const word = { start: "Starting", stop: "Stopping", restart: "Restarting", remove: "Removing" }[action];
    return this.change(`${word} ${name}…`, "/node", { name, action });
  }

  // ------------------------------------------------------------------ logs

  openLog(name: string): void {
    this.closeLog();
    useCluster.getState().set({ logFor: name, logText: "Loading…" });
    const load = async () => {
      try {
        const r = await this.request<{ text: string }>(`/logs?name=${encodeURIComponent(name)}&tail=120`);
        if (useCluster.getState().logFor === name) useCluster.getState().set({ logText: r.text || "(no output yet)" });
      } catch (e) {
        useCluster.getState().set({ logText: e instanceof Error ? e.message : String(e) });
      }
    };
    void load();
    this.logTimer = setInterval(() => void load(), 3000);
  }

  closeLog(): void {
    if (this.logTimer) clearInterval(this.logTimer);
    this.logTimer = null;
    useCluster.getState().set({ logFor: null, logText: "" });
  }
}
