import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { applyWatchEvent, describeWatchEvent, LineBuffer, parseWatchLine, sortUtxos, type LiveUtxoSet, type WatchEvent } from "./watchLines";

// The fixtures are what `hardkas watch <alice> --json` (HardKas 0.13.0-rc.3 build) printed against the IDE's local
// simnet node of the demo workspace: an idle 5-second watch, one during a mining burst that paid alice 1 KAS, and one
// while alice paid bob 1 KAS and a burst confirmed it.
const fixture = (name: string) => readFileSync(path.resolve(__dirname, "..", "__fixtures__", "node", name), "utf8");
const events = (name: string): WatchEvent[] => fixture(name).split(/\r?\n/).map(parseWatchLine).filter((e): e is WatchEvent => e !== null);
const kas = (sompi: string) => `${Number(BigInt(sompi) / 100_000_000n)} KAS`;
const ALICE = "kaspasim:qqlpk9rs7yag6eqj3lttzqd8vgvssz8l8fxlpdag4h7zx2rjjr8lkkerwkezn";

describe("parseWatchLine", () => {
  it("reads an idle watch: the snapshot first, the end last", () => {
    const list = events("watch-alice-idle.jsonl");
    expect(list.map((e) => e.event)).toEqual(["snapshot", "end"]);
    const snap = list[0];
    if (snap.event !== "snapshot") throw new Error("snapshot expected");
    expect(snap.at).toBe("2026-11-22T22:44:21.414Z");
    expect(snap.address).toBe(ALICE);
    expect(snap.network).toBe("simnet");
    expect(snap.utxos).toEqual([{ transactionId: "170ecff27b8c17303ecffde73555e7f89ef5d200e96a59402f0b9d34e56f3606", index: 0, amountSompi: "10000000000", state: "mature", covenantBound: false, covenantId: undefined }]);
    expect(snap.balance).toEqual({ mature: "10000000000", pending: "0", stasisCount: 0 });
    expect(list[1]).toEqual({ event: "end", at: "2026-11-22T22:44:26.428Z", reason: "timeout", events: 0 });
  });

  it("reads the burst: the 1 KAS the miner paid alice arrives pending", () => {
    const list = events("watch-alice-burst.jsonl");
    expect(list.map((e) => e.event)).toEqual(["snapshot", "added", "end"]);
    const added = list[1];
    if (added.event !== "added") throw new Error("added expected");
    expect(added.txid).toBe("c29d0ee95bf65c5898f189bb376a15b56496b19860500e8288be501d51f28fc9");
    expect(added.outputs).toEqual([{ transactionId: "c29d0ee95bf65c5898f189bb376a15b56496b19860500e8288be501d51f28fc9", index: 0, amountSompi: "100000000", state: "pending", covenantBound: false, covenantId: undefined }]);
    expect(list[2]).toMatchObject({ event: "end", reason: "timeout", events: 1 });
  });

  it("ignores blank and non-JSON lines, and keeps unknown events as notices", () => {
    expect(parseWatchLine("")).toBeNull();
    expect(parseWatchLine("   ")).toBeNull();
    expect(parseWatchLine("watching alice on simnet")).toBeNull();
    expect(parseWatchLine("{not json")).toBeNull();
    expect(parseWatchLine('{"at":"t","foo":1}')).toBeNull();
    expect(parseWatchLine('{"at":"2026-11-22T22:44:21.414Z","event":"disconnected"}')).toEqual({ event: "notice", at: "2026-11-22T22:44:21.414Z", name: "disconnected", raw: { at: "2026-11-22T22:44:21.414Z", event: "disconnected" } });
    expect(parseWatchLine('{"at":"t","event":"error","code":"WALLET_WATCH_NODE_NETWORK_CHANGED","message":"the node now says mainnet","fatal":true}')).toEqual({
      event: "error",
      at: "t",
      code: "WALLET_WATCH_NODE_NETWORK_CHANGED",
      message: "the node now says mainnet",
      fatal: true
    });
  });

  it("labels a covenant-bound output", () => {
    const e = parseWatchLine('{"at":"t","event":"added","txid":"ab","outputs":[{"transactionId":"ab","index":1,"amountSompi":"5","state":"pending","covenantBound":true,"covenantId":"c0ffee"}]}');
    if (e?.event !== "added") throw new Error("added expected");
    expect(e.outputs[0]).toMatchObject({ covenantBound: true, covenantId: "c0ffee" });
  });
});

describe("LineBuffer", () => {
  it("joins chunks into whole lines and keeps a partial line for the next chunk", () => {
    const b = new LineBuffer();
    expect(b.push('{"a":1}\n{"b"')).toEqual(['{"a":1}']);
    expect(b.push(':2}\r\n\n{"c":3}')).toEqual(['{"b":2}']);
    expect(b.flush()).toEqual(['{"c":3}']);
    expect(b.flush()).toEqual([]);
  });
});

describe("applyWatchEvent", () => {
  it("builds the list from the snapshot and adds the burst's output, totals recomputed from the rows", () => {
    let set: LiveUtxoSet | null = null;
    const [snap, added] = events("watch-alice-burst.jsonl");
    set = applyWatchEvent(set, snap, ALICE);
    expect(set).toEqual({ address: ALICE, totalSompi: "10000000000", count: 1, rows: [{ txId: "170ecff27b8c17303ecffde73555e7f89ef5d200e96a59402f0b9d34e56f3606", index: 0, amountSompi: "10000000000", daa: null, coinbase: false, state: "mature", covenantId: undefined }] });
    set = applyWatchEvent(set, added, ALICE);
    expect(set?.count).toBe(2);
    expect(set?.totalSompi).toBe("10100000000");
    expect(set?.rows.map((r) => [r.amountSompi, r.state])).toEqual([
      ["10000000000", "mature"],
      ["100000000", "pending"]
    ]);
    // the end line changes nothing
    const end = events("watch-alice-burst.jsonl")[2];
    expect(applyWatchEvent(set, end, ALICE)).toBe(set);
  });

  it("removes spent outputs, marks matured ones, and applies a resync as removed then added", () => {
    const start: LiveUtxoSet = {
      address: ALICE,
      totalSompi: "10100000000",
      count: 2,
      rows: [
        { txId: "aa", index: 0, amountSompi: "10000000000", daa: 3911, coinbase: false, state: "mature" },
        { txId: "bb", index: 0, amountSompi: "100000000", daa: null, coinbase: false, state: "pending" }
      ]
    };
    // the shapes `hardkas watch --json` documents for these events (packages/cli/src/commands/watch.ts)
    const removed = parseWatchLine('{"at":"t1","event":"removed","txid":"cc","outputs":[{"transactionId":"aa","index":0,"amountSompi":"10000000000","state":"mature","covenantBound":false}]}')!;
    const matured = parseWatchLine('{"at":"t2","event":"matured","txid":"bb","outputs":[{"transactionId":"bb","index":0,"amountSompi":"100000000","state":"mature","covenantBound":false}]}')!;
    const resync = parseWatchLine('{"at":"t3","event":"resync","reason":"reconnect","added":[{"transactionId":"dd","index":2,"amountSompi":"7","covenantBound":false}],"removed":[{"transactionId":"bb","index":0,"amountSompi":"100000000","covenantBound":false}]}')!;
    const afterRemoved = applyWatchEvent(start, removed, ALICE)!;
    expect(afterRemoved.rows.map((r) => r.txId)).toEqual(["bb"]);
    expect(afterRemoved.totalSompi).toBe("100000000");
    expect(afterRemoved.count).toBe(1);
    const afterMatured = applyWatchEvent(afterRemoved, matured, ALICE)!;
    expect(afterMatured.rows[0]).toMatchObject({ txId: "bb", state: "mature", daa: null });
    const afterResync = applyWatchEvent(afterMatured, resync, ALICE)!;
    expect(afterResync.rows.map((r) => `${r.txId}:${r.index}`)).toEqual(["dd:2"]);
    expect(afterResync.totalSompi).toBe("7");
    // a known output added again keeps the DAA score a previous `rpc utxos` reading gave it
    const readded = applyWatchEvent(start, parseWatchLine('{"at":"t4","event":"added","txid":"aa","outputs":[{"transactionId":"aa","index":0,"amountSompi":"10000000000","covenantBound":false}]}')!, ALICE)!;
    expect(readded.rows.find((r) => r.txId === "aa")?.daa).toBe(3911);
    expect(readded.count).toBe(2);
  });

  it("follows alice paying bob 1 KAS: both inputs removed, the payment's change and the burst's coin added", () => {
    const list = events("watch-alice-spend.jsonl");
    expect(list.map((e) => e.event)).toEqual(["snapshot", "removed", "removed", "added", "added", "end"]);
    let set: LiveUtxoSet | null = null;
    for (const e of list) set = applyWatchEvent(set, e, ALICE);
    expect(set!.count).toBe(2);
    expect(set!.rows.map((r) => [`${r.txId.slice(0, 8)}:${r.index}`, r.amountSompi, r.state])).toEqual([
      ["b0d762ef:1", "9999684600", "pending"],
      ["d54e3cf0:0", "100000000", "pending"]
    ]);
    // 101 KAS − 1 KAS paid − the fee the node took
    expect(set!.totalSompi).toBe("10099684600");
    expect(list[5]).toEqual({ event: "end", at: "2026-11-22T22:53:55.704Z", reason: "until", events: 4 });
    expect(describeWatchEvent(list[1], kas)).toBe("− 100 KAS (1 output spent) · tx 170ecff27b…");
  });

  it("starts from nothing for an event before any snapshot, and ignores a set of another address", () => {
    const added = events("watch-alice-burst.jsonl")[1];
    const fresh = applyWatchEvent(null, added, ALICE)!;
    expect(fresh.count).toBe(1);
    const other: LiveUtxoSet = { address: "kaspasim:other", totalSompi: "5", count: 1, rows: [{ txId: "zz", index: 0, amountSompi: "5", daa: 1, coinbase: true }] };
    expect(applyWatchEvent(other, added, ALICE)!.rows.map((r) => r.txId)).toEqual(["c29d0ee95bf65c5898f189bb376a15b56496b19860500e8288be501d51f28fc9"]);
  });

  it("sorts biggest first, then newest DAA, unknown DAA last", () => {
    const rows = sortUtxos([
      { txId: "a", index: 0, amountSompi: "5", daa: null, coinbase: false },
      { txId: "b", index: 0, amountSompi: "5", daa: 10, coinbase: false },
      { txId: "c", index: 0, amountSompi: "9", daa: 1, coinbase: false }
    ]);
    expect(rows.map((r) => r.txId)).toEqual(["c", "b", "a"]);
  });
});

describe("describeWatchEvent", () => {
  it("summarizes the fixture's events for the feed", () => {
    const [snap, added, end] = events("watch-alice-burst.jsonl");
    expect(describeWatchEvent(snap, kas)).toBe("watching on simnet: 1 output, mature 100 KAS, pending 0 KAS");
    expect(describeWatchEvent(added, kas)).toBe("+ 1 KAS (1 output) · tx c29d0ee95b…");
    expect(describeWatchEvent(end, kas)).toBe("watch ended (timeout) after 1 event");
    expect(describeWatchEvent(parseWatchLine('{"at":"t","event":"disconnected"}')!, kas)).toMatch(/^disconnected from the node/);
  });
});
