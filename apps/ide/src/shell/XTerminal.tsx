import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { Terminal as XTerm } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { useEffect, useRef } from "react";
import { useIde } from "@/store/ide";

interface Props {
  /** Stable id so the PTY survives tab switches (the component stays mounted, hidden). */
  id: string;
  visible: boolean;
  onExit?: (id: string) => void;
}

/**
 * A real shell (VS Code-style integrated terminal): xterm.js in the browser,
 * a PTY in ide-server, connected over WebSocket at /api/terminal/ws.
 */
export function XTerminal({ id, visible, onExit }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<XTerm | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const workspace = useIde((s) => s.workspace);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const css = getComputedStyle(document.documentElement);
    const v = (name: string, fb: string) => css.getPropertyValue(name).trim() || fb;

    const term = new XTerm({
      cursorBlink: true,
      fontFamily: v("--font-mono", "monospace"),
      fontSize: 13,
      lineHeight: 1.2,
      scrollback: 5000,
      allowProposedApi: true,
      theme: {
        background: v("--bg", "#0b0f14"),
        foreground: v("--fg", "#d7e0ea"),
        cursor: v("--accent", "#49eacb"),
        selectionBackground: v("--border", "#1f2a37"),
        black: "#0b0f14",
        brightBlack: v("--fg-muted", "#8696a7"),
        green: v("--ok", "#4ade80"),
        yellow: v("--warn", "#f5b942"),
        red: v("--error", "#ff6b6b"),
        blue: v("--info", "#7cc4ff"),
        cyan: v("--accent", "#49eacb")
      }
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon());
    term.open(host);
    termRef.current = term;
    fitRef.current = fit;
    try {
      fit.fit();
    } catch {
      // host not laid out yet; the resize observer will fit later
    }

    const proto = location.protocol === "https:" ? "wss" : "ws";
    const params = new URLSearchParams({ cols: String(term.cols), rows: String(term.rows) });
    if (workspace?.root) params.set("cwd", workspace.root);
    const ws = new WebSocket(`${proto}://${location.host}/api/terminal/ws?${params.toString()}`);
    wsRef.current = ws;
    ws.onmessage = (e) => term.write(typeof e.data === "string" ? e.data : "");
    ws.onclose = () => {
      term.write("\r\n\x1b[2m[terminal closed]\x1b[0m\r\n");
      onExit?.(id);
    };
    ws.onerror = () => term.write("\r\n\x1b[31m[could not connect to ide-server terminal]\x1b[0m\r\n");
    const disposeData = term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "input", data }));
    });
    const disposeResize = term.onResize(({ cols, rows }) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "resize", cols, rows }));
    });

    const observer = new ResizeObserver(() => {
      if (host.offsetWidth === 0 || host.offsetHeight === 0) return;
      try {
        fit.fit();
      } catch {
        // ignore transient layout states
      }
    });
    observer.observe(host);

    return () => {
      observer.disconnect();
      disposeData.dispose();
      disposeResize.dispose();
      // An unmount (including React StrictMode's dev double-mount) must not count as the
      // shell exiting: detach the handlers so onExit only fires for server-initiated closes.
      ws.onclose = null;
      ws.onmessage = null;
      ws.onerror = null;
      ws.close();
      term.dispose();
      termRef.current = null;
      wsRef.current = null;
    };
    // The PTY is bound to this component instance; cwd changes mean a new workspace, i.e. a new mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Re-fit and focus when the tab becomes visible.
  useEffect(() => {
    if (!visible) return;
    const t = setTimeout(() => {
      try {
        fitRef.current?.fit();
      } catch {
        // ignore
      }
      termRef.current?.focus();
    }, 30);
    return () => clearTimeout(t);
  }, [visible]);

  return <div ref={hostRef} className="h-full w-full px-2 py-1" style={{ display: visible ? "block" : "none" }} />;
}
