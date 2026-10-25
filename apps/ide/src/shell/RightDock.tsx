import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { useEngine, useEngineVersion } from "@/engine/context";
import { useIde } from "@/store/ide";
import { DockControls } from "./DockControls";
import { Outline } from "./Outline";

/** Right column: the Outline on top and every plugin the user docked to the right, stacked and resizable. */
export function RightDock() {
  const engine = useEngine();
  useEngineVersion();
  const docks = useIde((s) => s.docks);
  const outlineOpen = useIde((s) => s.outlineOpen);
  const plugins = engine.listByLocation("sidePanel").filter((p) => docks[p.profile.name] === "right" && p.view);

  return (
    <PanelGroup direction="vertical">
      {outlineOpen && (
        <Panel minSize={15} defaultSize={plugins.length ? 45 : 100}>
          <Outline />
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
                <View />
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
      <Panel minSize={12}>{children}</Panel>
    </>
  );
}
