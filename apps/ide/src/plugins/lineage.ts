import { GitBranch } from "lucide-react";
import { api, IdeApiError } from "@/api/client";
import { Plugin } from "@/engine/engine";
import { useLineage, type ArtifactRow, type LineageEdge } from "@/store/lineage";
import { useIde } from "@/store/ide";
import { LineageView } from "@/views/LineageView";
import type { ConsolePlugin } from "./console";

/**
 * Live lineage: every artifact the dev-server knows (plan → signed → receipt /
 * submission → observation …) as a graph that updates itself through the
 * dev-server's SSE stream. HardKas's reproducibility story, drawn.
 */
export class LineagePlugin extends Plugin {
  view = LineageView;
  private source: EventSource | null = null;
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;
  private offs: Array<() => void> = [];

  constructor() {
    super({
      name: "lineage",
      displayName: "Lineage",
      description: "Live graph of artifacts and their provenance",
      location: "mainPanel",
      icon: GitBranch,
      order: 50,
      methods: ["open", "refresh", "replay", "openArtifact"],
      events: ["updated", "artifactArrived"]
    });
  }

  private probeTimer: ReturnType<typeof setInterval> | null = null;

  onActivation(): void {
    void this.ensureConnected();
    this.probeTimer = setInterval(() => {
      if (!this.source) void this.ensureConnected();
    }, 15_000);
    this.offs.push(() => {
      if (this.probeTimer) {
        clearInterval(this.probeTimer);
        this.probeTimer = null;
      }
    });
    this.offs.push(this.on("deployRun", "transactionExecuted", () => this.scheduleRefresh(800)));
  }

  private async ensureConnected(): Promise<void> {
    if (this.source) return;
    try {
      const status = await api.devStatus();
      if (!status.available) {
        useLineage.getState().setLive(false);
        return;
      }
      this.connect();
    } catch {
      useLineage.getState().setLive(false);
    }
  }

  onDeactivation(): void {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
    this.source?.close();
    this.source = null;
    for (const off of this.offs) off();
    this.offs = [];
  }

  open(): void {
    useIde.getState().openView(this.profile.name, "Lineage");
    void this.refresh();
  }

  private connect(): void {
    this.source?.close();
    try {
      const es = new EventSource("/api/dev/artifacts/stream");
      es.addEventListener("connected", () => useLineage.getState().setLive(true));
      es.addEventListener("artifact", (e) => {
        try {
          const env = JSON.parse((e as MessageEvent).data as string) as { artifactId?: string; type?: string };
          if (env.artifactId) useLineage.getState().markFresh(env.artifactId);
          this.emit("artifactArrived", env);
        } catch {
          // ignore malformed envelopes
        }
        this.scheduleRefresh(400);
      });
      es.onerror = () => {
        // Close immediately instead of letting EventSource spin on 502s when dev-server is down.
        es.close();
        if (this.source === es) this.source = null;
        useLineage.getState().setLive(false);
      };
      this.source = es;
    } catch {
      useLineage.getState().setLive(false);
    }
  }

  private scheduleRefresh(ms: number): void {
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.refreshTimer = setTimeout(() => void this.refresh(), ms);
  }

  async refresh(): Promise<void> {
    const store = useLineage.getState();
    store.setLoading(true);
    try {
      const status = await api.devStatus().catch(() => ({ available: false, url: "", error: null }));
      if (status.available) {
        if (!this.source) this.connect();
        try {
          const [artifacts, lineage] = await Promise.all([
            api.dev<{ artifacts: ArtifactRow[] }>("/artifacts"),
            api.dev<{ nodes: Array<{ id: string }>; edges: LineageEdge[] }>("/lineage")
          ]);
          // The dev-server lists artifacts without a reading of them; the IDE server has one for each.
          const words = await api.store.lineage().catch(() => null);
          const summaries = new Map((words?.artifacts ?? []).map((a) => [a.artifactId, a.summary]));
          store.setGraph(
            (artifacts.artifacts ?? []).map((a) => (a.summary || !summaries.get(a.artifactId) ? a : { ...a, summary: summaries.get(a.artifactId) })),
            lineage.edges ?? []
          );
          store.setError(null);
          this.emit("updated");
          return;
        } catch {
          store.setLive(false);
        }
      } else {
        store.setLive(false);
      }

      const fallback = await api.store.lineage();
      store.setGraph(fallback.artifacts ?? [], fallback.edges ?? []);
      store.setError(null);
      this.emit("updated");
    } catch (e) {
      if (e instanceof IdeApiError && e.code === "NO_WORKSPACE") {
        store.setGraph([], []);
        store.setError(null);
      } else {
        store.setError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      store.setLoading(false);
    }
  }

  /** Replay-verifies an artifact through the dev-server and records the verdict on the node. */
  async replay(artifactId: string): Promise<void> {
    const store = useLineage.getState();
    const console_ = this.engine.get<ConsolePlugin>("console");
    store.setReplay(artifactId, { status: "running" });
    try {
      const res = await api.dev<Record<string, unknown>>(`/artifacts/${encodeURIComponent(artifactId)}/replay`, { method: "POST", body: "{}" });
      // dev-server shape: { ok, data: { status: passed|diverged|missing_dependency|unsupported, lineage, determinism, contamination, artifactsScanned } }
      const data = (res.data ?? res) as { status?: string; passed?: boolean };
      const status = String(data.status ?? (data.passed ? "passed" : "unknown"));
      store.setReplay(artifactId, { status, detail: res });
      console_.logJson(`replay ${artifactId.slice(0, 12)}… → ${status}`, res);
    } catch (e) {
      store.setReplay(artifactId, { status: "error", detail: String(e) });
      console_.error(`replay ${artifactId.slice(0, 12)}…: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  /** Opens the artifact's JSON in the editor (path from the dev-server, made workspace-relative). */
  async openArtifact(row: ArtifactRow): Promise<void> {
    if (!row.path) return;
    const root = (useIde.getState().workspace?.root ?? "").replace(/\\/g, "/");
    let rel = row.path.replace(/\\/g, "/");
    if (root && rel.toLowerCase().startsWith(root.toLowerCase())) rel = rel.slice(root.length).replace(/^\/+/, "");
    await this.call("fileManager", "open", rel);
  }
}
