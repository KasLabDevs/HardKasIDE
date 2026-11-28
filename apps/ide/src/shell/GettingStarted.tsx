import clsx from "clsx";
import { AlertTriangle, Check, Circle, Coins, Download, ExternalLink, FileCode2, FlaskConical, FolderOpen, GitFork, Loader2, Play, RefreshCw, Rocket, Server, Wrench, X, XCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { api, type TreeNode } from "@/api/client";
import { useEngine } from "@/engine/context";
import type { CompilerPlugin } from "@/plugins/compiler";
import type { ConsolePlugin } from "@/plugins/console";
import type { EnvironmentPlugin } from "@/plugins/environment";
import { useEnv } from "@/store/env";
import { useIde } from "@/store/ide";
import { useSilver } from "@/store/silver";
import { GUIDE_EVENT, GUIDE_HIDDEN_KEY } from "./actions";
import { HardKasMark } from "./Logo";
import { openNewArtifactWizard } from "./NewArtifactDialog";

const HIDDEN_KEY = GUIDE_HIDDEN_KEY;

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
  /** Rows shown under the step (the tool checks). */
  body?: React.ReactNode;
}

// ---------------------------------------------------------------- the tools

type ToolState = "ok" | "warn" | "bad";

interface ToolCheck {
  id: string;
  label: string;
  state: ToolState;
  detail: string;
  fix?: { label: string; icon: React.ReactNode; run: () => void | Promise<void> };
}

interface ToolsReport {
  at: number;
  checks: ToolCheck[];
  /** Everything the first steps need is there (warnings allowed). */
  ready: boolean;
}

/** One report per page load, shared by every mount of the guide; "Check again" replaces it. */
let toolsCache: ToolsReport | null = null;

type DoctorJson = { toolchains?: Record<string, { ok?: boolean; detail?: string }> };

/**
 * What the first steps need, each asked from its source: Node on the PATH (`/api/system`), the hardkas CLI the
 * server resolved (`/api/cli`), silverc and kaspa-wasm (`hardkas silver doctor`), Docker for the local node.
 */
async function checkTools(engine: ReturnType<typeof useEngine>, target: string): Promise<ToolsReport> {
  const console = engine.get<ConsolePlugin>("console");
  const [sys, cli, doctor] = await Promise.all([
    api.system().then((s) => s as typeof s & { nodeOnPath?: string | null; nodeRequired?: string }).catch(() => null),
    api.cli().catch(() => null),
    console.runHardkas(["silver", "doctor", "--json"], { quiet: true }).catch(() => null)
  ]);
  const checks: ToolCheck[] = [];
  const install = (id: string) => async () => {
    await console.runHardkas(["toolchain", "install", id, "--json"]);
  };

  const required = sys?.nodeRequired ?? "24.22.1";
  if (!sys) checks.push({ id: "node", label: "Node.js", state: "bad", detail: "The IDE server did not answer." });
  else if (!sys.nodeOnPath) checks.push({ id: "node", label: "Node.js", state: "bad", detail: `No \`node\` on the PATH. HardKas needs ${required}.`, fix: { label: "Get Node", icon: <ExternalLink size={12} />, run: () => void window.open("https://nodejs.org/en/download", "_blank", "noopener") } });
  else if (sys.nodeOnPath !== required) checks.push({ id: "node", label: "Node.js", state: "warn", detail: `${sys.nodeOnPath} on the PATH; the HardKas CLI requires ${required} exactly (hardkas doctor says so too).`, fix: { label: "Get Node", icon: <ExternalLink size={12} />, run: () => void window.open("https://nodejs.org/en/download", "_blank", "noopener") } });
  else checks.push({ id: "node", label: "Node.js", state: "ok", detail: `${sys.nodeOnPath}, the release HardKas requires.` });

  if (!cli || !cli.version) checks.push({ id: "cli", label: "HardKas CLI", state: "bad", detail: cli?.error ? `hardkas did not answer: ${cli.error}` : "hardkas not found. In the project: npm i -D @hardkas/cli@" + (cli?.pinned ?? "latest") });
  else if (cli.version !== cli.pinned) checks.push({ id: "cli", label: "HardKas CLI", state: "warn", detail: `${cli.version} (${cli.source}); this IDE was tested with ${cli.pinned}.` });
  else checks.push({ id: "cli", label: "HardKas CLI", state: "ok", detail: `${cli.version} (${cli.source === "project" ? "the project's own" : cli.source}).` });

  const chains = (doctor?.result as DoctorJson | null)?.toolchains ?? null;
  for (const [id, label] of [
    ["silverc", "silverc (SilverScript compiler)"],
    ["kaspa-wasm", "kaspa-wasm (Kaspa SDK)"]
  ] as const) {
    const tc = chains?.[id];
    if (!chains) checks.push({ id, label, state: "bad", detail: doctor ? "hardkas silver doctor gave no toolchain report." : "Could not run hardkas silver doctor.", fix: { label: `Install ${id}`, icon: <Download size={12} />, run: install(id) } });
    else if (tc?.ok) checks.push({ id, label, state: "ok", detail: tc.detail ? tc.detail.split(" ")[0] : "installed and verified." });
    else checks.push({ id, label, state: "bad", detail: tc?.detail ?? "not installed.", fix: { label: `Install ${id}`, icon: <Download size={12} />, run: install(id) } });
  }

  if (target === "localnet") {
    const d = sys?.docker;
    if (!d) checks.push({ id: "docker", label: "Docker", state: "bad", detail: "Not checked: the IDE server did not answer." });
    else if (!d.installed) checks.push({ id: "docker", label: "Docker", state: "bad", detail: "Not installed. The local node is rusty-kaspad in a container; the Simulator needs none.", fix: { label: "Get Docker", icon: <ExternalLink size={12} />, run: () => void window.open("https://www.docker.com/products/docker-desktop/", "_blank", "noopener") } });
    else if (!d.running) checks.push({ id: "docker", label: "Docker", state: "bad", detail: "Installed but not running: start Docker Desktop, then check again.", fix: { label: "Use the Simulator", icon: <Server size={12} />, run: () => useIde.getState().setTarget("simulator") } });
    else checks.push({ id: "docker", label: "Docker", state: "ok", detail: `${d.serverVersion ?? "running"}.` });
  }

  const ready = checks.every((c) => c.state !== "bad");
  return { at: Date.now(), checks, ready };
}

function ToolRows({ report, busy, onFix, onRefresh }: { report: ToolsReport | null; busy: string | null; onFix: (c: ToolCheck) => void; onRefresh: () => void }) {
  if (!report) return <div className="text-[11px] text-fg-muted pl-6">Checking…</div>;
  return (
    <ul className="pl-6 space-y-0.5">
      {report.checks.map((c) => (
        <li key={c.id} className="flex items-center gap-2 text-[11px]">
          <span className={clsx("shrink-0", c.state === "ok" ? "text-ok" : c.state === "warn" ? "text-warn" : "text-error")} aria-label={c.state}>
            {c.state === "ok" ? <Check size={12} /> : c.state === "warn" ? <AlertTriangle size={12} /> : <XCircle size={12} />}
          </span>
          <span className="text-fg shrink-0">{c.label}</span>
          <span className="text-fg-muted truncate flex-1" title={c.detail}>
            {c.detail}
          </span>
          {c.fix && c.state !== "ok" && (
            <button type="button" className="btn-ghost !py-0.5 text-[11px] shrink-0" disabled={busy !== null} onClick={() => onFix(c)}>
              {busy === c.id ? <Loader2 size={12} className="animate-spin" /> : c.fix.icon} {c.fix.label}
            </button>
          )}
        </li>
      ))}
      <li className="text-[10px] text-fg-muted pt-0.5 flex items-center gap-2">
        checked {new Date(report.at).toLocaleTimeString(undefined, { hour12: false })}
        <button type="button" className="underline hover:text-fg cursor-pointer" onClick={onRefresh} disabled={busy !== null}>
          <RefreshCw size={10} className="inline mr-0.5" />
          check again
        </button>
      </li>
    </ul>
  );
}

/**
 * The empty editor area: the path from an empty workspace to a contract called and drawn, as six steps with a
 * button each, ticked from the real state (node, balances, records). Hidden with one click; a link brings it back.
 */
export function EmptyMainArea() {
  const [hidden, setHidden] = useState(loadHidden);
  useEffect(() => {
    const show = () => setHidden(false);
    window.addEventListener(GUIDE_EVENT, show);
    return () => window.removeEventListener(GUIDE_EVENT, show);
  }, []);
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
  const [tools, setTools] = useState<ToolsReport | null>(toolsCache);
  const [toolBusy, setToolBusy] = useState<string | null>(null);

  const env = () => engine.get<EnvironmentPlugin>("environment");
  const runToolsCheck = async () => {
    setToolBusy("check");
    try {
      const report = await checkTools(engine, useIde.getState().target);
      toolsCache = report;
      setTools(report);
    } finally {
      setToolBusy(null);
    }
  };
  useEffect(() => {
    if (!toolsCache) void runToolsCheck();
    // The report is per page load; a mount with a cached report shows it as is.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const fixTool = async (c: ToolCheck) => {
    if (!c.fix) return;
    setToolBusy(c.id);
    setError(null);
    try {
      await c.fix.run();
      // An install changes the report; a link or a target switch changes nothing to re-read.
      if (c.id === "silverc" || c.id === "kaspa-wasm") await runToolsCheck();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setToolBusy(null);
    }
  };
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
      id: "tools",
      title: "Check the tools",
      detail: "Node.js, the HardKas CLI, silverc and kaspa-wasm" + (local ? ", and Docker for the local node." : "."),
      done: tools?.ready === true,
      action: toolBusy === "check" ? "Checking…" : tools ? "Check again" : "Check",
      icon: <Wrench size={14} />,
      run: runToolsCheck,
      body: <ToolRows report={tools} busy={toolBusy} onFix={(c) => void fixTool(c)} onRefresh={() => void runToolsCheck()} />
    },
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
      detail: sil ? `${sil} with the pinned silverc (Ctrl+Enter in the editor does the same).` : "No .sil file in this project yet: start from a template (a contract with one entry), then compile it.",
      done: compiled !== null,
      action: sil ? "Compile" : "Create a contract",
      icon: <FileCode2 size={14} />,
      run: async () => {
        if (!sil) {
          openNewArtifactWizard({ folder: "contracts", templateId: "silver-basic" });
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
              <p className="text-xs text-fg-muted mt-0.5">Seven steps; each button does one. The ticks come from the real state of the tools, the node, the accounts and the records.</p>
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
                <li key={s.id} className={clsx("rounded border px-3 py-2 space-y-1.5", isNext ? "border-accent/50 bg-accent/5" : "border-border/60", s.done && !s.body && "opacity-70")}>
                  <div className="flex items-center gap-3">
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
                    {(!s.done || s.body) && (
                      <button type="button" className={clsx("shrink-0 !py-1 text-[11px]", isNext ? "btn-primary" : "btn-ghost")} disabled={running !== null || toolBusy !== null || (s.id === "node" && nodeBusy !== null)} onClick={() => void runStep(s)}>
                        {busy || (s.id === "tools" && toolBusy === "check") ? <Loader2 size={12} className="animate-spin" /> : s.icon} {busy ? "Working…" : s.action}
                      </button>
                    )}
                  </div>
                  {s.body}
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
