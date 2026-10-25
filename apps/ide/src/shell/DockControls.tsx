import clsx from "clsx";
import { PanelBottom, PanelLeft, PanelRight, SquareStack } from "lucide-react";
import { useIde, type Dock } from "@/store/ide";

/** Eclipse-style "move this view": left column, right column (under Outline) or a tab in the editor area. */
export function DockControls({ pluginName, displayName }: { pluginName: string; displayName: string }) {
  const dock = useIde((s) => s.docks[pluginName] ?? "left");
  const setDock = useIde((s) => s.setDock);
  const openView = useIde((s) => s.openView);
  const options: Array<{ id: Dock; icon: React.ReactNode; title: string }> = [
    { id: "left", icon: <PanelLeft size={12} />, title: "Dock left" },
    { id: "leftBottom", icon: <PanelBottom size={12} />, title: "Dock below the Explorer" },
    { id: "right", icon: <PanelRight size={12} />, title: "Dock right (under Outline)" },
    { id: "main", icon: <SquareStack size={12} />, title: "Open as a tab" }
  ];
  return (
    <span className="flex items-center gap-0.5 normal-case tracking-normal">
      {options.map((o) => (
        <button
          key={o.id}
          title={o.title}
          onClick={() => {
            setDock(pluginName, o.id);
            if (o.id === "main") openView(pluginName, displayName);
          }}
          className={clsx("p-0.5 rounded", dock === o.id ? "text-accent" : "text-fg-muted hover:text-fg hover:bg-bg-hover")}
        >
          {o.icon}
        </button>
      ))}
    </span>
  );
}
