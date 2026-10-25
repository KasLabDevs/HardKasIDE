import { useEngine, useEngineVersion } from "@/engine/context";
import { useIde } from "@/store/ide";

/**
 * Mounts every side-panel plugin view once and hides the inactive ones, so each
 * panel keeps its state when you switch (Remix's RemixUIPanelPlugin pattern).
 */
export function SidePanel() {
  const engine = useEngine();
  useEngineVersion();
  const active = useIde((s) => s.activeSidePlugin);
  const plugins = engine.listByLocation("sidePanel");

  return (
    <aside className="h-full bg-bg-panel border-r border-border flex flex-col min-w-0">
      {plugins.map((p) => {
        const View = p.view;
        if (!View) return null;
        const isActive = p.profile.name === active;
        return (
          <section key={p.profile.name} className="flex-1 min-h-0 flex-col" style={{ display: isActive ? "flex" : "none" }}>
            <header className="panel-title flex items-center justify-between">
              <span>{p.profile.displayName}</span>
            </header>
            <div className="flex-1 min-h-0 overflow-auto">
              <View />
            </div>
          </section>
        );
      })}
    </aside>
  );
}
