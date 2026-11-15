# Deploy & Run

One panel, five tabs in the style of the editor's file tabs. Where it runs (simulator, local node, testnet) is chosen in the top bar; Payments says which one is active.

| tab | what is in it |
| --- | --- |
| **Payments** | Plan, sign and send between the project's accounts. Local node status and funding. Run history. Cards to read a transaction (`tx receipt`, `tx verify`, `tx profile`, `tx compare`) and the PSKT commands. |
| **SilverScript** | Your compiled and deployed contracts (deploy, call an entry), then cards for `silver inspect`, `silver verify`, `silver test`, `silver engine plan` and the multisig draft steps (`prepare`, `combine`, `finalize`). |
| **Covenants** | The covenant chains with their genesis and transitions, and a card for `silver covenant inspect`. |
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
- No card takes a password or a private key. Signing steps that need one stay in the CLI.

To add a command, add a `CommandSpec` to `cards.ts` (its words, its fields, a working sample if it takes JSON). `commandSpec.test.ts` checks that every card builds, that ids are unique and that every sample is valid JSON.

## PSKT

Before showing the PSKT cards the IDE runs `hardkas pskt capabilities`. When the runtime reports that it supports no PSKT operation (the Kaspa WASM build does not, today: every command answers `PSKT_OPERATION_UNSUPPORTED`), the cards are folded behind that statement, with a link to show them anyway. If a runtime reports some operations, the cards are shown.
