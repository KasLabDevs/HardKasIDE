import clsx from "clsx";
import { Check, CheckCircle2, Circle, HelpCircle, Loader2, Search, Sparkles, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { api, IdeApiError, type FrontendStackOption, type WorkspaceInfo } from "@/api/client";
import {
  DEFAULT_FRONTENDS,
  STARTER_CONTRACTS,
  WIZARD_STEPS,
  filterBlueprints,
  joinPath,
  nextWizardStep,
  prevWizardStep,
  type StarterKind,
  type WizardStep
} from "./newProjectWizard";

export { joinPath };

interface Props {
  defaultParent: string;
  onClose: () => void;
  onCreated: (workspace: WorkspaceInfo) => void;
}

/**
 * Multi-step "New HardKas Project" wizard (inspired by Eclipse's clean wizard flow):
 *   Step 1: Project Name, Location & optional Minimal workspace shortcut
 *   Step 2: Filterable Covenant Blueprint / Archetype table + starter module options
 *   Step 3: Project Layout (Contracts vs Full-Stack dApp), npm dependencies & structure summary
 *   Run:    Live 4-step scaffolding & npm install progress view
 */
export function NewProjectDialog({ defaultParent, onClose, onCreated }: Props) {
  const [frontends, setFrontends] = useState<FrontendStackOption[]>(DEFAULT_FRONTENDS);
  const [name, setName] = useState("my-hardkas-app");
  const [useDefaultLocation, setUseDefaultLocation] = useState(true);
  const [parent, setParent] = useState(defaultParent);
  const [minimalMode, setMinimalMode] = useState(false);

  // Step 2: Covenant blueprint
  const [blueprintFilter, setBlueprintFilter] = useState("");
  const [starterKind, setStarterKind] = useState<StarterKind>("covenant-1-n");
  const [className, setClassName] = useState("PaymentSplitter");
  const [fanout, setFanout] = useState<number>(3);
  const [generateComments, setGenerateComments] = useState(true);

  // Step 3: Layout & dependencies
  const [layoutMode, setLayoutMode] = useState<"contracts-only" | "fullstack">("contracts-only");
  const [frontend, setFrontend] = useState("react-ts");
  const [install, setInstall] = useState(true);

  // Wizard state
  const [wizardPage, setWizardPage] = useState<WizardStep>(1);
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

  const effectiveStarterKind: StarterKind = minimalMode ? "none" : starterKind;
  const effectiveFrontend = minimalMode || layoutMode !== "fullstack" ? "none" : frontend;
  const selectedStarter = STARTER_CONTRACTS.find((c) => c.id === starterKind) ?? STARTER_CONTRACTS[0];
  const selectedFrontend = frontends.find((f) => f.id === effectiveFrontend) ?? frontends[0];
  const effectiveParent = useDefaultLocation ? (defaultParent || parent) : parent;
  const fullLocation = effectiveParent ? joinPath(effectiveParent, name.trim()) : name.trim();
  const frontendOptions = frontends.filter((f) => f.id !== "none");
  const filteredBlueprints = useMemo(() => filterBlueprints(blueprintFilter), [blueprintFilter]);
  const currentStepMeta = WIZARD_STEPS.find((s) => s.id === wizardPage) ?? WIZARD_STEPS[0];

  const resolvedContractFile = `${(className.trim() || selectedStarter.defaultClass || "Contract").replace(/\.sil$/, "")}.sil`;

  const steps = [
    { id: 1, label: "Scaffolding HardKas project structure (contracts/, scripts/, test/)" },
    {
      id: 2,
      label:
        effectiveStarterKind === "none"
          ? effectiveFrontend === "none"
            ? "Configuring hardkas.config.ts & package.json"
            : `Scaffolding ${selectedFrontend?.framework ?? effectiveFrontend} frontend in dapp/`
          : `Generating contracts/${resolvedContractFile}${effectiveFrontend !== "none" ? ` & ${selectedFrontend?.framework} dapp/` : ""}`
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
        `→ Target location: ${dest}`
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

  const pickBlueprint = (itemId: StarterKind) => {
    setStarterKind(itemId);
    const found = STARTER_CONTRACTS.find((c) => c.id === itemId);
    if (found?.defaultClass) setClassName(found.defaultClass);
  };

  const progressPercent = phase === "done" ? 100 : Math.min(95, Math.max(12, Math.round(((currentStep - 0.5) / 4) * 100)));
  const hasBaseInfo = Boolean(name.trim() && effectiveParent.trim());
  const canFinish = hasBaseInfo && (effectiveStarterKind === "none" || Boolean(className.trim()));
  const canGoNext = wizardPage === 1 ? hasBaseInfo : wizardPage === 2 ? canFinish : false;
  const finishIsPrimary = wizardPage === 3 || (wizardPage === 1 && minimalMode);

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
        className={clsx(
          "w-full max-w-[700px] max-h-[90vh] flex flex-col overflow-hidden rounded-md border border-border bg-bg-elev shadow-2xl select-none",
          phase === "form" && "h-[min(86vh,640px)]"
        )}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Window Title Bar */}
        <div className="flex items-center justify-between px-3 py-1.5 bg-bg-panel border-b border-border text-xs shrink-0">
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center justify-center w-4 h-4 rounded-sm bg-accent/20 border border-accent/50 text-accent font-mono text-[11px] font-bold">
              H
            </span>
            <span className="font-medium text-fg">
              {phase === "form" ? "New HardKas Project" : "Creating Project — Progress"}
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

        {/* Clean Banner + Horizontal Stepper (no awkward badge icons) */}
        <div className="px-5 py-3.5 bg-bg border-b border-border shrink-0 space-y-2.5">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-0.5 min-w-0">
              <h2 id="new-project-dialog-title" className="text-sm font-bold text-fg">
                {phase === "form"
                  ? currentStepMeta.title
                  : phase === "done"
                    ? "Project Ready"
                    : phase === "failed"
                      ? "Project Creation Failed"
                      : "Installing Dependencies & Building Workspace"}
              </h2>
              <p className="text-[12px] text-fg-muted">
                {phase === "form"
                  ? !name.trim()
                    ? "Enter a project name to continue."
                    : currentStepMeta.subtitle
                  : phase === "running"
                    ? `Configuring ${name.trim()}… Wait until all steps complete.`
                    : phase === "done"
                      ? "Workspace ready. Opening in HardKas IDE…"
                      : "An error occurred while creating the project."}
              </p>
            </div>

            {phase === "form" && (
              <nav aria-label="Wizard steps" className="hidden sm:flex items-center gap-1 shrink-0 pt-0.5">
                {WIZARD_STEPS.map((s, idx) => {
                  const skipped = minimalMode && s.id === 2;
                  const active = wizardPage === s.id;
                  const completed = wizardPage > s.id && !skipped;
                  const clickable = !skipped && (s.id === 1 || hasBaseInfo);
                  return (
                    <div key={s.id} className="flex items-center gap-1">
                      {idx > 0 && <span className="w-3 h-px bg-border" />}
                      <button
                        type="button"
                        disabled={!clickable}
                        onClick={() => clickable && setWizardPage(s.id)}
                        className={clsx(
                          "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition-colors",
                          active
                            ? "border-accent/60 bg-accent/15 text-accent"
                            : completed
                              ? "border-ok/40 bg-ok/10 text-ok cursor-pointer hover:bg-ok/15"
                              : skipped
                                ? "border-border/50 text-fg-muted/40 line-through"
                                : clickable
                                  ? "border-border text-fg-muted hover:text-fg cursor-pointer"
                                  : "border-border/60 text-fg-muted/50"
                        )}
                      >
                        {completed ? <Check size={10} /> : <span>{s.id}</span>}
                        <span>{s.shortLabel}</span>
                      </button>
                    </div>
                  );
                })}
              </nav>
            )}
          </div>
        </div>

        {phase === "form" ? (
          <>
            <div className="p-5 overflow-y-auto flex-1 min-h-0 text-xs">
              {/* STEP 1: Name & Location */}
              {wizardPage === 1 && (
                <div className="space-y-4">
                  <div className="space-y-3">
                    <div className="flex items-center gap-3">
                      <label htmlFor="wizard-project-name" className="w-28 shrink-0 text-fg font-medium">
                        Project name:
                      </label>
                      <input
                        id="wizard-project-name"
                        className="input font-mono py-1.5 flex-1"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="my-hardkas-app"
                        autoFocus
                      />
                    </div>

                    <div className="pl-[7.75rem] space-y-2.5">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={useDefaultLocation}
                          onChange={(e) => setUseDefaultLocation(e.target.checked)}
                        />
                        <span className="text-fg">Use default workspace location</span>
                      </label>
                    </div>

                    <div className="flex items-center gap-3">
                      <label
                        htmlFor="wizard-project-location"
                        className={clsx("w-28 shrink-0 font-medium", useDefaultLocation ? "text-fg-muted/60" : "text-fg")}
                      >
                        Location:
                      </label>
                      <input
                        id="wizard-project-location"
                        className={clsx("input font-mono py-1.5 flex-1", useDefaultLocation && "opacity-60 cursor-not-allowed bg-bg-panel")}
                        value={useDefaultLocation ? fullLocation : parent}
                        disabled={useDefaultLocation}
                        onChange={(e) => setParent(e.target.value)}
                      />
                      <button
                        type="button"
                        disabled={useDefaultLocation}
                        onClick={() => setParent(defaultParent)}
                        className="btn-ghost border border-border px-2.5 py-1.5 text-[12px] disabled:opacity-40"
                      >
                        Reset
                      </button>
                    </div>
                  </div>

                  <div className="border-t border-border/70 pt-3.5 space-y-2">
                    <label className="flex items-start gap-2.5 cursor-pointer rounded-md border border-border bg-bg-panel/40 px-3 py-2.5 hover:border-fg-muted/40 transition-colors">
                      <input
                        type="checkbox"
                        className="mt-0.5"
                        checked={minimalMode}
                        onChange={(e) => {
                          setMinimalMode(e.target.checked);
                          if (e.target.checked) setLayoutMode("contracts-only");
                        }}
                      />
                      <div>
                        <div className="font-medium text-fg">Create a minimal workspace (skip blueprint selection)</div>
                        <div className="text-[11.5px] text-fg-muted mt-0.5">
                          Creates <code>contracts/</code>, <code>scripts/</code>, <code>test/</code>, <code>hardkas.config.ts</code> and <code>package.json</code> with no starter contract or frontend.
                        </div>
                      </div>
                    </label>
                  </div>

                  <div className="rounded-md border border-border/80 bg-bg-panel/30 px-3.5 py-2.5 flex items-center justify-between gap-3">
                    <div>
                      <div className="font-medium text-fg">SilverScript compiler</div>
                      <div className="text-[11.5px] text-fg-muted">
                        Pinned by HardKas and verified by digest automatically during setup.
                      </div>
                    </div>
                    <span className="shrink-0 text-[11.5px] font-mono text-accent bg-accent/10 border border-accent/30 px-2 py-0.5 rounded">
                      silverc v1.0.0 · pragma ^0.1.0
                    </span>
                  </div>
                </div>
              )}

              {/* STEP 2: Filterable Covenant Blueprint Table */}
              {wizardPage === 2 && (
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <label htmlFor="wizard-blueprint-filter" className="text-fg font-medium shrink-0">
                      Filter:
                    </label>
                    <div className="input flex items-center gap-2 py-1 px-2.5 flex-1">
                      <Search size={13} className="shrink-0 text-fg-muted pointer-events-none" />
                      <input
                        id="wizard-blueprint-filter"
                        className="flex-1 min-w-0 bg-transparent outline-none text-fg placeholder:text-fg-muted"
                        placeholder="Filter blueprints by name, pattern or contract..."
                        value={blueprintFilter}
                        onChange={(e) => setBlueprintFilter(e.target.value)}
                      />
                      {blueprintFilter && (
                        <button
                          type="button"
                          onClick={() => setBlueprintFilter("")}
                          aria-label="Clear filter"
                          className="shrink-0 text-fg-muted hover:text-fg cursor-pointer"
                        >
                          <X size={12} />
                        </button>
                      )}
                    </div>
                    <span className="text-[11.5px] text-fg-muted tabular-nums shrink-0">
                      {filteredBlueprints.length} / {STARTER_CONTRACTS.length}
                    </span>
                  </div>

                  {/* Archetype Table */}
                  <div className="rounded-md border border-border bg-bg overflow-hidden">
                    <div className="grid grid-cols-12 gap-2 px-3 py-1.5 bg-bg-panel border-b border-border text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
                      <div className="col-span-7">Blueprint</div>
                      <div className="col-span-2">Pattern</div>
                      <div className="col-span-3">Starter File</div>
                    </div>
                    <div role="listbox" aria-label="Covenant blueprints" className="max-h-56 overflow-y-auto divide-y divide-border/60">
                      {filteredBlueprints.length === 0 ? (
                        <div className="px-3 py-6 text-center text-fg-muted space-y-1">
                          <div>No blueprints match "{blueprintFilter}".</div>
                          <button type="button" onClick={() => setBlueprintFilter("")} className="text-accent hover:underline cursor-pointer">
                            Clear filter
                          </button>
                        </div>
                      ) : (
                        filteredBlueprints.map((item) => {
                          const selected = starterKind === item.id;
                          return (
                            <button
                              key={item.id}
                              type="button"
                              role="option"
                              aria-selected={selected}
                              onClick={() => pickBlueprint(item.id)}
                              onDoubleClick={() => {
                                pickBlueprint(item.id);
                                setWizardPage(3);
                              }}
                              className={clsx(
                                "w-full grid grid-cols-12 gap-2 px-3 py-1.5 text-left items-center transition-colors cursor-pointer",
                                selected ? "bg-accent/12 text-fg" : "text-fg-muted hover:bg-bg-hover/60 hover:text-fg"
                              )}
                            >
                              <div className="col-span-7 font-medium truncate flex items-center gap-2">
                                <span
                                  className={clsx(
                                    "w-1.5 h-1.5 rounded-full shrink-0",
                                    selected ? "bg-accent" : "bg-transparent"
                                  )}
                                />
                                <span className={clsx("truncate", selected && "text-fg font-semibold")}>{item.label}</span>
                              </div>
                              <div className="col-span-2 font-mono text-[11px] truncate">{item.badge}</div>
                              <div className="col-span-3 font-mono text-[11px] truncate text-fg-muted">
                                {item.defaultClass ? `${item.defaultClass}.sil` : "—"}
                              </div>
                            </button>
                          );
                        })
                      )}
                    </div>
                  </div>

                  {/* Description Box for Selected Blueprint */}
                  <div className="rounded-md border border-border bg-bg-panel/40 px-3 py-2 text-[11.5px] text-fg-muted leading-relaxed min-h-[3.25rem]">
                    <span className="font-semibold text-fg">{selectedStarter.badge}: </span>
                    {selectedStarter.description}
                  </div>

                  {/* Starter Module Options */}
                  {starterKind !== "none" && (
                    <div className="rounded-md border border-border/80 bg-bg-panel/30 p-3 space-y-2.5">
                      <div className="flex flex-wrap items-center gap-2.5">
                        <label htmlFor="wizard-contract-name" className="text-fg font-medium shrink-0">
                          Contract name:
                        </label>
                        <input
                          id="wizard-contract-name"
                          className="input font-mono py-1 flex-1 min-w-[10rem]"
                          value={className}
                          onChange={(e) => setClassName(e.target.value)}
                          placeholder="PaymentSplitter"
                        />
                        {selectedStarter.supportsFanout && (
                          <div className="flex items-center gap-1.5 shrink-0" title="Number of enforced outputs in Covenant 1:N">
                            <span className="text-fg-muted">Ratio:</span>
                            <select
                              aria-label="Covenant 1:N output ratio"
                              value={fanout}
                              onChange={(e) => setFanout(Number(e.target.value))}
                              className="input py-1 px-1.5 w-16 font-mono text-[12px]"
                            >
                              {[2, 3, 4, 5].map((n) => (
                                <option key={n} value={n}>
                                  1:{n}
                                </option>
                              ))}
                            </select>
                          </div>
                        )}
                        <span className="text-[11.5px] font-mono text-accent shrink-0">
                          contracts/{resolvedContractFile}
                        </span>
                      </div>

                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={generateComments}
                          onChange={(e) => setGenerateComments(e.target.checked)}
                        />
                        <span className="text-fg">Generate comments and TX v1 covenant documentation</span>
                      </label>
                    </div>
                  )}
                </div>
              )}

              {/* STEP 3: Layout, Frontend & Final Summary */}
              {wizardPage === 3 && (
                <div className="space-y-4">
                  <div className="space-y-2">
                    <div className="font-semibold text-fg">Project Layout &amp; Frontend dApp</div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                      <label
                        className={clsx(
                          "flex items-start gap-2.5 rounded-md border p-3 cursor-pointer transition-colors",
                          layoutMode === "contracts-only" ? "border-accent/60 bg-accent/10" : "border-border bg-bg-panel/40 hover:border-fg-muted/40"
                        )}
                      >
                        <input
                          type="radio"
                          name="layout-mode"
                          className="mt-0.5"
                          checked={layoutMode === "contracts-only"}
                          onChange={() => setLayoutMode("contracts-only")}
                        />
                        <div>
                          <div className="font-medium text-fg">Contracts &amp; SDK only</div>
                          <div className="text-[11px] text-fg-muted mt-0.5">
                            Standard workspace with <code>contracts/</code>, <code>scripts/</code> and <code>test/</code>.
                          </div>
                        </div>
                      </label>

                      <label
                        className={clsx(
                          "flex items-start gap-2.5 rounded-md border p-3 cursor-pointer transition-colors",
                          layoutMode === "fullstack" ? "border-accent/60 bg-accent/10" : "border-border bg-bg-panel/40 hover:border-fg-muted/40"
                        )}
                      >
                        <input
                          type="radio"
                          name="layout-mode"
                          className="mt-0.5"
                          checked={layoutMode === "fullstack"}
                          disabled={minimalMode}
                          onChange={() => {
                            setMinimalMode(false);
                            setLayoutMode("fullstack");
                          }}
                        />
                        <div>
                          <div className="font-medium text-fg">Full-stack Web dApp</div>
                          <div className="text-[11px] text-fg-muted mt-0.5">
                            Adds a ready-to-run frontend app inside <code>dapp/</code>.
                          </div>
                        </div>
                      </label>
                    </div>

                    {layoutMode === "fullstack" && !minimalMode && (
                      <div className="rounded-md border border-border bg-bg-panel/40 p-3 space-y-1.5">
                        <div className="flex items-center gap-3">
                          <label htmlFor="wizard-frontend-select" className="shrink-0 text-fg font-medium">
                            Frontend stack:
                          </label>
                          <select
                            id="wizard-frontend-select"
                            value={frontend}
                            onChange={(e) => setFrontend(e.target.value)}
                            className="input py-1 text-[12px] flex-1"
                          >
                            {frontendOptions.map((f) => (
                              <option key={f.id} value={f.id}>
                                {f.label} — {f.language}
                              </option>
                            ))}
                          </select>
                        </div>
                        {selectedFrontend && selectedFrontend.id !== "none" && (
                          <div className="text-[11.5px] text-fg-muted">{selectedFrontend.description}</div>
                        )}
                      </div>
                    )}
                  </div>

                  <label className="flex items-center justify-between gap-2 rounded-md border border-border bg-bg-panel/40 px-3 py-2.5 cursor-pointer">
                    <span className="flex items-center gap-2 text-fg">
                      <input type="checkbox" checked={install} onChange={(e) => setInstall(e.target.checked)} />
                      <span>
                        Install npm packages on finish (<code>@hardkas/cli</code>, <code>@hardkas/sdk</code>, <code>@hardkas/testing</code>
                        {effectiveFrontend !== "none" && effectiveFrontend !== "vanilla-js" ? " + dapp/" : ""})
                      </span>
                    </span>
                    <span className="text-[11.5px] font-mono text-fg-muted">npm install</span>
                  </label>

                  <div className="rounded-md border border-border bg-bg p-3 font-mono text-[11.5px] space-y-1">
                    <div className="flex items-center justify-between gap-2 pb-1 border-b border-border/60 font-sans">
                      <span className="font-semibold text-fg text-xs">Generated Structure Preview</span>
                      <span className="text-[11px] font-mono text-fg-muted truncate">{fullLocation}</span>
                    </div>
                    <div className="text-accent font-semibold pt-1">{name.trim() || "my-hardkas-app"}/</div>
                    <div className="pl-4 text-fg">├── contracts/</div>
                    {effectiveStarterKind !== "none" && (
                      <div className="pl-8 text-ok">
                        └── {resolvedContractFile} ({selectedStarter.badge}
                        {selectedStarter.supportsFanout ? ` · 1:${fanout}` : ""})
                      </div>
                    )}
                    <div className="pl-4 text-fg">├── scripts/</div>
                    <div className="pl-4 text-fg">├── test/</div>
                    {effectiveFrontend !== "none" && (
                      <div className="pl-4 text-accent">
                        ├── dapp/ ({selectedFrontend?.label})
                      </div>
                    )}
                    <div className="pl-4 text-fg-muted">├── hardkas.config.ts</div>
                    <div className="pl-4 text-fg-muted">└── package.json</div>
                  </div>
                </div>
              )}

              {showHelp && (
                <div className="mt-4 rounded border border-accent/30 bg-accent/5 p-2.5 text-[11.5px] text-fg-muted space-y-1">
                  <div className="font-semibold text-fg flex items-center gap-1.5">
                    <Sparkles size={12} className="text-accent" />
                    Step {wizardPage} Help
                  </div>
                  {wizardPage === 1 && (
                    <div>
                      Choose where the folder will be created. Check <b>Create a minimal workspace</b> if you want to skip template/dApp configuration and finish immediately.
                    </div>
                  )}
                  {wizardPage === 2 && (
                    <div>
                      Double-clicking any row selects it and advances straight to Setup. <b>Covenant 1:N</b> enforces multi-output shares across <code>tx.outputs[0..N-1]</code>.
                    </div>
                  )}
                  {wizardPage === 3 && (
                    <div>
                      <b>Full-stack Web dApp</b> scaffolds a frontend project under <code>dapp/</code> connected to KasWare Wallet and HardKas. Uncheck <code>npm install</code> for instant offline scaffolding.
                    </div>
                  )}
                </div>
              )}

              {error && <div role="alert" className="mt-3 text-error text-xs break-words">{error}</div>}
            </div>

            {/* Classic Wizard Footer (< Back | Next > | Finish | Cancel) */}
            <footer className="flex items-center justify-between px-5 py-3 border-t border-border bg-bg-panel shrink-0">
              <button
                type="button"
                onClick={() => setShowHelp((v) => !v)}
                className={clsx(
                  "w-6 h-6 rounded-full border flex items-center justify-center cursor-pointer transition-colors",
                  showHelp ? "border-accent text-accent bg-accent/10" : "border-border text-fg-muted hover:text-fg hover:bg-bg-hover"
                )}
                title="Toggle Wizard Help"
                aria-label="Toggle Wizard Help"
                aria-pressed={showHelp}
              >
                <HelpCircle size={14} />
              </button>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={wizardPage === 1}
                  onClick={() => setWizardPage(prevWizardStep(wizardPage, minimalMode))}
                  className="btn-ghost border border-border px-3.5 py-1 text-xs disabled:opacity-40"
                >
                  &lt; Back
                </button>
                <button
                  type="button"
                  disabled={!canGoNext}
                  onClick={() => setWizardPage(nextWizardStep(wizardPage, minimalMode))}
                  className={clsx(
                    finishIsPrimary ? "btn-ghost border border-border" : "btn-primary font-semibold",
                    "px-4 py-1 text-xs disabled:opacity-40"
                  )}
                >
                  Next &gt;
                </button>
                <button
                  type="button"
                  disabled={!canFinish}
                  onClick={() => void create()}
                  className={clsx(
                    finishIsPrimary ? "btn-primary font-semibold" : "btn-ghost border border-border",
                    "px-4 py-1 text-xs disabled:opacity-40"
                  )}
                >
                  Finish
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className="btn-ghost border border-border px-3.5 py-1 text-xs"
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
                      "flex items-center gap-2.5 px-3 py-2 rounded border text-[12px]",
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
                <span className="font-mono text-[12px] text-fg-muted">{fullLocation}</span>
              </div>
              <pre
                ref={logRef}
                className="rounded border border-border bg-bg p-3 h-52 overflow-auto font-mono text-[12px] whitespace-pre-wrap select-text"
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
