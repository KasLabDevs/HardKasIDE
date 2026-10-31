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

## Which hardkas runs

The server resolves the CLI in this order: the project's `node_modules/.bin/hardkas`, `HARDKAS_BIN`, the repo's demo workspace, then `npx @hardkas/cli@<pinned>`. `GET /api/cli` reports the resolved binary and its `--version`; the status bar and the Local node card show it and turn amber when it differs from the version the IDE was tested with (`HARDKAS_CLI_VERSION` in `packages/ide-server/src/runner.ts`).

Records under `.hardkas/artifacts/silver` carry a `schema` (`hardkas.silverDeploy.v1`, …). The IDE checks it when reading them (`apps/ide/src/utils/silverRecords.ts`): a record from a newer schema or with missing fields is listed in the Console and counted in Deploy & Run instead of being read as empty strings.
