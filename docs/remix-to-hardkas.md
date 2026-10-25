# HardKas IDE: mapa Remix → HardKas

Fecha: 2026-10-25. Base: Remix IDE (ethereum/remix-project, Apache-2.0) como molde, HardKas `0.12.0-rc.29` como motor.
El clon de referencia de Remix vive en `reference/remix-project` (sparse, ignorado por git).

## 1. Decisión

- **Molde**: Remix IDE. Su licencia Apache-2.0 es compatible con la MIT de HardKas: se puede copiar código con atribución (fichero NOTICE).
- **Stack**: Vite + React 19 + TypeScript + Tailwind 4 + Monaco (`@monaco-editor/react`). Mismo stack que `apps/dashboard` de HardKas.
- **Repo aparte** (`harkasIDE`), consumiendo `@hardkas/sdk`, `@hardkas/cli` y `@hardkas/dev-server` desde npm, pineados a `0.12.0-rc.29`.
- **No usar** `@hardkas/react` ni `@hardkas/client` publicados: están en `0.4.0-alpha` y `0.8.0-alpha`, no coinciden con el dev-server actual.

## 2. Mapa concepto a concepto

| Remix | HardKas IDE | Backend HardKas que lo sirve |
| --- | --- | --- |
| Workspace + File Explorer (IndexedDB) | Carpeta real de proyecto HardKas (`hardkas.config.ts`, `.hardkas/`) | **No existe API de ficheros**. Lo da el `ide-server` propio |
| Editor Monaco + grammar Solidity | Monaco + grammar Monarch para SilverScript (`.sil`) | No existe grammar. Hay que escribirla (`pragma silverscript ^0.1.0;`, `contract X(pubkey owner) { entry name(sig s) { require(checkSig(s, owner)); } }`) |
| Compile tab (solc) | Compile tab (silverc v1.0.0) | `hardkas silver compile <src> --json`. Errores solo como texto stderr, sin línea/columna |
| `compilationFinished` → ABI | `compilationFinished` → `contracts[{name, entries, lockingScript, address}]` del SilverCompile record | Record en `.hardkas/artifacts/silver/` |
| Deploy & Run: entorno "JavaScript VM" | Target `simulator` (`{mode: simulator, network: simulated}`) | `hardkas.config.ts` `execution.targets` |
| Deploy & Run: "Injected / Web3 provider" | Targets `localnet` (Docker rusty-kaspad simnet) y `rpc` (testnet-10/11) | `hardkas localnet start/status/fund` (solo CLI, Docker) |
| Accounts dropdown | alice, bob y cuentas de config | `GET /api/accounts`, `GET /api/dev-accounts` del dev-server |
| Deploy + ContractGUI (botón por función) | Plan → Sign → Send/Simulate + botón por `entry` del contrato | `hardkas tx plan/sign/send --json`, `POST /api/tx/plan|sign|send` |
| Deployed Contracts | Artifacts (plan, signed, receipt, submission) con lineage | `GET /api/artifacts`, `/api/artifacts/:id`, `/explain` |
| Transaction Recorder (scenario JSON) | Replay determinista | `hardkas replay verify`, `POST /api/artifacts/:id/replay` |
| Debugger (trace EVM paso a paso) | Fase 2: visor de `tracePath` del receipt y de `silver test` | `.hardkas/artifacts/silver-vm/` |
| Terminal (journal de bloques + REPL) | Terminal: salida JSON de la CLI + eventos SSE de artifacts | `GET /api/artifacts/stream` (SSE: `connected`, `artifact`, `ping`) |
| Home tab (templates) | Home: `hardkas init`, `hardkas create <template>` | Templates en `packages/cli/templates/*` |
| Status bar / badges | Badges `ReplayBadge`, `StatusBadge`, `LineageGraph` | Copiar de `apps/dashboard/src/components` (props puras) |
| Plugin engine `@remixproject/engine` | Mini engine propio (~300 líneas): `Plugin{profile, call, on, emit}` | — |

## 3. Arquitectura propuesta

```
apps/ide (Vite :5173)  ──HTTP/SSE──▶  packages/ide-server (Hono :7421)
   React + Monaco                         ├── /api/fs/*      ficheros del workspace (scoped a la raíz)
   mini plugin engine                     ├── /api/run       spawn `hardkas <cmd> --json`, jobs + SSE de logs
   zustand store                          └── /api/dev/*     proxy a dev-server :7420 (añade Bearer + X-Hardkas-Request)
                                                   │
                                                   ▼
                                      hardkas dev (:7420, Hono) + CLI hardkas (npm @hardkas/cli)
```

Por qué un `ide-server` propio y no pegar directo al dev-server:

1. El dev-server no tiene endpoints de ficheros, compile, run ni terminal. Solo artifacts, tx, accounts, observability y un SSE.
2. CORS está fijado a `localhost:7420` y `localhost:5173`; cualquier otro origen da 403 salvo `--unsafe-external`.
3. El token está en `.hardkas/dev-server-token`; el `ide-server` lo lee y lo inyecta, el navegador nunca lo ve.
4. La CLI con `--json` ya da salida estructurada (`{ok, code, message}` en error). Es la superficie más estable hoy.

## 4. Qué se copia de Remix y qué no

**Copiar (ideas y, donde compense, código con atribución):**
- Shell por regiones: icon rail, side panel, main (tabs + editor), terminal redimensionable, status bar. Vistas montadas una vez y ocultas con `d-none` para conservar estado (`libs/remix-ui/panel`).
- Plugin engine con profiles y `call/on/emit` asíncronos; activación ordenada con gates ("editor mounted", "workspace ready").
- Editor como servicio con `addErrorMarker(errors, from)` → `setModelMarkers`; un modelo Monaco por fichero; `contentChanged` con debounce de 500 ms para autosave y autocompile.
- Contrato de compilador uniforme: `compilationFinished(target, sources, lang, data)` + `statusChanged` para el badge.
- Entornos como provider plugins con un selector único de execution context.
- UI generada desde la interfaz del contrato (entries de SilverScript) + lista de instancias desplegadas + recorder/replay.
- Menú contextual extensible por extensión de fichero y catálogo de templates.

**Saltarse en la fase 1:** permission handler, directorio remoto de plugins, Electron, sync cloud/S3, Matomo, IA/nudges, panel pinned, Swarm, type-fetcher TS, OpenZeppelin/proxies, Nx.

## 5. Huecos que HardKas tiene que cubrir (para pedírselos al repo HardKas)

1. **API de ficheros del workspace** (list/read/write/rename/delete + watch de `.sil` y `.ts`). Hoy el watcher solo mira `.hardkas/`. El `ide-server` lo cubre mientras tanto.
2. **Compile/run con salida estructurada**: `POST /api/silver/compile` con diagnósticos línea/columna; `hardkas run`/`test` con logs en streaming. Hoy silverc solo devuelve stderr.
3. **Selección de target por petición en el dev-server**: siempre usa `execution.default` y `/api/localnet/status` es un mock. La CLI sí lo resuelve: `tx plan|sign|send --target <nombre>` funciona, y es lo que usa el IDE. Verificado el 2026-10-25: Plan → Sign → Send desde el IDE contra el simulador y contra rusty-kaspad v2.1.0 en simnet (localnet Toccata), con `tx status` devolviendo `CONFIRMED`.
   - Convenciones que el IDE asume: `tx sign`/`tx send` solo aceptan rutas de fichero; el plan se guarda como `.hardkas/artifacts/<ts>-<planId>.plan.json`; el resto como `<kind>-<contentHash>.json`. En simulador `tx send` devuelve `data.receipt` = `hardkas.txReceipt`; en nodo real = `hardkas.txSubmission.v1` (sin `status`, con `submitResult.accepted` y `fee.feeSompi`).
4. **Cliente de navegador publicado y coherente**: `@hardkas/react` y `@hardkas/client` están obsoletos; `sdk/client.ts` apunta a :3000 y no manda token. Además: bug en `GET /api/tx/receipt/:id` (filtra por `TxReceipt.v1`, el schema real es `hardkas.txReceipt`); `dev-server start --port` está definido pero no registrado.
5. **Tooling de lenguaje SilverScript**: grammar, `silverc --ast-only` como endpoint para outline/diagnósticos, binarios para macOS/ARM.

## 6. Fases

1. **Esqueleto** (siguiente paso): monorepo pnpm con `apps/ide` y `packages/ide-server`; shell Remix-like; file tree real; Monaco con grammar `.sil`; terminal con salida de `hardkas --json`; botón Compile.
2. **Deploy & Run**: selector de target, cuentas, Plan/Sign/Send contra la CLI, panel de artifacts con `LineageGraph` copiado del dashboard, SSE de artifacts en la terminal.
3. **Replay y Silver**: `replay verify`, `silver test`, visor de trace, botón por `entry`.
4. **Home y templates**: `hardkas init` / `create` desde la UI, workspaces recientes.
5. **Extras**: extensión VS Code (modelo Hardhat for VS Code) y servidor MCP (modelo `rea`) para agentes.

## 7. Estructura del repo prevista

```
harkasIDE/
  apps/ide/                 Vite + React + Monaco (puerto 5173 por el CORS del dev-server)
    src/engine/             mini plugin engine
    src/shell/              IconRail, SidePanel, MainPanel, Terminal, StatusBar
    src/panels/             Files, Compile, Run, Artifacts, Settings
    src/editor/             Editor.tsx, silverscript.ts (Monarch), theme.ts
  packages/ide-server/      Hono: /api/fs, /api/run (jobs + SSE), /api/dev proxy
  docs/                     este documento
  reference/                clon sparse de Remix (ignorado por git)
```
