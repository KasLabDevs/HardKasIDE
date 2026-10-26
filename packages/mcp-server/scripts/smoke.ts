/**
 * Smoke test: starts the MCP server over stdio like an agent host would, lists the tools and calls a few of them
 * against a running IDE server with a workspace open.
 *
 *   pnpm --filter @hardkas-ide/mcp smoke            (read-only calls)
 *   pnpm --filter @hardkas-ide/mcp smoke -- --write (also compiles a contract and sends a simulator payment)
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const write = process.argv.includes("--write");
const client = new Client({ name: "smoke", version: "0.0.0" });
await client.connect(new StdioClientTransport({ command: process.execPath, args: ["--import", "tsx", "src/index.ts"], stderr: "inherit" }));

const show = (label: string, res: unknown) => {
  const r = res as { isError?: boolean; content?: { type: string; text: string }[] };
  const body = r.content?.map((c) => c.text).join("\n") ?? "";
  console.log(`\n== ${label} ${r.isError ? "(ERROR)" : ""}\n${body.length > 700 ? body.slice(0, 700) + "…" : body}`);
  return r;
};

const tools = await client.listTools();
console.log(`${tools.tools.length} tools:`, tools.tools.map((t) => t.name).join(", "));

show("workspace_status", await client.callTool({ name: "workspace_status", arguments: {} }));
show("list_files contracts", await client.callTool({ name: "list_files", arguments: { dir: "contracts" } }));
show("accounts_list", await client.callTool({ name: "accounts_list", arguments: {} }));
show("account_balance alice simulator", await client.callTool({ name: "account_balance", arguments: { name: "alice", target: "simulator" } }));
show("environment_status", await client.callTool({ name: "environment_status", arguments: {} }));
show("bad input is rejected (path escape)", await client.callTool({ name: "read_file", arguments: { path: "../secrets.txt" } }).catch((e) => ({ isError: true, content: [{ type: "text", text: String(e.message ?? e) }] })));
show("kaspa_docs (index)", await client.callTool({ name: "kaspa_docs", arguments: { maxChars: 1200 } }));

if (write) {
  const compiled = show("compile_silverscript escrow", await client.callTool({ name: "compile_silverscript", arguments: { file: "contracts/escrow.sil" } }));
  show("send_payment simulator", await client.callTool({ name: "send_payment", arguments: { from: "alice", to: "bob", amountKas: "1", target: "simulator" } }));
  // Deploy on the real local node (needs it running and alice funded).
  const recordPath = (JSON.parse((compiled as { content: { text: string }[] }).content[0].text) as { recordPath?: string }).recordPath;
  if (recordPath) {
    show("deploy_contract (localnet)", await client.callTool({ name: "deploy_contract", arguments: { compileRecordPath: recordPath, from: "alice", amountKas: "5" } }));
    show("list_artifacts silverDeploy", await client.callTool({ name: "list_artifacts", arguments: { contains: "silverDeploy" } }));
  }
  show("hardkas_help silver spend", await client.callTool({ name: "hardkas_help", arguments: { command: ["silver", "spend"] } }));
  show("run_tests", await client.callTool({ name: "run_tests", arguments: {} }));
}

await client.close();
