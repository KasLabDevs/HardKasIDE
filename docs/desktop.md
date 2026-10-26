# HardKas IDE desktop app (Windows)

`apps/desktop` wraps the IDE in a [Tauri](https://tauri.app) window: no native frame (the IDE's own title bar is the window bar, with minimise, maximise and close), a Windows installer, and the IDE server started by the app itself.

## How it fits together

```
HardKas IDE.exe (Tauri, WebView2)
  ├─ splash page while starting
  └─ spawns   stage/node/node.exe  stage/server/dist/index.js     (the IDE server, hidden window)
                 serves the UI (stage/ui) and the /api on http://127.0.0.1:7421
```

- The window opens on a small splash page, starts the bundled Node runtime on the bundled IDE server, waits for port 7421 and then loads the IDE from it.
- If something already answers on 7421 (for example `pnpm dev:server`), the app uses that instead of starting its own.
- Closing the app stops the server and everything it started (terminals and running jobs).
- The IDE works offline: Monaco and its workers are part of the build, not loaded from a CDN.

## Build the installer

Needs Rust (stable, MSVC toolchain), Node 22+, pnpm and the WebView2 runtime (already present on Windows 10/11).

```bash
pnpm install
pnpm --filter @hardkas-ide/desktop build
```

That runs `scripts/stage.mjs` (builds the server and the UI, installs the server's production dependencies as real folders, copies the Node runtime and the UI into `src-tauri/stage`) and then `tauri build`. The installer lands in `apps/desktop/src-tauri/target/release/bundle/nsis/` (per-user install, no admin rights needed).

## Develop with the desktop window

```bash
pnpm --filter @hardkas-ide/desktop dev
```

`tauri dev` runs `pnpm dev` (Vite and the IDE server) and opens the window on Vite, so edits reload live.

## What the installed app still expects from the machine

- **Node and npm on the PATH.** The IDE server runs on the bundled Node, but the `hardkas` CLI is run through the project's own `node_modules/.bin/hardkas` or `npx @hardkas/cli`, and the Terminal opens your shell. Projects created from a template get their own copy after `npm install`.
- **Docker Desktop** for the Local node (the app tells you when it is missing, as in the browser).

## Notes

- Windows may show a SmartScreen warning: the installer is not code-signed yet.
- Plugin pages are served from the server's other loopback name (`localhost` while the IDE is on `127.0.0.1`), so they stay on a different origin from the IDE, as in the browser.
- The IDE window may only ask the shell for window controls (see `src-tauri/capabilities/default.json`).
