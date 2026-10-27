import { describe, expect, it } from "vitest";
import { parseNodeStatus } from "./environment";

// `hardkas localnet status --json` as HardKas 0.12.0-rc.29 prints it with the node up (trimmed).
const statusUp = {
  schema: "hardkas.localnetStatus.v1",
  profile: "toccata-v2",
  node: { ready: true, rpcUrl: "ws://127.0.0.1:18210", networkId: "simnet", serverVersion: "2.1.0", isSynced: false, virtualDaaScore: "608283" },
  identity: {
    verified: true,
    expected: { containerName: "hardkas-kaspad-toccata-v2", image: "kaspanet/rusty-kaspad:v2.1.0", network: "simnet", serverVersion: "2.1.0" },
    observed: { container: { name: "hardkas-kaspad-toccata-v2", running: true }, server: { url: "ws://127.0.0.1:18210", networkId: "simnet", serverVersion: "2.1.0", isSynced: false } },
    checkedAt: "2026-10-31T06:40:50.613Z"
  },
  miner: { exists: true, running: false, status: "exited", name: "hardkas-toccata-miner" }
};

describe("parseNodeStatus", () => {
  it("reads the short shape: a node that answers RPC is running and ready", () => {
    const s = parseNodeStatus(statusUp);
    expect(s).toMatchObject({ profile: "toccata-v2", running: true, rpcReady: true, status: "READY", network: "simnet", rpcUrl: "ws://127.0.0.1:18210", serverVersion: "2.1.0", isSynced: false, virtualDaaScore: "608283", containerName: "hardkas-kaspad-toccata-v2" });
    expect(s.miner).toEqual({ running: false, status: "exited" });
    expect(s.checkedAt).toBe("2026-10-31T06:40:50.613Z");
  });

  it("has no miner when HardKas says the container does not exist", () => {
    expect(parseNodeStatus({ ...statusUp, miner: { exists: false, running: false, status: "missing" } }).miner).toBeUndefined();
  });

  it("reads the full shape with container and rpc blocks", () => {
    const s = parseNodeStatus({
      profile: "toccata-v2",
      status: "STARTING",
      container: { name: "hardkas-kaspad-toccata-v2", running: true, image: "kaspanet/rusty-kaspad:v2.1.0" },
      rpc: { ready: false, url: "ws://127.0.0.1:18210", lastError: "connection refused", transports: { grpc: { port: 16210 }, borsh: { port: 17210 }, json: { port: 18210 } } }
    });
    expect(s).toMatchObject({ running: true, rpcReady: false, status: "STARTING", lastError: "connection refused", ports: { rpc: 16210, borshRpc: 17210, jsonRpc: 18210 } });
    expect(s.miner).toBeUndefined();
  });

  it("does not call the node ready when RPC answers but the container is down (another process on the port)", () => {
    const s = parseNodeStatus({
      ...statusUp,
      node: { ...statusUp.node, ready: true, virtualDaaScore: "90000000", isSynced: true },
      identity: { ...statusUp.identity, verified: false, observed: { ...statusUp.identity.observed, container: { name: "hardkas-kaspad-toccata-v2", running: false } } }
    });
    expect(s.rpcReady).toBe(false);
    expect(s.running).toBe(false);
    expect(s.status).toBe("FOREIGN RPC");
    expect(s.lastError).toMatch(/another process holds the port/);
  });

  it("treats an empty answer as a stopped node, with the defaults the Servers view shows", () => {
    const s = parseNodeStatus({});
    expect(s).toMatchObject({ profile: "toccata-v2", running: false, rpcReady: false, status: "STOPPED", network: "simnet", lastError: null });
  });
});
