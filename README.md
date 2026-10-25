# HardKas IDE

A single-purpose IDE for [HardKas](https://github.com/KasLabDevs/HardKas) projects on Kaspa.

- **Workbench** shaped like Remix IDE: icon rail, file explorer, Monaco editor, Compile, Deploy & Run, artifacts.
- **Servers view** shaped like Eclipse: the rusty-kaspad node (start / stop / restart / status) and the accounts with balances.
- **Bottom panel** shaped like VS Code: a **Console** (journal of every `hardkas` command the IDE runs, with a `hardkas ›` prompt) and real **Terminal** tabs (PowerShell or your shell, opened in the project folder, over a PTY).
- **Project flow** shaped like Visual Studio: a Home screen with New project (from HardKas CLI templates), Open folder and Recents.
- Projects are real folders on disk with `hardkas.config.ts` and `.hardkas/`, driven through `hardkas <cmd> --json`.

Design notes: [docs/remix-to-hardkas.md](docs/remix-to-hardkas.md).

## Layout

```
apps/ide              Vite + React 19 + Monaco (http://localhost:5173)
packages/ide-server   Hono server (http://127.0.0.1:7421): workspace files, hardkas jobs, dev-server proxy
docs/                 design documents
reference/            sparse clone of Remix IDE used as reference (git-ignored)
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
