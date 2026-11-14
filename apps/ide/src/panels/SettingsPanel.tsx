import { useEffect, useState } from "react";
import { useEnv } from "@/store/env";
import { useIde } from "@/store/ide";
import { useUpdates } from "@/store/updates";

export function SettingsPanel() {
  const workspace = useIde((s) => s.workspace);
  const resetLayout = useIde((s) => s.resetLayout);
  const cli = useEnv((s) => s.cli);
  const report = useUpdates((s) => s.report);
  const checking = useUpdates((s) => s.checking);
  const checkUpdates = useUpdates((s) => s.check);
  const openUpdates = useUpdates((s) => s.openPopover);
  // The addresses this IDE really talks to (the server reports its own port and the dev-server it proxies to).
  const [info, setInfo] = useState<{ port?: number; devServer?: string } | null>(null);
  useEffect(() => {
    fetch("/api/info")
      .then((r) => r.json() as Promise<{ port?: number; devServer?: string }>)
      .then(setInfo)
      .catch(() => setInfo(null));
  }, []);

  const updateSummary = !report
    ? "not checked yet"
    : report.ide.hasUpdate
      ? `IDE v${report.ide.latestVersion} available`
      : report.cli.hasUpdate
        ? `CLI v${report.cli.targetVersion} recommended`
        : report.ide.error
          ? "up to date locally (release check offline)"
          : "up to date";

  return (
    <div className="p-3 space-y-4 text-xs">
      <div>
        <div className="label">Workspace</div>
        <dl className="space-y-1">
          <Row k="root" v={workspace?.root ?? "—"} mono />
          <Row k="config" v={workspace?.configFile ?? "not found (run hardkas init)"} />
          <Row k=".hardkas/" v={workspace?.hasHardkasDir ? "present" : "missing"} />
          <Row k="dev-server token" v={workspace?.hasDevServerToken ? "present (hardkas dev was run)" : "missing"} />
        </dl>
      </div>
      <div>
        <div className="label">Layout</div>
        <p className="text-fg-muted mb-2">Every panel has an icon in the left rail wherever it is docked. If the layout got confusing, put everything back where it starts.</p>
        <button type="button" className="btn-ghost" onClick={() => resetLayout()}>
          Reset panel layout
        </button>
      </div>
      <div>
        <div className="label">Updates</div>
        <dl className="space-y-1 mb-2">
          <Row k="IDE" v={`v${__APP_VERSION__}`} mono />
          <Row k="CLI" v={cli?.version ? `v${cli.version} (${cli.source})` : "not found"} mono />
          <Row k="status" v={checking ? "checking…" : updateSummary} />
        </dl>
        <button
          type="button"
          className="btn-ghost"
          disabled={checking}
          onClick={() => {
            openUpdates();
            void checkUpdates(true);
          }}
        >
          {checking ? "Checking…" : "Check for updates"}
        </button>
      </div>
      <div>
        <div className="label">Servers</div>
        <dl className="space-y-1">
          <Row k="ide-server" v={info?.port ? `http://127.0.0.1:${info.port} (files, jobs, proxy)` : "not reachable"} mono />
          <Row k="dev-server" v={`${info?.devServer ?? "http://localhost:7420"} (hardkas dev)`} mono />
          <Row k="ui" v={location.origin} mono />
        </dl>
      </div>
      <div>
        <div className="label">About</div>
        <p className="text-fg-muted">
          HardKas IDE is a workbench for HardKas projects, with a Visual Studio-style project flow and Eclipse-style views. Design notes live in docs/design-notes.md.
        </p>
      </div>
    </div>
  );
}

function Row({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    // The label sits above the value: a long path or address gets the whole panel width instead of a narrow column.
    <div>
      <dt className="text-fg-muted">{k}</dt>
      <dd className={mono ? "font-mono break-all" : "break-words"}>{v}</dd>
    </div>
  );
}
