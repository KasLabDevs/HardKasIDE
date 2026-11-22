# Deploy & Run

One panel, six tabs in the style of the editor's file tabs. Where it runs (simulator, local node, testnet) is chosen in the top bar; Payments says which one is active.

| tab | what is in it |
| --- | --- |
| **Payments** | Plan, sign and send between the project's accounts. Local node status and funding. Run history. Cards to read a transaction (`tx receipt`, `tx verify`, `tx profile`, `tx compare`) and the PSKT commands. |
| **SilverScript** | Your compiled and deployed contracts (deploy, call an entry), then cards for `silver inspect`, `silver verify`, `silver test`, `silver engine plan` and the multisig draft steps (`prepare`, `combine`, `finalize`). |
| **Covenants** | The covenant chains with their genesis and transitions, and a card for `silver covenant inspect`. |
| **Escrow** | The escrows recorded in the workspace, the one you picked with its state, and the `hardkas escrow` lifecycle as cards: `create`, `fund`, `status`, `prepare`, `sign`, `release`, `reconcile`. Local node only. |
| **KCC20** | `kcc20 encode-state`, `decode-state`, `check`, `artifact`, and `kcc dispatch` / `template-hash`. All read-only. |
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
- Commands HardKAS itself labels alpha (`silver test`, `zk proof verify`, `zk proof verify-math`, `zk toccata verify-receipt`) carry an **alpha** badge.
- `--address-network` offers testnet-10 only. HardKAS refuses mainnet while it is locked down, and the IDE never offers it.
- No card takes a password or a private key. Signing steps that need one stay in the CLI: a field of kind `account` marked `signs` refuses to run for an encrypted account and shows the command to paste in a terminal, where HardKAS asks for the password itself. Development accounts need none.
- An `account` field lists the workspace's accounts by name (a plain text field when the workspace has none).

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

## PSKT

Before showing the PSKT cards the IDE runs `hardkas pskt capabilities`. When the runtime reports that it supports no PSKT operation (the Kaspa WASM build does not, today: every command answers `PSKT_OPERATION_UNSUPPORTED`), the cards are folded behind that statement, with a link to show them anyway. If a runtime reports some operations, the cards are shown.
