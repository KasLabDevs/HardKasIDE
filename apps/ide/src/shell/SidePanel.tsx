import { X } from "lucide-react";
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
  const hiddenPanels = useIde((s) => s.hiddenPanels);
  const setPanelHidden = useIde((s) => s.setPanelHidden);
  const all = engine.listByLocation("sidePanel");
  const left = all.filter((p) => (docks[p.profile.name] ?? "left") === "left");
  const below = all.filter((p) => docks[p.profile.name] === "leftBottom" && p.view && !hiddenPanels[p.profile.name]);
  // If the selected view lives elsewhere (docked right, as a tab…), show the first left view instead of an empty column.
  const shown = left.some((p) => p.profile.name === active) ? active : (left.find((p) => p.profile.name === "files") ?? left[0])?.profile.name;

  return (
    <aside className="h-full flex flex-col min-w-0">
      <div className="flex-1 min-h-0">
        <PanelGroup direction="vertical">
          <Panel id="side-main" order={0} minSize={15} defaultSize={below.length ? 55 : 100}>
            <div className="h-full flex flex-col min-w-0 bg-bg-panel panel-card">
              {left.map((p) => {
                const View = p.view;
                if (!View) return null;
                const isActive = p.profile.name === shown;
                return (
                  <section key={p.profile.name} className="flex-1 min-h-0 flex-col" style={{ display: isActive ? "flex" : "none" }}>
                    <header className="panel-title flex items-center justify-between">
                      <span>{p.profile.displayName}</span>
                      {p.profile.name !== "files" && <DockControls pluginName={p.profile.name} displayName={p.profile.displayName} />}
                    </header>
                    <div className="flex-1 min-h-0 overflow-auto">
                      <ErrorBoundary name={p.profile.displayName}>
                        <View />
                      </ErrorBoundary>
                    </div>
                  </section>
                );
              })}
              {left.length === 0 && <div className="p-3 text-xs text-fg-muted">Every view is docked elsewhere. Click an icon in the rail to show it, or reset the layout from the command palette.</div>}
            </div>
          </Panel>
          {below.map((p) => {
            const View = p.view!;
            return (
              <StackedPanel key={p.profile.name} id={`side-${p.profile.name}`}>
                <section className="h-full flex flex-col min-w-0 bg-bg-panel panel-card">
                  <header className="panel-title flex items-center justify-between gap-2">
                    <span className="truncate">{p.profile.displayName}</span>
                    <span className="flex items-center gap-0.5 shrink-0">
                      <DockControls pluginName={p.profile.name} displayName={p.profile.displayName} />
                      <button
                        type="button"
                        onClick={() => setPanelHidden(p.profile.name, true)}
                        className="p-0.5 rounded text-fg-muted hover:text-fg hover:bg-bg-hover normal-case cursor-pointer"
                        title={`Hide ${p.profile.displayName}`}
                        aria-label={`Hide ${p.profile.displayName}`}
                      >
                        <X size={13} />
                      </button>
                    </span>
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

function StackedPanel({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <>
      <PanelResizeHandle className="ide-split-v" />
      <Panel id={id} order={1} minSize={10}>{children}</Panel>
    </>
  );
}
