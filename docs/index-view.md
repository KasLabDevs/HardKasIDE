# The Index view

HardKAS keeps a SQLite index of everything it produces in `.hardkas/store.db`: every artifact (plans, signed transactions, receipts, traces, SilverScript records, snapshots), the event log, the lineage links between artifacts and the workflow traces. The **Index** view makes it visible. Open it from *View → Index*, the rail, the Welcome page or the command palette ("Show Index").

The IDE only **reads** the database (directly, read-only). Anything that changes it (sync, rebuild) goes through the HardKAS CLI, so the index is never edited by hand.

## Tabs

- **Overview.** Whether the index is current (it compares the newest artifact file with the last indexing time), how many artifacts, events, lineage links and traces it holds, its size, and breakdowns by kind, mode, network, event domain and trace status. Click a bar to open the Artifacts tab filtered by it. Buttons: *Sync* (`hardkas query store sync`), *Rebuild* (`hardkas query store rebuild`, asks first and only recreates the database), *Doctor* (`hardkas query store doctor`, its answer goes to the Console) and *Check for problems*. If the project has no index yet, the tab offers to build it.
- **Artifacts.** A paged table of everything indexed, with search (id, hash, tx id, file, kind) and filters for kind, mode and network. Select a row to see its JSON, its lineage (what it was derived from and what it led to; click to move along the chain) and a field-by-field comparison with another artifact. *Open file* jumps to the artifact on disk and *Transaction* to the next tab.
- **Transactions.** Paste a transaction id, or pick one of the recent ones, to see its artifacts in order (the plan it came from, the signed transaction, the submission or receipt, the trace), the key facts of each (status, from, to, amount, fee, mass) and its events. *Explain* runs `hardkas explain --tx` in the Console.
- **SQL.** A read-only console over the database. One `SELECT`, `WITH`, `EXPLAIN` or `PRAGMA table_info` at a time, at most 500 rows, stopped after 6 seconds. Ctrl+Enter runs it; the left list shows every table and column and puts names into the query; there are ready-made examples and a history; results copy as CSV.
- **Problems.** One button runs every integrity check HardKAS has and lists what it finds: the index is current, artifacts verify (hash, schema, lineage; `hardkas verify`), lineage has no broken links (`query lineage orphans`), receipts match their replay (`query replay divergences`) and workflow traces have finished. Click an item to open the transaction, artifact or file.

## Good to know

- The numbers in Overview are the index's. A few files under `.hardkas/artifacts` are not indexed on purpose (for example the timestamp-named copies of plans), so a file count on disk will not match.
- "Doctor" can report issues even when the index is current: it also reports artifacts that fail verification, which the Problems tab lists one by one.
- The same read-only query is available to AI agents through the MCP server as `query_index` (see [mcp.md](mcp.md)).
- Needs Node 22.13 or newer on the IDE server (built-in `node:sqlite`).
