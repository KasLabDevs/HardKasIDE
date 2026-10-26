import clsx from "clsx";
import { Home, ListTree, PanelLeft, TerminalSquare } from "lucide-react";
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
  const sidebarOpen = useIde((s) => s.sidebarOpen);
  const setSidebarOpen = useIde((s) => s.setSidebarOpen);
  const outlineOpen = useIde((s) => s.outlineOpen);
  const setOutlineOpen = useIde((s) => s.setOutlineOpen);
  const terminalOpen = useIde((s) => s.terminalOpen);
  const setTerminalOpen = useIde((s) => s.setTerminalOpen);

  return (
    <nav aria-label="Workbench navigation" className="w-12 shrink-0 bg-bg-panel border-r border-border flex flex-col items-center py-2 gap-1 select-none overflow-y-auto overflow-x-hidden">
      <button type="button" title="Home (Switch workspace)" aria-label="Home (Switch workspace)" onClick={onHome} className="w-10 h-10 grid place-items-center rounded cursor-pointer text-fg-muted hover:text-fg hover:bg-bg-hover transition-colors">
        <Home size={18} />
      </button>
      <div className="w-6 border-t border-border my-1" role="separator" />
      {plugins.map((p) => {
        const Icon = p.profile.icon;
        const dock = docks[p.profile.name] ?? "left";
        const isActive = dock === "left" ? sidebarOpen && active === p.profile.name : dock === "main" ? activeFile === `view:${p.profile.name}` : false;
        const where = dock === "left" ? "" : dock === "right" ? " (docked on the right)" : dock === "leftBottom" ? " (docked below the Explorer)" : " (open as a tab)";
        return (
          <button
            key={p.profile.name}
            type="button"
            title={`${p.profile.displayName}${where}`}
            aria-label={`${p.profile.displayName}${where}`}
            aria-pressed={isActive}
            onClick={() => (dock === "left" ? (isActive ? setSidebarOpen(false) : setActive(p.profile.name)) : revealPlugin(p.profile.name, p.profile.displayName))}
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
      {/* layout toggles, pinned to the bottom of the rail */}
      <div className="mt-auto flex flex-col items-center gap-1 pt-2 border-t border-border w-full">
        <RailToggle on={sidebarOpen} onClick={() => setSidebarOpen(!sidebarOpen)} onLabel="Hide primary side bar" offLabel="Show primary side bar" keys="Ctrl+B" icon={<PanelLeft size={18} />} />
        <RailToggle on={outlineOpen} onClick={() => setOutlineOpen(!outlineOpen)} onLabel="Hide Outline" offLabel="Show Outline" icon={<ListTree size={18} />} />
        <RailToggle on={terminalOpen} onClick={() => setTerminalOpen(!terminalOpen)} onLabel="Hide console / terminal" offLabel="Show console / terminal" keys="Ctrl+J" icon={<TerminalSquare size={18} />} />
      </div>
    </nav>
  );
}

function RailToggle({ on, onClick, onLabel, offLabel, keys, icon }: { on: boolean; onClick: () => void; onLabel: string; offLabel: string; keys?: string; icon: React.ReactNode }) {
  const label = on ? onLabel : offLabel;
  return (
    <button
      type="button"
      title={keys ? `${label} (${keys})` : label}
      aria-label={label}
      aria-pressed={on}
      onClick={onClick}
      className={clsx("w-10 h-10 grid place-items-center rounded cursor-pointer transition-colors", on ? "text-accent bg-bg-hover/60" : "text-fg-muted hover:text-fg hover:bg-bg-hover")}
    >
      {icon}
    </button>
  );
}