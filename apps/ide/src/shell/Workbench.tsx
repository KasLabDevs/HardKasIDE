import { useRef } from "react";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { useIde } from "@/store/ide";
import { BottomPanel } from "./BottomPanel";
import { CommandPalette } from "./CommandPalette";
import { NewArtifactDialog } from "./NewArtifactDialog";
import { NodeOpBanner } from "./NodeOpProgress";
import { IconRail } from "./IconRail";
import { MainArea } from "./MainArea";
import { RightDock } from "./RightDock";
import { SearchDialog } from "./SearchDialog";
import { SidePanel } from "./SidePanel";
import { TitleBar } from "./TitleBar";
import { TrustBanner } from "./TrustBanner";
import { useEngine, useEngineVersion } from "@/engine/context";
import { StatusBar } from "./StatusBar";

interface Props {
  onHome: () => void;
}

const RAIL_AND_GUTTER_PX = 54;

/** Picks a default percentage so sidebars launch near a consistent pixel width across 1280p–2560p screens. */
function defaultPanelPercent(targetPx: number, fallback: number, min: number, max: number): number {
  if (typeof window === "undefined" || window.innerWidth <= RAIL_AND_GUTTER_PX) return fallback;
  const groupWidth = window.innerWidth - RAIL_AND_GUTTER_PX;
  return Math.min(max, Math.max(min, Math.round((targetPx / groupWidth) * 100)));
}

/** The workbench screen: icon rail | side panel | editor over console/terminal | outline, status bar below. */
export function Workbench({ onHome }: Props) {
  const terminalOpen = useIde((s) => s.terminalOpen);
  const outlineOpen = useIde((s) => s.outlineOpen);
  const sidebarOpen = useIde((s) => s.sidebarOpen);
  const docks = useIde((s) => s.docks);
  const hiddenPanels = useIde((s) => s.hiddenPanels);
  const engine = useEngine();
  useEngineVersion();
  const mainRef = useRef<HTMLDivElement>(null);
  const rightDocked = engine.listByLocation("sidePanel").some((p) => docks[p.profile.name] === "right" && !hiddenPanels[p.profile.name]);
  const showRight = outlineOpen || rightDocked;
  const defaultSideWidth = defaultPanelPercent(298, 22, 13, 28);

  return (
    <div className="h-full flex flex-col bg-bg-panel">
      <TitleBar onHome={onHome} mainRef={mainRef} />
      <div className="flex-1 min-h-0 flex">
        <IconRail />
        <div className="flex-1 min-w-0 flex p-[3px] bg-bg-shell">
          <PanelGroup direction="horizontal" className="flex-1 min-w-0">
            {sidebarOpen && (
              <>
                <Panel id="side" order={1} defaultSize={defaultSideWidth} minSize={12} maxSize={38}>
                  <SidePanel />
                </Panel>
                <PanelResizeHandle className="ide-split-h" />
              </>
            )}
            <Panel id="main" order={2} minSize={30}>
              <div ref={mainRef} className="h-full flex flex-col min-w-0">
                <TrustBanner />
                <NodeOpBanner />
                <div className="flex-1 min-h-0">
                  <PanelGroup direction="vertical">
                    <Panel id="editor" order={1} minSize={20}>
                      <MainArea />
                    </Panel>
                    {terminalOpen && (
                      <>
                        <PanelResizeHandle className="ide-split-v" />
                        <Panel id="bottom" order={2} defaultSize={30} minSize={10}>
                          <BottomPanel />
                        </Panel>
                      </>
                    )}
                  </PanelGroup>
                </div>
              </div>
            </Panel>
            {showRight && (
              <>
                <PanelResizeHandle className="ide-split-h" />
                <Panel id="right" order={3} defaultSize={defaultSideWidth} minSize={12} maxSize={38}>
                  <RightDock />
                </Panel>
              </>
            )}
          </PanelGroup>
        </div>
      </div>
      <StatusBar borderless />
      <CommandPalette />
      <NewArtifactDialog />
      <SearchDialog />
    </div>
  );
}
