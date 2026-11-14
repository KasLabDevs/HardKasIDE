import clsx from "clsx";
import { ListTree, PanelLeft, Settings, Sparkles, TerminalSquare } from "lucide-react";
import { useEngine, useEngineVersion } from "@/engine/context";
import { useIde, VIEW_PREFIX } from "@/store/ide";

const PINNED_BOTTOM_PLUGINS = new Set(["assistant", "settings"]);

export function IconRail() {
  const engine = useEngine();
  useEngineVersion();
  const active = useIde((s) => s.activeSidePlugin);
  const setActive = useIde((s) => s.setActiveSidePlugin);
  const docks = useIde((s) => s.docks);
  const hiddenPanels = useIde((s) => s.hiddenPanels);
  const togglePanelHidden = useIde((s) => s.togglePanelHidden);
  const closeFile = useIde((s) => s.closeFile);
  // Side-panel plugins live at the top of the rail, except Assistant & Settings which live in the bottom bar.
  const allSidePlugins = engine.listByLocation("sidePanel");
  const plugins = allSidePlugins.filter((p) => !PINNED_BOTTOM_PLUGINS.has(p.profile.name));
  const assistantPlugin = allSidePlugins.find((p) => p.profile.name === "assistant");
  const settingsPlugin = allSidePlugins.find((p) => p.profile.name === "settings");
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

  const sideToggleState = (p: (typeof allSidePlugins)[number]) => {
    const dock = docks[p.profile.name] ?? "left";
    const isHidden = Boolean(hiddenPanels[p.profile.name]);
    const viewPath = VIEW_PREFIX + p.profile.name;
    const isActive =
      dock === "left"
        ? sidebarOpen && active === p.profile.name
        : dock === "right"
          ? !isHidden
          : dock === "leftBottom"
            ? sidebarOpen && !isHidden
            : activeFile === viewPath;
    const where = dock === "left" ? "" : dock === "right" ? " (right panel)" : dock === "leftBottom" ? " (below Explorer)" : " (tab)";
    const toggle = () => {
      if (dock === "left") {
        if (isActive) setSidebarOpen(false);
        else setActive(p.profile.name);
      } else if (dock === "right") {
        togglePanelHidden(p.profile.name);
      } else if (dock === "leftBottom") {
        if (!sidebarOpen) revealPlugin(p.profile.name, p.profile.displayName);
        else togglePanelHidden(p.profile.name);
      } else {
        if (isActive) closeFile(viewPath);
        else revealPlugin(p.profile.name, p.profile.displayName);
      }
    };
    return { isActive, where, toggle };
  };

  const renderBottomPlugin = (plugin: (typeof allSidePlugins)[number], FallbackIcon: typeof Sparkles) => {
    const st = sideToggleState(plugin);
    const PluginIcon = plugin.profile.icon ?? FallbackIcon;
    return (
      <RailToggle
        on={st.isActive}
        onClick={st.toggle}
        onLabel={`Hide ${plugin.profile.displayName}`}
        offLabel={`Show ${plugin.profile.displayName}`}
        icon={<PluginIcon size={17} />}
      />
    );
  };

  return (
    <nav aria-label="Workbench navigation" className="w-10 shrink-0 bg-bg-panel flex flex-col items-center py-1.5 gap-0.5 select-none overflow-y-auto overflow-x-hidden">
      {plugins.map((p) => {
        const Icon = p.profile.icon;
        const { isActive, where, toggle } = sideToggleState(p);
        return (
          <button
            key={p.profile.name}
            type="button"
            title={`${p.profile.displayName}${where}`}
            aria-label={`${p.profile.displayName}${where}`}
            aria-pressed={isActive}
            onClick={toggle}
            className={clsx(
              "w-8 h-8 grid place-items-center rounded relative cursor-pointer transition-colors",
              isActive ? "text-accent bg-bg-hover" : "text-fg-muted hover:text-fg hover:bg-bg-hover"
            )}
          >
            {isActive && <span className="absolute left-0 top-1.5 bottom-1.5 w-0.5 bg-accent rounded-r" />}
            {Icon ? <Icon size={17} /> : <span className="text-xs font-semibold">{p.profile.displayName[0]}</span>}
          </button>
        );
      })}
      {mainViews.length > 0 && <div className="w-5 border-t border-border my-1" role="separator" />}
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
              "w-8 h-8 grid place-items-center rounded relative cursor-pointer transition-colors",
              isActive ? "text-accent bg-bg-hover" : "text-fg-muted hover:text-fg hover:bg-bg-hover"
            )}
          >
            {/* A view open as a tab is marked on the right edge, a side panel on the left: two lit icons tell apart. */}
            {isActive && <span className="absolute right-0 top-1.5 bottom-1.5 w-0.5 bg-accent rounded-l" />}
            {Icon ? <Icon size={17} /> : <span className="text-xs font-semibold">{p.profile.displayName[0]}</span>}
          </button>
        );
      })}
      {/* layout toggles and workspace settings, pinned to the bottom of the rail */}
      <div className="mt-auto flex flex-col items-center gap-0.5 pt-1.5 border-t border-border w-full">
        {assistantPlugin && renderBottomPlugin(assistantPlugin, Sparkles)}
        <RailToggle on={sidebarOpen} onClick={() => setSidebarOpen(!sidebarOpen)} onLabel="Hide primary side bar" offLabel="Show primary side bar" keys="Ctrl+B" icon={<PanelLeft size={17} />} />
        <RailToggle on={outlineOpen} onClick={() => setOutlineOpen(!outlineOpen)} onLabel="Hide Outline" offLabel="Show Outline" icon={<ListTree size={17} />} />
        <RailToggle on={terminalOpen} onClick={() => setTerminalOpen(!terminalOpen)} onLabel="Hide console / terminal" offLabel="Show console / terminal" keys="Ctrl+J" icon={<TerminalSquare size={17} />} />
        {settingsPlugin && renderBottomPlugin(settingsPlugin, Settings)}
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
      className={clsx("w-8 h-8 grid place-items-center rounded cursor-pointer transition-colors", on ? "text-accent bg-bg-hover/60" : "text-fg-muted hover:text-fg hover:bg-bg-hover")}
    >
      {icon}
    </button>
  );
}