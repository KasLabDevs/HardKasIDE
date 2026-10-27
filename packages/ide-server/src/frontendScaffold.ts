import { promises as fs } from "node:fs";
import path from "node:path";
import { HARDKAS_CLI_VERSION } from "./runner.js";

export type FrontendStackId =
  | "none"
  | "react-ts"
  | "vue-ts"
  | "svelte-ts"
  | "nextjs"
  | "vanilla-ts"
  | "vanilla-js";

export interface FrontendStackOption {
  id: FrontendStackId;
  label: string;
  language: string;
  framework: string;
  description: string;
}

export const FRONTEND_STACKS: readonly FrontendStackOption[] = [
  {
    id: "none",
    label: "No frontend (Contracts & SDK only)",
    language: "TypeScript + SilverScript",
    framework: "None",
    description: "Pure HardKas workspace with SilverScript contracts, scripts and tests."
  },
  {
    id: "react-ts",
    label: "React + TypeScript (Vite)",
    language: "TypeScript (TSX)",
    framework: "React 19",
    description: "Vite + React + TypeScript dApp in dapp/ wired to KasWare Wallet and HardKas."
  },
  {
    id: "vue-ts",
    label: "Vue 3 + TypeScript (Vite)",
    language: "TypeScript (Vue SFC)",
    framework: "Vue 3",
    description: "Vite + Vue 3 Composition API + TypeScript dApp in dapp/."
  },
  {
    id: "svelte-ts",
    label: "Svelte + TypeScript (Vite)",
    language: "TypeScript (Svelte)",
    framework: "Svelte 5",
    description: "Vite + Svelte + TypeScript reactive dApp in dapp/."
  },
  {
    id: "nextjs",
    label: "Next.js (App Router · TypeScript)",
    language: "TypeScript (TSX)",
    framework: "Next.js 15",
    description: "Next.js App Router frontend in dapp/ with TypeScript."
  },
  {
    id: "vanilla-ts",
    label: "Vanilla TypeScript (Vite)",
    language: "TypeScript",
    framework: "Vanilla TS",
    description: "Lightweight Vite + TypeScript + HTML/CSS frontend in dapp/."
  },
  {
    id: "vanilla-js",
    label: "Vanilla JavaScript (ES Modules)",
    language: "JavaScript",
    framework: "Vanilla JS",
    description: "Zero-build HTML/CSS/JS dApp in dapp/ served directly by HardKas IDE."
  }
] as const;

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

const SHARED_CSS = `:root {
  color-scheme: dark;
  --bg: #0b0f17;
  --panel: #111827;
  --border: #1f2937;
  --fg: #f3f4f6;
  --muted: #9ca3af;
  --accent: #49eacb;
}
* { box-sizing: border-box; }
body {
  margin: 0;
  font-family: ui-sans-serif, system-ui, -apple-system, sans-serif;
  background: var(--bg);
  color: var(--fg);
  padding: 2rem;
}
.card {
  max-width: 680px;
  margin: 0 auto;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 1.5rem;
}
.badge {
  display: inline-block;
  padding: 0.2rem 0.6rem;
  border-radius: 999px;
  font-size: 0.75rem;
  background: rgba(73, 234, 203, 0.12);
  color: var(--accent);
  border: 1px solid rgba(73, 234, 203, 0.3);
}
button {
  background: var(--accent);
  color: #041311;
  font-weight: 600;
  border: none;
  border-radius: 8px;
  padding: 0.6rem 1rem;
  cursor: pointer;
}
button:hover { opacity: 0.92; }
pre, code {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 0.85rem;
}
.row {
  display: flex;
  justify-content: space-between;
  padding: 0.5rem 0;
  border-bottom: 1px solid var(--border);
}
`;

export interface StarterContractSpec {
  kind: "none" | "silver-basic" | "covenant-1-n" | "covenant-1-1" | "covenant-escrow" | "covenant-timelock";
  className?: string;
  fanout?: number;
}

function buildStarterContractCode(spec: StarterContractSpec, projectName: string): { fileName: string; code: string } | null {
  if (spec.kind === "none") return null;
  const rawName = (spec.className ?? "").replace(/\.[^.]+$/, "").replace(/[^A-Za-z0-9_]/g, "");
  const className = rawName && /^[A-Za-z]/.test(rawName) ? rawName.charAt(0).toUpperCase() + rawName.slice(1) : "MainContract";
  const fileName = `${className}.sil`;

  if (spec.kind === "covenant-1-n") {
    const count = Math.min(Math.max(spec.fanout ?? 3, 2), 6);
    const lockParams = Array.from({ length: count }, (_, i) => `  bytes recipient${i + 1}Lock`).join(",\n");
    const checks = Array.from(
      { length: count },
      (_, i) =>
        `    require(tx.outputs[${i}].lockingBytecode == recipient${i + 1}Lock);\n` +
        `    require(tx.outputs[${i}].value >= shareSompi);`
    ).join("\n\n");
    return {
      fileName,
      code: `pragma silverscript ^0.1.0;

/**
 * @title ${className} (Covenant 1:${count})
 * Splits 1 input UTXO across ${count} recipient outputs.
 */
contract ${className}(
  pubkey operator,
${lockParams},
  int shareSompi
) {
  entry distribute(sig operatorSig) {
    require(checkSig(operatorSig, operator));

${checks}
  }

  entry cancel(sig operatorSig) {
    require(checkSig(operatorSig, operator));
  }
}
`
    };
  }

  if (spec.kind === "covenant-1-1") {
    return {
      fileName,
      code: `pragma silverscript ^0.1.0;

/**
 * @title ${className} (Covenant 1:1)
 * Stateful vault that enforces output[0] recreates this covenant with the remaining balance.
 */
contract ${className}(
  pubkey owner,
  pubkey guardian,
  int maxWithdrawSompi
) {
  entry withdrawPartial(sig ownerSig, int withdrawSompi) {
    require(checkSig(ownerSig, owner));
    require(withdrawSompi > 0);
    require(withdrawSompi <= maxWithdrawSompi);

    bytes selfLock = tx.inputs[this.activeInputIndex].lockingBytecode;
    int currentBalance = tx.inputs[this.activeInputIndex].value;

    require(tx.outputs[0].lockingBytecode == selfLock);
    require(tx.outputs[0].value >= currentBalance - withdrawSompi);
  }

  entry emergencySweep(sig ownerSig, sig guardianSig) {
    require(checkSig(ownerSig, owner));
    require(checkSig(guardianSig, guardian));
  }
}
`
    };
  }

  if (spec.kind === "covenant-escrow") {
    return {
      fileName,
      code: `pragma silverscript ^0.1.0;

/**
 * @title ${className} (2-of-3 Escrow Covenant)
 */
contract ${className}(
  pubkey buyer,
  pubkey seller,
  pubkey arbiter,
  bytes sellerLock,
  bytes buyerLock,
  int amountSompi
) {
  entry releaseToSeller(sig buyerSig) {
    require(checkSig(buyerSig, buyer));
    require(tx.outputs[0].lockingBytecode == sellerLock);
    require(tx.outputs[0].value >= amountSompi);
  }

  entry refundToBuyer(sig sellerSig) {
    require(checkSig(sellerSig, seller));
    require(tx.outputs[0].lockingBytecode == buyerLock);
    require(tx.outputs[0].value >= amountSompi);
  }

  entry arbitrateSeller(sig arbiterSig, sig sellerSig) {
    require(checkSig(arbiterSig, arbiter));
    require(checkSig(sellerSig, seller));
    require(tx.outputs[0].lockingBytecode == sellerLock);
    require(tx.outputs[0].value >= amountSompi);
  }
}
`
    };
  }

  if (spec.kind === "covenant-timelock") {
    return {
      fileName,
      code: `pragma silverscript ^0.1.0;

/**
 * @title ${className} (Timelock Vesting Covenant)
 */
contract ${className}(
  pubkey beneficiary,
  pubkey grantor,
  bytes beneficiaryLock,
  int unlockTime,
  int vestAmountSompi
) {
  entry claim(sig beneficiarySig) {
    require(checkSig(beneficiarySig, beneficiary));
    require(tx.time >= unlockTime);
    require(tx.outputs[0].lockingBytecode == beneficiaryLock);
    require(tx.outputs[0].value >= vestAmountSompi);
  }

  entry revoke(sig grantorSig, sig beneficiarySig) {
    require(checkSig(grantorSig, grantor));
    require(checkSig(beneficiarySig, beneficiary));
  }
}
`
    };
  }

  return {
    fileName,
    code: `pragma silverscript ^0.1.0;

// Starter contract for ${projectName}
contract ${className}(pubkey owner) {
  entry spend(sig ownerSig) {
    require(checkSig(ownerSig, owner));
  }
}
`
  };
}

export function buildDefaultHardkasConfig(): string {
  return `import { defineHardkasConfig } from "@hardkas/sdk";

export default defineHardkasConfig({
  // HardKAS v${HARDKAS_CLI_VERSION} Configuration
  execution: {
    default: "simulator",
    targets: {
      simulator: {
        mode: "simulator",
        domain: "kaspa-l1",
        network: "simulated"
      },
      localnet: {
        mode: "localnet",
        domain: "kaspa-l1",
        network: "simnet"
      }
    }
  },

  // Strict execution policy
  network: {
    allowPublic: false
  },
  artifacts: {
    deterministic: true
  },
  experimental: false,

  networks: {
    simulated: {
      kind: "simulated",
      description: "Pure local simulation — no Docker, no RPC, no node"
    },

    simnet: {
      kind: "kaspa-node",
      network: "simnet",
      rpcUrl: "ws://127.0.0.1:18210",
      description: "Local Docker kaspad on simnet — requires hardkas node start"
    }
  }
});
`;
}

export async function ensureHardkasConfig(dest: string, onLog?: (msg: string) => void): Promise<boolean> {
  const candidates = ["hardkas.config.ts", "hardkas.config.mts", "hardkas.config.js", "hardkas.config.mjs"];
  for (const name of candidates) {
    if (await fileExists(path.join(dest, name))) {
      return false;
    }
  }
  await fs.writeFile(path.join(dest, "hardkas.config.ts"), buildDefaultHardkasConfig(), "utf8");
  onLog?.("Created hardkas.config.ts");
  return true;
}

/**
 * Ensures the root workspace has a complete package.json with @hardkas/* dependencies,
 * a hardkas.config.ts file, and the requested starter SilverScript contract under contracts/.
 */
export async function ensureWorkspaceBase(
  dest: string,
  projectName: string,
  frontend: FrontendStackId,
  onLog: (msg: string) => void,
  starterContract?: StarterContractSpec
): Promise<void> {
  const spec: StarterContractSpec = starterContract ?? { kind: "silver-basic", className: "Hello" };
  const builtContract = buildStarterContractCode(spec, projectName);

  await ensureHardkasConfig(dest, onLog);

  const pkgPath = path.join(dest, "package.json");
  let pkg: Record<string, unknown> = {};
  if (await fileExists(pkgPath)) {
    try {
      pkg = JSON.parse(await fs.readFile(pkgPath, "utf8")) as Record<string, unknown>;
    } catch {
      pkg = {};
    }
  }
  pkg.name = (pkg.name as string) || projectName.toLowerCase().replace(/[^a-z0-9._-]/g, "-");
  pkg.version = (pkg.version as string) || "0.1.0";
  pkg.private = true;
  pkg.type = (pkg.type as string) || "module";

  const scripts = (pkg.scripts as Record<string, string> | undefined) ?? {};
  scripts.test = scripts.test || "vitest run";
  if (builtContract) {
    scripts.compile = `hardkas silver compile contracts/${builtContract.fileName}`;
  }
  if (frontend !== "none" && frontend !== "vanilla-js") {
    scripts["dapp:dev"] = "npm --prefix dapp run dev";
    scripts["dapp:build"] = "npm --prefix dapp run build";
  }
  pkg.scripts = scripts;

  const devDeps = (pkg.devDependencies as Record<string, string> | undefined) ?? {};
  devDeps["@hardkas/cli"] = HARDKAS_CLI_VERSION;
  devDeps["@hardkas/testing"] = HARDKAS_CLI_VERSION;
  if (!devDeps.typescript) devDeps.typescript = "^5.8.3";
  if (!devDeps.vitest) devDeps.vitest = "^3.2.4";
  pkg.devDependencies = devDeps;

  const deps = (pkg.dependencies as Record<string, string> | undefined) ?? {};
  deps["@hardkas/sdk"] = HARDKAS_CLI_VERSION;
  pkg.dependencies = deps;

  await fs.writeFile(pkgPath, JSON.stringify(pkg, null, 2) + "\n", "utf8");

  const contractsDir = path.join(dest, "contracts");
  await fs.mkdir(contractsDir, { recursive: true });
  if (builtContract) {
    await fs.writeFile(path.join(contractsDir, builtContract.fileName), builtContract.code, "utf8");
    onLog(`Created starter contract contracts/${builtContract.fileName}`);
  }
}

export async function scaffoldFrontend(
  dest: string,
  projectName: string,
  frontend: FrontendStackId,
  onLog: (msg: string) => void
): Promise<{ needsInstall: boolean; dappDir: string | null }> {
  if (frontend === "none") {
    return { needsInstall: false, dappDir: null };
  }

  const dappDir = path.join(dest, "dapp");
  if (await fileExists(path.join(dappDir, "package.json"))) {
    onLog("Template already includes a dapp/ folder; keeping existing frontend files.");
    return { needsInstall: true, dappDir };
  }

  await fs.mkdir(dappDir, { recursive: true });

  if (frontend === "vanilla-js") {
    await fs.writeFile(path.join(dappDir, "styles.css"), SHARED_CSS, "utf8");
    await fs.writeFile(
      path.join(dappDir, "app.js"),
      `const statusEl = document.getElementById("wallet-status");
const addressEl = document.getElementById("wallet-address");
const networkEl = document.getElementById("wallet-network");
const connectBtn = document.getElementById("connect-btn");

connectBtn?.addEventListener("click", async () => {
  const kasware = window.kasware;
  if (!kasware) {
    statusEl.textContent = "KasWare extension not detected";
    return;
  }
  try {
    const accounts = await kasware.requestAccounts();
    const net = await kasware.getNetwork();
    statusEl.textContent = "Connected";
    addressEl.textContent = accounts[0] ?? "—";
    networkEl.textContent = net ?? "simnet";
  } catch (err) {
    statusEl.textContent = err instanceof Error ? err.message : String(err);
  }
});
`,
      "utf8"
    );
    await fs.writeFile(
      path.join(dappDir, "index.html"),
      `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${projectName} — Kaspa dApp</title>
    <link rel="stylesheet" href="./styles.css" />
  </head>
  <body>
    <main class="card">
      <span class="badge">Vanilla JS · Kaspa Simnet</span>
      <h1>${projectName}</h1>
      <p>Frontend wired for KasWare Wallet and your HardKas workspace.</p>
      <div class="row"><span>Status</span><code id="wallet-status">Disconnected</code></div>
      <div class="row"><span>Network</span><code id="wallet-network">simnet</code></div>
      <div class="row"><span>Address</span><code id="wallet-address">—</code></div>
      <div style="margin-top: 1.25rem">
        <button id="connect-btn" type="button">Connect KasWare Wallet</button>
      </div>
    </main>
    <script type="module" src="./app.js"></script>
  </body>
</html>
`,
      "utf8"
    );
    onLog("Scaffolded Vanilla JavaScript dApp in dapp/");
    return { needsInstall: false, dappDir };
  }

  if (frontend === "vanilla-ts") {
    await fs.mkdir(path.join(dappDir, "src"), { recursive: true });
    await fs.writeFile(
      path.join(dappDir, "package.json"),
      JSON.stringify(
        {
          name: `${projectName}-dapp`,
          private: true,
          version: "0.1.0",
          type: "module",
          scripts: {
            dev: "vite --port 5174",
            build: "tsc && vite build",
            preview: "vite preview"
          },
          devDependencies: {
            typescript: "^5.8.3",
            vite: "^6.3.5"
          }
        },
        null,
        2
      ) + "\n",
      "utf8"
    );
    await fs.writeFile(
      path.join(dappDir, "tsconfig.json"),
      JSON.stringify(
        {
          compilerOptions: {
            target: "ES2022",
            module: "ESNext",
            moduleResolution: "bundler",
            strict: true,
            noEmit: true,
            skipLibCheck: true
          },
          include: ["src"]
        },
        null,
        2
      ) + "\n",
      "utf8"
    );
    await fs.writeFile(path.join(dappDir, "src", "style.css"), SHARED_CSS, "utf8");
    await fs.writeFile(
      path.join(dappDir, "src", "main.ts"),
      `import "./style.css";

interface KasWareProvider {
  requestAccounts(): Promise<string[]>;
  getNetwork(): Promise<string>;
}

declare global {
  interface Window {
    kasware?: KasWareProvider;
  }
}

const app = document.querySelector<HTMLDivElement>("#app")!;
app.innerHTML = \`
  <main class="card">
    <span class="badge">Vanilla TypeScript · Vite</span>
    <h1>${projectName}</h1>
    <p>Kaspa dApp frontend generated by HardKas IDE.</p>
    <div class="row"><span>Status</span><code id="status">Disconnected</code></div>
    <div class="row"><span>Address</span><code id="address">—</code></div>
    <div style="margin-top: 1.25rem">
      <button id="connect" type="button">Connect KasWare</button>
    </div>
  </main>
\`;

document.querySelector<HTMLButtonElement>("#connect")?.addEventListener("click", async () => {
  const status = document.querySelector<HTMLElement>("#status")!;
  const address = document.querySelector<HTMLElement>("#address")!;
  if (!window.kasware) {
    status.textContent = "KasWare extension not installed";
    return;
  }
  const accounts = await window.kasware.requestAccounts();
  status.textContent = "Connected";
  address.textContent = accounts[0] ?? "—";
});
`,
      "utf8"
    );
    await fs.writeFile(
      path.join(dappDir, "index.html"),
      `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${projectName} — Kaspa dApp</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
`,
      "utf8"
    );
    onLog("Scaffolded Vanilla TypeScript (Vite) dApp in dapp/");
    return { needsInstall: true, dappDir };
  }

  if (frontend === "react-ts") {
    await fs.mkdir(path.join(dappDir, "src"), { recursive: true });
    await fs.writeFile(
      path.join(dappDir, "package.json"),
      JSON.stringify(
        {
          name: `${projectName}-dapp`,
          private: true,
          version: "0.1.0",
          type: "module",
          scripts: {
            dev: "vite --port 5174",
            build: "tsc && vite build",
            preview: "vite preview"
          },
          dependencies: {
            react: "^19.1.0",
            "react-dom": "^19.1.0"
          },
          devDependencies: {
            "@types/react": "^19.1.3",
            "@types/react-dom": "^19.1.3",
            "@vitejs/plugin-react": "^4.4.1",
            typescript: "^5.8.3",
            vite: "^6.3.5"
          }
        },
        null,
        2
      ) + "\n",
      "utf8"
    );
    await fs.writeFile(
      path.join(dappDir, "tsconfig.json"),
      JSON.stringify(
        {
          compilerOptions: {
            target: "ES2022",
            lib: ["ES2022", "DOM", "DOM.Iterable"],
            module: "ESNext",
            moduleResolution: "bundler",
            jsx: "react-jsx",
            strict: true,
            noEmit: true,
            skipLibCheck: true
          },
          include: ["src"]
        },
        null,
        2
      ) + "\n",
      "utf8"
    );
    await fs.writeFile(
      path.join(dappDir, "vite.config.ts"),
      `import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: { port: 5174 }
});
`,
      "utf8"
    );
    await fs.writeFile(path.join(dappDir, "src", "styles.css"), SHARED_CSS, "utf8");
    await fs.writeFile(
      path.join(dappDir, "src", "App.tsx"),
      `import { useState } from "react";

interface KasWare {
  requestAccounts(): Promise<string[]>;
  getNetwork(): Promise<string>;
}

declare global {
  interface Window {
    kasware?: KasWare;
  }
}

export function App() {
  const [address, setAddress] = useState<string | null>(null);
  const [network, setNetwork] = useState<string>("simnet");
  const [error, setError] = useState<string | null>(null);

  const connect = async () => {
    setError(null);
    if (!window.kasware) {
      setError("KasWare browser extension not detected.");
      return;
    }
    try {
      const accounts = await window.kasware.requestAccounts();
      const net = await window.kasware.getNetwork();
      setAddress(accounts[0] ?? null);
      setNetwork(net);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <main className="card">
      <span className="badge">React 19 + TypeScript · Kaspa</span>
      <h1>${projectName}</h1>
      <p>Connected to your HardKas SilverScript workspace.</p>
      <div className="row">
        <span>Network</span>
        <code>{network}</code>
      </div>
      <div className="row">
        <span>Wallet Address</span>
        <code>{address ?? "Not connected"}</code>
      </div>
      {error && <p style={{ color: "#f87171" }}>{error}</p>}
      <div style={{ marginTop: "1.25rem" }}>
        <button type="button" onClick={() => void connect()}>
          {address ? "Reconnect KasWare" : "Connect KasWare Wallet"}
        </button>
      </div>
    </main>
  );
}
`,
      "utf8"
    );
    await fs.writeFile(
      path.join(dappDir, "src", "main.tsx"),
      `import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
`,
      "utf8"
    );
    await fs.writeFile(
      path.join(dappDir, "index.html"),
      `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${projectName} — React Kaspa dApp</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
`,
      "utf8"
    );
    onLog("Scaffolded React + TypeScript (Vite) dApp in dapp/");
    return { needsInstall: true, dappDir };
  }

  if (frontend === "vue-ts") {
    await fs.mkdir(path.join(dappDir, "src"), { recursive: true });
    await fs.writeFile(
      path.join(dappDir, "package.json"),
      JSON.stringify(
        {
          name: `${projectName}-dapp`,
          private: true,
          version: "0.1.0",
          type: "module",
          scripts: {
            dev: "vite --port 5174",
            build: "vite build",
            preview: "vite preview"
          },
          dependencies: {
            vue: "^3.5.13"
          },
          devDependencies: {
            "@vitejs/plugin-vue": "^5.2.3",
            typescript: "^5.8.3",
            vite: "^6.3.5"
          }
        },
        null,
        2
      ) + "\n",
      "utf8"
    );
    await fs.writeFile(
      path.join(dappDir, "vite.config.ts"),
      `import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

export default defineConfig({
  plugins: [vue()],
  server: { port: 5174 }
});
`,
      "utf8"
    );
    await fs.writeFile(path.join(dappDir, "src", "style.css"), SHARED_CSS, "utf8");
    await fs.writeFile(
      path.join(dappDir, "src", "App.vue"),
      `<script setup lang="ts">
import { ref } from "vue";

const address = ref<string | null>(null);
const network = ref("simnet");
const error = ref<string | null>(null);

async function connect() {
  error.value = null;
  const kasware = (window as unknown as { kasware?: { requestAccounts(): Promise<string[]>; getNetwork(): Promise<string> } }).kasware;
  if (!kasware) {
    error.value = "KasWare extension not detected.";
    return;
  }
  try {
    const accounts = await kasware.requestAccounts();
    address.value = accounts[0] ?? null;
    network.value = await kasware.getNetwork();
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  }
}
</script>

<template>
  <main class="card">
    <span class="badge">Vue 3 + TypeScript · Kaspa</span>
    <h1>${projectName}</h1>
    <p>Vue 3 Composition API dApp wired for KasWare & HardKas.</p>
    <div class="row"><span>Network</span><code>{{ network }}</code></div>
    <div class="row"><span>Address</span><code>{{ address ?? "Not connected" }}</code></div>
    <p v-if="error" style="color: #f87171">{{ error }}</p>
    <div style="margin-top: 1.25rem">
      <button type="button" @click="connect">Connect KasWare Wallet</button>
    </div>
  </main>
</template>
`,
      "utf8"
    );
    await fs.writeFile(
      path.join(dappDir, "src", "main.ts"),
      `import { createApp } from "vue";
import App from "./App.vue";
import "./style.css";

createApp(App).mount("#app");
`,
      "utf8"
    );
    await fs.writeFile(
      path.join(dappDir, "index.html"),
      `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${projectName} — Vue 3 Kaspa dApp</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
`,
      "utf8"
    );
    onLog("Scaffolded Vue 3 + TypeScript (Vite) dApp in dapp/");
    return { needsInstall: true, dappDir };
  }

  if (frontend === "svelte-ts") {
    await fs.mkdir(path.join(dappDir, "src"), { recursive: true });
    await fs.writeFile(
      path.join(dappDir, "package.json"),
      JSON.stringify(
        {
          name: `${projectName}-dapp`,
          private: true,
          version: "0.1.0",
          type: "module",
          scripts: {
            dev: "vite --port 5174",
            build: "vite build",
            preview: "vite preview"
          },
          devDependencies: {
            "@sveltejs/vite-plugin-svelte": "^5.0.3",
            svelte: "^5.25.0",
            typescript: "^5.8.3",
            vite: "^6.3.5"
          }
        },
        null,
        2
      ) + "\n",
      "utf8"
    );
    await fs.writeFile(
      path.join(dappDir, "vite.config.ts"),
      `import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";

export default defineConfig({
  plugins: [svelte()],
  server: { port: 5174 }
});
`,
      "utf8"
    );
    await fs.writeFile(path.join(dappDir, "src", "app.css"), SHARED_CSS, "utf8");
    await fs.writeFile(
      path.join(dappDir, "src", "App.svelte"),
      `<script lang="ts">
  let address = $state<string | null>(null);
  let network = $state("simnet");
  let error = $state<string | null>(null);

  async function connect() {
    error = null;
    const kasware = (window as unknown as { kasware?: { requestAccounts(): Promise<string[]>; getNetwork(): Promise<string> } }).kasware;
    if (!kasware) {
      error = "KasWare extension not detected.";
      return;
    }
    try {
      const accounts = await kasware.requestAccounts();
      address = accounts[0] ?? null;
      network = await kasware.getNetwork();
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  }
</script>

<main class="card">
  <span class="badge">Svelte 5 + TypeScript · Kaspa</span>
  <h1>${projectName}</h1>
  <p>Reactive Svelte 5 dApp wired for KasWare & HardKas.</p>
  <div class="row"><span>Network</span><code>{network}</code></div>
  <div class="row"><span>Address</span><code>{address ?? "Not connected"}</code></div>
  {#if error}
    <p style="color: #f87171">{error}</p>
  {/if}
  <div style="margin-top: 1.25rem">
    <button type="button" onclick={connect}>Connect KasWare Wallet</button>
  </div>
</main>
`,
      "utf8"
    );
    await fs.writeFile(
      path.join(dappDir, "src", "main.ts"),
      `import { mount } from "svelte";
import App from "./App.svelte";
import "./app.css";

mount(App, { target: document.getElementById("app")! });
`,
      "utf8"
    );
    await fs.writeFile(
      path.join(dappDir, "index.html"),
      `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${projectName} — Svelte Kaspa dApp</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
`,
      "utf8"
    );
    onLog("Scaffolded Svelte 5 + TypeScript (Vite) dApp in dapp/");
    return { needsInstall: true, dappDir };
  }

  // nextjs
  await fs.mkdir(path.join(dappDir, "app"), { recursive: true });
  await fs.writeFile(
    path.join(dappDir, "package.json"),
    JSON.stringify(
      {
        name: `${projectName}-dapp`,
        private: true,
        version: "0.1.0",
        scripts: {
          dev: "next dev -p 5174",
          build: "next build",
          start: "next start -p 5174"
        },
        dependencies: {
          next: "^15.2.0",
          react: "^19.0.0",
          "react-dom": "^19.0.0"
        },
        devDependencies: {
          "@types/node": "^22.13.0",
          "@types/react": "^19.0.0",
          "@types/react-dom": "^19.0.0",
          typescript: "^5.8.3"
        }
      },
      null,
      2
    ) + "\n",
    "utf8"
  );
  await fs.writeFile(path.join(dappDir, "app", "globals.css"), SHARED_CSS, "utf8");
  await fs.writeFile(
    path.join(dappDir, "app", "layout.tsx"),
    `import "./globals.css";
import type { ReactNode } from "react";

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
`,
    "utf8"
  );
  await fs.writeFile(
    path.join(dappDir, "app", "page.tsx"),
    `"use client";
import { useState } from "react";

export default function Page() {
  const [address, setAddress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const connect = async () => {
    setError(null);
    const kasware = (window as unknown as { kasware?: { requestAccounts(): Promise<string[]> } }).kasware;
    if (!kasware) {
      setError("KasWare extension not detected.");
      return;
    }
    try {
      const accounts = await kasware.requestAccounts();
      setAddress(accounts[0] ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <main className="card">
      <span className="badge">Next.js App Router · TypeScript</span>
      <h1>${projectName}</h1>
      <p>Full-stack Next.js frontend wired to your HardKas workspace.</p>
      <div className="row"><span>Wallet Address</span><code>{address ?? "Not connected"}</code></div>
      {error && <p style={{ color: "#f87171" }}>{error}</p>}
      <div style={{ marginTop: "1.25rem" }}>
        <button type="button" onClick={() => void connect()}>Connect KasWare Wallet</button>
      </div>
    </main>
  );
}
`,
    "utf8"
  );
  onLog("Scaffolded Next.js (TypeScript) dApp in dapp/");
  return { needsInstall: true, dappDir };
}
