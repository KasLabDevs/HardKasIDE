import clsx from "clsx";
import { Check, Circle, Coins, FileCode2, FlaskConical, FolderOpen, GitFork, Loader2, Play, Rocket, Server, X } from "lucide-react";
import { useState } from "react";
import type { TreeNode } from "@/api/client";
import { useEngine } from "@/engine/context";
import type { CompilerPlugin } from "@/plugins/compiler";
import type { EnvironmentPlugin } from "@/plugins/environment";
import { useEnv } from "@/store/env";
import { useIde } from "@/store/ide";
import { useSilver } from "@/store/silver";
import { HardKasMark } from "./Logo";

const HIDDEN_KEY = "hardkas-ide.getting-started-hidden";

function loadHidden(): boolean {
  try {
    return localStorage.getItem(HIDDEN_KEY) === "1";
  } catch {
    return false;
  }
}

function firstSilFile(nodes: TreeNode[]): string | null {
  for (const n of nodes) {
    if (n.type === "file" && /\.sil$/i.test(n.name) && !n.path.startsWith(".hardkas/")) return n.path;
    if (n.type === "dir" && n.children) {
      const found = firstSilFile(n.children);
      if (found) return found;
    }
  }
  return null;
}

interface Step {
  id: string;
  title: string;
  /** One line: what this step does, in plain words. */
  detail: string;
  done: boolean;
  action: string;
  icon: React.ReactNode;
  run: () => Promise<void>;
}

/**
 * The empty editor area: the path from an empty workspace to a contract called and drawn, as six steps with a
 * button each, ticked from the real state (node, balances, records). Hidden with one click; a link brings it back.
 */
export function EmptyMainArea() {
  const [hidden, setHidden] = useState(loadHidden);
  const setHiddenPersist = (h: boolean) => {
    setHidden(h);
    try {
      localStorage.setItem(HIDDEN_KEY, h ? "1" : "0");
    } catch {
      // not remembered: fine
    }
  };
  return hidden ? <Shortcuts onShowGuide={() => setHiddenPersist(false)} /> : <GettingStarted onHide={() => setHiddenPersist(true)} />;
}

function GettingStarted({ onHide }: { onHide: () => void }) {
  const engine = useEngine();
  const target = useIde((s) => s.target);
  const tree = useIde((s) => s.tree);
  const node = useEnv((s) => s.node);
  const accounts = useEnv((s) => s.accounts);
  const nodeBusy = useEnv((s) => s.nodeBusy);
  const compiled = useSilver((s) => s.compiled);
  const deployments = useSilver((s) => s.deployments);
  const spends = useSilver((s) => s.spends);
  const [running, setRunning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const env = () => engine.get<EnvironmentPlugin>("environment");
  const reveal = (name: string, title: string) => useIde.getState().revealPlugin(name, title);
  const openDeployRun = async (tab: "silver") => {
    try {
      localStorage.setItem("hardkas-ide.run-tab", tab); // the panel starts on this tab when it mounts
    } catch {
      // fine
    }
    reveal("deployRun", "Deploy & Run");
  };

  const local = target === "localnet";
  const funded = accounts.some((a) => a.balanceSompi !== null && a.balanceSompi !== "0");
  const sil = firstSilFile(tree);
  const steps: Step[] = [
    {
      id: "node",
      title: local ? "Start the local node" : target === "simulator" ? "Simulator: nothing to start" : "Public testnet: your own node",
      detail: local ? "HardKas' rusty-kaspad in Docker, on a private simnet. Everything below runs on it." : target === "simulator" ? "The in-memory simulator needs no node and no Docker. Pick Local node in the bar above for a real chain." : "Transactions go to the testnet node in hardkas.config.ts.",
      done: local ? node?.rpcReady === true : true,
      action: nodeBusy === "start" ? "Starting…" : "Start node",
      icon: <Server size={14} />,
      run: async () => {
        if (local) await env().startNode();
      }
    },
    {
      id: "fund",
      title: "Give the dev accounts some KAS",
      detail: local ? "alice, bob and the others get test coins from the localnet treasury; blocks are mined for it." : "The simulator's faucet credits the accounts at once.",
      done: funded,
      action: "Fund accounts",
      icon: <Coins size={14} />,
      run: async () => {
        await env().fundAll("100", undefined, { onlyEmpty: true });
      }
    },
    {
      id: "compile",
      title: "Compile a SilverScript contract",
      detail: sil ? `${sil} with the pinned silverc (Ctrl+Enter in the editor does the same).` : "No .sil file in this project yet: open the Explorer and create one (File → New).",
      done: compiled !== null,
      action: sil ? "Compile" : "Open Explorer",
      icon: <FileCode2 size={14} />,
      run: async () => {
        if (!sil) {
          reveal("files", "Explorer");
          return;
        }
        await engine.call("fileManager", "open", sil);
        const result = await engine.get<CompilerPlugin>("silverCompiler").compile(sil);
        if (!result.ok) throw new Error(result.errorText || `${sil} did not compile; see the Problems panel.`);
      }
    },
    {
      id: "deploy",
      title: "Deploy it on the chain",
      detail: "Deploy & Run → SilverScript: one output locked by the contract, funded from an account. Blocks are mined for it automatically.",
      done: deployments.length > 0,
      action: "Open Deploy & Run",
      icon: <Rocket size={14} />,
      run: () => openDeployRun("silver")
    },
    {
      id: "spend",
      title: "Call one of its entries",
      detail: "The deployed contract lists its entries; fill the arguments, pick who signs, and spend the output.",
      done: spends.length > 0,
      action: "Open Deploy & Run",
      icon: <Play size={14} />,
      run: () => openDeployRun("silver")
    },
    {
      id: "graph",
      title: "See it in the Covenant graph",
      detail: "Deploys, entries and spends of the contract, drawn from HardKas' records and checked against the node.",
      done: false,
      action: "Open graph",
      icon: <GitFork size={14} />,
      run: async () => {
        await engine.call("covenant", "open");
      }
    }
  ];
  const next = steps.find((s) => !s.done);

  const runStep = async (s: Step) => {
    setRunning(s.id);
    setError(null);
    try {
      await s.run();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(null);
    }
  };

  return (
    <div className="absolute inset-0 overflow-auto">
      <div className="min-h-full flex items-center justify-center p-6">
        <section aria-label="Getting started" className="w-full max-w-xl rounded-lg border border-border bg-bg-elev/60 p-5 select-none">
          <div className="flex items-start gap-3">
            <div className="opacity-60 mt-0.5">
              <HardKasMark size={28} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold text-fg">From an empty project to a contract on the chain</div>
              <p className="text-xs text-fg-muted mt-0.5">Six steps; each button does one. The ticks come from the real state of the node, the accounts and the records.</p>
            </div>
            <button type="button" onClick={onHide} className="p-1 rounded text-fg-muted hover:text-fg hover:bg-bg-hover cursor-pointer shrink-0" title="Hide this guide (the empty area shows the shortcuts instead)" aria-label="Hide getting started">
              <X size={14} />
            </button>
          </div>

          <ol className="mt-4 space-y-1.5">
            {steps.map((s, i) => {
              const isNext = next?.id === s.id;
              const busy = running === s.id;
              return (
                <li key={s.id} className={clsx("flex items-center gap-3 rounded border px-3 py-2", isNext ? "border-accent/50 bg-accent/5" : "border-border/60", s.done && "opacity-70")}>
                  <span className={clsx("shrink-0", s.done ? "text-ok" : isNext ? "text-accent" : "text-fg-muted")} aria-hidden>
                    {s.done ? <Check size={16} /> : <Circle size={16} />}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className={clsx("text-xs font-medium flex items-center gap-1.5", s.done ? "text-fg-muted line-through" : "text-fg")}>
                      <span className="text-fg-muted font-mono text-[11px]">{i + 1}.</span> {s.title}
                    </div>
                    <div className="text-[11px] text-fg-muted leading-snug truncate" title={s.detail}>
                      {s.detail}
                    </div>
                  </div>
                  {!s.done && (
                    <button type="button" className={clsx("shrink-0 !py-1 text-[11px]", isNext ? "btn-primary" : "btn-ghost")} disabled={running !== null || (s.id === "node" && nodeBusy !== null)} onClick={() => void runStep(s)}>
                      {busy ? <Loader2 size={12} className="animate-spin" /> : s.icon} {busy ? "Working…" : s.action}
                    </button>
                  )}
                </li>
              );
            })}
          </ol>
          {error && (
            <div role="alert" className="mt-2 text-[11px] text-error break-words">
              {error}
            </div>
          )}
          <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-fg-muted">
            <span>
              Command Palette <kbd className="border border-border rounded px-1.5 py-0.5 bg-bg-elev">Ctrl+K</kbd>
            </span>
            <span>
              Compile .sil <kbd className="border border-border rounded px-1.5 py-0.5 bg-bg-elev">Ctrl+Enter</kbd>
            </span>
            <button type="button" className="hover:text-fg underline cursor-pointer" onClick={() => void engine.call("tests", "open")}>
              <FlaskConical size={11} className="inline mr-1" />
              Tests
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}

/** The quiet empty state once the guide is hidden: the shortcuts, and a way back to the guide. */
function Shortcuts({ onShowGuide }: { onShowGuide: () => void }) {
  const engine = useEngine();
  const reveal = (name: string, title: string) => useIde.getState().revealPlugin(name, title);
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center select-none">
      <div className="opacity-30 mb-3">
        <HardKasMark size={44} />
      </div>
      <div className="text-sm font-semibold text-fg">No open files</div>
      <p className="text-xs text-fg-muted mt-1 max-w-sm">Pick a file from the Explorer on the left, or use a shortcut below to jump right in.</p>
      <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
        <button type="button" className="btn-ghost" onClick={() => reveal("files", "Explorer")}>
          <FolderOpen size={13} /> Open Explorer
        </button>
        <button type="button" className="btn-ghost" onClick={() => reveal("deployRun", "Deploy & Run")}>
          <Rocket size={13} /> Deploy &amp; Run
        </button>
        <button type="button" className="btn-ghost" onClick={() => void engine.call("covenant", "open")}>
          <GitFork size={13} /> Covenant Graph
        </button>
        <button type="button" className="btn-ghost" onClick={() => void engine.call("tests", "open")}>
          <FlaskConical size={13} /> Tests
        </button>
      </div>
      <div className="mt-4 text-[12px] text-fg-muted flex items-center gap-4">
        <span>
          Command Palette <kbd className="border border-border rounded px-1.5 py-0.5 text-[12px] bg-bg-elev">Ctrl+K</kbd>
        </span>
        <span>
          Compile .sil <kbd className="border border-border rounded px-1.5 py-0.5 text-[12px] bg-bg-elev">Ctrl+Enter</kbd>
        </span>
        <button type="button" className="underline hover:text-fg cursor-pointer" onClick={onShowGuide}>
          Show the getting-started guide
        </button>
      </div>
    </div>
  );
}
