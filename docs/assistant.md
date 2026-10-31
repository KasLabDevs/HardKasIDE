# Assistant and agent

The **Assistant** side panel talks to a model of your choice about the open project and the Kaspa docs, and can run as an **agent** that edits files and runs HardKas commands in the workspace. Everything goes through the IDE server (`packages/ide-server/src/assistant.ts`); the browser never holds the API key.

## Setup

Settings → Assistant, or the gear in the panel:

- **Provider**: Anthropic (Messages API) or any OpenAI-compatible endpoint (`baseUrl` + model).
- **API key**: stored in `~/.hardkas-ide/assistant.json` on this machine, shown back only as a hint (`sk-…abcd`). `PUT /api/assistant/config` accepts it only from the IDE's own origin.
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
- The agent never reads key material (see the table above) and cannot run anything in the terminal without a click.
- Commands run with the workspace as `cwd`, through the same job runner as the Console (`/api/run` allows `hardkas`, `npm` and `npx vitest` only; the agent's terminal tool runs a shell and is the reason for the approval step).
