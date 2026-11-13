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

Needs Rust (stable, MSVC toolchain), Node 24.22.1 (the staging step copies the Node that runs it into the installer, and the HardKas CLI requires that release), pnpm and the WebView2 runtime (already present on Windows 10/11).

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

## Releases

- **Version.** The version is written in twelve places (package.json files, `tauri.conf.json`, `Cargo.toml`/`Cargo.lock`, the agent and MCP client names, the release workflow default). Change it only with `node scripts/version.mjs set 0.3.1`; `node scripts/version.mjs check` says whether they agree, and CI runs it on every push.
- **Tag.** Merge `develop` into `main` first, then tag `main` (`vX.Y.Z`). The release workflow (`.github/workflows/build-desktop.yml`) first checks that the tag matches the version in the code and stops if it does not, so a tag on the wrong commit fails in seconds instead of publishing mislabelled installers.
- **Every pull request** stages the app on Windows, macOS and Linux and starts it (`apps/desktop/scripts/stage-smoke.mjs`), so a platform-only break shows up before a tag.

## Signing

The installers are **not signed** yet: Windows shows a SmartScreen warning, and macOS refuses to open the app the first time (right-click → Open, or allow it in System Settings → Privacy & Security).

- **macOS** (ready in the workflow): join the Apple Developer Program, create a *Developer ID Application* certificate, and add these repository secrets (Settings → Secrets and variables → Actions): `APPLE_CERTIFICATE` (the exported `.p12`, base64), `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY` (e.g. `Developer ID Application: Name (TEAMID)`), and for notarization `APPLE_ID`, `APPLE_PASSWORD` (an app-specific password) and `APPLE_TEAM_ID`. The next release signs and notarizes by itself; without the secrets it stays unsigned, as now.
- **Windows** (needs a choice first): code-signing keys now live in hardware or a cloud service, not in a `.pfx` file. The usual options are Azure Trusted Signing (Microsoft's service, monthly fee, identity validation) or a certificate from a CA with cloud signing. Once one is chosen, Tauri signs through `bundle.windows.signCommand`; that is a small change to the workflow.

## Notes

- Windows may show a SmartScreen warning: the installer is not code-signed yet (see Signing).
- Plugin pages are served from the server's other loopback name (`localhost` while the IDE is on `127.0.0.1`), so they stay on a different origin from the IDE, as in the browser.
- The IDE window may only ask the shell for window controls (see `src-tauri/capabilities/default.json`).
