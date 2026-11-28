import type { FrontendStackOption } from "@/api/client";

export type StarterKind = "covenant-1-n" | "covenant-1-1" | "covenant-escrow" | "covenant-timelock" | "silver-basic" | "none";

export type WizardStep = 1 | 2 | 3;

export interface StarterContractOption {
  id: StarterKind;
  label: string;
  badge: string;
  defaultClass: string;
  description: string;
  supportsFanout?: boolean;
}

export const STARTER_CONTRACTS: readonly StarterContractOption[] = [
  {
    id: "covenant-1-n",
    label: "Covenant 1:N (Multi-Output Splitter)",
    badge: "Covenant 1:N",
    defaultClass: "PaymentSplitter",
    supportsFanout: true,
    description: "The spend must use this UTXO as its only input and pay each of N recipient scriptPubKeys (tx.outputs[0..N-1]) at least a share."
  },
  {
    id: "covenant-1-1",
    label: "Covenant 1:1 (Recursive Stateful Vault)",
    badge: "Covenant 1:1",
    defaultClass: "StatefulVault",
    description: "Recursive vault: a partial withdrawal must send output[0] back to this same contract (same scriptPubKey) with the rest of the balance."
  },
  {
    id: "covenant-escrow",
    label: "Covenant Escrow 2-of-3 (Buyer / Seller / Arbiter)",
    badge: "Escrow",
    defaultClass: "OrderEscrow",
    description: "2-of-3 escrow: every spend path needs two of buyer, seller and arbiter, and output[0] must pay the agreed scriptPubKey."
  },
  {
    id: "covenant-timelock",
    label: "Covenant Timelock / Vesting Vault",
    badge: "Timelock",
    defaultClass: "VestingVault",
    description: "Time-locked vault: claim needs the beneficiary's signature, tx.time >= unlockTime and output[0] paying the beneficiary's scriptPubKey."
  },
  {
    id: "silver-basic",
    label: "Basic SilverScript Contract",
    badge: "SilverScript",
    defaultClass: "VaultGuard",
    description: "Clean signature-guarded SilverScript contract skeleton."
  },
  {
    id: "none",
    label: "Empty Workspace (no starter contract)",
    badge: "Minimal",
    defaultClass: "",
    description: "Scaffolds hardkas.config.ts, package.json, contracts/, scripts/ and test/ without generating a starter .sil file."
  }
];

export const DEFAULT_FRONTENDS: FrontendStackOption[] = [
  { id: "none", label: "No frontend (Contracts & SDK only)", language: "TypeScript + SilverScript", framework: "None", description: "Pure HardKas workspace with SilverScript contracts, scripts and tests." },
  { id: "react-ts", label: "React + TypeScript (Vite)", language: "TypeScript (TSX)", framework: "React 19", description: "Vite + React + TypeScript dApp in dapp/ wired to KasWare Wallet and HardKas." },
  { id: "vue-ts", label: "Vue 3 + TypeScript (Vite)", language: "TypeScript (Vue SFC)", framework: "Vue 3", description: "Vite + Vue 3 Composition API + TypeScript dApp in dapp/." },
  { id: "svelte-ts", label: "Svelte + TypeScript (Vite)", language: "TypeScript (Svelte)", framework: "Svelte 5", description: "Vite + Svelte + TypeScript reactive dApp in dapp/." },
  { id: "nextjs", label: "Next.js (App Router · TypeScript)", language: "TypeScript (TSX)", framework: "Next.js 15", description: "Next.js App Router frontend in dapp/ with TypeScript." },
  { id: "vanilla-ts", label: "Vanilla TypeScript (Vite)", language: "TypeScript", framework: "Vanilla TS", description: "Lightweight Vite + TypeScript + HTML/CSS frontend in dapp/." },
  { id: "vanilla-js", label: "Vanilla JavaScript (ES Modules)", language: "JavaScript", framework: "Vanilla JS", description: "Zero-build HTML/CSS/JS dApp in dapp/ served directly by HardKas IDE." }
];

export interface WizardStepMeta {
  id: WizardStep;
  shortLabel: string;
  title: string;
  subtitle: string;
}

export const WIZARD_STEPS: readonly WizardStepMeta[] = [
  {
    id: 1,
    shortLabel: "Location",
    title: "Project Name & Location",
    subtitle: "Choose a workspace name, folder and compiler target."
  },
  {
    id: 2,
    shortLabel: "Blueprint",
    title: "Select a Covenant Blueprint",
    subtitle: "Choose a starter SilverScript archetype or an empty workspace."
  },
  {
    id: 3,
    shortLabel: "Setup",
    title: "Structure, dApp & Summary",
    subtitle: "Pick frontend layout, dependency install and confirm generated files."
  }
];

/**
 * Joins a folder the server reported with a child name, in that folder's own style: a Windows path (`C:\…` or one with
 * backslashes) gets `\`, a macOS / Linux path gets `/`.
 */
export function joinPath(parent: string, child: string): string {
  const windows = /^[A-Za-z]:/.test(parent) || (parent.includes("\\") && !parent.startsWith("/"));
  return `${parent.replace(/[\\/]+$/, "")}${windows ? "\\" : "/"}${child}`;
}

/** Filters starter contract blueprints case-insensitively across label, badge, class name, and description. */
export function filterBlueprints(query: string, options: readonly StarterContractOption[] = STARTER_CONTRACTS): StarterContractOption[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...options];
  return options.filter(
    (item) =>
      item.label.toLowerCase().includes(q) ||
      item.badge.toLowerCase().includes(q) ||
      item.defaultClass.toLowerCase().includes(q) ||
      item.description.toLowerCase().includes(q)
  );
}

/** Advances to the next wizard step, skipping Blueprint selection when minimal project mode is enabled. */
export function nextWizardStep(current: WizardStep, minimalMode: boolean): WizardStep {
  if (current === 1) return minimalMode ? 3 : 2;
  if (current === 2) return 3;
  return 3;
}

/** Steps backwards in the wizard, returning directly from Setup to Location when minimal mode is active. */
export function prevWizardStep(current: WizardStep, minimalMode: boolean): WizardStep {
  if (current === 3) return minimalMode ? 1 : 2;
  if (current === 2) return 1;
  return 1;
}
