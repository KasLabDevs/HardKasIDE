#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import * as ide from "./ide.js";

/**
 * HardKas IDE as an MCP server (stdio).
 *
 * It is a client of the IDE server (`pnpm dev:server`, :7421), so everything an agent does goes through the
 * same project, the same `hardkas` CLI and the same allowlist the IDE uses. What it deliberately does NOT offer:
 * private keys, wiping the local chain, arbitrary shell commands, mainnet.
 */

const server = new McpServer(
  { name: "hardkas-ide", version: "0.1.0" },
  {
    instructions: [
      "Tools for working on a HardKas (Kaspa) project through the HardKas IDE server.",
      "Start with workspace_status; open a project with open_workspace if none is open.",
      "Environments: simulator (in-memory), localnet (Docker rusty-kaspad, simnet) and testnet (testnet-10). Mainnet is not supported.",
      "Typical flow: compile_silverscript, then deploy_contract, then spend_contract; or send_payment for plain transfers.",
      "Amounts are in KAS as decimal strings. Private keys are never exposed."
    ].join("\n")
  }
);

// ------------------------------------------------------------------ helpers

type Target = "simulator" | "localnet" | "testnet";
const NETWORK: Record<Target, string> = { simulator: "simulated", localnet: "simnet", testnet: "testnet-10" };
const targetArgs = (t: Target): string[] => (t === "testnet" ? ["--network", "testnet-10"] : ["--target", t]);

const text = (data: unknown) => ({ content: [{ type: "text" as const, text: typeof data === "string" ? data : JSON.stringify(data, null, 2) }] });
const fail = (message: string) => ({ isError: true, content: [{ type: "text" as const, text: message }] });

/** Wraps a handler so IDE/CLI errors come back as tool errors the agent can read, not as protocol failures. */
function safe<A>(fn: (args: A) => Promise<ReturnType<typeof text>>) {
  return async (args: A) => {
    try {
      return await fn(args);
    } catch (e) {
      return fail(e instanceof Error ? e.message : String(e));
    }
  };
}

function cliError(run: ide.JobResult, fallback: string): string {
  const r = run.result as { message?: string; code?: string } | null;
  if (r && typeof r.message === "string") return `${r.code ? r.code + ": " : ""}${r.message}`;
  const err = run.stderr.trim().split("\n").slice(-6).join("\n");
  return err || `${fallback} (exit code ${run.exitCode})`;
}

/** Runs the CLI and returns its JSON document, or throws a readable error. */
async function cli(args: string[], failure: string, opts?: { timeoutMs?: number }): Promise<Record<string, unknown>> {
  const run = await ide.hardkas(args, opts);
  const raw = run.result as Record<string, unknown> | null;
  if (run.status !== "succeeded" || (raw && raw.ok === false)) throw new Error(cliError(run, failure));
  return raw ?? { ok: true, output: run.stdout.trim() };
}

/** The CLI reports record paths as absolute; tools take project-relative ones, so hand back the form an agent can reuse. */
async function withRelativeRecordPath(raw: Record<string, unknown>): Promise<Record<string, unknown>> {
  const p = raw.recordPath;
  if (typeof p !== "string") return raw;
  const root = (await ide.workspace()).root?.replace(/\\/g, "/").replace(/\/$/, "");
  const abs = p.replace(/\\/g, "/");
  if (root && abs.toLowerCase().startsWith(`${root.toLowerCase()}/`)) return { ...raw, recordPath: abs.slice(root.length + 1) };
  return raw;
}

const name = z.string().regex(/^[A-Za-z0-9._-]{1,64}$/, "letters, digits, dot, dash and underscore only");
const kas = z.string().regex(/^\d+(\.\d{1,8})?$/, 'decimal KAS amount such as "10" or "0.5"');
const target = z.enum(["simulator", "localnet", "testnet"]).describe("simulator = in-memory, localnet = Docker rusty-kaspad simnet, testnet = public testnet-10");
const relPath = z
  .string()
  .min(1)
  .refine((p) => !p.includes("..") && !p.startsWith("/") && !p.startsWith("\\") && !/^[A-Za-z]:/.test(p) && !p.startsWith("-") && !p.includes("\0"), "path must be relative to the project folder");
const READ = { readOnlyHint: true, openWorldHint: false } as const;
const WRITE = { readOnlyHint: false, destructiveHint: false, openWorldHint: false } as const;

// ------------------------------------------------------------------ workspace & files

server.registerTool(
  "workspace_status",
  { title: "Workspace status", description: "Which HardKas project is open in the IDE (folder, config, whether the dev-server token exists).", annotations: READ },
  safe(async () => text(await ide.workspace()))
);

server.registerTool(
  "open_workspace",
  { title: "Open a project", description: "Opens a project folder in the IDE server (the folder should hold a hardkas.config.ts).", inputSchema: { path: z.string().min(1).describe("Absolute path to the project folder") }, annotations: WRITE },
  safe(async ({ path }) => text(await ide.openWorkspace(path)))
);

server.registerTool(
  "list_files",
  { title: "List project files", description: "Flat list of files in the open project, optionally limited to a sub-folder. Capped at 400 entries.", inputSchema: { dir: relPath.optional().describe("Sub-folder, e.g. contracts") }, annotations: READ },
  safe(async ({ dir }) => {
    const files = ide.flattenTree(await ide.tree(), dir?.replace(/\/$/, "") ?? "");
    return text({ count: files.length, files: files.slice(0, 400), truncated: files.length > 400 });
  })
);

server.registerTool(
  "read_file",
  { title: "Read a file", description: "Reads a text file inside the open project.", inputSchema: { path: relPath }, annotations: READ },
  safe(async ({ path }) => text(await ide.readFile(path)))
);

server.registerTool(
  "write_file",
  { title: "Write a file", description: "Creates or overwrites a text file inside the open project (for example a .sil contract). The IDE shows it in the explorer.", inputSchema: { path: relPath, content: z.string() }, annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false } },
  safe(async ({ path, content }) => {
    await ide.writeFile(path, content);
    return text(`Wrote ${path} (${content.length} characters)`);
  })
);

server.registerTool(
  "list_artifacts",
  { title: "List artifacts", description: "Paths of the artifacts HardKas saved under .hardkas/artifacts (plans, signed txs, receipts, SilverScript compile/deploy/spend records). Read one with read_file.", inputSchema: { contains: z.string().max(64).optional().describe('Only paths containing this text, e.g. "silverDeploy" or "receipt"') }, annotations: READ },
  safe(async ({ contains }) => {
    const all = await ide.findFiles(".hardkas/artifacts", ".json");
    const files = contains ? all.filter((p) => p.includes(contains)) : all;
    return text({ count: files.length, files: files.slice(-200), truncated: files.length > 200 });
  })
);

// ------------------------------------------------------------------ environment

server.registerTool(
  "query_index",
  {
    title: "Query the HardKAS index",
    description:
      "Read-only SQL over the project's query store (.hardkas/store.db): tables artifacts, events, lineage_edges, lineage_closure, traces. One SELECT, at most 500 rows. With no `sql` it returns the store's health instead (counts, kinds, whether it is behind the files on disk). Useful to find receipts, follow lineage or count things without reading files one by one.",
    inputSchema: { sql: z.string().min(1).max(4000).optional().describe("A single SELECT or WITH statement") },
    annotations: READ
  },
  safe(async ({ sql }) => text(sql ? await ide.querySql(sql) : await ide.storeHealth()))
);
server.registerTool(
  "environment_status",
  { title: "Environment status", description: "Docker availability and the state of the local node (rusty-kaspad on simnet): ready, DAA score, container.", annotations: READ },
  safe(async () => {
    const [system, node] = await Promise.all([ide.system().catch(() => null), ide.hardkas(["localnet", "status", "--json"]).catch(() => null)]);
    return text({ docker: system?.docker ?? "unknown", localnet: node?.result ?? node?.stderr ?? "unknown" });
  })
);

server.registerTool(
  "node_control",
  {
    title: "Start, stop or restart the local node",
    description: "Controls the Docker rusty-kaspad node of the localnet environment. Stop and restart keep the chain; wiping it is intentionally not available here (use the IDE).",
    inputSchema: { action: z.enum(["start", "stop", "restart"]) },
    annotations: WRITE
  },
  safe(async ({ action }) => {
    if (action !== "start") await cli(["localnet", "stop", "--toccata", "--json"], "Could not stop the node", { timeoutMs: 120_000 });
    if (action !== "stop") await cli(["localnet", "start", "--toccata", "--json"], "Could not start the node", { timeoutMs: 180_000 });
    const status = await ide.hardkas(["localnet", "status", "--json"]);
    return text({ action, status: status.result });
  })
);

server.registerTool(
  "accounts_list",
  { title: "List accounts", description: "Account names and public addresses of the project (alice, bob, … plus created ones). Private keys are never returned.", annotations: READ },
  safe(async () => text(await cli(["accounts", "list", "--json"], "accounts list failed")))
);

server.registerTool(
  "account_balance",
  { title: "Account balance", description: "Balance of one account on an environment.", inputSchema: { name, target }, annotations: READ },
  safe(async ({ name, target }) => text(await cli(["accounts", "balance", name, "--network", NETWORK[target], "--json"], "accounts balance failed")))
);

server.registerTool(
  "fund_account",
  {
    title: "Fund an account (test coins)",
    description: "Gives an account test coins: simulator credits it in memory; localnet mines to it on the Docker node. The public testnet cannot be funded from here.",
    inputSchema: { name, amountKas: kas, target: z.enum(["simulator", "localnet"]) },
    annotations: WRITE
  },
  safe(async ({ name, amountKas, target }) => {
    const args = target === "localnet" ? ["localnet", "fund", name, "--amount", amountKas, "--profile", "toccata-v2", "--json"] : ["simulator", "fund", name, "--amount", amountKas, "--json"];
    return text(await cli(args, "fund failed", { timeoutMs: 240_000 }));
  })
);

// ------------------------------------------------------------------ transactions

server.registerTool(
  "send_payment",
  {
    title: "Send a payment (plan, sign, send)",
    description: "Runs the full HardKas lifecycle for a plain transfer between two project accounts: tx plan, tx sign, tx send. Returns the artifact paths, the tx id and the receipt. Test coins only.",
    inputSchema: { from: name, to: name, amountKas: kas, target },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true }
  },
  safe(async ({ from, to, amountKas, target }) => {
    const plan = await cli(["tx", "plan", "--from", from, "--to", to, "--amount", amountKas, ...targetArgs(target), "--json"], "tx plan failed");
    const planId = String(plan.planId ?? "");
    if (!planId) throw new Error("tx plan did not return a planId");
    let planPath: string | undefined;
    for (let i = 0; i < 12 && !planPath; i++) {
      planPath = (await ide.findFiles(".hardkas/artifacts", `-${planId}.plan.json`))[0];
      if (!planPath) await new Promise((r) => setTimeout(r, 300));
    }
    if (!planPath) throw new Error(`Plan ${planId} was created but its file was not found under .hardkas/artifacts`);
    const signed = await cli(["tx", "sign", planPath, "--account", from, ...targetArgs(target), "--json"], "tx sign failed");
    const signedPath = `.hardkas/artifacts/signed/signedTx-${String(signed.contentHash)}.json`;
    const sent = await cli(["tx", "send", signedPath, ...targetArgs(target), "--json"], "tx send failed", { timeoutMs: 240_000 });
    return text({ target, from, to, amountKas, planPath, signedPath, txId: signed.txId, outcome: sent.outcome, receipt: (sent.data as { receipt?: unknown } | undefined)?.receipt ?? sent });
  })
);

server.registerTool(
  "tx_status",
  { title: "Transaction status", description: "Asks the node (or the simulator) how a transaction is doing: state, confirmations, finality.", inputSchema: { txId: z.string().regex(/^[0-9a-fA-F]{16,128}$/), target }, annotations: READ },
  safe(async ({ txId, target }) => text(await cli(["tx", "status", txId, "--network", NETWORK[target], "--json"], "tx status failed")))
);

// ------------------------------------------------------------------ SilverScript

const argsFileFor = (file: string) => file.replace(/\.sil$/, "") + ".constructor-args.json";

server.registerTool(
  "compile_silverscript",
  {
    title: "Compile a SilverScript contract",
    description: "hardkas silver compile on a .sil file. Constructor arguments come from <name>.constructor-args.json next to the file, or from constructorArgs (JSON text), which is then saved there. Returns the contracts, their entries and addresses, and the compile record path to deploy from.",
    inputSchema: { file: relPath.refine((p) => p.endsWith(".sil"), "must be a .sil file"), constructorArgs: z.string().optional().describe("JSON array of constructor arguments") },
    annotations: WRITE
  },
  safe(async ({ file, constructorArgs }) => {
    const argsFile = argsFileFor(file);
    const cliArgs = ["silver", "compile", file];
    if (constructorArgs?.trim()) {
      JSON.parse(constructorArgs);
      await ide.writeFile(argsFile, constructorArgs);
      cliArgs.push("--args", argsFile);
    } else if (await ide.readFile(argsFile).then(() => true, () => false)) {
      cliArgs.push("--args", argsFile);
    }
    cliArgs.push("--json");
    return text(await withRelativeRecordPath(await cli(cliArgs, "silver compile failed")));
  })
);

server.registerTool(
  "deploy_contract",
  {
    title: "Deploy a compiled contract",
    description: "hardkas silver deploy: funds the contract address from an account and waits for it. Needs the compile record path from compile_silverscript. Test coins only.",
    inputSchema: { compileRecordPath: relPath, from: name, amountKas: kas, contract: name.optional().describe("Contract name when the file defines several") },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true }
  },
  safe(async ({ compileRecordPath, from, amountKas, contract }) => {
    const args = ["silver", "deploy", compileRecordPath, "--from", from, "--amount", amountKas, "--wait", "--json"];
    if (contract) args.push("--contract", contract);
    return text(await withRelativeRecordPath(await cli(args, "silver deploy failed", { timeoutMs: 300_000 })));
  })
);

server.registerTool(
  "spend_contract",
  {
    title: "Spend a contract entry",
    description: "hardkas silver spend: calls one entry of a deployed contract and sends the output to an address or account. `args` is the JSON array of entry arguments, in the encoding the compile record describes (see the contract's constructor args file for the format).",
    inputSchema: {
      deployRecordPath: relPath,
      entry: name,
      to: z.string().min(3).max(200).refine((s) => !s.startsWith("-"), "invalid destination"),
      args: z.array(z.unknown()).default([]),
      sequence: z.string().regex(/^\d+$/).optional()
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true }
  },
  safe(async ({ deployRecordPath, entry, to, args, sequence }) => {
    const hash = deployRecordPath.split("/").pop()?.replace(/[^A-Za-z0-9]/g, "").slice(-16) || "deploy";
    const argsFile = `.hardkas/ide/spend-args/${hash}-${entry}.json`;
    await ide.writeFile(argsFile, JSON.stringify(args, null, 2));
    const cliArgs = ["silver", "spend", deployRecordPath, "--entry", entry, "--to", to, "--args", argsFile, "--wait", "--json"];
    if (sequence) cliArgs.push("--sequence", sequence);
    return text(await withRelativeRecordPath(await cli(cliArgs, "silver spend failed", { timeoutMs: 300_000 })));
  })
);

// ------------------------------------------------------------------ tests, help, docs

server.registerTool(
  "run_tests",
  {
    title: "Run the project's tests",
    description: "Runs vitest in the open project (optionally one file) and returns the per-test results.",
    inputSchema: { file: relPath.optional() },
    annotations: WRITE
  },
  safe(async ({ file }) => {
    const out = ".hardkas/ide/test-results.json";
    const run = await ide.hardkas(["vitest", "run", ...(file ? [file] : []), "--reporter=json", `--outputFile=${out}`], { command: "npx", timeoutMs: 10 * 60_000 });
    const report = await ide.readFile(out).then((t) => JSON.parse(t) as { numTotalTests?: number; numPassedTests?: number; numFailedTests?: number; testResults?: { name: string; assertionResults?: { fullName: string; status: string; failureMessages?: string[] }[] }[] }, () => null);
    if (!report) return fail(`vitest produced no report (exit code ${run.exitCode}). Is vitest installed in the project?\n${run.stderr.slice(-800)}`);
    const failed = (report.testResults ?? []).flatMap((f) => (f.assertionResults ?? []).filter((t) => t.status === "failed").map((t) => ({ file: f.name, test: t.fullName, message: (t.failureMessages ?? []).join("\n").slice(0, 600) })));
    return text({ total: report.numTotalTests, passed: report.numPassedTests, failed: report.numFailedTests, failures: failed });
  })
);

server.registerTool(
  "hardkas_help",
  { title: "HardKas CLI help", description: "Runs `hardkas <command> --help` so you can read the real options, for example command [\"silver\", \"spend\"].", inputSchema: { command: z.array(z.string().regex(/^[a-z][a-z-]*$/)).max(3).default([]) }, annotations: READ },
  safe(async ({ command }) => {
    const run = await ide.hardkas([...command, "--help"]);
    return text((run.stdout || run.stderr).trim().slice(0, 6000));
  })
);

server.registerTool(
  "kaspa_docs",
  {
    title: "Kaspa developer docs",
    description: "Fetches the official Kaspa docs as plain text. Without `page` it returns the docs index (llms.txt); pass a docs.kaspa.org URL from the index to read a page. Use it before answering questions about Kaspa or SilverScript.",
    inputSchema: { page: z.string().url().optional().describe("A https://docs.kaspa.org/... URL"), maxChars: z.number().int().min(1000).max(60000).default(20000) },
    annotations: { readOnlyHint: true, openWorldHint: true }
  },
  safe(async ({ page, maxChars }) => {
    const url = page ?? "https://docs.kaspa.org/llms.txt";
    if (new URL(url).hostname !== "docs.kaspa.org") throw new Error("Only docs.kaspa.org pages can be fetched");
    const res = await fetch(url, { headers: { accept: "text/plain, text/markdown, */*" } });
    if (!res.ok) throw new Error(`docs.kaspa.org answered ${res.status} for ${url}`);
    const body = await res.text();
    return text(body.length > maxChars ? `${body.slice(0, maxChars)}\n\n[truncated: ${body.length - maxChars} more characters]` : body);
  })
);

// ------------------------------------------------------------------ boot

await server.connect(new StdioServerTransport());
console.error(`[hardkas-ide-mcp] ready, talking to ${ide.IDE_URL}`);
