# Cluster of local nodes

HardKAS runs exactly one local node (rusty-kaspad in Docker, simnet). The **Cluster** card in the Servers view lets you start more nodes next to it, scale them up and down like replicas, and watch each node's chain.

## What you see

- **Extra nodes: − n +.** Scale the number of extra nodes up or down (`+2` adds two at once, *remove all* clears them). The newest node is removed first when scaling down. Up to 12.
- **One card per node** (the HardKAS node is always first and is the reference):
  - state: reference, in sync, syncing, starting or stopped;
  - **height** (the virtual DAA score) and how many blocks it is behind the reference;
  - **final block** (the sink hash, copyable). Two nodes with the same final block agree on the chain;
  - number of tips and connected peers, memory and the RPC port on `127.0.0.1`;
  - while a node is joining, a progress bar with the download speed and an estimate of the time left.
- **Actions per extra node:** stop, start, restart, remove, and a live log view. The HardKAS node only has the log view; it is never started, stopped or changed from here.

## How it works

`packages/ide-server/src/cluster.ts` runs extra containers from the same image as the HardKAS node (`kaspad --simnet`, with its JSON RPC published on `127.0.0.1:28301+`). Each new node peers with the HardKAS node and up to two running extras by IP on Docker's default network. Status comes straight from each node's JSON wRPC (`getBlockDagInfo`, `getConnectedPeerInfo`, `getInfo`), so polling is cheap. The IDE only touches containers it created (label `hardkas-ide.cluster=extra`, names `hardkas-ide-n<N>`).

Extra nodes keep **no data of their own**: they download the chain from their peers and then follow new blocks. Removing one loses nothing.

## What was tested

With five nodes on a private network: blocks mined on one node reached all the others; two nodes stopped and restarted caught up by themselves; after a network split the nodes found each other again and, about two minutes later, agreed on the same final block.

## Limits

- Mining and funding stay on the HardKAS node (they belong to HardKAS' own miner). Extra nodes follow its blocks.
- A joining node copies the **whole** chain. A chain that has been mined for a long time (hundreds of thousands of blocks) takes tens of minutes; the card warns about it. *Reset from scratch* on the HardKAS node starts a short chain that new nodes copy in seconds.
- Each node uses roughly 100 to 700 MB of memory while syncing (capped at 3 GB each) and one CPU at most.
- Sending transactions from HardKAS commands to an extra node would need it declared in `hardkas.config.ts`; the IDE does not edit your configuration for this.
- Needs Docker running. Nodes live in Docker, so they survive restarting the IDE; remove them from the card when you are done.
