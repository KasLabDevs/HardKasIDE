import { beforeEach, describe, expect, it, vi } from "vitest";
import { Engine, Plugin } from "@/engine/engine";
import { EnvironmentPlugin } from "./environment";
import { useIde } from "@/store/ide";

class MockConsolePlugin extends Plugin {
  calls: string[][] = [];
  legacyCli = false;
  seedErrorStderr: string | null = null;
  private balances = new Map<string, string>([
    ["alice", "0"],
    ["bob", "0"]
  ]);
  private addresses = new Map<string, string>([
    ["alice", "kaspasim:qalicefake000"],
    ["bob", "kaspasim:qbobfake000"]
  ]);

  constructor() {
    super({ name: "console", displayName: "Console", methods: ["runHardkas"] });
  }

  async runHardkas(args: string[]) {
    this.calls.push(args);
    const cmd = `${args[0]} ${args[1] ?? ""}`.trim();
    if (cmd === "accounts list") {
      return {
        status: "succeeded",
        exitCode: 0,
        result: this.legacyCli
          ? [
              { name: "alice", kind: "synthetic", address: "kaspa:sim_alice" },
              { name: "bob", kind: "synthetic", address: "kaspa:sim_bob" }
            ]
          : [
              { name: "alice", kind: "dev", address: "kaspasim:qalicefake000" },
              { name: "bob", kind: "dev", address: "kaspasim:qbobfake000" }
            ]
      };
    }
    if (cmd === "accounts balance") {
      const target = args[2];
      if (this.legacyCli && !target.startsWith("kaspasim:")) {
        return {
          status: "failed",
          exitCode: 1,
          result: { ok: false, code: "UNKNOWN_ERROR", message: "Kaspa RpcApi -> Error: The address prefix is missing" }
        };
      }
      const acc = [...this.addresses.entries()].find(([, addr]) => addr === target)?.[0] ?? target;
      return {
        status: "succeeded",
        exitCode: 0,
        result: {
          address: this.addresses.get(acc) ?? `kaspasim:${acc}`,
          balanceSompi: this.balances.get(acc) ?? "0",
          utxoCount: this.balances.get(acc) === "0" ? 0 : 1
        }
      };
    }
    if (cmd === "localnet seed") {
      if (this.legacyCli) {
        return { status: "failed", exitCode: 1, result: null, stderr: "error: unknown command 'seed'\n" };
      }
      if (this.seedErrorStderr) {
        return { status: "failed", exitCode: 1, result: null, stderr: this.seedErrorStderr };
      }
      this.balances.set("alice", "10000000000");
      this.balances.set("bob", "10000000000");
      return {
        status: "succeeded",
        exitCode: 0,
        result: { status: "TOCCATA_ACCOUNTS_SEEDED", txIds: ["aa".repeat(32)] }
      };
    }
    if (cmd === "localnet fund") {
      const acc = args[2];
      if (this.legacyCli && args.includes("--treasury")) {
        return { status: "failed", exitCode: 1, result: null, stderr: "error: unknown option '--treasury'\n" };
      }
      const before = BigInt(this.balances.get(acc) ?? "0");
      const amountKas = BigInt(args[args.indexOf("--amount") + 1] ?? "100");
      const after = before + amountKas * 100_000_000n;
      this.balances.set(acc, after.toString());
      return {
        status: "succeeded",
        exitCode: 0,
        result: {
          status: "TOCCATA_ACCOUNT_FUNDED",
          before: { matureBalanceSompi: before.toString() },
          after: { matureBalanceSompi: after.toString() }
        }
      };
    }
    return { status: "succeeded", exitCode: 0, result: {} };
  }
}

vi.mock("@/api/client", () => ({
  api: {
    devkeys: {
      list: vi.fn(async () => ["alice", "bob"]),
      addresses: vi.fn(async () => ({ alice: "kaspasim:qalicefake000", bob: "kaspasim:qbobfake000" }))
    }
  }
}));

describe("EnvironmentPlugin localnet 100 KAS treasury integration", () => {
  let consolePlugin: MockConsolePlugin;
  let env: EnvironmentPlugin;

  beforeEach(() => {
    const engine = new Engine();
    consolePlugin = new MockConsolePlugin();
    env = new EnvironmentPlugin();
    engine.register(consolePlugin);
    engine.register(env);
    useIde.setState({ target: "localnet" });
  });

  it("uses one batched localnet seed --amount 100 call when funding all empty accounts on localnet", async () => {
    await env.fundAll("100", undefined, { onlyEmpty: true, target: "localnet" });

    const seedCalls = consolePlugin.calls.filter((c) => c[0] === "localnet" && c[1] === "seed");
    const fundCalls = consolePlugin.calls.filter((c) => c[0] === "localnet" && c[1] === "fund");
    expect(seedCalls).toEqual([["localnet", "seed", "--amount", "100", "--profile", "toccata-v2", "--stop-miner", "--json", "--only-empty"]]);
    expect(fundCalls).toEqual([]);
  });

  it("passes --treasury when funding a single account on localnet", async () => {
    await env.fund("bob", "100", { target: "localnet", refreshAfter: false });

    const fundCalls = consolePlugin.calls.filter((c) => c[0] === "localnet" && c[1] === "fund");
    expect(fundCalls).toEqual([["localnet", "fund", "bob", "--treasury", "--amount", "100", "--profile", "toccata-v2", "--stop-miner", "--json"]]);
  });

  it("falls back cleanly on 0.12.x/0.13.0-rc.1 CLIs without localnet seed, --treasury, or alias simnet balances", async () => {
    consolePlugin.legacyCli = true;

    await env.fundAll("100", undefined, { onlyEmpty: true, target: "localnet" });

    const seedCalls = consolePlugin.calls.filter((c) => c[0] === "localnet" && c[1] === "seed");
    const fundCalls = consolePlugin.calls.filter((c) => c[0] === "localnet" && c[1] === "fund");
    expect(seedCalls).toHaveLength(1);
    expect(fundCalls).toEqual([
      ["localnet", "fund", "alice", "--treasury", "--amount", "100", "--profile", "toccata-v2", "--stop-miner", "--json"],
      ["localnet", "fund", "alice", "--amount", "100", "--profile", "toccata-v2", "--stop-miner", "--json"],
      ["localnet", "fund", "bob", "--amount", "100", "--profile", "toccata-v2", "--stop-miner", "--json"]
    ]);
    const balanceCalls = consolePlugin.calls.filter((c) => c[0] === "accounts" && c[1] === "balance").map((c) => c[2]);
    expect(balanceCalls).toContain("kaspasim:qalicefake000");
    expect(balanceCalls).toContain("kaspasim:qbobfake000");
  });

  it("surfaces CLI stderr errors when seed fails without JSON output", async () => {
    consolePlugin.seedErrorStderr = "error: Docker daemon is not running\n";

    await expect(env.fundAll("100", undefined, { onlyEmpty: true, target: "localnet" })).rejects.toThrow("error: Docker daemon is not running");
  });
});
