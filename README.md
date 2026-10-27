# HardKas IDE

A single-purpose IDE for [HardKas](https://github.com/KasLabDevs/HardKas) projects on Kaspa.

- **Workbench**: icon rail, file explorer, Monaco editor, SilverScript compiler, Deploy & Run, artifacts.
- **Servers view** shaped like Eclipse: the rusty-kaspad node (start / stop / restart / status) and the accounts with balances.
- **Bottom panel** shaped like VS Code: a **Console** (journal of every `hardkas` command the IDE runs, with a `hardkas ›` prompt) and real **Terminal** tabs (PowerShell or your shell, opened in the project folder, over a PTY).
- **Project flow** shaped like Visual Studio: a Home screen with New project (from HardKas CLI templates), Open folder and Recents.
- Projects are real folders on disk with `hardkas.config.ts` and `.hardkas/`, driven through `hardkas <cmd> --json`.

- **Cluster**: start extra local nodes next to the HardKAS node from the Servers view, scale them up and down and watch each one's height and sync. See [docs/cluster.md](docs/cluster.md).
- **Index view**: browse everything HardKAS indexes (artifacts, events, lineage, transactions), query it with read-only SQL and run integrity checks. See [docs/index-view.md](docs/index-view.md).
- **Test debugger**: breakpoints, stepping, variables and watches for the project's vitest tests (F5, F9, F10, F11). See [docs/debugging.md](docs/debugging.md).
- **Desktop app** (`apps/desktop`): a frameless Tauri window around the IDE with a Windows installer; it starts the IDE server itself. See [docs/desktop.md](docs/desktop.md).
- **MCP server** (`packages/mcp-server`): lets an AI agent compile SilverScript, run the local node, move test coins and deploy contracts through the IDE. See [docs/mcp.md](docs/mcp.md).
- **Covenant graph**: a compiled contract, its deploys, entries and spends drawn from HardKas records and checked against the local node. See [docs/covenant-graph.md](docs/covenant-graph.md).
- **Assistant / agent**: chat grounded in the Kaspa docs, and an agent that edits files and runs commands with your approval. See [docs/assistant.md](docs/assistant.md).
- **Local node, miner and confirmations**: why a deploy can sit unconfirmed, and the miner controls. See [docs/local-node.md](docs/local-node.md).

Design notes: [docs/design-notes.md](docs/design-notes.md).

## Layout

```
apps/ide              Vite + React 19 + Monaco (http://localhost:5173)
packages/ide-server   Hono server (http://127.0.0.1:7421): workspace files, hardkas jobs, dev-server proxy
packages/mcp-server   MCP server (stdio) for AI agents, a client of the IDE server
apps/desktop          Tauri desktop app (frameless window, installer, starts the server)
docs/                 design documents
```

## Run

```bash
pnpm install
pnpm dev
```

Then open http://localhost:5173. The server starts with no workspace; pick or create one from the Home screen.
To start with a workspace already open:

```bash
pnpm dev:server -- --workspace C:/path/to/my-hardkas-project
```

Requirements: Node >= 22.5, pnpm, and `@hardkas/cli` (the server uses the project's own `node_modules/.bin/hardkas` when present, then `HARDKAS_BIN`, otherwise `npx @hardkas/cli@<pinned>`). The IDE is tested against one CLI version (`HARDKAS_CLI_VERSION` in `packages/ide-server/src/runner.ts`); the status bar shows the version actually running and warns when it differs.

## Check

```bash
pnpm typecheck
pnpm test
```

Unit tests (vitest, `apps/ide/src/**/*.test.ts`) cover the record readers, the Covenant graph's data side and the node-status parser, against real HardKas records kept in `apps/ide/src/__fixtures__`. CI runs both on every push and pull request.
