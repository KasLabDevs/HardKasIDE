import clsx from "clsx";
import { CheckCircle2, Circle, FolderPlus, HelpCircle, Loader2, Sparkles, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api, IdeApiError, type FrontendStackOption, type WorkspaceInfo } from "@/api/client";

interface Props {
  defaultParent: string;
  onClose: () => void;
  onCreated: (workspace: WorkspaceInfo) => void;
}

type StarterKind = "covenant-1-n" | "covenant-1-1" | "covenant-escrow" | "covenant-timelock" | "silver-basic" | "none";

interface StarterContractOption {
  id: StarterKind;
  label: string;
  badge: string;
  defaultClass: string;
  description: string;
  supportsFanout?: boolean;
}

const STARTER_CONTRACTS: readonly StarterContractOption[] = [
  {
    id: "covenant-1-n",
    label: "Covenant 1:N (Multi-Output Splitter)",
    badge: "Covenant 1:N",
    defaultClass: "PaymentSplitter",
    supportsFanout: true,
    description: "Enforces that 1 input UTXO splits across N recipient outputs (tx.outputs[0..N-1])."
  },
  {
    id: "covenant-1-1",
    label: "Covenant 1:1 (Recursive Stateful Vault)",
    badge: "Covenant 1:1",
    defaultClass: "StatefulVault",
    description: "Enforces a 1:1 state continuation output keeping the same covenant lockingBytecode."
  },
  {
    id: "covenant-escrow",
    label: "Covenant Escrow 2-of-3 (Buyer / Seller / Arbiter)",
    badge: "Escrow",
    defaultClass: "OrderEscrow",
    description: "Multi-party escrow covenant enforcing settlement destination and amount."
  },
  {
    id: "covenant-timelock",
    label: "Covenant Timelock / Vesting Vault",
    badge: "Timelock",
    defaultClass: "VestingVault",
    description: "Time-locked vault requiring tx.time >= unlockTime and beneficiary output guard."
  },
  {
    id: "silver-basic",
    label: "Basic SilverScript Contract",
    badge: "SilverScript",
    defaultClass: "VaultGuard",
    description: "Clean signature-guarded SilverScript contract skeleton."
  }
];

const COMPILER_ENVS = [
  {
    id: "SilverScript-0.1-CovenantV1",
    label: "SilverScript-0.1 (silverc 1.0.0 · Kaspa Covenant v1 · TX v1)"
  },
  {
    id: "SilverScript-0.1-StrictSimnet",
    label: "SilverScript-0.1 (rusty-kaspad Toccata v2 · Consensus Strict)"
  },
  {
    id: "SilverScript-0.1-Simulator",
    label: "SilverScript-0.1 (Local Simulator Fast Mode)"
  }
];

const DEFAULT_FRONTENDS: FrontendStackOption[] = [
  { id: "none", label: "No frontend (Contracts & SDK only)", language: "TypeScript + SilverScript", framework: "None", description: "Pure HardKas workspace with SilverScript contracts, scripts and tests." },
  { id: "react-ts", label: "React + TypeScript (Vite)", language: "TypeScript (TSX)", framework: "React 19", description: "Vite + React + TypeScript dApp in dapp/ wired to KasWare Wallet and HardKas." },
  { id: "vue-ts", label: "Vue 3 + TypeScript (Vite)", language: "TypeScript (Vue SFC)", framework: "Vue 3", description: "Vite + Vue 3 Composition API + TypeScript dApp in dapp/." },
  { id: "svelte-ts", label: "Svelte + TypeScript (Vite)", language: "TypeScript (Svelte)", framework: "Svelte 5", description: "Vite + Svelte + TypeScript reactive dApp in dapp/." },
  { id: "nextjs", label: "Next.js (App Router · TypeScript)", language: "TypeScript (TSX)", framework: "Next.js 15", description: "Next.js App Router frontend in dapp/ with TypeScript." },
  { id: "vanilla-ts", label: "Vanilla TypeScript (Vite)", language: "TypeScript", framework: "Vanilla TS", description: "Lightweight Vite + TypeScript + HTML/CSS frontend in dapp/." },
  { id: "vanilla-js", label: "Vanilla JavaScript (ES Modules)", language: "JavaScript", framework: "Vanilla JS", description: "Zero-build HTML/CSS/JS dApp in dapp/ served directly by HardKas IDE." }
];

/**
 * Classic Eclipse-style "New HardKas Project" dialog (modeled after Eclipse's "New Java Project" wizard):
 * - Top header banner with title, dynamic status message & project icon
 * - Inline Project name + "Use default location" checkbox + Location path
 * - Grouped <fieldset> sections:
 *     1. SilverScript & Execution Environment (JRE-style radio selector)
 *     2. Project layout (Standard folders vs Full-stack with Frontend dApp language selector)
 *     3. Dependencies & Workspace Setup
 *     4. Contract Module (Create starter .sil file, Covenant 1:N / 1:1 / Escrow / Timelock, class name)
 * - Classic wizard button bar (< Back, Next >, Finish, Cancel)
 * - Clicking Finish transitions to the live dependency installation & workspace build window.
 */
export function NewProjectDialog({ defaultParent, onClose, onCreated }: Props) {
  const [frontends, setFrontends] = useState<FrontendStackOption[]>(DEFAULT_FRONTENDS);
  const [name, setName] = useState("my-hardkas-app");
  const [useDefaultLocation, setUseDefaultLocation] = useState(true);
  const [parent, setParent] = useState(defaultParent);

  // SilverScript & Execution Environment section
  const [envMode, setEnvMode] = useState<"exec-env" | "project-specific" | "workspace-default">("exec-env");
  const [compilerEnv, setCompilerEnv] = useState(COMPILER_ENVS[0].id);

  // Project layout section
  const [layoutMode, setLayoutMode] = useState<"contracts-only" | "fullstack">("contracts-only");
  const [frontend, setFrontend] = useState("react-ts");

  // Working sets / Dependencies section
  const [install, setInstall] = useState(true);

  // Module / Starter Contract section
  const [createModule, setCreateModule] = useState(true);
  const [starterKind, setStarterKind] = useState<StarterKind>("covenant-1-n");
  const [className, setClassName] = useState("PaymentSplitter");
  const [fanout, setFanout] = useState<number>(3);
  const [generateComments, setGenerateComments] = useState(true);

  // Wizard step & help state
  const [wizardPage, setWizardPage] = useState<1 | 2>(1);
  const [showHelp, setShowHelp] = useState(false);

  // Installation phase state
  const [log, setLog] = useState<string[]>([]);
  const [currentStep, setCurrentStep] = useState<number>(1);
  const [phase, setPhase] = useState<"form" | "running" | "done" | "failed">("form");
  const [error, setError] = useState<string | null>(null);
  const logRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    api.project
      .templates()
      .then((r) => {
        if (r.frontends && r.frontends.length > 0) setFrontends(r.frontends);
        if (!parent && r.defaultParent) setParent(r.defaultParent);
      })
      .catch((e) => setError(String(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [log]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && phase !== "running") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase, onClose]);

  const effectiveStarterKind: StarterKind = createModule ? starterKind : "none";
  const effectiveFrontend = layoutMode === "fullstack" ? frontend : "none";
  const selectedStarter = STARTER_CONTRACTS.find((c) => c.id === starterKind) ?? STARTER_CONTRACTS[0];
  const selectedFrontend = frontends.find((f) => f.id === effectiveFrontend) ?? frontends[0];
  const effectiveParent = useDefaultLocation ? (defaultParent || parent) : parent;
  const fullLocation = `${effectiveParent.replace(/[\\/]+$/, "")}${effectiveParent ? "\\" : ""}${name.trim()}`;

  const frontendOptions = frontends.filter((f) => f.id !== "none");

  const steps = [
    { id: 1, label: "Scaffolding HardKas project structure (contracts/, scripts/, test/)" },
    {
      id: 2,
      label:
        effectiveStarterKind === "none"
          ? effectiveFrontend === "none"
            ? "Configuring hardkas.config.ts & package.json"
            : `Scaffolding ${selectedFrontend?.framework ?? effectiveFrontend} frontend in dapp/`
          : `Generating contracts/${(className.trim() || selectedStarter.defaultClass).replace(/\.sil$/, "")}.sil${effectiveFrontend !== "none" ? ` & ${selectedFrontend?.framework} dapp/` : ""}`
    },
    { id: 3, label: install ? "Installing HardKas SDK, CLI & test dependencies (npm install)" : "Writing workspace package.json" },
    {
      id: 4,
      label:
        install && effectiveFrontend !== "none" && effectiveFrontend !== "vanilla-js"
          ? `Installing ${selectedFrontend?.framework ?? "frontend"} dependencies in dapp/`
          : "Finalizing project & opening workspace in HardKas IDE"
    }
  ];

  const create = async () => {
    setPhase("running");
    setCurrentStep(1);
    setError(null);
    setLog([]);
    try {
      const { job, dest } = await api.project.create({
        template: "init",
        name: name.trim(),
        parentDir: effectiveParent.trim(),
        install,
        frontend: effectiveFrontend,
        starterContract: {
          kind: effectiveStarterKind,
          className: className.trim() || selectedStarter.defaultClass,
          fanout
        }
      });
      setLog((l) => [
        ...l,
        `$ hardkas ${job.args.join(" ")}`,
        `→ Target location: ${dest}`,
        `→ Compiler environment: ${compilerEnv} (silverc v1.0.0 · pragma ^0.1.0)`
      ]);
      const done = await api.jobs.follow(job.id, (_type, data) => {
        const text = data.trimEnd();
        if (!text) return;
        const stepMatch = /\[step\s+(\d+)\/4\]/i.exec(text);
        if (stepMatch) {
          setCurrentStep(Number(stepMatch[1]));
        }
        setLog((l) => [...l, text]);
      });
      if (done.status !== "succeeded") {
        setPhase("failed");
        setError(`Project creation exited with code ${done.exitCode}. Check the console log below for details.`);
        return;
      }
      setCurrentStep(5);
      setPhase("done");
      const ws = await api.workspace.open(dest);
      onCreated(ws);
    } catch (e) {
      setPhase("failed");
      setError(e instanceof IdeApiError ? e.message : String(e));
    }
  };

  const progressPercent = phase === "done" ? 100 : Math.min(95, Math.max(12, Math.round(((currentStep - 0.5) / 4) * 100)));
  const canFinish = Boolean(name.trim() && effectiveParent.trim() && (!createModule || className.trim()));

  return (
    <div
      role="presentation"
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur-[1px] flex items-center justify-center p-4"
      onClick={phase === "running" ? undefined : onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-project-dialog-title"
        className="w-full max-w-[680px] max-h-[92vh] flex flex-col overflow-hidden rounded-md border border-border bg-bg-elev shadow-2xl select-none"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Classic Desktop Window Title Bar */}
        <div className="flex items-center justify-between px-3 py-1.5 bg-bg-panel border-b border-border text-xs">
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center justify-center w-4 h-4 rounded-sm bg-accent/20 border border-accent/50 text-accent font-mono text-[9px] font-bold">
              S
            </span>
            <span className="font-medium text-fg">
              {phase === "form" ? "New HardKas Project" : "Progress Information — Installing Project Dependencies"}
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={phase === "running"}
            className="text-fg-muted hover:text-fg disabled:opacity-40 cursor-pointer p-0.5 rounded hover:bg-bg-hover"
            aria-label="Close dialog"
          >
            <X size={14} />
          </button>
        </div>

        {/* Eclipse-style Top Banner Area */}
        <div className="flex items-center justify-between px-5 py-3.5 bg-bg border-b border-border shrink-0">
          <div className="space-y-0.5 pr-4">
            <h2 id="new-project-dialog-title" className="text-sm font-bold text-fg">
              {phase === "form"
                ? wizardPage === 1
                  ? "Create a HardKas Project"
                  : "HardKas Project Build & Structure Settings"
                : phase === "done"
                  ? "Project Ready"
                  : phase === "failed"
                    ? "Project Creation Failed"
                    : "Installing Dependencies & Building Workspace"}
            </h2>
            <p className="text-[11px] text-fg-muted">
              {phase === "form"
                ? !name.trim()
                  ? "Enter a project name."
                  : wizardPage === 1
                    ? "Configure SilverScript compiler environment, project layout and initial Covenant module."
                    : "Review generated folders, starter contract path and npm dependency installation."
                : phase === "running"
                  ? `Running npm install and configuring ${name.trim()}… Wait until all steps complete.`
                  : phase === "done"
                    ? "All dependencies installed cleanly. Opening workspace…"
                    : "An error occurred while creating the project."}
            </p>
          </div>
          <div className="relative w-12 h-12 rounded-lg bg-accent/10 border border-accent/30 flex items-center justify-center shrink-0">
            <FolderPlus size={24} className="text-accent" />
            <span className="absolute -bottom-1 -right-1 px-1 py-0.2 rounded bg-accent text-bg font-mono text-[9px] font-bold shadow">
              .sil
            </span>
          </div>
        </div>

        {phase === "form" ? (
          <>
            {wizardPage === 1 ? (
              <div className="p-5 space-y-3.5 text-xs overflow-y-auto flex-1">
                {/* Project Name & Location (Eclipse top rows) */}
                <div className="space-y-2">
                  <div className="flex items-center gap-3">
                    <label htmlFor="eclipse-project-name" className="w-24 shrink-0 text-fg">
                      Project name:
                    </label>
                    <input
                      id="eclipse-project-name"
                      className="input font-mono py-1 flex-1"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="my-hardkas-app"
                      autoFocus
                    />
                  </div>

                  <label className="flex items-center gap-2 cursor-pointer pt-0.5">
                    <input
                      type="checkbox"
                      checked={useDefaultLocation}
                      onChange={(e) => setUseDefaultLocation(e.target.checked)}
                    />
                    <span className="text-fg">Use default location</span>
                  </label>

                  <div className="flex items-center gap-3">
                    <label
                      htmlFor="eclipse-project-location"
                      className={clsx("w-24 shrink-0", useDefaultLocation ? "text-fg-muted/60" : "text-fg")}
                    >
                      Location:
                    </label>
                    <input
                      id="eclipse-project-location"
                      className={clsx("input font-mono py-1 flex-1", useDefaultLocation && "opacity-60 cursor-not-allowed bg-bg-panel")}
                      value={useDefaultLocation ? fullLocation : parent}
                      disabled={useDefaultLocation}
                      onChange={(e) => setParent(e.target.value)}
                    />
                    <button
                      type="button"
                      disabled={useDefaultLocation}
                      onClick={() => setParent(defaultParent)}
                      className="btn-ghost border border-border px-2.5 py-1 text-[11px] disabled:opacity-40"
                    >
                      Reset
                    </button>
                  </div>
                </div>

                {/* Fieldset 1: SilverScript & Execution Environment (like Eclipse JRE group) */}
                <fieldset className="border border-border rounded px-3.5 py-2.5 space-y-2 bg-bg-panel/40">
                  <legend className="px-1.5 text-[11px] font-semibold text-fg">SilverScript Compiler & Runtime</legend>

                  <div className="flex items-center gap-2">
                    <input
                      id="env-mode-exec"
                      type="radio"
                      name="env-mode"
                      checked={envMode === "exec-env"}
                      onChange={() => setEnvMode("exec-env")}
                    />
                    <label htmlFor="env-mode-exec" className="text-fg shrink-0 cursor-pointer">
                      Use an execution environment compiler:
                    </label>
                    <select
                      aria-label="Execution environment compiler"
                      disabled={envMode !== "exec-env"}
                      value={compilerEnv}
                      onChange={(e) => setCompilerEnv(e.target.value)}
                      className="input py-1 text-[11px] font-mono flex-1 disabled:opacity-50"
                    >
                      {COMPILER_ENVS.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="flex items-center gap-2">
                    <input
                      id="env-mode-specific"
                      type="radio"
                      name="env-mode"
                      checked={envMode === "project-specific"}
                      onChange={() => setEnvMode("project-specific")}
                    />
                    <label htmlFor="env-mode-specific" className="text-fg shrink-0 cursor-pointer">
                      Use a project specific toolchain:
                    </label>
                    <select
                      aria-label="Project specific toolchain"
                      disabled={envMode !== "project-specific"}
                      className="input py-1 text-[11px] font-mono flex-1 disabled:opacity-50"
                      defaultValue="silverc-1.0.0"
                    >
                      <option value="silverc-1.0.0">silverc 1.0.0 (pragma silverscript ^0.1.0 · HardKas 0.13.0-rc.1)</option>
                    </select>
                  </div>

                  <div className="flex items-center justify-between gap-2">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        name="env-mode"
                        checked={envMode === "workspace-default"}
                        onChange={() => setEnvMode("workspace-default")}
                      />
                      <span className="text-fg">Use default compiler &apos;silverc&apos; and workspace preferences</span>
                    </label>
                    <span className="text-[10px] font-mono text-accent bg-accent/10 border border-accent/30 px-1.5 py-0.5 rounded">
                      silverc v1.0.0 · ^0.1.0
                    </span>
                  </div>
                </fieldset>

                {/* Fieldset 2: Project layout (Standard vs Full-Stack Frontend dApp) */}
                <fieldset className="border border-border rounded px-3.5 py-2.5 space-y-2 bg-bg-panel/40">
                  <legend className="px-1.5 text-[11px] font-semibold text-fg">Project layout</legend>

                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="layout-mode"
                      checked={layoutMode === "contracts-only"}
                      onChange={() => setLayoutMode("contracts-only")}
                    />
                    <span className="text-fg">
                      Create separate folders for contracts, scripts and tests (<code>contracts/</code>, <code>scripts/</code>, <code>test/</code>)
                    </span>
                  </label>

                  <div className="space-y-2">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        name="layout-mode"
                        checked={layoutMode === "fullstack"}
                        onChange={() => setLayoutMode("fullstack")}
                      />
                      <span className="text-fg">
                        Create full-stack layout with Frontend dApp folder (<code>contracts/</code>, <code>scripts/</code>, <code>test/</code>, <code>dapp/</code>)
                      </span>
                    </label>

                    <div className="flex items-center gap-3 pl-5">
                      <label
                        htmlFor="eclipse-frontend-select"
                        className={clsx("w-36 shrink-0 text-[11px]", layoutMode === "fullstack" ? "text-fg" : "text-fg-muted/60")}
                      >
                        Frontend stack / language:
                      </label>
                      <select
                        id="eclipse-frontend-select"
                        disabled={layoutMode !== "fullstack"}
                        value={frontend}
                        onChange={(e) => setFrontend(e.target.value)}
                        className="input py-1 text-[11px] flex-1 disabled:opacity-50"
                      >
                        {frontendOptions.map((f) => (
                          <option key={f.id} value={f.id}>
                            {f.label} — {f.language}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                </fieldset>

                {/* Fieldset 3: Dependencies & Build Automation (like Eclipse Working sets group) */}
                <fieldset className="border border-border rounded px-3.5 py-2.5 space-y-1.5 bg-bg-panel/40">
                  <legend className="px-1.5 text-[11px] font-semibold text-fg">Dependencies & Build Path</legend>
                  <label className="flex items-center justify-between gap-2 cursor-pointer">
                    <span className="flex items-center gap-2 text-fg">
                      <input type="checkbox" checked={install} onChange={(e) => setInstall(e.target.checked)} />
                      <span>
                        Install npm dependencies on finish (<code>@hardkas/cli</code>, <code>@hardkas/sdk</code>, <code>@hardkas/testing</code>
                        {layoutMode === "fullstack" && frontend !== "vanilla-js" ? ` + dapp/ packages` : ""})
                      </span>
                    </span>
                    <span className="text-[10px] font-mono text-fg-muted">npm install</span>
                  </label>
                </fieldset>

                {/* Fieldset 4: Contract Module (like Eclipse Module group) */}
                <fieldset className="border border-border rounded px-3.5 py-2.5 space-y-2 bg-bg-panel/40">
                  <legend className="px-1.5 text-[11px] font-semibold text-fg">SilverScript / Covenant Module</legend>

                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={createModule} onChange={(e) => setCreateModule(e.target.checked)} />
                    <span className="text-fg">Create starter SilverScript contract file (<code>.sil</code>)</span>
                  </label>

                  <div className={clsx("space-y-2 pl-5", !createModule && "opacity-50 pointer-events-none")}>
                    <div className="flex items-center gap-3">
                      <label htmlFor="eclipse-module-kind" className="w-28 shrink-0 text-fg">
                        Covenant blueprint:
                      </label>
                      <select
                        id="eclipse-module-kind"
                        disabled={!createModule}
                        value={starterKind}
                        onChange={(e) => {
                          const next = e.target.value as StarterKind;
                          setStarterKind(next);
                          const found = STARTER_CONTRACTS.find((c) => c.id === next);
                          if (found?.defaultClass) setClassName(found.defaultClass);
                        }}
                        className="input py-1 text-[11px] flex-1"
                      >
                        {STARTER_CONTRACTS.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.label}
                          </option>
                        ))}
                      </select>

                      {selectedStarter.supportsFanout && (
                        <div className="flex items-center gap-1 shrink-0" title="Number of enforced outputs in Covenant 1:N">
                          <span className="text-[11px] text-fg-muted">Ratio:</span>
                          <select
                            aria-label="Covenant 1:N output ratio"
                            value={fanout}
                            onChange={(e) => setFanout(Number(e.target.value))}
                            className="input py-1 px-1.5 w-16 font-mono text-[11px]"
                          >
                            {[2, 3, 4, 5].map((n) => (
                              <option key={n} value={n}>
                                1:{n}
                              </option>
                            ))}
                          </select>
                        </div>
                      )}
                    </div>

                    <div className="flex items-center gap-3">
                      <label htmlFor="eclipse-module-name" className="w-28 shrink-0 text-fg">
                        Contract name:
                      </label>
                      <input
                        id="eclipse-module-name"
                        disabled={!createModule}
                        className="input font-mono py-1 flex-1"
                        value={className}
                        onChange={(e) => setClassName(e.target.value)}
                        placeholder="PaymentSplitter"
                      />
                      <span className="text-[10px] font-mono text-accent shrink-0">
                        contracts/{(className.trim() || selectedStarter.defaultClass).replace(/\.sil$/, "")}.sil
                      </span>
                    </div>

                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        disabled={!createModule}
                        checked={generateComments}
                        onChange={(e) => setGenerateComments(e.target.checked)}
                      />
                      <span className="text-fg">Generate comments and TX v1 covenant documentation</span>
                    </label>
                  </div>
                </fieldset>

                {showHelp && (
                  <div className="rounded border border-accent/30 bg-accent/5 p-2.5 text-[11px] text-fg-muted space-y-1">
                    <div className="font-semibold text-fg flex items-center gap-1.5">
                      <Sparkles size={12} className="text-accent" /> HardKas Project Wizard Help
                    </div>
                    <div>
                      • <b>Covenant 1:N</b> generates a multi-output splitter validating <code>tx.outputs[0..N-1]</code> values &amp; locking scripts.
                    </div>
                    <div>
                      • <b>Full-stack layout</b> scaffolds a ready-to-run frontend inside <code>dapp/</code> and installs both root &amp; frontend packages when you click <b>Finish</b>.
                    </div>
                  </div>
                )}

                {error && <div role="alert" className="text-error text-xs break-words">{error}</div>}
              </div>
            ) : (
              /* Wizard Page 2 (Next >): Source folders & Build summary preview before Finish */
              <div className="p-5 space-y-4 text-xs overflow-y-auto flex-1">
                <div className="text-fg font-semibold">Project Build Path &amp; Generated Structure Preview</div>
                <div className="rounded border border-border bg-bg p-3 font-mono text-[11px] space-y-1">
                  <div className="text-accent font-semibold">📁 {name.trim() || "my-hardkas-app"}/</div>
                  <div className="pl-4 text-fg">├── 📁 contracts/</div>
                  {createModule && (
                    <div className="pl-8 text-ok">
                      └── 📄 {(className.trim() || selectedStarter.defaultClass).replace(/\.sil$/, "")}.sil ({selectedStarter.badge}
                      {selectedStarter.supportsFanout ? ` · 1:${fanout}` : ""})
                    </div>
                  )}
                  <div className="pl-4 text-fg">├── 📁 scripts/ (deploy &amp; covenant workflow scripts)</div>
                  <div className="pl-4 text-fg">├── 📁 test/ (Vitest + HardKas simulator/simnet suite)</div>
                  {layoutMode === "fullstack" && (
                    <div className="pl-4 text-accent">
                      ├── 📁 dapp/ ({selectedFrontend?.label} · {selectedFrontend?.language})
                    </div>
                  )}
                  <div className="pl-4 text-fg-muted">├── ⚙️ hardkas.config.ts</div>
                  <div className="pl-4 text-fg-muted">└── 📦 package.json</div>
                </div>

                <div className="rounded border border-border bg-bg-panel p-3 space-y-1.5 text-[11px]">
                  <div className="font-semibold text-fg">Actions executed when clicking Finish:</div>
                  {steps.map((s) => (
                    <div key={s.id} className="flex items-center gap-2 text-fg-muted">
                      <span className="font-mono text-accent">[{s.id}/4]</span>
                      <span>{s.label}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Classic Eclipse Wizard Footer (< Back | Next > | Finish | Cancel) */}
            <footer className="flex items-center justify-between px-5 py-3 border-t border-border bg-bg-panel shrink-0">
              <button
                type="button"
                onClick={() => setShowHelp((v) => !v)}
                className="w-6 h-6 rounded-full border border-border flex items-center justify-center text-fg-muted hover:text-fg hover:bg-bg-hover cursor-pointer"
                title="Toggle Wizard Help"
              >
                <HelpCircle size={14} />
              </button>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={wizardPage === 1}
                  onClick={() => setWizardPage(1)}
                  className="btn-ghost border border-border px-4 py-1 text-xs disabled:opacity-40"
                >
                  &lt; Back
                </button>
                <button
                  type="button"
                  disabled={wizardPage === 2 || !canFinish}
                  onClick={() => setWizardPage(2)}
                  className="btn-ghost border border-border px-4 py-1 text-xs disabled:opacity-40"
                >
                  Next &gt;
                </button>
                <button
                  type="button"
                  disabled={!canFinish}
                  onClick={() => void create()}
                  className="btn-primary px-5 py-1 text-xs font-semibold"
                >
                  Finish
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className="btn-ghost border border-border px-4 py-1 text-xs"
                >
                  Cancel
                </button>
              </div>
            </footer>
          </>
        ) : (
          /* Installing Dependencies & Building Workspace Window */
          <div className="p-5 space-y-4 text-xs overflow-auto flex-1">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span
                  className={clsx(
                    "font-semibold text-xs flex items-center gap-2",
                    phase === "done" ? "text-ok" : phase === "failed" ? "text-error" : "text-accent"
                  )}
                >
                  {phase === "running" && <Loader2 size={14} className="animate-spin shrink-0" />}
                  {phase === "done" && <CheckCircle2 size={14} className="shrink-0" />}
                  {phase === "done"
                    ? "Dependencies installed! Opening project in HardKas IDE…"
                    : phase === "failed"
                      ? "Project setup encountered an error"
                      : `Step ${Math.min(currentStep, 4)} of 4 — Installing dependencies and configuring workspace…`}
                </span>
                <span className="font-mono text-fg-muted tabular-nums">{progressPercent}%</span>
              </div>
              <div className="w-full h-2.5 rounded-sm bg-bg border border-border overflow-hidden">
                <div
                  className={clsx(
                    "h-full transition-all duration-300",
                    phase === "failed" ? "bg-error" : phase === "done" ? "bg-ok" : "bg-accent"
                  )}
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
            </div>

            <ul className="space-y-1.5">
              {steps.map((s) => {
                const isDone = currentStep > s.id || phase === "done";
                const isActive = currentStep === s.id && phase === "running";
                return (
                  <li
                    key={s.id}
                    className={clsx(
                      "flex items-center gap-2.5 px-3 py-2 rounded border text-[11px]",
                      isDone
                        ? "border-ok/30 bg-ok/5 text-fg"
                        : isActive
                          ? "border-accent bg-accent/10 text-fg font-medium"
                          : "border-border bg-bg-panel text-fg-muted"
                    )}
                  >
                    {isDone ? (
                      <CheckCircle2 size={14} className="text-ok shrink-0" />
                    ) : isActive ? (
                      <Loader2 size={14} className="text-accent animate-spin shrink-0" />
                    ) : (
                      <Circle size={14} className="text-fg-muted/50 shrink-0" />
                    )}
                    <span className="truncate">{s.label}</span>
                  </li>
                );
              })}
            </ul>

            <div>
              <div className="label mb-1 flex items-center justify-between">
                <span>Live Installation Console (npm install / hardkas init)</span>
                <span className="font-mono text-[10px] text-fg-muted">{fullLocation}</span>
              </div>
              <pre
                ref={logRef}
                className="rounded border border-border bg-bg p-3 h-52 overflow-auto font-mono text-[11px] whitespace-pre-wrap select-text"
              >
                {log.join("\n")}
              </pre>
            </div>

            {error && (
              <div className="flex items-center justify-between gap-3 pt-1">
                <div role="alert" className="text-error break-words flex-1">
                  {error}
                </div>
                <button type="button" className="btn-ghost border border-border px-3 py-1 shrink-0" onClick={() => setPhase("form")}>
                  &lt; Back to Wizard
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
