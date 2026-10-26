import clsx from "clsx";
import { X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api, IdeApiError, type ProjectTemplate, type WorkspaceInfo } from "@/api/client";

interface Props {
  defaultParent: string;
  onClose: () => void;
  onCreated: (workspace: WorkspaceInfo) => void;
}

/**
 * "New project" wizard: template → name → folder → Create.
 * Runs `hardkas init` or `hardkas create <template> <dest>` through the ide-server
 * and streams the CLI output while it works.
 */
export function NewProjectDialog({ defaultParent, onClose, onCreated }: Props) {
  const [templates, setTemplates] = useState<ProjectTemplate[]>([]);
  const [template, setTemplate] = useState("init");
  const [name, setName] = useState("my-hardkas-app");
  const [parent, setParent] = useState(defaultParent);
  const [install, setInstall] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const [phase, setPhase] = useState<"form" | "running" | "done" | "failed">("form");
  const [error, setError] = useState<string | null>(null);
  const logRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    api.project
      .templates()
      .then((r) => {
        setTemplates(r.templates);
        if (!parent) setParent(r.defaultParent);
      })
      .catch((e) => setError(String(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [log]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && phase !== "running") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase, onClose]);

  const create = async () => {
    setPhase("running");
    setError(null);
    setLog([]);
    try {
      const { job, dest } = await api.project.create({ template, name, parentDir: parent, install });
      setLog((l) => [...l, `$ hardkas ${job.args.join(" ")}`, `→ ${dest}`]);
      const done = await api.jobs.follow(job.id, (_type, data) => setLog((l) => [...l, data.trimEnd()]));
      if (done.status !== "succeeded") {
        setPhase("failed");
        setError(`hardkas exited with code ${done.exitCode}. The folder may be partially created.`);
        return;
      }
      setPhase("done");
      const ws = await api.workspace.open(dest);
      onCreated(ws);
    } catch (e) {
      setPhase("failed");
      setError(e instanceof IdeApiError ? e.message : String(e));
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-6" onClick={phase === "running" ? undefined : onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-project-dialog-title"
        className="w-full max-w-3xl max-h-full overflow-auto rounded-lg border border-border bg-bg-elev shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between px-5 py-3 border-b border-border">
          <h2 id="new-project-dialog-title" className="text-sm font-semibold">Create a new HardKas project</h2>
          <button type="button" onClick={onClose} disabled={phase === "running"} className="text-fg-muted hover:text-fg" aria-label="Close dialog">
            <X size={16} />
          </button>
        </header>

        {phase === "form" || phase === "failed" ? (
          <div className="p-5 grid grid-cols-1 md:grid-cols-5 gap-5 text-xs">
            <div className="md:col-span-3">
              <div className="label">Template</div>
              <div className="grid gap-2 max-h-80 overflow-auto pr-1">
                {templates.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    aria-pressed={template === t.id}
                    onClick={() => setTemplate(t.id)}
                    className={clsx(
                      "text-left rounded border p-3 transition-colors cursor-pointer",
                      template === t.id ? "border-accent bg-bg-hover" : "border-border bg-bg-panel hover:bg-bg-hover"
                    )}
                  >
                    <div className="font-medium text-fg">{t.label}</div>
                    <div className="text-fg-muted mt-0.5">{t.description}</div>
                    <div className="text-[10px] font-mono text-fg-muted mt-1">hardkas {t.command === "init" ? "init" : `create ${t.id}`}</div>
                  </button>
                ))}
                {templates.length === 0 && <div className="text-fg-muted">Loading templates…</div>}
              </div>
            </div>
            <div className="md:col-span-2 space-y-3">
              <div>
                <label htmlFor="new-project-name" className="label">Project name</label>
                <input id="new-project-name" className="input" value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div>
                <label htmlFor="new-project-parent" className="label">Location</label>
                <input id="new-project-parent" className="input font-mono" value={parent} onChange={(e) => setParent(e.target.value)} />
                <div className="text-fg-muted mt-1 font-mono text-[11px] break-all">
                  {parent.replace(/[\\/]+$/, "")}
                  {parent ? "/" : ""}
                  {name}
                </div>
              </div>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={install} onChange={(e) => setInstall(e.target.checked)} />
                <span>Run install after creating (slower)</span>
              </label>
              {error && <div role="alert" className="text-error break-words">{error}</div>}
              <button type="button" className="btn-primary w-full justify-center py-2" disabled={!name || !parent || templates.length === 0} onClick={() => void create()}>
                Create
              </button>
              <p className="text-fg-muted text-[11px]">
                The parent folder must exist. The project folder itself must not. Uses the HardKas CLI pinned to 0.12.0-rc.29 (via npx if not installed).
              </p>
            </div>
          </div>
        ) : (
          <div className="p-5 space-y-3 text-xs">
            <div className={phase === "done" ? "text-ok" : "text-info"}>{phase === "done" ? "Project created. Opening…" : "Running the HardKas CLI… (first run downloads @hardkas/cli, this can take a minute)"}</div>
            <pre ref={logRef} className="rounded border border-border bg-bg p-3 h-64 overflow-auto font-mono text-[11px] whitespace-pre-wrap">
              {log.join("\n")}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}
