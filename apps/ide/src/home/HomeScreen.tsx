import { Clock, FolderOpen, FolderPlus } from "lucide-react";
import { useEffect, useState } from "react";
import { api, IdeApiError, type CliInfo, type RecentEntry, type WorkspaceInfo } from "@/api/client";
import { HardKasMark, HardKasWordmark } from "@/shell/Logo";
import { NewProjectDialog } from "./NewProjectDialog";

interface Props {
  onOpened: (workspace: WorkspaceInfo) => void;
}

/** Visual Studio-style start page: New project, Open folder, Recents. */
export function HomeScreen({ onOpened }: Props) {
  const [recents, setRecents] = useState<RecentEntry[]>([]);
  const [home, setHome] = useState("");
  const [openPath, setOpenPath] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // undefined while asking, null when the server could not tell.
  const [cli, setCli] = useState<CliInfo | null | undefined>(undefined);

  useEffect(() => {
    api.workspace
      .recents()
      .then((r) => {
        setRecents(r.recents);
        setHome(r.home);
      })
      .catch((e) => setError(String(e)));
    api.cli().then(setCli, () => setCli(null));
  }, []);

  const open = async (path: string) => {
    setBusy(true);
    setError(null);
    try {
      const ws = await api.workspace.open(path);
      onOpened(ws);
    } catch (e) {
      setError(e instanceof IdeApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="h-full overflow-auto bg-bg">
      <div className="max-w-5xl mx-auto px-8 py-12">
        <header className="flex items-center gap-4 mb-10">
          <HardKasMark size={56} />
          <div>
            <h1 className="text-3xl font-bold tracking-tight leading-none">
              <HardKasWordmark /> <span className="text-fg-muted font-normal text-xl">IDE</span>
            </h1>
            <div className="text-[11px] uppercase tracking-[0.3em] text-fg-muted mt-1">Kaspa developer toolkit</div>
            <p className="text-fg-muted text-sm mt-2">Plan, sign, simulate, inspect and replay Kaspa transaction workflows. Nothing touches a real network until you say so.</p>
          </div>
        </header>

        <div className="grid grid-cols-1 md:grid-cols-5 gap-10">
          <section className="md:col-span-2 space-y-6">
            <div>
              <h2 className="label">Start</h2>
              <div className="space-y-2">
                <button type="button" className="btn-primary w-full justify-start py-2.5" onClick={() => setShowNew(true)}>
                  <FolderPlus size={16} /> New project…
                </button>
                <div className="rounded border border-border bg-bg-panel p-3 space-y-2">
                  <label htmlFor="home-open-folder-input" className="flex items-center gap-2 text-fg cursor-pointer">
                    <FolderOpen size={16} className="text-fg-muted" /> Open folder
                  </label>
                  <input
                    id="home-open-folder-input"
                    className="input font-mono"
                    placeholder={home ? `${home.replace(/\\/g, "/")}/my-hardkas-project` : "C:/path/to/project"}
                    value={openPath}
                    onChange={(e) => setOpenPath(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && openPath && void open(openPath)}
                  />
                  <button type="button" className="btn-ghost w-full justify-center" disabled={!openPath || busy} onClick={() => void open(openPath)}>
                    {busy ? "Opening…" : "Open"}
                  </button>
                  <p className="text-fg-muted text-[11px]">A HardKas project is any folder with a hardkas.config.ts. Paste the absolute path.</p>
                </div>
              </div>
            </div>

            <div className="text-[11px] text-fg-muted space-y-1">
              <p>Workbench for Kaspa and SilverScript. Project flow shaped after Visual Studio.</p>
              <p>
                Engine: HardKas CLI {cli === undefined ? "…" : cli?.version ?? `not found (tested with ${cli?.pinned ?? "0.12.0-rc.29"})`}
                {cli?.version && cli.version !== cli.pinned ? ` (tested with ${cli.pinned})` : ""} · simulator / localnet / rpc.
              </p>
            </div>
          </section>

          <section className="md:col-span-3">
            <h2 className="label flex items-center gap-1.5">
              <Clock size={12} /> Recent projects
            </h2>
            {recents.length === 0 ? (
              <div className="rounded border border-dashed border-border p-6 text-center text-fg-muted">
                No recent projects yet. Create one or open a folder.
              </div>
            ) : (
              <ul className="divide-y divide-border rounded border border-border bg-bg-panel overflow-hidden">
                {recents.map((r) => (
                  <li key={r.path}>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void open(r.path)}
                      className="w-full text-left px-4 py-3 hover:bg-bg-hover flex items-center justify-between gap-4 cursor-pointer transition-colors disabled:opacity-50"
                    >
                      <div className="min-w-0">
                        <div className="text-fg font-medium truncate">{r.name}</div>
                        <div className="text-fg-muted font-mono text-[11px] truncate">{r.path}</div>
                      </div>
                      <div className="text-fg-muted text-[11px] shrink-0 tabular-nums">{new Date(r.openedAt).toLocaleDateString()}</div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {error && <div role="alert" className="mt-3 text-error text-xs break-words">{error}</div>}
          </section>
        </div>
      </div>

      {showNew && <NewProjectDialog defaultParent={home ? `${home}\\hardkas-projects` : ""} onClose={() => setShowNew(false)} onCreated={(ws) => onOpened(ws)} />}
    </div>
  );
}
