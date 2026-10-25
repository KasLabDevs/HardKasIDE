import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { useIde } from "@/store/ide";
import { EnvBar } from "./EnvBar";
import { IconRail } from "./IconRail";
import { MainArea } from "./MainArea";
import { SidePanel } from "./SidePanel";
import { StatusBar } from "./StatusBar";
import { Terminal } from "./Terminal";

interface Props {
  onHome: () => void;
}

/** The Remix-shaped screen: icon rail | side panel | editor over terminal, status bar below. */
export function Workbench({ onHome }: Props) {
  const terminalOpen = useIde((s) => s.terminalOpen);

  return (
    <div className="h-full flex flex-col">
      <div className="flex-1 min-h-0 flex">
        <IconRail onHome={onHome} />
        <PanelGroup direction="horizontal" className="flex-1 min-w-0">
          <Panel defaultSize={22} minSize={14} maxSize={45}>
            <SidePanel />
          </Panel>
          <PanelResizeHandle className="w-px bg-border hover:bg-accent transition-colors" />
          <Panel minSize={30}>
            <div className="h-full flex flex-col min-w-0">
              <EnvBar />
              <div className="flex-1 min-h-0">
                <PanelGroup direction="vertical">
                  <Panel minSize={20}>
                    <MainArea />
                  </Panel>
                  {terminalOpen && (
                    <>
                      <PanelResizeHandle className="h-px bg-border hover:bg-accent transition-colors" />
                      <Panel defaultSize={30} minSize={10}>
                        <Terminal />
                      </Panel>
                    </>
                  )}
                </PanelGroup>
              </div>
            </div>
          </Panel>
        </PanelGroup>
      </div>
      <StatusBar />
    </div>
  );
}
