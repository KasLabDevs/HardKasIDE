import clsx from "clsx";
import { FileJson, RefreshCw, ShieldCheck } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { api, IdeApiError } from "@/api/client";
import { useEngine } from "@/engine/context";
import type { TerminalPlugin } from "@/plugins/terminal";
import { useIde } from "@/store/ide";

interface ArtifactRow {
  artifactId: string;
  schema: string;
  kind?: string;
  mode?: string;
  networkId?: string;
  txId?: string;
  createdAt?: string;
  path?: string;
  integrityStatus?: string;
  parentArtifactId?: string;
}

const SCHEMA_COLORS: Record<string, string> = {
  txPlan: "text-info",
  signedTx: "text-warn",
  txReceipt: "text-ok",
  silverCompile: "text-accent"
};

/**
 * Artifacts from the HardKas dev-server (`hardkas dev`, :7420) through the
 * ide-server proxy: plan → signed → receipt lineage, replay verification.
 */
export function ArtifactsPanel() {
  const engine = useEngine();
  const workspace = useIde((s) => s.workspace);
  const [rows, setRows] = useState<ArtifactRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.dev<{ artifacts: ArtifactRow[] }>("/artifacts");
      const list = data.artifacts ?? [];
      list.sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
      setRows(list);
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

  const open = (row: ArtifactRow) => {
    if (!row.path) return;
    const root = workspace?.root ?? "";
    let rel = row.path.replace(/\\/g, "/");
    const normRoot = root.replace(/\\/g, "/");
    if (normRoot && rel.toLowerCase().startsWith(normRoot.toLowerCase())) rel = rel.slice(normRoot.length).replace(/^\/+/, "");
    void engine.call("fileManager", "open", rel);
  };

  const visible = filter ? rows.filter((r) => r.schema.includes(filter)) : rows;

  return (
    <div className="text-xs">
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border">
        <select className="input py-1" value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="">all schemas</option>
          <option value="txPlan">plans</option>
          <option value="signedTx">signed</option>
          <option value="txReceipt">receipts</option>
          <option value="silverCompile">silver</option>
        </select>
        <span className="text-fg-muted whitespace-nowrap">{visible.length}</span>
        <button onClick={() => void load()} className="text-fg-muted hover:text-fg" title="Refresh">
          <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
        </button>
      </div>
      {error && (
        <div className="p-3 space-y-2">
          <div className="text-warn">{error}</div>
          <div className="text-fg-muted">Start the HardKas dev-server in the project folder, then refresh:</div>
          <button className="btn-ghost w-full justify-center" onClick={() => void engine.get<TerminalPlugin>("terminal").runHardkas(["dev", "--headless"])}>
            Run hardkas dev --headless
          </button>
        </div>
      )}
      <ul>
        {visible.map((a) => {
          const short = a.schema.replace(/^hardkas\./, "");
          return (
            <li key={a.artifactId} className="px-3 py-2 border-b border-border hover:bg-bg-hover">
              <div className="flex items-center justify-between gap-2">
                <span className={clsx("font-semibold", SCHEMA_COLORS[short] ?? "text-fg")}>{short}</span>
                <span className="flex items-center gap-2">
                  {a.path && (
                    <button title="Open JSON" onClick={() => open(a)} className="text-fg-muted hover:text-accent">
                      <FileJson size={14} />
                    </button>
                  )}
                  <button title="Replay verify" onClick={() => void replay(a.artifactId)} className="text-fg-muted hover:text-accent">
                    <ShieldCheck size={14} />
                  </button>
                </span>
              </div>
              <div className="font-mono text-[10px] text-fg-muted truncate" title={a.artifactId}>
                {a.artifactId}
              </div>
              {a.txId && (
                <div className="font-mono text-[10px] text-fg-muted truncate" title={a.txId}>
                  tx {a.txId}
                </div>
              )}
              <div className="flex gap-2 text-fg-muted mt-0.5">
                {a.mode && <span>{a.mode}</span>}
                {a.networkId && <span>{a.networkId}</span>}
                {a.integrityStatus && <span className={a.integrityStatus === "ok" || a.integrityStatus === "verified" ? "text-ok" : "text-warn"}>{a.integrityStatus}</span>}
                {a.createdAt && <span className="ml-auto">{new Date(a.createdAt).toLocaleTimeString(undefined, { hour12: false })}</span>}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
