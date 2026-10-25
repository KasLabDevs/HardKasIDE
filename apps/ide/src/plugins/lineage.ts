import { GitBranch } from "lucide-react";
import { api } from "@/api/client";
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

  onActivation(): void {
    this.connect();
    this.offs.push(this.on("deployRun", "transactionExecuted", () => this.scheduleRefresh(800)));
  }

  onDeactivation(): void {
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
        useLineage.getState().setLive(false);
        // EventSource retries on its own; if the dev-server is down, refresh() reports it.
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
      const [artifacts, lineage] = await Promise.all([
        api.dev<{ artifacts: ArtifactRow[] }>("/artifacts"),
        api.dev<{ nodes: Array<{ id: string }>; edges: LineageEdge[] }>("/lineage")
      ]);
      store.setGraph(artifacts.artifacts ?? [], lineage.edges ?? []);
      store.setError(null);
      this.emit("updated");
    } catch (e) {
      store.setError(e instanceof Error ? e.message : String(e));
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
