import { Clock, FolderOpen, FolderPlus, Terminal } from "lucide-react";
import { useEffect, useState } from "react";
import { api, IdeApiError, type CliInfo, type RecentEntry, type WorkspaceInfo } from "@/api/client";
import { HardKasMark, HardKasWordmark } from "@/shell/Logo";
import { joinPath, NewProjectDialog } from "./NewProjectDialog";

interface Props {
  onOpened: (workspace: WorkspaceInfo) => void;
}

/** Single-column start hub: workspace bar, truthful Kaspa targets, and structured recents table. */
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

  const cliLabel =
    cli === undefined
      ? "checking cli"
      : cli?.version
        ? `cli ${cli.version}`
        : `cli missing (${cli?.pinned ?? "0.13.0-rc.3"})`;

  const cliTitle =
    cli === undefined
      ? "Checking HardKas CLI version"
      : cli?.version
        ? `HardKas CLI ${cli.version} (${cli.source})${cli.version !== cli.pinned ? ` — tested with ${cli.pinned}` : ""}`
        : cli?.error ?? `HardKas CLI not found (tested with ${cli?.pinned ?? "0.13.0-rc.3"})`;

  return (
    <div className="h-full overflow-auto bg-bg">
      <div className="max-w-5xl mx-auto px-6 sm:px-8 py-10 space-y-6">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-4 min-w-0 flex-1">
            <HardKasMark size={48} />
            <div className="min-w-0 space-y-1.5">
              <div className="flex flex-wrap items-center gap-2.5">
                <h1 className="text-2xl sm:text-[28px] font-bold tracking-tight leading-none">
                  <HardKasWordmark /> <span className="text-fg-muted font-normal text-xl sm:text-2xl">IDE</span>
                </h1>
                <span
                  title={cliTitle}
                  className="inline-flex items-center gap-1.5 rounded border border-border bg-bg-panel px-2 py-0.5 font-mono text-[11px] text-fg-muted"
                >
                  <Terminal size={11} className="text-accent shrink-0" />
                  <span>{cliLabel}</span>
                </span>
              </div>
              <p className="text-fg-muted text-[13px] leading-snug max-w-2xl">
                Plan, sign, simulate, inspect and replay Kaspa workflows locally before any broadcast.
              </p>
              <div className="flex flex-wrap items-center gap-1.5 pt-0.5 text-[11px] font-mono">
                <span className="rounded border border-accent/40 bg-accent/10 px-2 py-0.5 text-accent">
                  L1 · SilverScript
                </span>
                <span className="rounded border border-border bg-bg-panel px-2 py-0.5 text-fg-muted">
                  Simulator &amp; Localnet
                </span>
                <span className="rounded border border-border bg-bg-panel px-2 py-0.5 text-fg-muted">
                  Lineage &amp; Covenant Graph
                </span>
              </div>
            </div>
          </div>

          <button
            type="button"
            className="btn-primary px-4 py-2 font-semibold shrink-0"
            onClick={() => setShowNew(true)}
          >
            <FolderPlus size={15} /> New project…
          </button>
        </header>

        <section className="rounded-lg border border-border bg-bg-panel p-3.5 space-y-2.5">
          <form
            className="flex flex-wrap sm:flex-nowrap items-center gap-2.5"
            onSubmit={(e) => {
              e.preventDefault();
              if (openPath.trim() && !busy) void open(openPath.trim());
            }}
          >
            <label
              htmlFor="home-open-folder-input"
              className="inline-flex items-center gap-2 text-fg text-xs font-medium cursor-pointer shrink-0"
            >
              <FolderOpen size={15} className="text-accent shrink-0" /> Open folder
            </label>
            <input
              id="home-open-folder-input"
              className="input font-mono flex-1 min-w-[200px]"
              placeholder={home ? `${home.replace(/\\/g, "/")}/my-hardkas-project` : "C:/path/to/project"}
              value={openPath}
              onChange={(e) => setOpenPath(e.target.value)}
            />
            <button
              type="submit"
              className="btn-ghost border border-border px-4 py-1.5 shrink-0 font-medium hover:border-accent/50"
              disabled={!openPath.trim() || busy}
            >
              {busy ? "Opening…" : "Open"}
            </button>
          </form>

          <div className="flex flex-wrap items-center justify-between gap-2 text-[11.5px] text-fg-muted border-t border-border/50 pt-2">
            <span>
              Any folder containing <code className="font-mono text-fg">hardkas.config.ts</code> opens directly.
            </span>
            <span className="flex items-center gap-2 font-mono text-[11px]">
              <span>Targets: simulator / localnet / rpc</span>
              <span className="text-border">|</span>
              <span className="inline-flex items-center gap-1">
                <kbd className="rounded border border-border bg-bg px-1.5 py-0.5 text-[10px] text-fg">Enter</kbd>
                <span>open path</span>
              </span>
            </span>
          </div>

          {error && <div role="alert" className="text-error text-xs break-words">{error}</div>}
        </section>

        <section className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <h2 className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
              <Clock size={12} /> Recent projects
            </h2>
            <span className="text-[11px] font-mono text-fg-muted tabular-nums">
              {recents.length} {recents.length === 1 ? "workspace" : "workspaces"}
            </span>
          </div>

          {recents.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border bg-bg-panel/40 p-8 text-center text-fg-muted text-sm">
              No recent projects yet. Create one or open a folder above.
            </div>
          ) : (
            <div className="rounded-lg border border-border bg-bg-panel overflow-hidden">
              <div className="grid grid-cols-[minmax(140px,1.2fr)_minmax(200px,2.4fr)_auto] items-center gap-3 px-4 py-2 border-b border-border bg-bg/50 text-[10.5px] font-mono uppercase tracking-wider text-fg-muted">
                <div>Project</div>
                <div>Path</div>
                <div className="text-right">Opened</div>
              </div>
              <ul className="divide-y divide-border/70">
                {recents.map((r) => (
                  <li key={r.path}>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void open(r.path)}
                      title={r.path}
                      className="w-full text-left grid grid-cols-[minmax(140px,1.2fr)_minmax(200px,2.4fr)_auto] items-center gap-3 px-4 py-2.5 hover:bg-bg-hover cursor-pointer transition-colors disabled:opacity-50"
                    >
                      <span className="text-fg font-medium text-[13px] truncate min-w-0">{r.name}</span>
                      <span className="text-fg-muted font-mono text-[12px] truncate min-w-0">{r.path}</span>
                      <span className="text-fg-muted font-mono text-[11.5px] tabular-nums shrink-0 text-right">
                        {new Date(r.openedAt).toLocaleDateString()}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      </div>

      {showNew && <NewProjectDialog defaultParent={home ? joinPath(home, "hardkas-projects") : ""} onClose={() => setShowNew(false)} onCreated={(ws) => onOpened(ws)} />}
    </div>
  );
}
