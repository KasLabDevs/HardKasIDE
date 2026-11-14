import clsx from "clsx";
import { Code2, File, FilePlus2, Folder, FolderPlus, Layers, ShieldCheck, Sparkles, TestTube2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useEngine } from "@/engine/context";
import { buildStarterContractCode, type StarterContractSpec } from "./silverTemplates";

export interface NewArtifactModalOptions {
  folder?: string;
  templateId?: string;
}

export const NEW_ARTIFACT_EVENT = "hardkas:new-artifact";

export function openNewArtifactWizard(options?: NewArtifactModalOptions): void {
  window.dispatchEvent(new CustomEvent<NewArtifactModalOptions>(NEW_ARTIFACT_EVENT, { detail: options ?? {} }));
}

export type CategoryId = "silverscript" | "typescript" | "general";

export interface WizardTemplate {
  id: string;
  category: CategoryId;
  label: string;
  shortLabel: string;
  badge: string;
  badgeTone: "green" | "teal" | "purple" | "amber" | "blue" | "gold" | "sky" | "slate";
  defaultFolder: string;
  ext: string;
  defaultClass: string;
  description: string;
  supportsFanout?: boolean;
  buildContent: (className: string, fanoutCount: number) => string;
}

/** Eclipse-style circular / pill badge (C = Class, I = Interface, E = Enum, R = Record, S = SilverScript, 1:N = Covenant). */
export function EclipseTypeBadge({ text, tone }: { text: string; tone: WizardTemplate["badgeTone"] }) {
  if (text === "FILE") return <File size={13} className="text-fg-muted shrink-0" />;
  if (text === "DIR") return <Folder size={13} className="text-warn shrink-0" />;
  const toneClass: Record<WizardTemplate["badgeTone"], string> = {
    green: "bg-emerald-500/20 text-emerald-300 border-emerald-400/40",
    teal: "bg-teal-500/20 text-teal-300 border-teal-400/40",
    purple: "bg-purple-500/20 text-purple-300 border-purple-400/40",
    amber: "bg-amber-500/20 text-amber-300 border-amber-400/40",
    blue: "bg-blue-500/20 text-blue-300 border-blue-400/40",
    gold: "bg-yellow-500/20 text-yellow-300 border-yellow-400/40",
    sky: "bg-sky-500/20 text-sky-300 border-sky-400/40",
    slate: "bg-slate-500/20 text-slate-300 border-slate-400/40"
  };
  const isSingleChar = text.length === 1;
  return (
    <span
      className={clsx(
        "inline-flex items-center justify-center font-mono font-bold border leading-none shrink-0 select-none",
        isSingleChar ? "w-4 h-4 rounded-full text-[12px]" : "h-4 px-1 rounded text-[12px]",
        toneClass[tone]
      )}
    >
      {text}
    </span>
  );
}

export function toPascalCase(raw: string, fallback = "MyContract"): string {
  const cleaned = raw
    .replace(/\.[^.]+$/, "")
    .replace(/[^A-Za-z0-9_]+/g, " ")
    .trim();
  if (!cleaned) return fallback;
  const pascal = cleaned
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join("");
  return /^[A-Za-z]/.test(pascal) ? pascal : `Contract${pascal}`;
}

export function toFileStem(raw: string, fallback = "MyContract"): string {
  const cleaned = raw
    .replace(/\.[^.]+$/, "")
    .replace(/[^A-Za-z0-9_-]+/g, "")
    .trim();
  return cleaned || fallback;
}

/** The same starter contracts as the New Project wizard (compiled with the pinned silverc by scripts/check-templates.mjs). */
function starter(kind: StarterContractSpec["kind"], className: string, fanout?: number): string {
  return buildStarterContractCode({ kind, className, fanout }, className)?.code ?? "";
}

export const WIZARD_TEMPLATES: readonly WizardTemplate[] = [
  {
    id: "silver-basic",
    category: "silverscript",
    label: "SilverScript Contract (Basic Guard)",
    shortLabel: "SilverScript Contract",
    badge: "S",
    badgeTone: "green",
    defaultFolder: "contracts",
    ext: ".sil",
    defaultClass: "VaultGuard",
    description: "Clean SilverScript contract skeleton with constructor parameters and an entry point.",
    buildContent: (className) => starter("silver-basic", className)
  },
  {
    id: "covenant-1-n",
    category: "silverscript",
    label: "Covenant 1:N (Multi-Output Splitter)",
    shortLabel: "Covenant 1:N (Splitter)",
    badge: "1:N",
    badgeTone: "teal",
    defaultFolder: "contracts",
    ext: ".sil",
    defaultClass: "PaymentSplitter",
    supportsFanout: true,
    description: "The spend must use this UTXO as its only input and pay each of N recipient scriptPubKeys (tx.outputs[0..N-1]) at least a share.",
    buildContent: (className, n) => starter("covenant-1-n", className, n)
  },
  {
    id: "covenant-1-1",
    category: "silverscript",
    label: "Covenant 1:1 (Recursive Stateful Vault)",
    shortLabel: "Covenant 1:1 (Vault)",
    badge: "1:1",
    badgeTone: "sky",
    defaultFolder: "contracts",
    ext: ".sil",
    defaultClass: "StatefulVault",
    description: "Recursive vault: a partial withdrawal must send output[0] back to this same contract (same scriptPubKey) with the rest of the balance.",
    buildContent: (className) => starter("covenant-1-1", className)
  },
  {
    id: "covenant-escrow",
    category: "silverscript",
    label: "Covenant Escrow 2-of-3 (Buyer / Seller / Arbiter)",
    shortLabel: "Escrow 2-of-3 Covenant",
    badge: "E",
    badgeTone: "amber",
    defaultFolder: "contracts",
    ext: ".sil",
    defaultClass: "OrderEscrow",
    description: "2-of-3 escrow: every spend path needs two of buyer, seller and arbiter, and output[0] must pay the agreed scriptPubKey.",
    buildContent: (className) => starter("covenant-escrow", className)
  },
  {
    id: "covenant-timelock",
    category: "silverscript",
    label: "Covenant Timelock / Vesting Vault",
    shortLabel: "Timelock Covenant",
    badge: "T",
    badgeTone: "blue",
    defaultFolder: "contracts",
    ext: ".sil",
    defaultClass: "VestingVault",
    description: "Time-locked vault: claim needs the beneficiary's signature, tx.time >= unlockTime and output[0] paying the beneficiary's scriptPubKey.",
    buildContent: (className) => starter("covenant-timelock", className)
  },
  {
    id: "ts-class",
    category: "typescript",
    label: "Class (TypeScript Service / Workflow)",
    shortLabel: "Class",
    badge: "C",
    badgeTone: "green",
    defaultFolder: "scripts",
    ext: ".ts",
    defaultClass: "PaymentService",
    description: "TypeScript class with typed constructor and async execution method.",
    buildContent: (className) => `/**
 * ${className}
 */
export class ${className} {
  constructor(public readonly network: "simulated" | "simnet" | "testnet-10" = "simnet") {}

  async run(): Promise<void> {
    console.log(\`[${className}] active on \${this.network}\`);
  }
}
`
  },
  {
    id: "ts-interface",
    category: "typescript",
    label: "Interface (TypeScript Contract / Model)",
    shortLabel: "Interface",
    badge: "I",
    badgeTone: "purple",
    defaultFolder: "scripts",
    ext: ".ts",
    defaultClass: "IPaymentOrder",
    description: "TypeScript interface definition for domain models or service contracts.",
    buildContent: (className) => `/**
 * ${className} interface
 */
export interface ${className} {
  readonly id: string;
  readonly senderAddress: string;
  readonly recipientAddress: string;
  readonly amountSompi: bigint;
  readonly createdAt: string;
}
`
  },
  {
    id: "ts-enum",
    category: "typescript",
    label: "Enum (TypeScript Enumeration)",
    shortLabel: "Enum",
    badge: "E",
    badgeTone: "amber",
    defaultFolder: "scripts",
    ext: ".ts",
    defaultClass: "SettlementStatus",
    description: "TypeScript string enumeration for workflow states or transaction kinds.",
    buildContent: (className) => `/**
 * ${className} enumeration
 */
export enum ${className} {
  Pending = "PENDING",
  Planned = "PLANNED",
  Signed = "SIGNED",
  Broadcast = "BROADCAST",
  Confirmed = "CONFIRMED",
  Failed = "FAILED"
}
`
  },
  {
    id: "ts-record",
    category: "typescript",
    label: "Record (Immutable Value / Artifact DTO)",
    shortLabel: "Record",
    badge: "R",
    badgeTone: "gold",
    defaultFolder: "scripts",
    ext: ".ts",
    defaultClass: "SettlementReceipt",
    description: "Immutable TypeScript record type and factory helper.",
    buildContent: (className) => `/**
 * ${className} immutable record
 */
export interface ${className} {
  readonly schema: "hardkas.custom.${className}.v1";
  readonly txId: string;
  readonly amountSompi: string;
  readonly timestamp: string;
}

export function create${className}(init: Omit<${className}, "schema" | "timestamp">): ${className} {
  return Object.freeze({
    schema: "hardkas.custom.${className}.v1",
    ...init,
    timestamp: new Date().toISOString()
  });
}
`
  },
  {
    id: "ts-contract-test",
    category: "typescript",
    label: "Contract Test Suite (Vitest)",
    shortLabel: "Test Suite",
    badge: "T",
    badgeTone: "teal",
    defaultFolder: "test",
    ext: ".test.ts",
    defaultClass: "PaymentSplitter",
    description: "Vitest test suite that compiles and verifies a SilverScript contract.",
    buildContent: (className) => `import { describe, expect, it } from "vitest";
import { execSync } from "node:child_process";

describe("${className} contract", () => {
  it("compiles contracts/${className}.sil cleanly", () => {
    const out = execSync("npx hardkas silver compile contracts/${className}.sil --json", {
      encoding: "utf8"
    });
    const parsed = JSON.parse(out) as { contractName?: string };
    expect(parsed.contractName ?? "${className}").toContain("${className}");
  });
});
`
  },
  {
    id: "sql-file",
    category: "typescript",
    label: "SQL File (HardKas Index / Query Store)",
    shortLabel: "SQL File",
    badge: "SQL",
    badgeTone: "sky",
    defaultFolder: "queries",
    ext: ".sql",
    defaultClass: "recent_settlements",
    description: "SQL query file for inspecting HardKas query-store artifacts, UTXOs, and events.",
    buildContent: (className) => `-- ${className}.sql — HardKas Index Query
SELECT
  id,
  kind,
  network_id,
  created_at
FROM artifacts
ORDER BY created_at DESC
LIMIT 50;
`
  },
  {
    id: "empty-file",
    category: "general",
    label: "File (Empty)",
    shortLabel: "File",
    badge: "FILE",
    badgeTone: "slate",
    defaultFolder: "",
    ext: ".ts",
    defaultClass: "untitled",
    description: "Create a blank file in the selected directory.",
    buildContent: () => ""
  },
  {
    id: "folder",
    category: "general",
    label: "Folder (Directory)",
    shortLabel: "Folder",
    badge: "DIR",
    badgeTone: "amber",
    defaultFolder: "",
    ext: "",
    defaultClass: "new-folder",
    description: "Create a new directory in the selected path.",
    buildContent: () => ""
  }
];

const CATEGORIES: Array<{ id: CategoryId; label: string; icon: React.ReactNode }> = [
  { id: "silverscript", label: "SilverScript & Covenants", icon: <ShieldCheck size={13} className="text-accent" /> },
  { id: "typescript", label: "Classes, Types, Tests & SQL", icon: <TestTube2 size={13} className="text-accent" /> },
  { id: "general", label: "General (File / Folder)", icon: <FolderPlus size={13} className="text-fg-muted" /> }
];

export function NewArtifactDialog() {
  const engine = useEngine();
  const [open, setOpen] = useState(false);
  const [templateId, setTemplateId] = useState<string>("covenant-1-n");
  const [classNameInput, setClassNameInput] = useState<string>("PaymentSplitter");
  const [folderOverride, setFolderOverride] = useState<string | null>(null);
  const [customPath, setCustomPath] = useState<string>("");
  const [pathTouched, setPathTouched] = useState<boolean>(false);
  const [fanoutCount, setFanoutCount] = useState<number>(3);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onOpen = (e: Event) => {
      const detail = (e as CustomEvent<NewArtifactModalOptions>).detail ?? {};
      const initialTpl = WIZARD_TEMPLATES.find((t) => t.id === detail.templateId) ?? WIZARD_TEMPLATES[0];
      setTemplateId(initialTpl.id);
      setClassNameInput(initialTpl.defaultClass);
      setFolderOverride(detail.folder !== undefined ? detail.folder : null);
      setPathTouched(false);
      setError(null);
      setOpen(true);
    };
    window.addEventListener(NEW_ARTIFACT_EVENT, onOpen);
    return () => window.removeEventListener(NEW_ARTIFACT_EVENT, onOpen);
  }, []);

  const activeTemplate = useMemo(
    () => WIZARD_TEMPLATES.find((t) => t.id === templateId) ?? WIZARD_TEMPLATES[0],
    [templateId]
  );

  const pascalClass = useMemo(
    () => toPascalCase(classNameInput, activeTemplate.defaultClass),
    [classNameInput, activeTemplate.defaultClass]
  );

  const computedPath = useMemo(() => {
    const baseFolder = folderOverride !== null ? folderOverride : activeTemplate.defaultFolder;
    const stem =
      activeTemplate.category === "general" || activeTemplate.id === "sql-file"
        ? classNameInput.trim() || activeTemplate.defaultClass
        : toFileStem(classNameInput, activeTemplate.defaultClass);
    const fileName = stem.endsWith(activeTemplate.ext) || !activeTemplate.ext ? stem : `${stem}${activeTemplate.ext}`;
    return baseFolder ? `${baseFolder.replace(/\/+$/, "")}/${fileName}` : fileName;
  }, [folderOverride, activeTemplate, classNameInput]);

  const targetPath = pathTouched ? customPath : computedPath;

  const previewCode = useMemo(
    () => activeTemplate.buildContent(pascalClass, fanoutCount),
    [activeTemplate, pascalClass, fanoutCount]
  );

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, busy]);

  if (!open) return null;

  const selectTemplate = (tpl: WizardTemplate) => {
    setTemplateId(tpl.id);
    setClassNameInput(tpl.defaultClass);
    setPathTouched(false);
    setError(null);
  };

  const create = async () => {
    const finalPath = targetPath.trim();
    if (!finalPath) return;
    setBusy(true);
    setError(null);
    try {
      if (activeTemplate.id === "folder") {
        await engine.call("fileManager", "mkdir", finalPath);
      } else {
        await engine.call("fileManager", "createFile", finalPath, previewCode);
      }
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      role="presentation"
      className="fixed inset-0 z-50 bg-black/65 backdrop-blur-[1px] flex items-center justify-center p-6"
      onClick={busy ? undefined : () => setOpen(false)}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-artifact-wizard-title"
        className="w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden rounded-lg border border-border bg-bg-elev shadow-2xl text-xs"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between px-5 py-3 border-b border-border bg-bg-panel shrink-0">
          <div className="flex items-center gap-2">
            <Sparkles size={15} className="text-accent" />
            <h2 id="new-artifact-wizard-title" className="text-sm font-semibold text-fg">
              New — Select a Wizard
            </h2>
            {folderOverride !== null && folderOverride !== "" && (
              <span className="text-[12px] font-mono px-2 py-0.5 rounded bg-bg border border-border text-accent">
                in {folderOverride}/
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            disabled={busy}
            className="text-fg-muted hover:text-fg cursor-pointer"
            aria-label="Close wizard"
          >
            <X size={16} />
          </button>
        </header>

        <div className="p-5 grid grid-cols-1 md:grid-cols-12 gap-5 overflow-auto flex-1 min-h-0">
          {/* Left column: Eclipse-style Wizard Tree */}
          <div className="md:col-span-5 flex flex-col gap-3 min-h-0 overflow-auto pr-1">
            <div className="label flex items-center gap-1.5">
              <Layers size={12} className="text-accent" /> Wizards
            </div>
            {CATEGORIES.map((cat) => {
              const items = WIZARD_TEMPLATES.filter((t) => t.category === cat.id);
              return (
                <div key={cat.id} className="space-y-1">
                  <div className="flex items-center gap-1.5 text-[12px] font-semibold text-fg-muted px-1">
                    {cat.icon}
                    <span>{cat.label}</span>
                  </div>
                  <div className="grid gap-1">
                    {items.map((tpl) => (
                      <button
                        key={tpl.id}
                        type="button"
                        aria-pressed={templateId === tpl.id}
                        onClick={() => selectTemplate(tpl)}
                        className={clsx(
                          "text-left rounded border px-2.5 py-1.5 transition-colors cursor-pointer",
                          templateId === tpl.id
                            ? "border-accent bg-accent/10 text-fg"
                            : "border-border bg-bg-panel hover:bg-bg-hover text-fg"
                        )}
                      >
                        <div className="flex items-center gap-2">
                          <EclipseTypeBadge text={tpl.badge} tone={tpl.badgeTone} />
                          <span className="font-medium truncate flex-1">{tpl.label}</span>
                        </div>
                        <div className="text-[12px] text-fg-muted mt-0.5 pl-6 line-clamp-1">{tpl.description}</div>
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Right column: Class Name, Covenant 1:N options, Target Path & Live Code Preview */}
          <div className="md:col-span-7 flex flex-col gap-3 min-h-0">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label htmlFor="wizard-class-name" className="label">
                  {activeTemplate.category === "general" || activeTemplate.id === "sql-file" ? "Name" : "Type / Contract Name"}
                </label>
                <input
                  id="wizard-class-name"
                  autoFocus
                  className="input font-mono"
                  value={classNameInput}
                  onChange={(e) => setClassNameInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && void create()}
                  placeholder="e.g. PaymentSplitter"
                />
                {activeTemplate.category !== "general" && activeTemplate.id !== "sql-file" && (
                  <div className="text-[12px] text-fg-muted mt-0.5">
                    Identifier: <code className="text-accent">{pascalClass}</code>
                  </div>
                )}
              </div>

              <div>
                <label htmlFor="wizard-target-path" className="label">
                  Destination Path
                </label>
                <input
                  id="wizard-target-path"
                  className="input font-mono"
                  value={targetPath}
                  onChange={(e) => {
                    setPathTouched(true);
                    setCustomPath(e.target.value);
                  }}
                  onKeyDown={(e) => e.key === "Enter" && void create()}
                />
                <div className="text-[12px] text-fg-muted mt-0.5">
                  {folderOverride ? `Inside directory '${folderOverride}/'` : "Relative to project root"}
                </div>
              </div>
            </div>

            {activeTemplate.supportsFanout && (
              <div className="rounded border border-accent/30 bg-accent/5 p-2.5 flex items-center justify-between gap-3">
                <div>
                  <div className="font-medium text-fg">Covenant 1:N Output Ratio</div>
                  <div className="text-[12px] text-fg-muted">
                    Number of recipient outputs (<code>tx.outputs[0..N-1]</code>) enforced by the covenant.
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {[2, 3, 4, 5].map((n) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => setFanoutCount(n)}
                      className={clsx(
                        "px-2.5 py-1 rounded font-mono text-xs border cursor-pointer transition-colors",
                        fanoutCount === n
                          ? "border-accent bg-accent text-bg font-semibold"
                          : "border-border bg-bg-panel text-fg hover:bg-bg-hover"
                      )}
                    >
                      1:{n}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {activeTemplate.id !== "folder" && (
              <div className="flex-1 flex flex-col min-h-0">
                <div className="label flex items-center justify-between mb-1">
                  <span className="flex items-center gap-1.5">
                    <Code2 size={12} className="text-accent" /> Generated Source Preview ({targetPath})
                  </span>
                  <span className="text-[12px] font-mono text-fg-muted">{previewCode.split("\n").length} lines</span>
                </div>
                <pre className="rounded border border-border bg-bg p-3 flex-1 min-h-48 max-h-64 overflow-auto font-mono text-[12px] text-fg leading-relaxed">
                  {previewCode || "// Empty file"}
                </pre>
              </div>
            )}

            {error && (
              <div role="alert" className="text-error text-xs break-words">
                {error}
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-1 border-t border-border">
              <button type="button" className="btn-ghost px-4 py-1.5" onClick={() => setOpen(false)}>
                Cancel
              </button>
              <button
                type="button"
                className="btn-primary px-5 py-1.5"
                disabled={busy || !targetPath.trim()}
                onClick={() => void create()}
              >
                <FilePlus2 size={13} />
                {busy ? "Creating…" : activeTemplate.id === "folder" ? "Create Folder" : `Finish (${targetPath.split("/").pop()})`}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
