import { describe, expect, it } from "vitest";
import compileAuction from "@/__fixtures__/silver/compile-kaspaauction.json";
import compileRelease from "@/__fixtures__/silver/compile-signedrelease.json";
import deployAuction from "@/__fixtures__/silver/deploy-kaspaauction.json";
import deployLive from "@/__fixtures__/silver/deploy-signedrelease-live.json";
import deploySpent from "@/__fixtures__/silver/deploy-signedrelease-spent.json";
import spendRelease from "@/__fixtures__/silver/spend-signedrelease.json";
import {
  groupCovenantChains,
  markSpent,
  markSupersededCovenants,
  newestFirst,
  parseCompileRecord,
  parseCovenantRecord,
  parseDeployRecord,
  parseJsonRecord,
  parseSchema,
  parseSpendRecord,
  schemaProblems
} from "./silverRecords";

// The fixtures are real records written by HardKas 0.12.0-rc.29 for the demo workspace.
const raw = (o: unknown) => o as Record<string, unknown>;

describe("schema", () => {
  it("parses hardkas.<family>.v<major>", () => {
    expect(parseSchema("hardkas.silverDeploy.v1")).toEqual({ family: "silverDeploy", major: 1 });
    expect(parseSchema("hardkas.silverSpend.v12")).toEqual({ family: "silverSpend", major: 12 });
    expect(parseSchema("something else")).toBeNull();
    expect(parseSchema(undefined)).toBeNull();
  });

  it("accepts the known version and names every other case", () => {
    expect(schemaProblems(raw(deployLive), "silverDeploy")).toEqual([]);
    expect(schemaProblems({ schema: "hardkas.silverDeploy.v2" }, "silverDeploy")[0]).toMatch(/newer than this IDE understands \(v1\)/);
    expect(schemaProblems({ schema: "hardkas.silverSpend.v1" }, "silverDeploy")[0]).toMatch(/not a silverDeploy record/);
    expect(schemaProblems({}, "silverDeploy")[0]).toMatch(/no schema field/);
  });
});

describe("parseJsonRecord", () => {
  it("returns the object or says why not", () => {
    expect(parseJsonRecord('{"a":1}')).toEqual({ raw: { a: 1 }, problem: null });
    expect(parseJsonRecord("[1]").problem).toBe("not a JSON object");
    expect(parseJsonRecord("{oops").problem).toMatch(/invalid JSON/);
  });
});

describe("parseCompileRecord", () => {
  it("reads the ABI of KaspaAuction with its three entries and constructor params", () => {
    const { record, problems } = parseCompileRecord("c.json", raw(compileAuction));
    expect(problems).toEqual([]);
    expect(record?.contentHash).toBe(compileAuction.contentHash);
    expect(record?.sourcePath).toBe("contracts/auction.sil");
    expect(record?.networkId).toBe("simnet");
    expect(record?.hardkasVersion).toBe("0.12.0-rc.29");
    const c = record!.contracts.find((x) => x.name === "KaspaAuction")!;
    expect(c.entries.map((e) => e.name).sort()).toEqual(["cancel", "claim", "close"]);
    expect(c.entries.find((e) => e.name === "close")?.params).toEqual([{ name: "sellerSig", kind: "sig" }]);
    expect(c.constructorParams?.map((p) => p.name)).toEqual(["seller", "highestBidder", "minBidSompi"]);
    expect(c.address).toMatch(/^kaspasim:p/);
  });

  it("reads SignedRelease with one entry", () => {
    const { record } = parseCompileRecord("c.json", raw(compileRelease));
    expect(record?.contracts.map((c) => c.name)).toEqual(["SignedRelease"]);
    expect(record?.contracts[0].entries.map((e) => e.name)).toEqual(["release"]);
  });

  it("reports a record with no contracts", () => {
    const { problems } = parseCompileRecord("c.json", { schema: "hardkas.silverCompile.v1", contentHash: "x" });
    expect(problems).toContain("no contracts found in artifactJson or contracts[]");
  });
});

describe("parseDeployRecord", () => {
  it("reads a confirmed deploy and keeps the link to its compile record", () => {
    const { record, problems } = parseDeployRecord("d.json", raw(deployLive));
    expect(problems).toEqual([]);
    expect(record).toMatchObject({
      recordPath: "d.json",
      contract: "SignedRelease",
      address: deployLive.address,
      txId: deployLive.txId,
      outpoint: { transactionId: deployLive.txId, index: 0 },
      valueSompi: "500000000",
      feeSompi: "204700",
      status: "confirmed",
      networkId: "simnet",
      compileRecordPath: ".hardkas/artifacts/silver/silverCompile-aabb26b4bbcb9f87.json",
      hardkasVersion: "0.12.0-rc.29",
      spent: false
    });
  });

  it("refuses a file without the fields a deploy needs, and says which", () => {
    const { record, problems } = parseDeployRecord("d.json", { schema: "hardkas.silverDeploy.v1", contract: "X" });
    expect(record).toBeNull();
    expect(problems).toEqual(["missing address, txId, contentHash", "missing outpoint {transactionId, index}"]);
  });

  it("still reads a newer schema, flagged", () => {
    const { record, problems } = parseDeployRecord("d.json", { ...raw(deployLive), schema: "hardkas.silverDeploy.v3" });
    expect(record?.txId).toBe(deployLive.txId);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/newer/);
  });
});

describe("parseSpendRecord", () => {
  it("reads a spend with the outpoint it consumed", () => {
    const { record, problems } = parseSpendRecord("s.json", raw(spendRelease));
    expect(problems).toEqual([]);
    expect(record).toMatchObject({
      txId: spendRelease.txId,
      contract: "SignedRelease",
      entry: "release",
      to: spendRelease.to,
      outputSompi: "499824800",
      feeSompi: "175200",
      status: "confirmed",
      deployContentHash: spendRelease.deployRecord.contentHash,
      spentOutpoint: { transactionId: spendRelease.spentOutpoint.transactionId, index: 0 }
    });
  });

  it("keeps a spend without spentOutpoint but warns that nothing can be marked spent", () => {
    const { spentOutpoint: _o, ...rest } = raw(spendRelease);
    const { record, problems } = parseSpendRecord("s.json", rest);
    expect(record?.spentOutpoint).toBeUndefined();
    expect(problems[0]).toMatch(/missing spentOutpoint/);
  });
});

describe("markSpent + newestFirst", () => {
  it("marks exactly the deploy whose outpoint the spend consumed", () => {
    const deploys = [parseDeployRecord("live.json", raw(deployLive)).record!, parseDeployRecord("spent.json", raw(deploySpent)).record!, parseDeployRecord("auction.json", raw(deployAuction)).record!];
    const spends = [parseSpendRecord("s.json", raw(spendRelease)).record!];
    expect(spendRelease.spentOutpoint.transactionId).toBe(deploySpent.txId); // the fixture pair really is linked
    const marked = markSpent(deploys, spends);
    expect(marked.map((d) => [d.recordPath, d.spent])).toEqual([
      ["live.json", false],
      ["spent.json", true],
      ["auction.json", false]
    ]);
  });

  it("orders by createdAt, newest first, undated last", () => {
    const list = newestFirst([{ createdAt: "2026-10-26T00:00:00Z", n: 1 }, { n: 3 }, { createdAt: "2026-10-30T00:00:00Z", n: 2 }]);
    expect(list.map((x) => x.n)).toEqual([2, 1, 3]);
  });
});

describe("Toccata covenant records & ABI decoding", () => {
  const sampleCounterCompile = {
    schema: "hardkas.silverCompile.v1",
    contentHash: "0b3fae3bd823117ad48e12e738311704b559b8d1d9baa86be82dfa8a7c27dc1f",
    networkId: "simnet",
    source: {
      path: "contracts/counter.sil",
      text: `pragma silverscript ^0.1.0;\ncontract Counter(int init_value) {\n  int value = init_value;\n  #[covenant(binding = auth, from = 1, to = 1, mode = transition)]\n  function bump(State prev_state, int delta) : (State) {\n    require(delta > 0);\n    return(State { value: prev_state.value + delta });\n  }\n}`
    },
    artifactJson: JSON.stringify({
      schema_version: 1,
      compiler_version: "0.1.0",
      structs: {},
      contracts: {
        Counter: {
          runtime_state: {
            source: "State",
            fields: [{ name: "value", type: { kind: "int" } }]
          },
          entries: {
            __covenant_entrypoint_auth_bump: {
              dispatch_tag: "f3489a39",
              params: [{ name: "delta", type: { kind: "int" } }]
            }
          },
          cov_decl_to_abi: { bump: "__covenant_entrypoint_auth_bump" },
          compiled: {
            bytecode: [107, 8, 8, 0, 0, 0, 0, 0, 0, 0, 108],
            template_hash: new Array(32).fill(1),
            state_span: { offset: 1, len: 9 }
          }
        }
      }
    }),
    contracts: [{ name: "Counter", address: "kaspasim:prh9794z4vsajyjekcpcvmwc8fkxtnm3udz7dmjcqn9gedd8qr072w7cnfgp2" }]
  };

  it("decodes Toccata runtime_state values, policies, and default stateMap from compile artifacts", () => {
    const { record, problems } = parseCompileRecord("compile.json", sampleCounterCompile);
    expect(problems).toEqual([]);
    const abi = record!.contracts[0];
    expect(abi.stateFields).toEqual([{ name: "value", kind: "int" }]);
    expect(abi.covenantPolicies).toEqual({ bump: "__covenant_entrypoint_auth_bump" });
    expect(abi.stateValues).toEqual({ value: "8" });
    expect(abi.stateMapDefault).toEqual({ value: 0 });
  });

  it("parses genesis + transition silverCovenant.v1 records and groups active head chains", () => {
    const genesis = parseCovenantRecord("cov-gen.json", {
      schema: "hardkas.silverCovenant.v1",
      kind: "genesis",
      createdAt: "2026-11-13T03:28:30.000Z",
      contract: "Counter",
      covenantId: "cov-abc",
      address: "kaspasim:pqt",
      txId: "tx0",
      outpoint: { transactionId: "tx0", index: 0 },
      valueSompi: "1000000000",
      status: "confirmed",
      contentHash: "h0"
    });
    const transition = parseCovenantRecord("cov-tr.json", {
      schema: "hardkas.silverCovenant.v1",
      kind: "transition",
      createdAt: "2026-11-13T03:28:40.000Z",
      contract: "Counter",
      policy: "bump",
      covenantId: "cov-abc",
      address: "kaspasim:prh",
      txId: "tx1",
      outpoint: { transactionId: "tx1", index: 0 },
      previous: { path: "cov-gen.json", contentHash: "h0", outpoint: { transactionId: "tx0", index: 0 } },
      valueSompi: "999928100",
      status: "confirmed",
      contentHash: "h1"
    });
    expect(genesis.problems).toEqual([]);
    expect(transition.problems).toEqual([]);

    const marked = markSupersededCovenants([genesis.record!, transition.record!]);
    expect(marked[0].superseded).toBe(true);
    expect(marked[1].superseded).toBe(false);

    const chains = groupCovenantChains(marked);
    expect(chains).toHaveLength(1);
    expect(chains[0].head.contentHash).toBe("h1");
    expect(chains[0].history.map((h) => h.kind)).toEqual(["genesis", "transition"]);
  });
});
