import { createContext, useContext, useSyncExternalStore } from "react";
import { Engine } from "./engine";

export const EngineContext = createContext<Engine | null>(null);

export function useEngine(): Engine {
  const engine = useContext(EngineContext);
  if (!engine) throw new Error("useEngine must be used inside <EngineContext.Provider>");
  return engine;
}

/** Re-renders when plugins are registered, activated or deactivated. */
export function useEngineVersion(): number {
  const engine = useEngine();
  return useSyncExternalStore(
    (cb) => engine.subscribe(cb),
    () => engine.version,
    () => engine.version
  );
}
