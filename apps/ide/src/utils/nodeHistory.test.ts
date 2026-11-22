import { describe, expect, it } from "vitest";
import afterSeed from "@/__fixtures__/node/history-alice-after-seed.json";
import afterBurstLimit2 from "@/__fixtures__/node/history-alice-after-burst-limit2.json";
import afterSpend from "@/__fixtures__/node/history-alice-after-spend.json";
import { describeWindow, directionLabel, entryAmount, HISTORY_SCHEMA, parseHistoryResult } from "./nodeHistory";

// The fixtures are what `hardkas history <alice> --json` (HardKas 0.13.0-rc.3 build) printed against the IDE's local
// simnet node of the demo workspace: right after the node seeded the dev accounts, after one mining burst with
// `--limit 2` (a second page exists), and after alice paid bob 1 KAS from the CLI and a burst confirmed it.

describe("parseHistoryResult", () => {
  it("reads the first page of a fresh account: one payment from the node, three records of the workspace", () => {
    const parsed = parseHistoryResult(afterSeed, { now: 1 });
    expect(parsed.error).toBeNull();
    const v = parsed.view!;
    expect(v.address).toBe("kaspasim:qqlpk9rs7yag6eqj3lttzqd8vgvssz8l8fxlpdag4h7zx2rjjr8lkkerwkezn");
    expect(v.networkId).toBe("simnet");
    expect(v.entries).toHaveLength(4);
    expect(v.total).toBe(4);
    expect(v.offset).toBe(0);
    expect(v.limit).toBe(100);
    expect(v.cursor).toBeUndefined();
    expect(v.nextCursor).toBeUndefined();
    expect(v.loadedAt).toBe(1);
    expect(v.tipDaa).toBe("6217");
    expect(v.sinkBlueScore).toBe("5606");
    expect(v.nodeSynced).toBe(false);
    expect(v.serverVersion).toBe("2.1.0");
    expect(v.spendsCoverage).toBe("node-entries");
    expect(v.workspace).toEqual({ merged: true, records: 3, outsideWindow: 3, rejected: 0 });
    expect(v.notCovered).toHaveLength(3);
    expect(v.notCovered[0]).toMatch(/mempool is not history/);
  });

  it("keeps the window facts the node stated", () => {
    const w = parseHistoryResult(afterSeed).view!.window;
    expect(w).toMatchObject({
      requestedKind: "default",
      lookback: 1000,
      fromDaa: "0",
      firstCoveredDaaScore: "1",
      toDaa: "6213",
      chainBlocks: 143,
      reachedTip: true,
      startsAtPruningPoint: true,
      pruningPointIsGenesis: true,
      clampedToPruningPoint: false,
      requestedStartNotReached: false,
      startOffSelectedChain: false,
      stoppedBy: "tip"
    });
    expect(w.fromHash).toHaveLength(64);
    expect(w.continueFrom).toBeUndefined();
  });

  it("reads a node entry with its acceptance and confirmations", () => {
    const e = parseHistoryResult(afterSeed).view!.entries[0];
    expect(e.txId).toBe("170ecff27b8c17303ecffde73555e7f89ef5d200e96a59402f0b9d34e56f3606");
    expect(e.source).toBe("node");
    expect(e.direction).toBe("in");
    expect(directionLabel(e.direction)).toBe("paid");
    expect(e.receivedSompi).toBe("10000000000");
    expect(e.netSompi).toBe("10000000000");
    expect(e.coinbase).toBe(false);
    expect(e.covenantBound).toBe(false);
    expect(e.covenantId).toBeUndefined();
    expect(e.outputs).toEqual([{ index: 0, amountSompi: "10000000000", covenantId: undefined, spentBy: undefined }]);
    expect(e.spends).toEqual([]);
    expect(e.acceptance).toEqual({
      chainBlockHash: "f7fab1f599999682d23d88cbd22bcdb08ae6726c35074e0fc88a33cb9288969a",
      daaScore: "3911",
      blueScore: "3432",
      previousChainBlockHash: "f94ae3e431baff7fa6a8ec2f390c1c3f0a5f2a7751ae48c4a6d5096438ba103f",
      confirmationsDaa: "2306",
      confirmationsBlue: "2174"
    });
    expect(e.workspace).toBeUndefined();
    expect(e.outsideWindow).toBeUndefined();
    expect(entryAmount(e)).toEqual({ sompi: "10000000000", sign: "+", known: true });
  });

  it("reads a workspace-only record: no acceptance, the CLI's reason why the window does not show it", () => {
    const e = parseHistoryResult(afterSeed).view!.entries[1];
    expect(e.source).toBe("workspace");
    expect(e.direction).toBe("self");
    expect(directionLabel(e.direction)).toBe("self");
    expect(e.acceptance).toBeUndefined();
    expect(e.spentSompi).toBe("5000000000");
    expect(e.netSompi).toBe("-1000203600");
    expect(entryAmount(e)).toEqual({ sompi: "1000203600", sign: "-", known: true });
    expect(e.outputs[0]).toMatchObject({ index: undefined, amountSompi: "3999796400" });
    expect(e.spends[0]).toMatchObject({ outpoint: "3dc6e4635d3390bfe502c83a8f220bc31df2414d4a14e8b2cdfad6da6584dad5:38", amountSompi: "5000000000", matchedBy: "workspace-plan" });
    expect(e.workspace).toEqual({
      submissionArtifactId: "2910390a098bf80d252b63d16b4d77d83b95f87dcae1dd8164e6f05f50d2632e",
      receiptArtifactId: undefined,
      planArtifactId: "c6681cdc856c3aeea8b6c816d265ea3bda312be3e1e08b60f5c7f6d1a0cb8448",
      submittedAt: "2026-10-26T01:08:44.069Z",
      state: "SUBMITTED",
      acceptingBlockHash: undefined
    });
    expect(e.outsideWindow).toMatch(/locates no accepting chain block/);
    const confirmed = parseHistoryResult(afterSeed).view!.entries[2];
    expect(confirmed.workspace?.state).toBe("CONFIRMED");
    expect(confirmed.workspace?.acceptingBlockHash).toHaveLength(64);
  });

  it("reads a page that is not the last one: its size, its next cursor, the total over every page", () => {
    const v = parseHistoryResult(afterBurstLimit2, { cursor: undefined }).view!;
    expect(v.entries).toHaveLength(2);
    expect(v.total).toBe(5);
    expect(v.limit).toBe(2);
    expect(v.offset).toBe(0);
    expect(typeof v.nextCursor).toBe("string");
    expect(v.nextCursor!.length).toBeGreaterThan(20);
    // the burst's payment to alice, accepted by the chain
    expect(v.entries[1]).toMatchObject({ txId: "c29d0ee95bf65c5898f189bb376a15b56496b19860500e8288be501d51f28fc9", source: "node", direction: "in", receivedSompi: "100000000" });
    expect(v.entries[1].acceptance?.daaScore).toBe("6235");
    // the cursor a page was read with is kept on the view, for the "previous" trail
    expect(parseHistoryResult(afterBurstLimit2, { cursor: "abc" }).view!.cursor).toBe("abc");
  });

  it("reads a transaction the node accepted and the workspace recorded (alice paid bob 1 KAS), with the outputs it spent", () => {
    const v = parseHistoryResult(afterSpend).view!;
    expect(v.total).toBe(8);
    expect(v.workspace.outsideWindow).toBe(4);
    const spend = v.entries.find((e) => e.txId === "b0d762ef59303790b2e123ca0450819e869390547a786baf9092c3928beea5d6")!;
    expect(spend.source).toBe("node+workspace");
    expect(spend.direction).toBe("self");
    expect(directionLabel(spend.direction)).toBe("self");
    expect(spend.netSompi).toBe("-100315400");
    expect(entryAmount(spend)).toEqual({ sompi: "100315400", sign: "-", known: true });
    expect(spend.spends.map((s) => s.outpoint)).toEqual(["170ecff27b8c17303ecffde73555e7f89ef5d200e96a59402f0b9d34e56f3606:0", "c29d0ee95bf65c5898f189bb376a15b56496b19860500e8288be501d51f28fc9:0"]);
    expect(spend.spends.every((s) => s.matchedBy === "node-entry")).toBe(true);
    expect(spend.acceptance?.confirmationsBlue).toBe("785");
    expect(spend.workspace?.submissionArtifactId).toBe("983e6dc358ccc8af6fe88f4e3f9afeef685c1a885d1c8c827996093c6451072d");
    expect(spend.workspace?.state).toBe("SUBMITTED");
    expect(spend.outsideWindow).toBeUndefined();
    // the seed payment's output now says which transaction of the window spent it
    const seed = v.entries.find((e) => e.txId === "170ecff27b8c17303ecffde73555e7f89ef5d200e96a59402f0b9d34e56f3606")!;
    expect(seed.outputs[0].spentBy).toBe(spend.txId);
  });

  it("says what the window covered, from the result only", () => {
    const text = describeWindow(parseHistoryResult(afterSeed).view!);
    expect(text).toBe("The node covered 143 chain blocks from the node's genesis (DAA 0: its whole history) to the node's tip (DAA 6213).");
  });

  it("describes a window that stopped early and one clamped to the pruning point", () => {
    const base = parseHistoryResult(afterSeed).view!;
    const early = { ...base, window: { ...base.window, startsAtPruningPoint: false, pruningPointIsGenesis: false, fromDaa: "5000", reachedTip: false, stoppedBy: "deadline", toDaa: "5900", continueFrom: "abcd" } };
    expect(describeWindow(early)).toBe(
      "The node covered 143 chain blocks after chain block DAA 5000 (the last 1000 chain blocks) to DAA 5900, where it stopped (deadline). what follows is not covered; the next window continues from the block the result names."
    );
    const clamped = { ...base, window: { ...base.window, pruningPointIsGenesis: false, clampedToPruningPoint: true, requestedKind: "daaScore" } };
    expect(describeWindow(clamped)).toMatch(/^The node covered 143 chain blocks from the node's pruning point \(DAA 0: nothing older is readable on it\) to the node's tip \(DAA 6213\)\. the requested start was below the pruning point/);
  });

  it("returns the CLI's own refusal, and a plain error for a document that is not a history", () => {
    expect(parseHistoryResult({ ok: false, code: "RPC_CONNECTION_FAILED", message: "Cannot connect" })).toEqual({ view: null, error: "RPC_CONNECTION_FAILED: Cannot connect" });
    expect(parseHistoryResult(null).error).toMatch(/0\.13\.0-rc\.3/);
    expect(parseHistoryResult({ ok: true, entries: [] }).error).toMatch(/no history result/);
    expect(parseHistoryResult({ ...afterSeed, schema: "hardkas.addressHistory.v2" }).error).toMatch(/v2; this IDE reads hardkas\.addressHistory\.v1/);
    expect(HISTORY_SCHEMA).toBe("hardkas.addressHistory.v1");
  });

  it("does not invent an amount: an entry without netSompi shows what was received, flagged unknown", () => {
    const raw = { ...afterSeed, entries: [{ ...afterSeed.entries[0], netSompi: undefined, spentSompi: undefined }] };
    const e = parseHistoryResult(raw).view!.entries[0];
    expect(e.netSompi).toBeUndefined();
    expect(entryAmount(e)).toEqual({ sompi: "10000000000", sign: "+", known: false });
  });
});
