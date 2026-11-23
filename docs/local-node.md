# Local node, blocks and confirmations

The **Local node** environment is HardKas' own rusty-kaspad in Docker (`hardkas localnet start --toccata`, container `hardkas-kaspad-toccata-v2`, simnet, wRPC on `ws://127.0.0.1:18210`). The Servers view starts, stops, restarts and resets it; the Accounts card shows the dev accounts `alice…erin` with their simnet balances.

## Blocks only exist while the miner runs

A private simnet has no network to mine for it. HardKas runs a CPU miner (`kaspanet/cpuminer`, container `hardkas-toccata-miner`) **only while `hardkas localnet fund` is funding an account**; when the funding ends, the miner stops and the chain stands still. So:

- A deploy or spend sent with the miner stopped reaches the mempool and **stays there**. `hardkas silver deploy/spend --wait` gives up after its timeout and, when it does, **writes no record** even though the transaction is still pending and confirms as soon as blocks come. The IDE passes `--timeout 600` for that reason.
- A miner left running flat out (`--keep-miner`) finds blocks faster than the node accepts them. The miner log fills with `Block was not submitted: route is full`, and confirmations take minutes instead of seconds.

The **Local node** card in the Servers view (and the top of Deploy & Run) says which of the two is happening and offers:

| action | what runs | when to use it |
| --- | --- | --- |
| **Mine a burst** | `hardkas localnet fund <first account> --amount 1 --stop-miner` | You sent a transaction and want it confirmed: mines until one more mature KAS reaches the account (a few minutes on a long chain), then stops. |
| **Start miner** | `docker start hardkas-toccata-miner` | You want continuous blocks for a while (several deploys and spends in a row). Stop it afterwards. |
| **Stop miner** | `docker stop -t 2 hardkas-toccata-miner` | The explorer's Blocks tab shows `route is full`, or you are done. |

The miner container exists only after the first funding; before that the card says so and offers the burst (which creates it).

The **Explorer** card (Blocks tab) shows the blocks the miner found, its rate, and how many blocks the node refused in the current log window.

## History and live UTXOs of an address

The Explorer card reads an address two more ways, both through HardKas 0.13.0-rc.3 commands (an older CLI lacks them, and the card says so):

- **History tab** runs `hardkas history <address> --json` for the account picked (or any pasted address). The node keeps no address index: the CLI walks a bounded window of the node's selected chain (by default the last 1000 chain blocks, never before the pruning point) and lists every accepted transaction that pays the address or spends from it, with the depth of its acceptance (blue-score and DAA confirmations, measured from the node's tip at the end of the read) and the direction (`paid`, `spent` or `self` for a transaction that does both, like a payment with change). The workspace's own records (submissions, receipts and their plans) are merged in: a transaction the node accepted and the workspace recorded says so, and a record whose acceptance the window does not hold is listed last with the CLI's reason. **Every result states what the window covered**, and the card shows that line as the CLI meant it (how many chain blocks, from where to where, whether it reached the tip or stopped early) plus the "not covered" list: a mempool is not history, an unsynced node has not seen everything, and other workspaces' records are not merged. Pages come from the CLI's cursor (`--cursor`); the arrows read the next page or go back along the pages already read. The **record** link of an entry opens the artifact file the Run history read for that tx, or the Index view's Transactions tab when there is none.
- **Watch** (UTXOs tab) runs `hardkas watch <address> --json` as a long-lived job and applies its JSON lines to the UTXO list as they arrive: the `snapshot` first (the node's full list and balance), then `added`, `removed` and `matured` per transaction, a `resync` after every reconnect (the whole difference), connection notices and errors, `end` last. A feed under the toggle shows the last events. A watched output has no DAA score until **Load** reads the list again (`rpc utxos`), which only fills in what it knows and keeps the live list. The job is stopped (`DELETE /api/jobs/:id`, which kills the CLI process, the whole tree on Windows) when the toggle goes off, when the Explorer card leaves the screen (another side panel, the view scrolled away), when the node stops, when the page unloads, and when the explorer plugin deactivates. Nothing polls and nothing watches while the card is off screen.

Neither reading is faked: every row comes from the CLI's result, and a watch that ends says why (the CLI's `end` reason, or the IDE's: toggle off, node stopped, explorer off screen).

`DELETE /api/jobs/:id` is new in this version and guarded like every other write (same-origin IDE page or a local program). Its `killed` is false when the job had already ended.

## Reset from scratch

The reset (it asks first) stops the node, clears the project's chain state (`.hardkas/node-data`, `.hardkas/localnet`), wipes the node with `hardkas localnet reset --yes` (on a CLI without `localnet reset`, up to 0.13.0-rc.3, the deprecated `hardkas node reset --yes`), starts a fresh one and funds the dev accounts. Keys are never deleted: the dev keystores (`.hardkas/dev-accounts`) are moved to `.hardkas/backups/reset-<time>/`, and `.hardkas/accounts.real.json` (which can hold testnet keys) stays in place while a copy goes to the same backup. The reset is refused when `.hardkas` is a link to another folder, and in a folder that is not trusted.

## Which hardkas runs

The server resolves the CLI in this order: `HARDKAS_BIN`; then, only when `HARDKAS_IDE_CLI_FROM_REPO=1` (for work on HardKas itself), a sibling `HardKas-repo` build and the IDE repo's demo workspace; then the project's `node_modules/.bin/hardkas`; then `npx @hardkas/cli@<pinned>`. In a folder that is not trusted the CLI is not run, so no version is shown. `GET /api/cli` reports the resolved binary and its `--version`; the status bar and the Local node card show it and turn amber when it differs from the version the IDE was tested with (`HARDKAS_CLI_VERSION` in `packages/ide-server/src/runner.ts`).

`HARDKAS_BIN` may point at a `.js` entry (a local build of the CLI, e.g. `HardKas-repo/packages/cli/dist/index.js`): the server then runs it with its own `node`. To run a second IDE checkout (a git worktree) next to the first, give both servers their own ports: `HARDKAS_IDE_PORT` for ide-server, `HARDKAS_IDE_UI_PORT` for the Vite dev server (which also reads `HARDKAS_IDE_PORT` for its `/api` proxy), and the UI's origin in `HARDKAS_IDE_EXTRA_ORIGINS` so the server accepts it:

```powershell
$env:HARDKAS_IDE_PORT = '7431'; $env:HARDKAS_IDE_EXTRA_ORIGINS = 'http://localhost:5183'; pnpm --filter @hardkas-ide/server run dev
```

```powershell
$env:HARDKAS_IDE_UI_PORT = '5183'; $env:HARDKAS_IDE_PORT = '7431'; pnpm --filter @hardkas-ide/ide exec vite --port 5183 --strictPort
```

Records under `.hardkas/artifacts/silver` carry a `schema` (`hardkas.silverDeploy.v1`, …). The IDE checks it when reading them (`apps/ide/src/utils/silverRecords.ts`): a record from a newer schema or with missing fields is listed in the Console and counted in Deploy & Run instead of being read as empty strings.

## One local node

The IDE works with HardKAS' single local node and nothing else. Earlier IDE versions also had a **Cluster** card that started extra simnet nodes next to it; it was removed because contract work needs one node, and extra nodes only cost Docker resources next to the shared one. Containers it created are named `hardkas-ide-n<number>` and carry the label `hardkas-ide.cluster=extra`; the IDE no longer touches them. To remove leftovers (only those, never the HardKAS node):

```sh
docker ps -a --filter label=hardkas-ide.cluster=extra
docker rm -f $(docker ps -aq --filter label=hardkas-ide.cluster=extra)
```
