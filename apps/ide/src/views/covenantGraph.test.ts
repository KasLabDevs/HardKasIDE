import { describe, expect, it } from "vitest";
import compileAuction from "@/__fixtures__/silver/compile-kaspaauction.json";
import compileRelease from "@/__fixtures__/silver/compile-signedrelease.json";
import deployAuction from "@/__fixtures__/silver/deploy-kaspaauction.json";
import deployLive from "@/__fixtures__/silver/deploy-signedrelease-live.json";
import deploySpent from "@/__fixtures__/silver/deploy-signedrelease-spent.json";
import spendRelease from "@/__fixtures__/silver/spend-signedrelease.json";
import type { CompiledRecord, DeployRecord } from "@/store/silver";
import { markSpent, parseCompileRecord, parseDeployRecord, parseSpendRecord } from "@/utils/silverRecords";
import { buildGraph, deployState, deploysFor, parseUtxos, reconcile, selectSubjects, spendsFor, sumSompi } from "./covenantGraph";

const raw = (o: unknown) => o as Record<string, unknown>;

// The demo workspace as the IDE sees it: two compile records, three deploys (one spent), one spend.
const releaseAbi = parseCompileRecord(".hardkas/artifacts/silver/silverCompile-aabb26b4bbcb9f87.json", raw(compileRelease)).record!;
const auctionAbi = parseCompileRecord(".hardkas/artifacts/silver/silverCompile-17057d802ec0ee75.json", raw(compileAuction)).record!;
const withAbi = (path: string, r: unknown, abi: typeof releaseAbi): DeployRecord => ({ ...parseDeployRecord(path, raw(r)).record!, abi: abi.contracts[0] });
const spends = [parseSpendRecord("spend.json", raw(spendRelease)).record!];
const deployments = markSpent([withAbi("live.json", deployLive, releaseAbi), withAbi("spent.json", deploySpent, releaseAbi), withAbi("auction.json", deployAuction, auctionAbi)], spends);

describe("selectSubjects", () => {
  it("lists every deployed contract when nothing was compiled this session", () => {
    const subjects = selectSubjects(null, deployments);
    expect(subjects.map((s) => [s.contract.name, s.fromDeploy])).toEqual([
      ["SignedRelease", true],
      ["KaspaAuction", true]
    ]);
  });

  it("puts the contract compiled now first and does not list its deploys' subject twice", () => {
    const compiled: CompiledRecord = { ...releaseAbi };
    const subjects = selectSubjects(compiled, deployments);
    expect(subjects.map((s) => [s.contract.name, s.fromDeploy])).toEqual([
      ["SignedRelease", false],
      ["KaspaAuction", true]
    ]);
  });

  it("skips deploys whose compile record could not be read (no ABI)", () => {
    const noAbi = deployments.map((d) => ({ ...d, abi: undefined }));
    expect(selectSubjects(null, noAbi)).toEqual([]);
  });
});

describe("deploysFor / spendsFor", () => {
  it("matches deploys by contract and compile record, and spends by the deploy they consumed", () => {
    const [release, auction] = selectSubjects(null, deployments);
    const releaseDeploys = deploysFor(release, deployments);
    expect(releaseDeploys.map((d) => d.recordPath)).toEqual(["live.json", "spent.json"]);
    expect(spendsFor(release.contract, releaseDeploys, spends)).toHaveLength(1);
    const auctionDeploys = deploysFor(auction, deployments);
    expect(auctionDeploys.map((d) => d.recordPath)).toEqual(["auction.json"]);
    expect(spendsFor(auction.contract, auctionDeploys, spends)).toEqual([]);
  });

  it("falls back to deploys by name for a contract compiled now from a different record", () => {
    const compiled: CompiledRecord = { ...releaseAbi, recordPath: "fresh-compile.json", contentHash: "new" };
    const [subject] = selectSubjects(compiled, deployments);
    expect(subject.recordPath).toBe("fresh-compile.json");
    expect(deploysFor(subject, deployments).map((d) => d.recordPath)).toEqual(["live.json", "spent.json"]);
  });
});

describe("buildGraph", () => {
  it("draws KaspaAuction as one deploy, the covenant, three entries and no spends", () => {
    const [, auction] = selectSubjects(null, deployments);
    const ds = deploysFor(auction, deployments);
    const { nodes, edges } = buildGraph(auction.contract, ds, spendsFor(auction.contract, ds, spends), null);
    const byType = (t: string) => nodes.filter((n) => n.type === t);
    expect(byType("deploy")).toHaveLength(1);
    expect(byType("covenant")).toHaveLength(1);
    expect(byType("entry").map((n) => (n.data as { entry: { name: string } }).entry.name).sort()).toEqual(["cancel", "claim", "close"]);
    expect(byType("spend")).toHaveLength(0);
    expect(byType("unrecorded")).toHaveLength(0);
    expect(edges).toHaveLength(1 + 3);
    expect(byType("covenant")[0].data).toMatchObject({ deployCount: 1, liveCount: 1, fromChain: false, address: deployAuction.address });
  });

  it("draws SignedRelease with two deploys (one spent) and the spend under its entry", () => {
    const [release] = selectSubjects(null, deployments);
    const ds = deploysFor(release, deployments);
    const { nodes, edges } = buildGraph(release.contract, ds, spendsFor(release.contract, ds, spends), "spend:spend.json");
    const deployNodes = nodes.filter((n) => n.type === "deploy");
    expect(deployNodes.map((n) => (n.data as { state: string }).state)).toEqual(["live", "spent"]);
    const spendNode = nodes.find((n) => n.type === "spend")!;
    expect(spendNode.data.selected).toBe(true);
    expect(edges.find((e) => e.target === spendNode.id)?.source).toBe("entry:release");
    expect(nodes.find((n) => n.type === "covenant")!.data).toMatchObject({ deployCount: 2, liveCount: 1 });
    // a spent deploy's edge stops animating
    expect(edges.find((e) => e.source === "deploy:spent.json")?.animated).toBe(false);
    expect(edges.find((e) => e.source === "deploy:live.json")?.animated).toBe(true);
  });

  it("lays entries out in rows that leave room for each entry's spends", () => {
    const [release] = selectSubjects(null, deployments);
    const ds = deploysFor(release, deployments);
    const { nodes } = buildGraph(release.contract, ds, spendsFor(release.contract, ds, spends), null);
    const ys = nodes.filter((n) => n.type === "deploy").map((n) => n.position.y);
    expect(ys[1] - ys[0]).toBe(170);
  });
});

describe("chain reconciliation", () => {
  const address = deployLive.address;
  const utxosResult = {
    totalSompi: "1000000000",
    utxos: [
      { outpoint: { transactionId: deployLive.txId, index: 0 }, amountSompi: "500000000", blockDaaScore: "594989", isCoinbase: false },
      { outpoint: { transactionId: "358408dd".padEnd(64, "0"), index: 0 }, amountSompi: "500000000", blockDaaScore: "600000", isCoinbase: false }
    ]
  };

  it("reads hardkas rpc utxos --json", () => {
    const utxos = parseUtxos(utxosResult)!;
    expect(utxos).toHaveLength(2);
    expect(utxos[0]).toEqual({ txId: deployLive.txId, index: 0, amountSompi: "500000000", daa: 594989 });
    expect(parseUtxos({ message: "node down" })).toBeNull();
    expect(sumSompi(utxos)).toBe("1000000000");
  });

  it("tells unspent from gone deploys and finds outputs no record describes", () => {
    const [release] = selectSubjects(null, deployments);
    const ds = deploysFor(release, deployments);
    const chain = reconcile(ds, { address, checkedAt: 1, utxos: parseUtxos(utxosResult)! });
    expect([...chain.unspent]).toEqual(["live.json"]);
    expect([...chain.spent]).toEqual(["spent.json"]);
    expect(chain.unrecorded.map((u) => u.txId.slice(0, 8))).toEqual(["358408dd"]);
  });

  it("names the four states a deploy can be in", () => {
    const [release] = selectSubjects(null, deployments);
    const ds = deploysFor(release, deployments);
    const chain = reconcile(ds, { address, checkedAt: 1, utxos: [] }); // the node holds nothing at the address
    expect(deployState(ds[0], null)).toBe("live");
    expect(deployState(ds[1], null)).toBe("spent");
    expect(deployState(ds[0], chain)).toBe("spent on chain"); // gone, but no spend record names it
    expect(deployState(ds[1], chain)).toBe("spent");
    const full = reconcile(ds, { address, checkedAt: 1, utxos: parseUtxos(utxosResult)! });
    expect(deployState(ds[0], full)).toBe("on chain");
  });

  it("ignores a check made for another address", () => {
    const [release] = selectSubjects(null, deployments);
    const ds = deploysFor(release, deployments);
    const chain = reconcile(ds, { address: "kaspasim:other", checkedAt: 1, utxos: [] });
    expect(chain.unspent.size + chain.spent.size).toBe(0);
    expect(deployState(ds[0], chain)).toBe("live");
    const { nodes } = buildGraph(release.contract, ds, [], null, chain);
    expect(nodes.find((n) => n.type === "covenant")!.data).toMatchObject({ fromChain: false });
  });

  it("adds one dashed node for the unrecorded outputs", () => {
    const [release] = selectSubjects(null, deployments);
    const ds = deploysFor(release, deployments);
    const chain = reconcile(ds, { address, checkedAt: 1, utxos: parseUtxos(utxosResult)! });
    const { nodes, edges } = buildGraph(release.contract, ds, spendsFor(release.contract, ds, spends), null, chain);
    const un = nodes.find((n) => n.type === "unrecorded")!;
    expect((un.data as { utxos: unknown[] }).utxos).toHaveLength(1);
    expect(edges.find((e) => e.source === "unrecorded")?.target).toBe("covenant");
    expect(nodes.find((n) => n.type === "covenant")!.data).toMatchObject({ liveCount: 1, fromChain: true });
  });
});
