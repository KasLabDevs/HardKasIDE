# HardKas IDE as an MCP server

`packages/mcp-server` exposes the IDE to AI agents (Claude Code, Claude Desktop, Cursor, any MCP client) over stdio. It is a client of the IDE server, so an agent works on the same open project, with the same `hardkas` CLI and the same safety rules as the IDE itself.

## Run it

The IDE server must be running with a project open (`pnpm dev:server -- --workspace <folder>`, or open one from the IDE).

```bash
pnpm install
pnpm --filter @hardkas-ide/mcp build
```

Claude Code:

```bash
claude mcp add hardkas-ide -- node /path/to/harkasIDE/packages/mcp-server/dist/index.js
```

Any other client (JSON config):

```json
{
  "mcpServers": {
    "hardkas-ide": {
      "command": "node",
      "args": ["/path/to/harkasIDE/packages/mcp-server/dist/index.js"],
      "env": { "HARDKAS_IDE_URL": "http://127.0.0.1:7421" }
    }
  }
}
```

During development use `pnpm --filter @hardkas-ide/mcp dev` (tsx) instead of the build.

## Tools

| Group | Tool | What it does |
| --- | --- | --- |
| Project | `workspace_status`, `open_workspace` | Which project is open; open another folder |
| | `list_files`, `read_file`, `write_file` | Files inside the project (paths are always project-relative) |
| | `list_artifacts` | Plans, signed txs, receipts and SilverScript records under `.hardkas/artifacts` |
| Environment | `environment_status` | Docker and local node state (ready, DAA score) |
| | `node_control` | start, stop or restart the Docker node. Stop and restart keep the chain |
| Accounts | `accounts_list`, `account_balance` | Names, public addresses and balances. Never private keys |
| | `fund_account` | Test coins on the simulator or the local node |
| Transactions | `send_payment` | Plan, sign and send in one call, with artifact paths and the receipt |
| | `tx_status` | State and confirmations of a transaction |
| SilverScript | `compile_silverscript` | Compile a `.sil` file; returns contracts, entries and the compile record |
| | `deploy_contract`, `spend_contract` | Deploy a compiled contract and call one of its entries |
| Quality | `run_tests` | vitest in the project, per-test results |
| Knowledge | `hardkas_help`, `kaspa_docs` | Real CLI options; the official Kaspa docs as text (docs.kaspa.org only) |

Environments are `simulator` (in memory), `localnet` (Docker rusty-kaspad, simnet) and `testnet` (testnet-10). Mainnet is not available.

## What it deliberately does not do

- It never returns private keys or key material.
- It cannot wipe the local chain ("reset from scratch" stays a confirmed action in the IDE).
- It cannot run arbitrary commands: every tool maps to one fixed `hardkas` subcommand with validated arguments (names, amounts, tx ids and project-relative paths only).
- It cannot touch files outside the open project.

## Check it

```bash
pnpm --filter @hardkas-ide/mcp smoke            # lists the tools and runs read-only calls
pnpm --filter @hardkas-ide/mcp smoke -- --write # also compiles, sends a simulator payment and deploys on the local node
pnpm --filter @hardkas-ide/mcp call account_balance '{"name":"alice","target":"simulator"}'
```

`call` also accepts `@file.json` for the arguments.
