import { HardKasMark } from "./Logo";
import { WindowControls, isDesktopApp } from "./WindowControls";

/**
 * The window bar for screens that have no workbench title bar (Home, starting, server down) when the IDE runs in
 * the frameless desktop window: logo, drag region and the window controls. Renders nothing in a browser.
 */
export function DesktopBar() {
  if (!isDesktopApp()) return null;
  return (
    <header data-tauri-drag-region className="titlebar h-9 shrink-0 flex items-center gap-2 pl-3 pr-2 border-b border-border bg-bg-panel select-none">
      <span data-tauri-drag-region className="flex items-center gap-2 text-xs text-fg-muted">
        <HardKasMark size={18} /> HardKas IDE
      </span>
      <span data-tauri-drag-region className="flex-1 h-full" />
      <WindowControls />
    </header>
  );
}

/** Puts the desktop bar above a full-screen page. */
export function WithDesktopBar({ children }: { children: React.ReactNode }) {
  if (!isDesktopApp()) return <>{children}</>;
  return (
    <div className="h-full flex flex-col">
      <DesktopBar />
      <div className="flex-1 min-h-0 overflow-auto">{children}</div>
    </div>
  );
}
