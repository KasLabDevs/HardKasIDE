/** Calls one tool of the MCP server: `pnpm --filter @hardkas-ide/mcp call <tool> '{"json":"args"}'`. */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

import { readFileSync } from "node:fs";

const [tool, argArg] = process.argv.slice(2);
// The JSON can be passed inline or as @path/to/file.json (easier from PowerShell).
const rawArgs = argArg?.startsWith("@") ? readFileSync(argArg.slice(1), "utf8") : argArg;
if (!tool) {
  console.error("usage: call <tool> ['{...json args...}']");
  process.exit(2);
}
const client = new Client({ name: "call", version: "0.0.0" });
await client.connect(new StdioClientTransport({ command: process.execPath, args: ["--import", "tsx", "src/index.ts"], stderr: "ignore" }));
const res = (await client.callTool({ name: tool, arguments: rawArgs ? JSON.parse(rawArgs) : {} })) as { isError?: boolean; content?: { text: string }[] };
console.log(`${res.isError ? "ERROR: " : ""}${res.content?.map((c) => c.text).join("\n") ?? ""}`);
await client.close();
process.exit(res.isError ? 1 : 0);
