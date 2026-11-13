import { beforeEach, describe, expect, it, vi } from "vitest";
import { Engine, Plugin } from "@/engine/engine";
import { EnvironmentPlugin } from "./environment";
import { useIde } from "@/store/ide";

class MockConsolePlugin extends Plugin {
  calls: string[][] = [];
  private balances = new Map<string, string>([
    ["alice", "0"],
    ["bob", "0"]
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
        result: [
          { name: "alice", kind: "dev", address: "kaspasim:alice" },
          { name: "bob", kind: "dev", address: "kaspasim:bob" }
        ]
      };
    }
    if (cmd === "accounts balance") {
      const acc = args[2];
      return {
        status: "succeeded",
        exitCode: 0,
        result: {
          address: `kaspasim:${acc}`,
          balanceSompi: this.balances.get(acc) ?? "0",
          utxoCount: this.balances.get(acc) === "0" ? 0 : 1
        }
      };
    }
    if (cmd === "localnet seed") {
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
    devkeys: { list: vi.fn(async () => ["alice", "bob"]) }
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
});
