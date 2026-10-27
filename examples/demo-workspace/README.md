# demo-workspace

A small HardKas project to open in the IDE: three SilverScript contracts (`contracts/*.sil`), two vitest tests, and a demo dApp. Open it from the Home screen (paste this folder's absolute path), or start the server with:

```bash
pnpm dev:server -- --workspace ./examples/demo-workspace
```

## KaspaAuction dApp

`dapp/index.html` is a page for the `KaspaAuction` covenant. It shows only what it can source: the deployment from `dapp/contract-config.json`, what the local node holds at the covenant address, and the transactions you send from it.

1. Start the local node from the IDE (Servers view) and fund `alice` once.
2. `npm run deploy:auction` compiles `contracts/auction.sil` with alice and bob as seller and bidder, deploys it with 5 KAS from alice and writes `dapp/contract-config.json` (it needs the IDE server running on :7421 for the account addresses).
3. Open **http://127.0.0.1:7421/dapp/** — served by the IDE server, so the page is in *IDE mode*: it queries the node (`hardkas rpc utxos`) and the three entry buttons run real spends (`hardkas silver spend … --wait`) signed by the dev accounts. Nothing confirms unless blocks are mined: use *Mine a burst* in the Servers view.

`npm run dapp` serves the same page on :3300 without the IDE server: *read-only mode*, where the entries are disabled and only KasWare can send KAS to the address.

The `contract-config.json` in the repo is an example of the script's output from one machine's simnet; on another chain the page will report its deploy output as spent (or the node will hold nothing at the address) until you run the deploy script yourself.
