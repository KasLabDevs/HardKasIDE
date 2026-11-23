# Deploy & Run

One panel, six tabs in the style of the editor's file tabs. Where it runs (simulator, local node, testnet) is chosen in the top bar; Payments says which one is active.

| tab | what is in it |
| --- | --- |
| **Payments** | Plan, sign and send between the project's accounts. Local node status and funding. Run history. Cards to read a transaction (`tx receipt`, `tx verify`, `tx profile`, `tx compare`) and the PSKT commands. |
| **SilverScript** | Your compiled and deployed contracts (deploy, call an entry), then cards for `silver inspect`, `silver verify`, `silver test`, `silver engine plan` and the multisig draft steps (`prepare`, `combine`, `finalize`). |
| **Covenants** | The covenant chains with their genesis and transitions; **Start a covenant** (`silver covenant start`, several outputs) and, on each chain, **Advance** (`silver covenant advance`: 1:N, N:M, termination) and **Check at the node** (`silver covenant inspect`); a card for `silver covenant inspect`. |
| **Escrow** | The escrows recorded in the workspace, the one you picked with its state, and the `hardkas escrow` lifecycle as cards: `create`, `fund`, `status`, `prepare`, `sign`, `release`, `reconcile`. Local node only. |
| **KCC20** | On the node (experimental): `kcc20 deploy`, `transfer`, `balance`. Off chain, read-only: `kcc20 encode-state`, `decode-state`, `check`, `artifact`, and `kcc dispatch` / `template-hash`. |
| **ZK** | `zk capabilities`, `zk toccata rules`, `zk proof inspect / verify / verify-math`, `zk corpus verify`, and the Toccata script tools (`build-scripts`, `verify-receipt`, `verify-scripts`). |

The last tab you used is remembered. Arrow keys, Home and End move between the tabs.

## Command cards

A card is one `hardkas` command as a form (`apps/ide/src/panels/run/cards.ts`). Press the button and the IDE runs the real command and reads the JSON it prints:

- a **verdict** when the command judges something (`STRUCTURALLY_VALID`, `REJECTED`, `valid`, `reproduced`, `ok`), green or red; plain information is left uncoloured;
- the answer as **rows** (long values such as hex get their own line and a copy button; objects and lists fold);
- the **exact command line**, to paste in a terminal.

The command also goes to the Console, like any other run.

Rules the cards keep:

- A JSON field (a KCC-20 state, a transfer, a spec) is written to `.hardkas/ide/scratch/<card>-<field>.json` and the command gets that path. The server refuses `& | < > ^ % !` in arguments on Windows, and JSON is full of quotes, so JSON never travels on the command line.
- A value typed in a plain field must not start with `-` (it would be read as an option) nor hold control characters or those shell characters; the card says so instead of sending it.
- Cards that only read, decode or check say so: *Reads and checks only: sends nothing, signs nothing.*
- Commands HardKAS itself labels alpha (`silver test`, `zk proof verify`, `zk proof verify-math`, `zk toccata verify-receipt`) carry an **alpha** badge; the ones it labels experimental (`kcc20 deploy | transfer | balance`, the covenant topologies other than 1:1) carry an **experimental** badge and one sentence from HardKAS's own `docs/status/limitations.md` on what is not proven.
- `--address-network` and `--network` offer testnet-10 at most (the escrow cards, simnet only). HardKAS refuses mainnet while it is locked down, and the IDE never offers it.
- No card takes a password or a private key. A field of kind `account` lists the workspace's accounts by name (a plain text field when none is loaded); the development accounts the node seeded need no password. A field marked `signs` refuses to run for an encrypted account and shows the command to paste in a terminal, where HardKAS asks for the password itself. On testnet-10 HardKAS also wants `--yes` (a checkbox): without it the command answers `NOT EXECUTED` and sends nothing.
- A card that signs and sends says so. A repeatable option (`--holder`, `--to`, `--input`, `--next`, `--output`) is one field whose values are separated by commas: the command gets the option once per value. An option HardKAS declares `<files...>` (`--signatures`) gets its flag once, then every value (`variadic` in the field).

To add a command, add a `CommandSpec` to `cards.ts` (its words, its fields, a working sample if it takes JSON). `commandSpec.test.ts` checks that every card builds, that ids are unique and that every sample is valid JSON.

## Escrow

The v2 escrow lifecycle of HardKAS 0.13 (`EscrowFull` with one principal, `EscrowSplit` with two allocations; three parties, two of three sign a release) on the local node. The simulator has no escrow lifecycle and mainnet is refused by HardKAS itself, so the cards offer simnet only.

**Escrows in this workspace** lists the records `hardkas escrow` writes under `.hardkas/escrows/<id>.json` (schema `hardkas.escrow.record.v1`), read by `apps/ide/src/utils/escrowRecords.ts` with the same tolerance as the Silver records: the schema is checked, what could not be read is reported (count and reasons, once in the Console), and a field the record lacks stays empty rather than invented. Picking one shows the record's facts (address, principal or allocations, the funding with its transaction, the prepared branch, who signed, the release) and the next step in the CLI's own words. **Show status** runs `escrow status <id>` and draws the answer the same way; `status` reads the record and contacts no node. **Reconcile** is what asks the node (its mempool, then its chain) and records what it shows, so a funding or a release goes from `broadcast` to `confirmed` through reconcile, after a block was mined (Mine a burst).

The lifecycle cards fill in the selected escrow's id:

1. **Create** (`escrow create`): buyer, seller and arbiter from the workspace's accounts, the principal (EscrowFull) or both allocations (EscrowSplit), an optional fee budget. Compiled with the pinned silverc and recorded; nothing is sent.
2. **Fund** (`escrow fund --from <buyer>`): one payment of principal + fee budget from the buyer's account. The record says `FUNDED` as soon as the node took it; the funding is `confirmed` once reconcile saw it in a chain block.
3. **Prepare** (`escrow prepare --branch`): one branch (`mutualRelease`, `releaseToSeller`, `refundBuyer`; for a split `executeSplit`, `fullRelease`, `fullRefund`), optional mutual shares. The release request file goes to the workspace root unless **Write the request to** says otherwise.
4. **Sign** (`escrow sign`): the escrow id (the signature goes into the record) or a request file from another workspace, one role, the signing account.
5. **Release** (`escrow release`): sends the signed release, with `--signatures` for request files other workspaces signed. HardKAS refuses it until the node lists the funding unspent in a chain block (`ESCROW_FUNDING_NOT_UNSPENT`): mine a burst, reconcile, release.
6. **Reconcile** (`escrow reconcile`): one look at the node for the pending funding and release.

A refusal is shown as the card's answer with its code and message (`NO_SPENDABLE_UTXOS`, `ESCROW_FUNDING_NOT_UNSPENT`, `ESCROW_CONFIG_INVALID`, …), and every command line goes to the Console. The records in `apps/ide/src/__fixtures__/escrow` are the three states of one escrow walked from the tab on the local node with HardKas 0.13.0-rc.3 (`escrowRecords.test.ts`).

## Covenants: `start` and `advance` (HardKAS 0.13)

`Genesis` (in SilverScript contracts) and `Transition` (on a chain) keep the 1:1 form and its `silverCovenant` records. HardKAS 0.13 added two commands on the SDK's v1 engine, and the Covenants tab runs them:

- **Start a covenant** runs `hardkas silver covenant start <compile record> --from <account> --output <state-file>=<kas>… [--constructor-args <file>] --wait --timeout 600`: one or more outputs, each holding its own state (`{field: {kind, value}}`, prefilled from the compile record's ABI), all bound to the one covenant id the SDK derives. Every output holds a state, or none does.
- **Advance** (on every chain) runs `hardkas silver covenant advance <compile record> --covenant <id> --policy <name> --input txid:index… --next <state-file>[=<kas>]… [--pay <to>=<kas>…] [--terminate] [--args <file>] [--delegate-args <file>…] [--funder <account>] --wait --timeout 600`. The inputs are the chain's tip outputs, ticked in order (the leader first); the leader entry's arguments other than its next states come from the ABI (a `sig` is an account to sign with); one continuation may leave its amount empty to keep what the others and the fee leave. The form shows the topology (`1:2`, `2:1`, `1:0` for a termination) and, unless it is `1:1`, the **experimental** badge with HardKAS's sentence: only 1:1 auth-bound transitions are a corpus capability with real-node evidence; 1:N, N:M and termination are accepted by a real rusty-kaspad on simnet, are not a corpus capability and have no testnet-10 evidence.
- The compile record keeps only a digest of the constructor arguments: a parameter that no State field holds (a bound such as `max_outs`) must be given again, and HardKAS refuses otherwise (`SILVER_CONSTRUCTOR_ARGS_REQUIRED`). The Advance form prefills them from the chain's own plan records.

These two commands write no `silverCovenant` record. The IDE reads the chains they make from the engine's own records (`apps/ide/src/utils/engineCovenants.ts`): `.hardkas/artifacts/plans/txPlan-*.json` (txVersion 1: inputs, outputs, the states declared per output), `signed/signedTx-*.json` (the transaction, its txId, what it spends and which covenant each output is bound to) and `receipts/txSubmission-*.json` (what the node answered). Each reader checks the schema and reports what it could not read, like the silver records' readers; v0 payments in the same folders are skipped. A chain card shows its lineage (genesis, transitions as `inputs:continuations`, payments out of the covenant), the node's recorded answer, and its **tip by this workspace's records**: the outputs nothing recorded spends. That tip is not a claim about the node; **Check at the node** runs `silver covenant inspect <id>` and shows the CLI's verdict (anchor recomputed, links, each tip output listed unspent or not, its state checked against its address). The same chain in a `silverCovenant` record (a `genesis` later `advance`d) is one card: the record's, with the engine's transitions noted.

JSON (states, arguments, constructor arguments) goes to `.hardkas/ide/scratch/covenant-{start,advance}-<run>-*.json`; the exact command line is shown with the answer.

## KCC-20 on the node (experimental)

`kcc20 deploy` (a covenant genesis of the token program with one token output per initial holder), `kcc20 transfer` (the sender's token outputs to the recipients through the program's `transfer` and `transfer_delegator`, checked against the KCC-20 rules before any key is read) and `kcc20 balance` (a holder's, or every holder's, live token outputs from this workspace's records of the covenant, each listed unspent at the node). The program is a compile record: the reference `KCC20.sil` (argent-lang/kcc20-reference) compiled by `silver compile` with its seven zero constructor arguments, which the deploy card carries as its sample (byte lists, not hex strings: `silver compile --args` refuses the latter). The deploy's answer gives the covenant id the transfer and balance cards take. A covenant made this way also appears in the Covenants tab, read from the same engine records.

What HardKAS says about it, shown on the cards: a token's outputs are found through this workspace's records of the covenant (a node cannot be asked by covenant id), so a transfer made by another workspace is not seen, only its effect; balances count only outputs the node lists unspent and whose state commits to their address.

## What confirms, and what the IDE waits for

Blocks on the local simnet exist only while HardKAS's miner runs. A command sent with `--wait` returns when the node lists its outputs, so after pressing a button that sends, press **Mine a burst** in the Servers view (or start the miner). The cards and forms pass `--timeout 600` (the CLI's own default is 120 s: a burst's miner can take a minute or two to find its first block, and a transfer the node then confirmed came back `SILVER_CONFIRMATION_TIMEOUT` at 120 s; nothing was lost, the records say what was sent). A node left without blocks for a while reports itself not synced, and HardKAS refuses to read it (`NODE_NOT_SYNCED`) until a burst is mined.

## Verified live (2026-11-23)

Run from the IDE against the Docker localnet (rusty-kaspad 2.1.0, simnet), with the IDE server pointed at a HardKAS 0.13.0-rc.3 build (`HARDKAS_BIN=<HardKas-repo>/packages/cli/dist/index.js`; the IDE's pinned rc.1 lacks these commands), in the demo workspace:

| what | result |
| --- | --- |
| `kcc20 deploy` (reference KCC20.sil, alice=1000, 1 KAS) | confirmed; covenant `9f606665…`, tx `e7680a6b…`, fee 208300 sompi |
| `kcc20 transfer` alice → bob=600 | accepted and confirmed by the node (tx `73abc5ff…`); the card timed out at the CLI's default 120 s, hence `--timeout 600` |
| `kcc20 balance` (every holder) | bob 600 and alice 400 in two outputs of tx `73abc5ff…`, total 1000 |
| `silver covenant start` (Decls / fanout.sil, one 2 KAS output, value=10) | confirmed; covenant `cef7b6af…`, tx `ffea1559…` |
| `silver covenant advance` 1:2, policy `fanout` (0.8 KAS value=11, the rest value=12) | confirmed; tx `2fa74f32…`, continuations 80000000 and 119830200 sompi, fee 169800 |
| Covenants tab | both chains read from the engine's records with their tips and states |

Not verified live: N:M with delegates (`--delegate-args`), a termination, payments out of a covenant, `--funder`, and testnet-10 (never offered without `--yes`). Right after the advance, `silver covenant inspect` reported the two new outputs "not listed" at the node while `hardkas rpc utxos` listed both unspent with the covenant id: the IDE shows the CLI's answer as it is; the difference is HardKAS's to explain.

The records of these runs are the test fixtures in `apps/ide/src/__fixtures__/engine/` (`engineCovenants.test.ts`).

## PSKT

Before showing the PSKT cards the IDE runs `hardkas pskt capabilities`. When the runtime reports that it supports no PSKT operation (the Kaspa WASM build does not, today: every command answers `PSKT_OPERATION_UNSUPPORTED`), the cards are folded behind that statement, with a link to show them anyway. If a runtime reports some operations, the cards are shown.
