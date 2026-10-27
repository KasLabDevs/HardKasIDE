# Covenant graph

The **Covenant Graph** view (fork icon in the rail) draws the life of one compiled SilverScript contract:

```
deploy records ──► covenant (the P2SH output) ──► one node per entry ──► spend records
```

Everything drawn comes from HardKas records under `.hardkas/artifacts/silver`:

- the **covenant** and its **entries** (name, dispatch tag, argument types, constructor parameters, address, locking script) from the **compile record** (`silverCompile-*.json`, silverc's artifact JSON);
- each **deploy** node from a **deploy record** (`silverDeploy-*.json`) that points at that compile record;
- each **spend** node from a **spend record** (`silverSpend-*.json`) that consumed one of those deploys, placed under the entry it called.

What has not happened is not drawn: a contract that was never deployed shows the covenant and its entries and says so. The contract picker lists the contracts of the last compile in this session ("compiled now") and every contract with a deploy record in the workspace ("deployed"). Clicking a node opens the inspector with the record's values and a button to open the JSON file in the editor.

## Checking the records against the node

Records are what the CLI wrote, not what the chain holds. With the environment on **Local node** and the node running, the view asks the node what it holds at the covenant address (`hardkas rpc utxos <address> --json`), once per address and again after every deploy or spend made from the IDE, or on **Check again**. The result changes the badges:

| badge | meaning |
| --- | --- |
| **on chain** | the deploy's output is still unspent on the node |
| **spent** | a spend record consumed it |
| **spent on chain** | the node no longer holds it, but no spend record names it (spent outside the IDE, or the CLI stopped waiting before the spend confirmed) |
| **live** | records only (node not asked): the deploy was accepted and no spend record consumed it |

Outputs at the address that **no deploy record describes** appear as one dashed node, "Without a record", with their outpoints and total. The usual cause is `hardkas silver deploy --wait` giving up before the block arrived and writing nothing; the coins are locked by the covenant all the same, but Deploy & Run needs a deploy record to build a spend. The legend at the bottom left says what the node check found and when.

## Code

- `apps/ide/src/views/covenantGraph.ts`: the data side (subjects, which deploys and spends belong to a contract, layout, chain reconciliation). Tested in `covenantGraph.test.ts` against real records from the demo workspace (`apps/ide/src/__fixtures__/silver`).
- `apps/ide/src/views/CovenantView.tsx`: the React Flow view and inspectors.
- `apps/ide/src/utils/silverRecords.ts`: the record readers, with schema checks.
