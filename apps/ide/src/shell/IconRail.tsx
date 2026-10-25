import clsx from "clsx";
import { Home, ListTree, TerminalSquare } from "lucide-react";
import { useEngine, useEngineVersion } from "@/engine/context";
import { useIde } from "@/store/ide";
import { HardKasMark } from "./Logo";

interface Props {
  onHome: () => void;
}

export function IconRail({ onHome }: Props) {
  const engine = useEngine();
  useEngineVersion();
  const active = useIde((s) => s.activeSidePlugin);
  const setActive = useIde((s) => s.setActiveSidePlugin);
  const docks = useIde((s) => s.docks);
  const plugins = engine.listByLocation("sidePanel").filter((p) => (docks[p.profile.name] ?? "left") === "left");
  const mainViews = engine.listByLocation("mainPanel");
  const openView = useIde((s) => s.openView);
  const activeFile = useIde((s) => s.activeFile);
  const outlineOpen = useIde((s) => s.outlineOpen);
  const setOutlineOpen = useIde((s) => s.setOutlineOpen);
  const terminalOpen = useIde((s) => s.terminalOpen);
  const setTerminalOpen = useIde((s) => s.setTerminalOpen);

  return (
    <nav className="w-12 shrink-0 bg-bg-panel border-r border-border flex flex-col items-center py-2 gap-1 select-none">
      <div className="w-10 h-10 grid place-items-center" title="HardKas IDE">
        <HardKasMark size={26} />
      </div>
      <button title="Home" onClick={onHome} className="w-10 h-10 grid place-items-center rounded text-fg-muted hover:text-fg hover:bg-bg-hover">
        <Home size={18} />
      </button>
      <div className="w-6 border-t border-border my-1" />
      {plugins.map((p) => {
        const Icon = p.profile.icon;
        const isActive = active === p.profile.name;
        return (
          <button
            key={p.profile.name}
            title={p.profile.displayName}
            onClick={() => setActive(p.profile.name)}
            className={clsx(
              "w-10 h-10 grid place-items-center rounded relative transition-colors",
              isActive ? "text-accent bg-bg-hover" : "text-fg-muted hover:text-fg hover:bg-bg-hover"
            )}
          >
            {isActive && <span className="absolute left-0 top-2 bottom-2 w-0.5 bg-accent rounded-r" />}
            {Icon ? <Icon size={18} /> : <span className="text-xs">{p.profile.displayName[0]}</span>}
          </button>
        );
      })}
      {mainViews.length > 0 && <div className="w-6 border-t border-border my-1" />}
      {mainViews.map((p) => {
        const Icon = p.profile.icon;
        const isActive = activeFile === `view:${p.profile.name}`;
        return (
          <button
            key={p.profile.name}
            title={p.profile.displayName}
            onClick={() => openView(p.profile.name, p.profile.displayName)}
            className={clsx(
              "w-10 h-10 grid place-items-center rounded relative transition-colors",
              isActive ? "text-accent bg-bg-hover" : "text-fg-muted hover:text-fg hover:bg-bg-hover"
            )}
          >
            {isActive && <span className="absolute left-0 top-2 bottom-2 w-0.5 bg-accent rounded-r" />}
            {Icon ? <Icon size={18} /> : <span className="text-xs">{p.profile.displayName[0]}</span>}
          </button>
        );
      })}
      {/* layout toggles, pinned to the bottom like VS Code's panel buttons */}
      <div className="mt-auto flex flex-col items-center gap-1 pt-2 border-t border-border w-full">
        <button
          title={outlineOpen ? "Hide Outline" : "Show Outline"}
          onClick={() => setOutlineOpen(!outlineOpen)}
          className={clsx("w-10 h-10 grid place-items-center rounded transition-colors", outlineOpen ? "text-accent" : "text-fg-muted hover:text-fg hover:bg-bg-hover")}
        >
          <ListTree size={18} />
        </button>
        <button
          title={terminalOpen ? "Hide console / terminal" : "Show console / terminal"}
          onClick={() => setTerminalOpen(!terminalOpen)}
          className={clsx("w-10 h-10 grid place-items-center rounded transition-colors", terminalOpen ? "text-accent" : "text-fg-muted hover:text-fg hover:bg-bg-hover")}
        >
          <TerminalSquare size={18} />
        </button>
      </div>
    </nav>
  );
}
