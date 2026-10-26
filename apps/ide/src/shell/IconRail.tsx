import clsx from "clsx";
import { Home } from "lucide-react";
import { useEngine, useEngineVersion } from "@/engine/context";
import { useIde } from "@/store/ide";

interface Props {
  onHome: () => void;
}

export function IconRail({ onHome }: Props) {
  const engine = useEngine();
  useEngineVersion();
  const active = useIde((s) => s.activeSidePlugin);
  const setActive = useIde((s) => s.setActiveSidePlugin);
  const docks = useIde((s) => s.docks);
  // Every side-panel plugin gets an icon wherever it is docked, so a panel can never get lost:
  // clicking it shows it (left column, stacked, right column or editor tab).
  const plugins = engine.listByLocation("sidePanel");
  const revealPlugin = useIde((s) => s.revealPlugin);
  const mainViews = engine.listByLocation("mainPanel");
  const openView = useIde((s) => s.openView);
  const activeFile = useIde((s) => s.activeFile);

  return (
    <nav aria-label="Workbench navigation" className="w-12 shrink-0 bg-bg-panel border-r border-border flex flex-col items-center py-2 gap-1 select-none">
      <button type="button" title="Home (Switch workspace)" aria-label="Home (Switch workspace)" onClick={onHome} className="w-10 h-10 grid place-items-center rounded cursor-pointer text-fg-muted hover:text-fg hover:bg-bg-hover transition-colors">
        <Home size={18} />
      </button>
      <div className="w-6 border-t border-border my-1" role="separator" />
      {plugins.map((p) => {
        const Icon = p.profile.icon;
        const dock = docks[p.profile.name] ?? "left";
        const isActive = dock === "left" ? active === p.profile.name : dock === "main" ? activeFile === `view:${p.profile.name}` : false;
        const where = dock === "left" ? "" : dock === "right" ? " (docked on the right)" : dock === "leftBottom" ? " (docked below the Explorer)" : " (open as a tab)";
        return (
          <button
            key={p.profile.name}
            type="button"
            title={`${p.profile.displayName}${where}`}
            aria-label={`${p.profile.displayName}${where}`}
            aria-pressed={isActive}
            onClick={() => (dock === "left" ? setActive(p.profile.name) : revealPlugin(p.profile.name, p.profile.displayName))}
            className={clsx(
              "w-10 h-10 grid place-items-center rounded relative cursor-pointer transition-colors",
              isActive ? "text-accent bg-bg-hover" : "text-fg-muted hover:text-fg hover:bg-bg-hover"
            )}
          >
            {isActive && <span className="absolute left-0 top-2 bottom-2 w-0.5 bg-accent rounded-r" />}
            {Icon ? <Icon size={18} /> : <span className="text-xs font-semibold">{p.profile.displayName[0]}</span>}
            {dock !== "left" && <span className="absolute right-1 bottom-1 w-1.5 h-1.5 rounded-full bg-fg-muted/70" aria-hidden="true" />}
          </button>
        );
      })}
      {mainViews.length > 0 && <div className="w-6 border-t border-border my-1" role="separator" />}
      {mainViews.map((p) => {
        const Icon = p.profile.icon;
        const isActive = activeFile === `view:${p.profile.name}`;
        return (
          <button
            key={p.profile.name}
            type="button"
            title={p.profile.displayName}
            aria-label={p.profile.displayName}
            aria-pressed={isActive}
            onClick={() => openView(p.profile.name, p.profile.displayName)}
            className={clsx(
              "w-10 h-10 grid place-items-center rounded relative cursor-pointer transition-colors",
              isActive ? "text-accent bg-bg-hover" : "text-fg-muted hover:text-fg hover:bg-bg-hover"
            )}
          >
            {isActive && <span className="absolute left-0 top-2 bottom-2 w-0.5 bg-accent rounded-r" />}
            {Icon ? <Icon size={18} /> : <span className="text-xs font-semibold">{p.profile.displayName[0]}</span>}
          </button>
        );
      })}
      {/* the layout toggles (side bar, panel, outline) live in the title bar now, like VS Code */}
    </nav>
  );
}
