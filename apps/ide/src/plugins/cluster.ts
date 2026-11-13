import { Boxes } from "lucide-react";
import { Plugin } from "@/engine/engine";
import { useCluster, type ClusterStatus, type NodeInspectDetail, type Sample } from "@/store/cluster";
import { useIde } from "@/store/ide";
import { ClusterNodeView } from "@/views/ClusterNodeView";

/**
 * Local cluster controller: extra simnet nodes next to the HardKAS node, started and stopped through Docker by ide-server.
 * The Servers view calls start() while the Cluster card is on screen; nothing polls otherwise.
 */
export class ClusterPlugin extends Plugin {
  view = ClusterNodeView;
  private timer: ReturnType<typeof setInterval> | null = null;
  private viewers = 0;
  private logTimer: ReturnType<typeof setInterval> | null = null;
  private inspectTimer: ReturnType<typeof setInterval> | null = null;
  private inspectViewers = 0;

  constructor() {
    super({
      name: "cluster",
      displayName: "Cluster",
      location: "none",
      icon: Boxes,
      methods: [
        "start",
        "stop",
        "refresh",
        "add",
        "scale",
        "action",
        "openLog",
        "closeLog",
        "openNode",
        "refreshInspect",
        "startInspectPoll",
        "stopInspectPoll"
      ],
      events: ["updated"]
    });
  }

  onDeactivation(): void {
    this.viewers = 0;
    this.inspectViewers = 0;
    this.halt();
    this.haltInspect();
    this.closeLog();
    useCluster.getState().set({
      status: null,
      samples: {},
      error: null,
      selectedNode: null,
      inspect: null,
      inspectLoading: false,
      inspectError: null,
      inspectLogs: ""
    });
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

  async action(name: string, action: "start" | "stop" | "restart" | "remove"): Promise<void> {
    const word = { start: "Starting", stop: "Stopping", restart: "Restarting", remove: "Removing" }[action];
    await this.change(`${word} ${name}…`, "/node", { name, action });
    if (useCluster.getState().selectedNode === name) {
      if (action === "remove") {
        const next = useCluster.getState().status?.nodes[0]?.name ?? null;
        useCluster.getState().set({ selectedNode: next, inspect: null, inspectLogs: "" });
        if (next) await this.refreshInspect(next);
      } else {
        await this.refreshInspect(name);
      }
    }
  }

  // ------------------------------------------------------------------ node inspector (OpenShift pod details view)

  openNode(name: string): void {
    const prev = useCluster.getState().selectedNode;
    useCluster.getState().set({
      selectedNode: name,
      inspectError: null,
      ...(prev !== name ? { inspect: null, inspectLogs: "" } : {})
    });
    useIde.getState().openView(this.profile.name, "Cluster pods");
    void this.refreshInspect(name);
  }

  async refreshInspect(name?: string): Promise<void> {
    const nodeName = name ?? useCluster.getState().selectedNode;
    if (!nodeName || useCluster.getState().selectedNode !== nodeName) return;
    useCluster.getState().set({ inspectLoading: true, inspectError: null });
    try {
      const r = await this.request<{ node: NodeInspectDetail }>(`/inspect?name=${encodeURIComponent(nodeName)}`);
      if (useCluster.getState().selectedNode !== nodeName) return;
      useCluster.getState().set({ inspect: r.node, inspectLoading: false, inspectError: null });
      if (useCluster.getState().inspectTab === "logs") {
        const lr = await this.request<{ text: string }>(`/logs?name=${encodeURIComponent(nodeName)}&tail=300`).catch(() => null);
        if (lr && useCluster.getState().selectedNode === nodeName) {
          useCluster.getState().set({ inspectLogs: lr.text || "(no output yet)" });
        }
      }
    } catch (e) {
      if (useCluster.getState().selectedNode === nodeName) {
        useCluster.getState().set({ inspectLoading: false, inspectError: e instanceof Error ? e.message : String(e) });
      }
    }
  }

  startInspectPoll(): void {
    this.inspectViewers++;
    void this.refresh();
    void this.refreshInspect();
    if (this.inspectTimer) return;
    this.inspectTimer = setInterval(() => {
      void this.refresh();
      void this.refreshInspect();
    }, 3000);
  }

  stopInspectPoll(): void {
    this.inspectViewers = Math.max(0, this.inspectViewers - 1);
    if (this.inspectViewers === 0) this.haltInspect();
  }

  private haltInspect(): void {
    if (this.inspectTimer) {
      clearInterval(this.inspectTimer);
      this.inspectTimer = null;
    }
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
