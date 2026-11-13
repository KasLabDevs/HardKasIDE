import { X } from "lucide-react";
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
  const hiddenPanels = useIde((s) => s.hiddenPanels);
  const setPanelHidden = useIde((s) => s.setPanelHidden);
  const outlineOpen = useIde((s) => s.outlineOpen);
  const plugins = engine.listByLocation("sidePanel").filter((p) => docks[p.profile.name] === "right" && p.view && !hiddenPanels[p.profile.name]);

  // Default sizes add up to 100: the Outline takes 26 %, the docked views share the rest.
  const outlineSize = plugins.length ? 26 : 100;
  const viewSize = (100 - (outlineOpen ? outlineSize : 0)) / Math.max(1, plugins.length);
  return (
    <PanelGroup direction="vertical">
      {outlineOpen && (
        <Panel id="outline" order={0} minSize={12} defaultSize={outlineSize}>
          <ErrorBoundary name="Outline">
            <Outline />
          </ErrorBoundary>
        </Panel>
      )}
      {plugins.map((p, i) => {
        const View = p.view!;
        return (
          <PanelGroupItem key={p.profile.name} id={`dock-${p.profile.name}`} order={i + 1} size={viewSize} first={i === 0 && !outlineOpen}>
            <section className="h-full bg-bg-panel border-l border-border flex flex-col min-w-0">
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

function PanelGroupItem({ first, id, order, size, children }: { first: boolean; id: string; order: number; size: number; children: React.ReactNode }) {
  return (
    <>
      {!first && <PanelResizeHandle className="h-px bg-border hover:bg-accent transition-colors" />}
      <Panel id={id} order={order} minSize={12} defaultSize={size}>{children}</Panel>
    </>
  );
}
