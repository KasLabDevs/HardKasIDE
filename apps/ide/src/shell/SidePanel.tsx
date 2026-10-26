import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { useEngine, useEngineVersion } from "@/engine/context";
import { useIde } from "@/store/ide";
import { DockControls } from "./DockControls";
import { ErrorBoundary } from "./ErrorBoundary";

/**
 * Left column. The active left-docked view on top; views docked "below the Explorer"
 * stack underneath, each resizable (Eclipse's stacked views). Every left view is
 * mounted once and hidden when inactive, so state survives switching.
 */
export function SidePanel() {
  const engine = useEngine();
  useEngineVersion();
  const active = useIde((s) => s.activeSidePlugin);
  const docks = useIde((s) => s.docks);
  const workspace = useIde((s) => s.workspace);
  const all = engine.listByLocation("sidePanel");
  const left = all.filter((p) => (docks[p.profile.name] ?? "left") === "left");
  const below = all.filter((p) => docks[p.profile.name] === "leftBottom" && p.view);

  return (
    <aside className="h-full bg-bg-panel border-r border-border flex flex-col min-w-0">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border select-none" title={workspace?.root ?? ""}>
        <span className="text-xs font-semibold tracking-tight">
          <span className="text-fg">Hard</span>
          <span className="text-accent">Kas</span> <span className="text-fg-muted font-normal">IDE</span>
        </span>
        {workspace?.name && <span className="ml-auto text-[10px] text-fg-muted truncate">{workspace.name}</span>}
      </div>
      <div className="flex-1 min-h-0">
        <PanelGroup direction="vertical">
          <Panel minSize={15} defaultSize={below.length ? 55 : 100}>
            <div className="h-full flex flex-col min-h-0">
              {left.map((p) => {
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
                      <ErrorBoundary name={p.profile.displayName}>
                        <View />
                      </ErrorBoundary>
                    </div>
                  </section>
                );
              })}
              {left.length > 0 && !left.some((p) => p.profile.name === active) && <div className="p-3 text-xs text-fg-muted">Pick a view in the rail on the left.</div>}
            </div>
          </Panel>
          {below.map((p) => {
            const View = p.view!;
            return (
              <StackedPanel key={p.profile.name}>
                <section className="h-full flex flex-col min-h-0 border-t border-border">
                  <header className="panel-title flex items-center justify-between">
                    <span>{p.profile.displayName}</span>
                    <DockControls pluginName={p.profile.name} displayName={p.profile.displayName} />
                  </header>
                  <div className="flex-1 min-h-0 overflow-auto">
                    <ErrorBoundary name={p.profile.displayName}>
                      <View />
                    </ErrorBoundary>
                  </div>
                </section>
              </StackedPanel>
            );
          })}
        </PanelGroup>
      </div>
    </aside>
  );
}

function StackedPanel({ children }: { children: React.ReactNode }) {
  return (
    <>
      <PanelResizeHandle className="h-px bg-border hover:bg-accent transition-colors" />
      <Panel minSize={10}>{children}</Panel>
    </>
  );
}
