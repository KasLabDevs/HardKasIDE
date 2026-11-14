# HardKas IDE

A single-purpose IDE for [HardKas](https://github.com/KasLabDevs/HardKas) projects on Kaspa.

- **Workbench**: icon rail, file explorer, Monaco editor, SilverScript compiler (a contract summary read from the source, the locking script silverc really produced, and an *Install silverc* button when silverc is missing), Deploy & Run, artifacts.
- **Servers view** shaped like Eclipse: the rusty-kaspad node (start / stop / restart / status) and the accounts with balances.
- **Bottom panel** shaped like VS Code: a **Console** (journal of every `hardkas` command the IDE runs, with a `hardkas ›` prompt) and real **Terminal** tabs (PowerShell or your shell, opened in the project folder, over a PTY).
- **Project flow** shaped like Visual Studio: a Home screen with New project (from HardKas CLI templates), Open folder and Recents.
- Projects are real folders on disk with `hardkas.config.ts` and `.hardkas/`, driven through `hardkas <cmd> --json`.

- **Index view**: browse everything HardKAS indexes (artifacts, events, lineage, transactions), query it with read-only SQL and run integrity checks. See [docs/index-view.md](docs/index-view.md).
- **Test debugger**: breakpoints, stepping, variables and watches for the project's vitest tests (F5, F9, F10, F11). See [docs/debugging.md](docs/debugging.md).
- **SilverScript debugger**: runs a contract entry on the Kaspa script engine line by line (breakpoints, locals, stack, eval), with `sig` arguments signed by simnet dev accounts. Needs a local build of `cli-debugger`. See [docs/debugging.md](docs/debugging.md#debugging-silverscript-contracts).
- **Third-party extensions** (Open VSX, plugins from npm or a URL) are off until you turn them on in the Plugins view. See [docs/plugins.md](docs/plugins.md).
- **Desktop app** (`apps/desktop`): a frameless Tauri window around the IDE with a Windows installer; it starts the IDE server itself. See [docs/desktop.md](docs/desktop.md).
- **MCP server** (`packages/mcp-server`): lets an AI agent compile SilverScript, run the local node, move test coins and deploy contracts through the IDE. See [docs/mcp.md](docs/mcp.md).
- **Covenant graph**: a compiled contract, its deploys, entries and spends drawn from HardKas records and checked against the local node. See [docs/covenant-graph.md](docs/covenant-graph.md).
- **Assistant / agent**: chat grounded in the Kaspa docs, and an agent that edits files and runs commands with your approval. By default it runs the open-source OpenCode agent on free hosted models, off until you turn it on (the panel says what is sent); Anthropic or any OpenAI-compatible endpoint also work. See [docs/assistant.md](docs/assistant.md).
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

Requirements: Node **24.22.1** exactly (the IDE server runs the HardKas CLI with the same Node, and the CLI requires that release: `hardkas doctor` warns on another 24.x and fails on other major lines), pnpm, and `@hardkas/cli` (the server uses `HARDKAS_BIN` when set, then the project's own `node_modules/.bin/hardkas` when present, otherwise `npx @hardkas/cli@<pinned>`; `HARDKAS_IDE_CLI_FROM_REPO=1` puts a sibling HardKas-repo build and the demo workspace's CLI before the project's, for work on HardKas itself). The IDE is tested against one CLI version (`HARDKAS_CLI_VERSION` in `packages/ide-server/src/runner.ts`); the status bar shows the version actually running and warns when it differs.

## Folder trust

A HardKas project is code: the CLI runs its `hardkas.config.ts`, npm runs its scripts, the tests run its files. A folder you have not trusted yet opens in **restricted mode**: you can read and edit files, but it runs no HardKas CLI, npm scripts, tests, debugger, agent or node reset (the server answers `403 UNTRUSTED_WORKSPACE`). A banner offers **Trust this folder** (`POST /api/workspace/trust`); trust covers subfolders and is kept in `~/.hardkas-ide/trusted.json`. Folders made with New project are trusted automatically. Drive roots, your home folder, `~/.hardkas-ide` and `~/.hardkas` can never be opened as a project.

## Secrets and the server

- **Key files.** Key stores (`accounts.real.json`, `.hardkas/dev-accounts`, keystores, `.hardkas/backups`, the dev-server token, `~/.hardkas-ide`) are refused to everyone by the file API. `.env` files (except `.env.example`, `.sample`, `.template`, `.dist`), SSH keys (`id_*`) and `.pem`/`.p12`/`.pfx` files open in the editor but are refused to AI agents (`packages/ide-server/src/secretPaths.ts`). A folder that holds a key store cannot be deleted or renamed from the IDE.
- **Links.** A path that leaves the project through a link (symlink, junction) is refused, and the file tree does not descend into links.
- **Who may call the API.** The server answers only on loopback names, and only the IDE's own page (its port, plus Vite on `:5173` in development) or a local program that sends no `Origin` (such as the MCP server). Cross-site requests and `Origin: null` are refused (`packages/ide-server/src/guard.ts`). Request bodies are limited to 16 MB.

## Check

```bash
pnpm typecheck
pnpm test
```

Unit tests (vitest, `apps/ide/src/**/*.test.ts`) cover the record readers, the Covenant graph's data side and the node-status parser, against real HardKas records kept in `apps/ide/src/__fixtures__`. CI runs both on every push and pull request.
