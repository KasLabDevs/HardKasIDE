import { Copy, Minus, Square, X } from "lucide-react";
import { useEffect, useState } from "react";

/** True when the IDE runs inside the desktop app (Tauri injects its bridge into the page). */
export const isDesktopApp = (): boolean => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

type AppWindow = {
  minimize(): Promise<void>;
  toggleMaximize(): Promise<void>;
  close(): Promise<void>;
  isMaximized(): Promise<boolean>;
  onResized(handler: () => void): Promise<() => void>;
};

async function appWindow(): Promise<AppWindow> {
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  return getCurrentWindow() as unknown as AppWindow;
}

/** Minimise, maximise/restore and close for the frameless desktop window (the title bar is its drag region). */
export function WindowControls() {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    let off: (() => void) | undefined;
    let cancelled = false;
    void appWindow().then(async (w) => {
      const sync = () => void w.isMaximized().then((m) => !cancelled && setMaximized(m));
      sync();
      off = await w.onResized(sync);
    });
    return () => {
      cancelled = true;
      off?.();
    };
  }, []);

  const act = (fn: (w: AppWindow) => Promise<void>) => () => void appWindow().then(fn);
  const base = "w-11 h-9 grid place-items-center text-fg-muted hover:text-fg cursor-pointer transition-colors";

  return (
    <div className="flex items-stretch -mr-2 ml-1" role="group" aria-label="Window controls">
      <button type="button" className={`${base} hover:bg-bg-hover`} onClick={act((w) => w.minimize())} aria-label="Minimize" title="Minimize">
        <Minus size={14} />
      </button>
      <button type="button" className={`${base} hover:bg-bg-hover`} onClick={act((w) => w.toggleMaximize())} aria-label={maximized ? "Restore" : "Maximize"} title={maximized ? "Restore" : "Maximize"}>
        {maximized ? <Copy size={12} /> : <Square size={12} />}
      </button>
      <button type="button" className={`${base} hover:bg-error hover:text-white`} onClick={act((w) => w.close())} aria-label="Close" title="Close">
        <X size={15} />
      </button>
    </div>
  );
}
