import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { useIde } from "@/store/ide";
import { BottomPanel } from "./BottomPanel";
import { CommandPalette } from "./CommandPalette";
import { EnvBar } from "./EnvBar";
import { EnvNotice } from "./EnvNotice";
import { NodeOpBanner } from "./NodeOpProgress";
import { IconRail } from "./IconRail";
import { MainArea } from "./MainArea";
import { RightDock } from "./RightDock";
import { SidePanel } from "./SidePanel";
import { TitleBar } from "./TitleBar";
import { useEngine, useEngineVersion } from "@/engine/context";
import { StatusBar } from "./StatusBar";

interface Props {
  onHome: () => void;
}

/** The workbench screen: icon rail | side panel | editor over console/terminal | outline, status bar below. */
export function Workbench({ onHome }: Props) {
  const terminalOpen = useIde((s) => s.terminalOpen);
  const outlineOpen = useIde((s) => s.outlineOpen);
  const sidebarOpen = useIde((s) => s.sidebarOpen);
  const docks = useIde((s) => s.docks);
  const engine = useEngine();
  useEngineVersion();
  const rightDocked = engine.listByLocation("sidePanel").some((p) => docks[p.profile.name] === "right");
  const showRight = outlineOpen || rightDocked;

  return (
    <div className="h-full flex flex-col">
      <TitleBar onHome={onHome} />
      <div className="flex-1 min-h-0 flex">
        <IconRail onHome={onHome} />
        <PanelGroup direction="horizontal" className="flex-1 min-w-0">
          {sidebarOpen && (
            <>
              <Panel id="side" order={1} defaultSize={22} minSize={14} maxSize={45}>
                <SidePanel />
              </Panel>
              <PanelResizeHandle className="w-px bg-border hover:bg-accent transition-colors" />
            </>
          )}
          <Panel id="main" order={2} minSize={30}>
            <div className="h-full flex flex-col min-w-0">
              <EnvBar />
              <EnvNotice />
              <NodeOpBanner />
              <div className="flex-1 min-h-0">
                <PanelGroup direction="vertical">
                  <Panel minSize={20}>
                    <MainArea />
                  </Panel>
                  {terminalOpen && (
                    <>
                      <PanelResizeHandle className="h-px bg-border hover:bg-accent transition-colors" />
                      <Panel defaultSize={30} minSize={10}>
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
              <PanelResizeHandle className="w-px bg-border hover:bg-accent transition-colors" />
              <Panel id="right" order={3} defaultSize={20} minSize={12} maxSize={40}>
                <RightDock />
              </Panel>
            </>
          )}
        </PanelGroup>
      </div>
      <StatusBar />
      <CommandPalette />
    </div>
  );
}
