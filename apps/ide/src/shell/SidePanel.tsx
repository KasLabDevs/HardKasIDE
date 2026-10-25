import { useEngine, useEngineVersion } from "@/engine/context";
import { useIde } from "@/store/ide";
import { DockControls } from "./DockControls";

/**
 * Left column. Mounts every left-docked side-panel plugin view once and hides the
 * inactive ones, so each panel keeps its state when you switch (Remix's RemixUIPanelPlugin pattern).
 */
export function SidePanel() {
  const engine = useEngine();
  useEngineVersion();
  const active = useIde((s) => s.activeSidePlugin);
  const docks = useIde((s) => s.docks);
  const workspace = useIde((s) => s.workspace);
  const plugins = engine.listByLocation("sidePanel").filter((p) => (docks[p.profile.name] ?? "left") === "left");

  return (
    <aside className="h-full bg-bg-panel border-r border-border flex flex-col min-w-0">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border select-none" title={workspace?.root ?? ""}>
        <span className="text-xs font-semibold tracking-tight">
          <span className="text-fg">Hard</span>
          <span className="text-accent">Kas</span> <span className="text-fg-muted font-normal">IDE</span>
        </span>
        {workspace?.name && <span className="ml-auto text-[10px] text-fg-muted truncate">{workspace.name}</span>}
      </div>
      {plugins.map((p) => {
        const View = p.view;
        if (!View) return null;
        const isActive = p.profile.name === active;
        return (
          <section key={p.profile.name} className="flex-1 min-h-0 flex-col" style={{ display: isActive ? "flex" : "none" }}>
            <header className="panel-title flex items-center justify-between">
              <span>{p.profile.displayName}</span>
              <DockControls pluginName={p.profile.name} displayName={p.profile.displayName} />
            </header>
            <div className="flex-1 min-h-0 overflow-auto">
              <View />
            </div>
          </section>
        );
      })}
      {plugins.length > 0 && !plugins.some((p) => p.profile.name === active) && (
        <div className="p-3 text-xs text-fg-muted">Pick a view in the rail on the left.</div>
      )}
    </aside>
  );
}
