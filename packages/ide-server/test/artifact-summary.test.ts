import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { sompiToKas, summarizeArtifact } from "../src/artifactSummary.ts";

describe("sompiToKas", () => {
  it("is exact, with no floating point", () => {
    assert.equal(sompiToKas(500000000), "5");
    assert.equal(sompiToKas("499824800"), "4.998248");
    assert.equal(sompiToKas(1), "0.00000001");
    assert.equal(sompiToKas("123456789012345678901"), "1234567890123.45678901");
  });
  it("gives nothing for what is not a whole sompi amount", () => {
    for (const v of [undefined, null, "abc", 1.5, -3, "1e3", {}]) assert.equal(sompiToKas(v), undefined, String(v));
  });
});

describe("summarizeArtifact: values from real HardKAS records", () => {
  it("a compile names the contract and the file", () => {
    const s = summarizeArtifact("hardkas.silverCompile.v1", { source: { path: "contracts/VaultGuard.sil" }, contracts: [{ name: "VaultGuard" }] });
    assert.deepEqual(s, { verb: "Compile", subject: "VaultGuard", note: "VaultGuard.sil" });
  });
  it("a deploy gives the contract, the amount and the status", () => {
    const s = summarizeArtifact("hardkas.silverDeploy.v1", { contract: "VaultGuard", valueSompi: 500000000, status: "confirmed", txId: "x" });
    assert.deepEqual(s, { verb: "Deploy", subject: "VaultGuard", kas: "5", note: "confirmed" });
  });
  it("a spend gives contract.entry, the receiver and what it sent", () => {
    const s = summarizeArtifact("hardkas.silverSpend.v1", { contract: "VaultGuard", entry: "spend", to: "kaspasim:qryj23", outputSompi: 499824800, status: "confirmed" });
    assert.deepEqual(s, { verb: "Spend", subject: "VaultGuard.spend", to: "kaspasim:qryj23", kas: "4.998248", note: "confirmed" });
  });
  it("a node check gives the finding and the confirmations", () => {
    const s = summarizeArtifact("hardkas.txObservation.v1", { subject: { txId: "d0ac7269cd4d750265eaa822ac74d79a" }, finding: { type: "chain_accepted", confirmationsBlue: "1377" } });
    assert.deepEqual(s, { verb: "Node check", subject: "d0ac7269cd…", note: "chain accepted · 1377 confirmations" });
  });
  it("a snapshot counts accounts and UTXOs", () => {
    assert.deepEqual(summarizeArtifact("hardkas.snapshot.v1", { accounts: [{}, {}, {}], utxos: [{}] }), { verb: "State snapshot", note: "3 accounts · 1 UTXOs" });
  });
});

describe("summarizeArtifact: real simulator artifacts", () => {
  it("a plan names the accounts by their input name and gives the amount", () => {
    const s = summarizeArtifact("hardkas.txPlan", { from: { address: "kaspa:sim_alice", input: "alice" }, to: { address: "kaspa:sim_bob", input: "bob" }, amountSompi: "1000000000" });
    assert.deepEqual(s, { verb: "Payment plan", from: "alice", to: "bob", kas: "10", note: undefined });
  });
  it("a scenario result gives its name, its status and the error code when it failed", () => {
    assert.deepEqual(summarizeArtifact("hardkas.scenarioResult.v1", { scenarioName: "payment", status: "passed", artifactsGenerated: [] }), { verb: "Scenario", subject: "payment", note: "passed" });
    assert.equal(summarizeArtifact("hardkas.scenarioResult.v1", { scenarioName: "payment-flow", status: "passed", metadata: { kind: "task" } })?.verb, "Task");
    assert.equal(summarizeArtifact("hardkas.scenarioResult.v1", { scenarioName: "payment", status: "failed", error: { code: "SEND_REFUSED", message: "x" } })?.note, "failed · SEND_REFUSED");
  });
  it("a receipt carries its status, a trace of a synthetic transaction says simulated", () => {
    assert.equal(summarizeArtifact("hardkas.txReceipt", { from: "kaspa:sim_alice", to: "kaspa:sim_bob", amountSompi: "1000000000", status: "accepted" })?.note, "accepted");
    assert.deepEqual(summarizeArtifact("hardkas.txTrace", { txId: "synthetic-214ed2e27b13f89174a3a104" }), { verb: "Trace", subject: "214ed2e27b…", note: "simulated" });
  });
});

describe("summarizeArtifact: payments and unknowns", () => {
  it("reads sender and receiver as an account name or an address", () => {
    const s = summarizeArtifact("hardkas.txPlan.v1", { from: { accountName: "alice", address: "kaspasim:q1" }, to: { address: "kaspasim:q2" }, amountSompi: "1000000000" });
    assert.deepEqual(s, { verb: "Payment plan", from: "alice", to: "kaspasim:q2", kas: "10", note: undefined });
  });
  it("marks a rejected submission", () => {
    const s = summarizeArtifact("hardkas.txSubmission.v1", { from: "alice", to: "bob", amountSompi: 100000000, submitResult: { accepted: false } });
    assert.equal(s?.note, "rejected");
  });
  it("leaves out what the artifact does not say, and gives nothing for an unknown kind or bad input", () => {
    assert.deepEqual(summarizeArtifact("hardkas.silverDeploy.v1", {}), { verb: "Deploy", subject: undefined, kas: undefined, note: undefined });
    assert.equal(summarizeArtifact("hardkas.somethingNew.v9", { a: 1 }), undefined);
    assert.equal(summarizeArtifact("hardkas.txPlan.v1", null), undefined);
    assert.equal(summarizeArtifact("hardkas.txPlan.v1", [1, 2]), undefined);
  });
});
