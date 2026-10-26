import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { useEngine, useEngineVersion } from "@/engine/context";
import { useIde } from "@/store/ide";
import { DockControls } from "./DockControls";
import { ErrorBoundary } from "./ErrorBoundary";
import { Outline } from "./Outline";

/** Right column: the Outline on top and every plugin the user docked to the right, stacked and resizable. */
export function RightDock() {
  const engine = useEngine();
  useEngineVersion();
  const docks = useIde((s) => s.docks);
  const outlineOpen = useIde((s) => s.outlineOpen);
  // The Debug view goes first (Eclipse puts it at the top), the rest keep their usual order.
  const plugins = engine
    .listByLocation("sidePanel")
    .filter((p) => docks[p.profile.name] === "right" && p.view)
    .sort((a, b) => Number(b.profile.name === "debug") - Number(a.profile.name === "debug"));

  return (
    <PanelGroup direction="vertical">
      {outlineOpen && (
        <Panel minSize={12} defaultSize={plugins.length ? 26 : 100}>
          <ErrorBoundary name="Outline">
            <Outline />
          </ErrorBoundary>
        </Panel>
      )}
      {plugins.map((p, i) => {
        const View = p.view!;
        return (
          <PanelGroupItem key={p.profile.name} first={i === 0 && !outlineOpen}>
            <section className="h-full bg-bg-panel border-l border-border flex flex-col min-w-0">
              <header className="panel-title flex items-center justify-between">
                <span>{p.profile.displayName}</span>
                <DockControls pluginName={p.profile.name} displayName={p.profile.displayName} />
              </header>
              <div className="flex-1 min-h-0 overflow-auto text-xs">
                <ErrorBoundary name={p.profile.displayName}>
                  <View />
                </ErrorBoundary>
              </div>
            </section>
          </PanelGroupItem>
        );
      })}
    </PanelGroup>
  );
}

function PanelGroupItem({ first, children }: { first: boolean; children: React.ReactNode }) {
  return (
    <>
      {!first && <PanelResizeHandle className="h-px bg-border hover:bg-accent transition-colors" />}
      <Panel minSize={20} defaultSize={74}>{children}</Panel>
    </>
  );
}
