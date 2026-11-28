import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { Terminal as XTerm } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { useEffect, useRef } from "react";
import { api } from "@/api/client";
import { useIde } from "@/store/ide";
import { useScripts, type TerminalTab } from "@/store/scripts";

interface Props {
  tab: TerminalTab;
  visible: boolean;
}

type WsFrame =
  | { type: "ready"; id: string; shell: string; cwd: string; commandLine?: string }
  | { type: "data"; data: string }
  | { type: "exit"; exitCode: number | null; stopped?: boolean }
  | { type: "error"; message: string };

/**
 * A real PTY shell or package.json script runner in ide-server over /api/terminal/ws.
 */
export function XTerminal({ tab, visible }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<XTerm | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const workspace = useIde((s) => s.workspace);

  const runSeq = tab.scriptRun?.runSeq ?? 1;

  // Create the xterm canvas once per terminal tab so re-runs keep scrollback visible cleanly.
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
        background: v("--bg", "#1f1f1f"),
        foreground: v("--fg", "#d7e0ea"),
        cursor: v("--accent", "#49eacb"),
        selectionBackground: v("--border", "#2b2b2b"),
        black: "#181818",
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

    const disposeData = term.onData((data) => {
      const ws = wsRef.current;
      if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "input", data }));
    });
    const disposeResize = term.onResize(({ cols, rows }) => {
      const ws = wsRef.current;
      if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "resize", cols, rows }));
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
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
  }, [tab.id]);

  // Connect WebSocket session (and reconnect cleanly when re-running a script).
  useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    if (runSeq > 1 && tab.scriptRun) {
      term.write(`\r\n\x1b[2m──────── re-running ${tab.scriptRun.commandLine} ────────\x1b[0m\r\n`);
    }

    const proto = location.protocol === "https:" ? "wss" : "ws";
    const params = new URLSearchParams({
      cols: String(term.cols || 100),
      rows: String(term.rows || 30),
      events: "json"
    });
    const tabId = api.tabId();
    if (tabId) params.set("tab", tabId);
    if (tab.scriptRun) {
      params.set("pkgDir", tab.scriptRun.pkgRelDir);
      params.set("script", tab.scriptRun.scriptName);
    } else if (tab.cwd ?? workspace?.root) {
      params.set("cwd", tab.cwd ?? workspace!.root!);
    }

    const ws = new WebSocket(`${proto}://${location.host}/api/terminal/ws?${params.toString()}`);
    wsRef.current = ws;
    let exited = false;
    const store = useScripts.getState;

    ws.onmessage = (e) => {
      const raw = typeof e.data === "string" ? e.data : "";
      try {
        const frame = JSON.parse(raw) as WsFrame;
        if (frame.type === "ready") {
          store().setSessionId(tab.id, frame.id);
        } else if (frame.type === "data") {
          term.write(frame.data);
          store().appendTerminalOutput(tab.id, frame.data);
        } else if (frame.type === "exit") {
          exited = true;
          store().markExited(tab.id, frame.exitCode, Boolean(frame.stopped));
        } else if (frame.type === "error") {
          exited = true;
          term.write(`\r\n\x1b[31m[${frame.message}]\x1b[0m\r\n`);
          store().markExited(tab.id, 1, false);
        }
      } catch {
        term.write(raw);
      }
    };

    ws.onclose = () => {
      if (!exited) {
        term.write("\r\n\x1b[2m[terminal closed]\x1b[0m\r\n");
        store().markExited(tab.id, null, false);
      }
    };

    ws.onerror = () => {
      term.write("\r\n\x1b[31m[could not connect to ide-server terminal]\x1b[0m\r\n");
    };

    return () => {
      ws.onclose = null;
      ws.onmessage = null;
      ws.onerror = null;
      ws.close();
      if (wsRef.current === ws) wsRef.current = null;
    };
    // Only reconnect when tab identity or runSeq changes cleanly; script metadata stays aligned with runSeq.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab.id, runSeq]);

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
