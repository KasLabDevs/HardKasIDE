import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, it } from "node:test";
import { lineage, StoreError } from "../src/store.js";

const tempDirs: string[] = [];

async function makeWorkspace(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "hardkas-ide-lineage-"));
  tempDirs.push(dir);
  await fs.mkdir(path.join(dir, ".hardkas", "artifacts", "plans"), { recursive: true });
  await fs.mkdir(path.join(dir, ".hardkas", "artifacts", "signed"), { recursive: true });
  return dir;
}

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) await fs.rm(dir, { recursive: true, force: true });
});

describe("store.lineage fallback", () => {
  it("throws NO_WORKSPACE when no root is open or passed", async () => {
    await assert.rejects(() => lineage(), (err: unknown) => err instanceof StoreError && err.code === "NO_WORKSPACE");
  });

  it("reads artifacts and causal edges from store.db plus tolerant disk scan while skipping corrupt JSON", async () => {
    const root = await makeWorkspace();
    const planId = "a".repeat(64);
    const signedId = "b".repeat(64);
    const extraId = "c".repeat(64);

    // Seed store.db with plan + signed artifact and causal edge.
    const db = new DatabaseSync(path.join(root, ".hardkas", "store.db"));
    try {
      db.exec(`
        CREATE TABLE artifacts (
          artifact_id TEXT PRIMARY KEY,
          content_hash TEXT,
          schema TEXT,
          version TEXT,
          kind TEXT,
          mode TEXT,
          network_id TEXT,
          tx_id TEXT,
          created_at TEXT,
          raw_json TEXT,
          file_path TEXT,
          file_mtime_ms INTEGER,
          indexed_at TEXT
        );
        CREATE TABLE lineage_edges (
          lineage_id TEXT,
          parent_artifact_id TEXT,
          child_artifact_id TEXT,
          edge_kind TEXT,
          created_at TEXT,
          depth INTEGER
        );
      `);
      db.prepare(
        `INSERT INTO artifacts (artifact_id, content_hash, schema, kind, mode, network_id, created_at, raw_json, file_path)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        planId,
        planId,
        "hardkas.txPlan",
        "hardkas.txPlan",
        "localnet",
        "simnet",
        "2026-11-13T03:20:46.721Z",
        JSON.stringify({ schema: "hardkas.txPlan", workflowId: "wf_1", lineage: { artifactId: planId } }),
        path.join(root, ".hardkas", "artifacts", "plans", `txPlan-${planId}.json`)
      );
      db.prepare(
        `INSERT INTO artifacts (artifact_id, content_hash, schema, kind, mode, network_id, tx_id, created_at, raw_json, file_path)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        signedId,
        signedId,
        "hardkas.signedTx",
        "hardkas.signedTx",
        "localnet",
        "simnet",
        "tx_123",
        "2026-11-13T03:20:55.312Z",
        JSON.stringify({ schema: "hardkas.signedTx", workflowId: "wf_1", lineage: { artifactId: signedId, parentArtifactId: planId } }),
        path.join(root, ".hardkas", "artifacts", "signed", `signedTx-${signedId}.json`)
      );
      db.prepare(
        `INSERT INTO lineage_edges (lineage_id, parent_artifact_id, child_artifact_id, edge_kind, created_at, depth)
         VALUES (?, ?, ?, 'derived', ?, 1)`
      ).run(planId, planId, signedId, "2026-11-13T03:20:55.312Z");
    } finally {
      db.close();
    }

    // Add a valid unindexed artifact on disk linked to signedId, plus a corrupted [REDACTED].json file.
    await fs.writeFile(
      path.join(root, ".hardkas", "artifacts", "signed", `txSubmission-${extraId}.json`),
      JSON.stringify({
        schema: "hardkas.txSubmission.v1",
        contentHash: extraId,
        createdAt: "2026-11-13T03:21:00.000Z",
        txId: "tx_123",
        execution: { mode: "localnet", network: "simnet" },
        lineage: { artifactId: extraId, parentArtifactId: signedId },
        workflowId: "wf_1"
      }),
      "utf8"
    );
    await fs.writeFile(
      path.join(root, ".hardkas", "artifacts", "plans", `txPlan-${"d".repeat(64)} [REDACTED].json`),
      "{ corrupted json ...",
      "utf8"
    );

    const res = await lineage(root);
    assert.equal(res.source, "store");
    assert.equal(res.artifacts.length, 3);
    assert.deepEqual(
      res.artifacts.map((a) => a.artifactId),
      [extraId, signedId, planId]
    );
    assert.equal(res.edges.length, 2);
    assert.deepEqual(
      res.edges.map((e) => e.id).sort(),
      [`${planId}->${signedId}`, `${signedId}->${extraId}`].sort()
    );
  });

  it("works from .hardkas/artifacts alone when store.db does not exist", async () => {
    const root = await makeWorkspace();
    const id = "e".repeat(64);
    await fs.writeFile(
      path.join(root, ".hardkas", "artifacts", "plans", `2026-11-13-plan-${id.slice(0, 16)}.plan.json`),
      JSON.stringify({
        schema: "hardkas.txPlan",
        contentHash: id,
        mode: "simulator",
        networkId: "simnet",
        createdAt: "2026-11-13T10:00:00.000Z",
        lineage: { artifactId: id }
      }),
      "utf8"
    );

    const res = await lineage(root);
    assert.equal(res.source, "disk");
    assert.equal(res.artifacts.length, 1);
    assert.equal(res.artifacts[0].artifactId, id);
    assert.equal(res.edges.length, 0);
  });
});
