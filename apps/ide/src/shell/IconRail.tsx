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
  const plugins = engine.listByLocation("sidePanel");

  return (
    <nav className="w-12 shrink-0 bg-bg-panel border-r border-border flex flex-col items-center py-2 gap-1 select-none">
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
    </nav>
  );
}
