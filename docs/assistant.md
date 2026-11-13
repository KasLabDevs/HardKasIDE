# Assistant and agent

The **Assistant** side panel talks to a model of your choice about the open project and the Kaspa docs, and can run as an **agent** that edits files and runs HardKas commands in the workspace. Everything goes through the IDE server (`packages/ide-server/src/assistant.ts`); the browser never holds the API key.

## OpenCode (the default provider)

With the **OpenCode** provider the IDE hosts the open-source [OpenCode](https://github.com/anomalyco/opencode) agent (MIT, bundled with the desktop app) over the Agent Client Protocol and gives it the HardKas tools through the IDE's MCP server (`packages/ide-server/src/acpAgent.ts`). It needs no account and no key: it uses OpenCode's free hosted models.

- **Off until you turn it on.** A fresh install sends nothing. The panel explains what leaves the machine and offers **Turn on OpenCode** or **Use my own provider**; until then the chat and agent routes answer `CONSENT_REQUIRED`. **Turn off OpenCode** in the settings withdraws it. The answer is stored as `opencodeConsent` in `~/.hardkas-ide/assistant.json`.
- **What is sent.** Your questions, the open file when "Share the open file" is ticked, and the workspace files the agent reads go to the selected model on OpenCode's servers. Each free model has its own data terms ([opencode.ai/docs/zen](https://opencode.ai/docs/zen)). The default, `opencode/deepseek-v4.1-flash-free`, and the next two suggestions (`glm-5.3-flash-free`, `minimax-m3.1-flash-free`) are listed there as zero-retention and not used for training; `big-pickle` may use data to improve the model.
- **What it may do.** The IDE writes OpenCode's policy on every start (`~/.hardkas-ide/opencode`): reads and the read-only HardKas tools run without asking; file edits, shell commands and HardKas tools that change something (payments, deploys, funding, node control) ask in the panel; account keys, `dev-accounts`, keystores, the dev-server token and `.env` files are denied. The bundled binary never updates itself and never shares sessions (`update: disable`, `share: disabled`).

The sections below (tools table, approvals) describe the IDE's own agent, used with the Anthropic and OpenAI-compatible providers.

## Setup

Settings → Assistant, or the model name at the top of the panel:

- **Provider**: OpenCode (the default, see above), Anthropic (Messages API) or any OpenAI-compatible endpoint (`baseUrl` + model).
- **API key** (Anthropic and OpenAI-compatible only): saved in the system credential store (Windows Credential Manager, macOS Keychain, the Linux Secret Service; service `hardkas-ide`, account `anthropic-api-key` or `openai-api-key`), never in a file, and shown back only as a hint (`…abcd`). If `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` is set in the environment, that key is used instead, which also covers a Linux machine without a keyring. A key that earlier versions kept in `~/.hardkas-ide/assistant.json` moves to the credential store the first time the IDE reads its settings; if no store is available it stays in the file, the panel says so, and a new key is refused with a pointer to the variable. `PUT /api/assistant/config` accepts a key only from the IDE's own origin (`packages/ide-server/src/secrets.ts`).
- **Kaspa docs**: `off`, `core` (the `llms.txt` pack from docs.kaspa.org) or `full` (`llms-full.txt`). Fetched by the server, cached, and prepended to the system prompt; the panel shows the approximate token cost.

## Chat

Streams an answer (`POST /api/assistant/chat`, SSE) with the current file, compile errors or test output as context when you ask from those places ("Fix this error", "Fix the failing test", …). Code blocks can be inserted at the cursor.

## Agent

Give it a goal; it works in steps (`POST /api/assistant/agent`, SSE events `step`, `thought`, `confirm`, `done`, `error`), at most 16 tool calls per run. Its tools:

| tool | what it does |
| --- | --- |
| `read_file`, `list_files` | read the workspace, **except** secrets: `.env*`, `accounts.real.json`, `.hardkas/dev-accounts`, the dev-server token, keystores, `id_rsa`, `.pem` |
| `write_file` | writes a file; an open editor tab reloads unless it has unsaved changes |
| `compile_silverscript` | `hardkas silver compile <file> --json` |
| `run_tests` | the project's vitest suite |
| `fund_account` | `hardkas localnet fund` / `simulator fund` |
| `execute_terminal_command` | a shell command in the workspace, **only after you approve it** |

### Terminal commands need your approval

Every `execute_terminal_command` pauses the run and shows the command in the panel with three buttons: **Run** (this one), **Run all in this run** (no more questions until the run ends) and **Skip** (the model is told the command was declined and must not retry it). An unanswered command times out after ten minutes and counts as declined. Stopping the run declines it too. The answer travels through `POST /api/assistant/agent/confirm`.

### What "Finished" means

The green **Finished** badge and the final summary are the model's own account of what it did. The IDE shows the steps it took, with each tool's real output, so you can check them; it does not verify the claim. Run the tests and read the diff before trusting a summary.

## Security notes

- Only local origins may call the assistant routes (`localOnly` in `packages/ide-server/src/index.ts`).
- With the OpenCode provider nothing leaves the machine before the user turns it on in the panel (`requireOpenCodeConsent` in `assistant.ts`).
- The agent never reads key material (see the table above) and cannot run anything in the terminal without a click. The OpenCode agent's policy also denies the IDE's own settings folder, `~/.hardkas-ide`.
- Commands run with the workspace as `cwd`, through the same job runner as the Console (`/api/run` allows `hardkas`, `npm` and `npx vitest` only; the agent's terminal tool runs a shell and is the reason for the approval step).
