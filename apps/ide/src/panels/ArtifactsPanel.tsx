import { RefreshCw, ShieldCheck } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { api, IdeApiError } from "@/api/client";
import { useEngine } from "@/engine/context";
import type { TerminalPlugin } from "@/plugins/terminal";

interface ArtifactRow {
  artifactId: string;
  schema: string;
  kind?: string;
  mode?: string;
  networkId?: string;
  txId?: string;
  createdAt?: string;
  integrityStatus?: string;
  parentArtifactId?: string;
}

/**
 * Artifacts list from the HardKas dev-server (`hardkas dev`, :7420) through the
 * ide-server proxy. If the dev-server is not running, explains how to start it.
 */
export function ArtifactsPanel() {
  const engine = useEngine();
  const [rows, setRows] = useState<ArtifactRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.dev<{ artifacts: ArtifactRow[] }>("/artifacts");
      setRows(data.artifacts ?? []);
    } catch (e) {
      setError(e instanceof IdeApiError ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    return engine.on("deployRun", "transactionExecuted", () => void load());
  }, [engine, load]);

  const replay = async (id: string) => {
    const terminal = engine.get<TerminalPlugin>("terminal");
    try {
      const res = await api.dev("/artifacts/" + encodeURIComponent(id) + "/replay", { method: "POST", body: "{}" });
      terminal.logJson(`replay ${id.slice(0, 12)}…`, res);
    } catch (e) {
      terminal.error(String(e));
    }
  };

  return (
    <div className="text-xs">
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-border">
        <span className="text-fg-muted">{rows.length} artifact(s)</span>
        <button onClick={() => void load()} className="text-fg-muted hover:text-fg" title="Refresh">
          <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
        </button>
      </div>
      {error && (
        <div className="p-3 space-y-2">
          <div className="text-warn">{error}</div>
          <div className="text-fg-muted">
            Start the HardKas dev-server in the project folder, then refresh:
          </div>
          <button className="btn-ghost w-full justify-center" onClick={() => void engine.get<TerminalPlugin>("terminal").runHardkas(["dev", "--headless"])}>
            Run hardkas dev --headless
          </button>
        </div>
      )}
      <ul>
        {rows.map((a) => (
          <li key={a.artifactId} className="px-3 py-2 border-b border-border hover:bg-bg-hover">
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono text-[11px] truncate" title={a.artifactId}>
                {a.artifactId}
              </span>
              <button title="Replay verify" onClick={() => void replay(a.artifactId)} className="text-fg-muted hover:text-accent">
                <ShieldCheck size={14} />
              </button>
            </div>
            <div className="flex gap-2 text-fg-muted mt-0.5">
              <span className="text-info">{a.schema.replace(/^hardkas\./, "")}</span>
              {a.mode && <span>{a.mode}</span>}
              {a.networkId && <span>{a.networkId}</span>}
              {a.integrityStatus && <span className={a.integrityStatus === "ok" ? "text-ok" : "text-warn"}>{a.integrityStatus}</span>}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
