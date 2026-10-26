# HardKas IDE

A single-purpose IDE for [HardKas](https://github.com/KasLabDevs/HardKas) projects on Kaspa.

- **Workbench**: icon rail, file explorer, Monaco editor, SilverScript compiler, Deploy & Run, artifacts.
- **Servers view** shaped like Eclipse: the rusty-kaspad node (start / stop / restart / status) and the accounts with balances.
- **Bottom panel** shaped like VS Code: a **Console** (journal of every `hardkas` command the IDE runs, with a `hardkas ›` prompt) and real **Terminal** tabs (PowerShell or your shell, opened in the project folder, over a PTY).
- **Project flow** shaped like Visual Studio: a Home screen with New project (from HardKas CLI templates), Open folder and Recents.
- Projects are real folders on disk with `hardkas.config.ts` and `.hardkas/`, driven through `hardkas <cmd> --json`.

- **MCP server** (`packages/mcp-server`): lets an AI agent compile SilverScript, run the local node, move test coins and deploy contracts through the IDE. See [docs/mcp.md](docs/mcp.md).

Design notes: [docs/design-notes.md](docs/design-notes.md).

## Layout

```
apps/ide              Vite + React 19 + Monaco (http://localhost:5173)
packages/ide-server   Hono server (http://127.0.0.1:7421): workspace files, hardkas jobs, dev-server proxy
packages/mcp-server   MCP server (stdio) for AI agents, a client of the IDE server
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

Requirements: Node >= 22.5, pnpm, and `@hardkas/cli` (the server uses the project's own `node_modules/.bin/hardkas` when present, otherwise `npx @hardkas/cli@0.12.0-rc.29`).
