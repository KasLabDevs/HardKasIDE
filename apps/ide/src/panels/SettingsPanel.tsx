import { useIde } from "@/store/ide";

export function SettingsPanel() {
  const workspace = useIde((s) => s.workspace);
  const resetLayout = useIde((s) => s.resetLayout);
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
        <div className="label">Servers</div>
        <dl className="space-y-1">
          <Row k="ide-server" v="http://127.0.0.1:7421 (files, jobs, proxy)" mono />
          <Row k="dev-server" v="http://127.0.0.1:7420 (hardkas dev)" mono />
          <Row k="ui" v="http://localhost:5173" mono />
        </dl>
      </div>
      <div>
        <div className="label">About</div>
        <p className="text-fg-muted">
          HardKas IDE is shaped after Remix IDE (Apache-2.0) for the workbench and after Visual Studio for the project flow. Design notes live in docs/remix-to-hardkas.md.
        </p>
      </div>
    </div>
  );
}

function Row({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div className="flex gap-2">
      <dt className="w-28 shrink-0 text-fg-muted">{k}</dt>
      <dd className={mono ? "font-mono break-all" : ""}>{v}</dd>
    </div>
  );
}
