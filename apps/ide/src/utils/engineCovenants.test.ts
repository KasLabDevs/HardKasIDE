import { describe, expect, it } from "vitest";
import planAdvance from "@/__fixtures__/engine/plan-covenant-advance.json";
import planStart from "@/__fixtures__/engine/plan-covenant-start.json";
import signedAdvance from "@/__fixtures__/engine/signed-covenant-advance.json";
import signedStart from "@/__fixtures__/engine/signed-covenant-start.json";
import submissionAdvance from "@/__fixtures__/engine/submission-covenant-advance.json";
import submissionStart from "@/__fixtures__/engine/submission-covenant-start.json";
import planDeploy from "@/__fixtures__/engine/plan-kcc20-deploy.json";
import planTransfer from "@/__fixtures__/engine/plan-kcc20-transfer.json";
import planTransferDraft from "@/__fixtures__/engine/plan-kcc20-transfer-draft.json";
import signedDeploy from "@/__fixtures__/engine/signed-kcc20-deploy.json";
import signedTransfer from "@/__fixtures__/engine/signed-kcc20-transfer.json";
import submissionDeploy from "@/__fixtures__/engine/submission-kcc20-deploy.json";
import submissionTransfer from "@/__fixtures__/engine/submission-kcc20-transfer.json";
import { declaredStatePreview, groupEngineCovenants, parseEnginePlan, parseEngineSigned, parseEngineSubmission } from "./engineCovenants";

/**
 * The fixtures are the records HardKAS 0.13.0-rc.3 (the rc.4 build of the repository) wrote in the demo workspace on
 * 2026-11-23 for `hardkas kcc20 deploy` (alice=1000, --kas 1) and `hardkas kcc20 transfer --from alice --to bob=600`,
 * both accepted and confirmed by the Docker localnet; `kcc20 balance` then listed bob 600 and alice 400 at the node.
 * The draft plan is the transfer's first plan (placeholder signatures), never signed: it must not become a transaction.
 */
const raw = (o: unknown) => o as Record<string, unknown>;
const COVENANT = "9f60666516ff77c5e2a1d7d4164104d15f20c08879f0fc725680ceb2801d6aa6";
const DEPLOY_TX = "e7680a6b98775c97bf0a27748a7ec2056792038d93189202dd3e01226ba672b8";
const TRANSFER_TX = "73abc5ff2db34b025f7d0915b5ec912be7adc75f3b3f4b95c30c50bd63cfcc59";

describe("parseEnginePlan", () => {
  it("reads a genesis plan: the funding input, the bound output with its declared state and contract", () => {
    const { record, problems } = parseEnginePlan("p.json", raw(planDeploy));
    expect(problems).toEqual([]);
    expect(record?.contentHash).toBe(planDeploy.contentHash);
    expect(record?.hardkasVersion).toBe("0.13.0-rc.3");
    expect(record?.estimatedFeeSompi).toBe("208300");
    expect(record?.inputs).toHaveLength(1);
    expect(record?.inputs[0].covenantId).toBeUndefined(); // alice's coin
    // a genesis plan names no covenant id yet: the SDK derives it when it signs (the signed record carries it)
    expect(record?.covenantIds).toEqual([]);
    const out = record!.outputs[0];
    expect(out.covenantId).toBeUndefined();
    expect(out.amountSompi).toBe("100000000");
    expect(out.contract?.contract).toBe("KCC20");
    expect(out.contract?.compileRecordPath).toBe(".hardkas/artifacts/silver/silverCompile-ae08321d82d42fd2.json");
    expect(out.contract?.constructorArgs).toHaveLength(7);
    expect(declaredStatePreview(out.declaredState)).toContain("amount=1000");
    expect(record!.outputs[1].covenantId).toBeUndefined(); // the change
  });

  it("reads a transition plan: the covenant input with its entry, and the next states per output", () => {
    const { record, problems } = parseEnginePlan("p.json", raw(planTransfer));
    expect(problems).toEqual([]);
    expect(record?.inputs[0]).toMatchObject({ outpoint: `${DEPLOY_TX}:0`, covenantId: COVENANT, kind: "covenant", entry: "transfer" });
    expect(record?.outputs.map((o) => o.covenantId)).toEqual([COVENANT, COVENANT]);
    expect(declaredStatePreview(record?.outputs[0].declaredState)).toContain("amount=600");
    expect(declaredStatePreview(record?.outputs[1].declaredState)).toContain("amount=400");
    expect(record?.outputs[0].contract?.contract).toBe("KCC20");
  });

  it("refuses what is not a v1 engine plan, saying why", () => {
    expect(parseEnginePlan("p.json", { schema: "hardkas.txPlan", txVersion: 0 })).toMatchObject({ record: null, problems: [expect.stringMatching(/^txVersion 0/)] });
    expect(parseEnginePlan("p.json", { schema: "hardkas.signedTx" }).problems[0]).toMatch(/not a hardkas.txPlan record/);
    expect(parseEnginePlan("p.json", {}).problems[0]).toMatch(/no schema field/);
  });
});

describe("parseEngineSigned", () => {
  it("reads the signed transaction: its txId, its plan, what it spends and which outputs the covenant binds", () => {
    const { record, problems } = parseEngineSigned("s.json", raw(signedTransfer));
    expect(problems).toEqual([]);
    expect(record?.txId).toBe(TRANSFER_TX);
    expect(record?.planContentHash).toBe(planTransfer.contentHash);
    expect(record?.spends[0]).toBe(`${DEPLOY_TX}:0`);
    expect(record?.outputCovenantIds).toEqual([COVENANT, COVENANT]);
    expect(record?.outputAmounts).toEqual(["50000000", "48231400"]);
  });
  it("a genesis binds its first output only; the change is unbound", () => {
    const { record } = parseEngineSigned("s.json", raw(signedDeploy));
    expect(record?.txId).toBe(DEPLOY_TX);
    expect(record?.outputCovenantIds).toEqual([COVENANT, undefined]);
  });
});

describe("parseEngineSubmission", () => {
  it("reads what the node answered", () => {
    expect(parseEngineSubmission("r.json", raw(submissionDeploy)).record).toMatchObject({ txId: DEPLOY_TX, outcome: "accepted" });
    expect(parseEngineSubmission("r.json", raw(submissionTransfer)).record).toMatchObject({ txId: TRANSFER_TX, outcome: "accepted" });
    expect(parseEngineSubmission("r.json", { schema: "hardkas.txSubmission.v1", txId: TRANSFER_TX, submitResult: { error: "rejected" } }).record?.outcome).toBe("rejected");
    expect(parseEngineSubmission("r.json", { schema: "hardkas.txSubmission.v2", txId: TRANSFER_TX }).problems[0]).toMatch(/newer than this IDE understands/);
  });
});

describe("groupEngineCovenants", () => {
  const plans = [planDeploy, planTransfer, planTransferDraft].map((p, i) => parseEnginePlan(`plan-${i}.json`, raw(p)).record!);
  const signed = [signedDeploy, signedTransfer].map((s, i) => parseEngineSigned(`signed-${i}.json`, raw(s)).record!);
  const submissions = [submissionDeploy, submissionTransfer].map((s, i) => parseEngineSubmission(`sub-${i}.json`, raw(s)).record!);

  it("follows the token's covenant from its genesis to the transfer, the tip being the transfer's two outputs", () => {
    const chains = groupEngineCovenants(plans, signed, submissions);
    expect(chains).toHaveLength(1);
    const c = chains[0];
    expect(c.covenantId).toBe(COVENANT);
    expect(c.contract?.contract).toBe("KCC20");
    expect(c.transactions.map((t) => [t.kind, t.txId, t.recorded])).toEqual([
      ["genesis", DEPLOY_TX, "accepted"],
      ["transition", TRANSFER_TX, "accepted"]
    ]);
    expect(c.transactions[1].spends).toEqual([`${DEPLOY_TX}:0`]);
    expect(c.transactions[1].entries).toEqual(["transfer"]);
    expect(c.transactions[0].payments).toHaveLength(1); // alice's change
    expect(c.tip.map((t) => t.outpoint)).toEqual([`${TRANSFER_TX}:0`, `${TRANSFER_TX}:1`]);
    expect(c.tip.map((t) => declaredStatePreview(t.declaredState))).toEqual([expect.stringContaining("amount=600"), expect.stringContaining("amount=400")]);
    expect(c.rejected).toEqual([]);
    expect(c.unsent).toEqual([]);
    expect(c.findings).toEqual([]);
  });

  it("a signed transaction never submitted is kept apart; a missing plan is a finding, not a crash", () => {
    const unsent = groupEngineCovenants(plans, signed, [submissions[0]]);
    expect(unsent[0].unsent.map((t) => t.txId)).toEqual([TRANSFER_TX]);
    expect(unsent[0].tip.map((t) => t.outpoint)).toEqual([`${DEPLOY_TX}:0`]);

    const noPlan = groupEngineCovenants([plans[0]], signed, submissions);
    expect(noPlan[0].findings[0]).toMatch(/its plan .* is not in this workspace's records/);
    expect(noPlan[0].transactions.map((t) => t.txId)).toEqual([DEPLOY_TX, TRANSFER_TX]);
  });

  it("follows a `silver covenant start` + `advance` (1:2 fan-out) covenant: two tip outputs with their states, next to the token's chain", () => {
    // the same CLI build on the same localnet: Decls (fanout.sil) started with value=10 in one 2 KAS output, advanced 1:2 to value=11 (0.8 KAS) and value=12 (the rest)
    const all = groupEngineCovenants(
      [...plans, parseEnginePlan("ps.json", raw(planStart)).record!, parseEnginePlan("pa.json", raw(planAdvance)).record!],
      [...signed, parseEngineSigned("ss.json", raw(signedStart)).record!, parseEngineSigned("sa.json", raw(signedAdvance)).record!],
      [...submissions, parseEngineSubmission("rs.json", raw(submissionStart)).record!, parseEngineSubmission("ra.json", raw(submissionAdvance)).record!]
    );
    expect(all.map((c) => c.contract?.contract)).toEqual(["Decls", "KCC20"]); // newest chain first
    const d = all[0];
    expect(d.covenantId).toBe("cef7b6af0c84742487931edbf3b2394000c7eb6396fb1c1c2141b077add3da20");
    expect(d.contract?.constructorArgs).toEqual([
      { kind: "int", value: "3" },
      { kind: "int", value: "10" }
    ]);
    expect(d.transactions.map((t) => `${t.kind} ${t.spends.length}:${t.outputs.length} ${t.recorded}`)).toEqual(["genesis 0:1 accepted", "transition 1:2 accepted"]);
    expect(d.transactions[0].outputs[0]).toMatchObject({ amountSompi: "200000000", declaredState: { value: { kind: "int", value: "10" } } });
    expect(d.transactions[1].entries).toEqual(["__covenant_entrypoint_auth_fanout"]);
    expect(d.transactions[1].feeSompi).toBe("169800");
    expect(d.tip.map((t) => [t.amountSompi, declaredStatePreview(t.declaredState)])).toEqual([
      ["80000000", "value=11"],
      ["119830200", "value=12"]
    ]);
    expect(d.findings).toEqual([]);
  });

  it("a transaction the node rejected is history, and the output it tried to spend stays at the tip", () => {
    const rejected = groupEngineCovenants(plans, signed, [submissions[0], { ...submissions[1], outcome: "rejected" }]);
    expect(rejected[0].rejected.map((t) => t.txId)).toEqual([TRANSFER_TX]);
    expect(rejected[0].tip.map((t) => t.outpoint)).toEqual([`${DEPLOY_TX}:0`]);
  });
});
