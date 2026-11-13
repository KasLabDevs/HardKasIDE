import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import { listDevAccountNames, networkFromAddress, revealDevAccountKey } from "../src/devkeys.js";
import { FsError } from "../src/fs.js";
import { allowedHostnames, isAllowedHost } from "../src/guard.js";
import { isHardkasMiner, LocalNodeError, resetWorkspaceChainState } from "../src/localNode.js";

const tempDirs: string[] = [];

async function makeWorkspace(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "hardkas-ide-sec-"));
  tempDirs.push(dir);
  await fs.mkdir(path.join(dir, ".hardkas"), { recursive: true });
  return dir;
}

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) await fs.rm(dir, { recursive: true, force: true });
});

const KEY_A = "a".repeat(64);
const KEY_B = "b".repeat(64);
const KEY_C = "c".repeat(64);
const KEY_D = "d".repeat(64);

async function writeRealAccounts(root: string): Promise<void> {
  const store = {
    accounts: [
      { name: "sim1", network: "simnet", address: "kaspasim:qsim1", privateKey: KEY_A },
      { name: "tn10", network: "testnet-10", address: "kaspatest:qtn10", privateKey: KEY_B },
      { name: "legacy", address: "kaspatest:qlegacy", privateKey: KEY_C },
      { name: "liar", network: "simnet", address: "kaspa:qmain", privateKey: KEY_D }
    ]
  };
  await fs.writeFile(path.join(root, ".hardkas", "accounts.real.json"), JSON.stringify(store), "utf8");
}

describe("Host allowlist (DNS rebinding)", () => {
  it("accepts loopback hosts with or without a port", () => {
    for (const h of ["127.0.0.1:7421", "localhost:5173", "[::1]:7421", "LOCALHOST:7421", "localhost"]) {
      assert.equal(isAllowedHost(h), true, h);
    }
  });

  it("refuses any other host, a missing host and look-alikes", () => {
    for (const h of [undefined, "", "evil.example:7421", "127.0.0.1.evil.example", "localhost.evil.example:7421", "192.168.1.10:7421"]) {
      assert.equal(isAllowedHost(h), false, String(h));
    }
  });

  it("accepts extra host names only when configured", () => {
    const allowed = allowedHostnames({ HARDKAS_IDE_ALLOWED_HOSTS: "ide.internal, Proxy.Local" } as NodeJS.ProcessEnv);
    assert.equal(isAllowedHost("ide.internal:7421", allowed), true);
    assert.equal(isAllowedHost("proxy.local", allowed), true);
    assert.equal(isAllowedHost("ide.internal:7421"), false);
  });
});

describe("Key export: plaintext real accounts must be simnet", () => {
  it("reads the network from the address prefix", () => {
    assert.equal(networkFromAddress("kaspasim:q1"), "simnet");
    assert.equal(networkFromAddress("kaspatest:q1"), "testnet");
    assert.equal(networkFromAddress("kaspa:q1"), "mainnet");
    assert.equal(networkFromAddress("q1"), undefined);
  });

  it("exports a simnet entry", async () => {
    const root = await makeWorkspace();
    await writeRealAccounts(root);
    const key = await revealDevAccountKey("sim1", root);
    assert.equal(key.privateKey, KEY_A);
    assert.equal(key.network, "simnet");
  });

  it("refuses a testnet entry, and a legacy entry whose address is testnet", async () => {
    const root = await makeWorkspace();
    await writeRealAccounts(root);
    for (const name of ["tn10", "legacy"]) {
      await assert.rejects(revealDevAccountKey(name, root), (e: unknown) => e instanceof FsError && e.code === "NOT_SIMNET", name);
    }
  });

  it("refuses an entry whose network field and address disagree", async () => {
    const root = await makeWorkspace();
    await writeRealAccounts(root);
    await assert.rejects(revealDevAccountKey("liar", root), (e: unknown) => e instanceof FsError && e.code === "NETWORK_MISMATCH");
  });

  it("lists only the exportable entries", async () => {
    const root = await makeWorkspace();
    await writeRealAccounts(root);
    assert.deepEqual(await listDevAccountNames(root), ["sim1"]);
  });
});

describe("Node reset keeps the account keys", () => {
  it("moves the keys to a backup and deletes only chain state", async () => {
    const root = await makeWorkspace();
    const hk = path.join(root, ".hardkas");
    await fs.mkdir(path.join(hk, "node-data"), { recursive: true });
    await fs.writeFile(path.join(hk, "node-data", "db"), "chain", "utf8");
    await fs.mkdir(path.join(hk, "localnet"), { recursive: true });
    await fs.mkdir(path.join(hk, "dev-accounts"), { recursive: true });
    await fs.writeFile(path.join(hk, "dev-accounts", "alice.json"), "{\"k\":1}", "utf8");
    await fs.writeFile(path.join(hk, "accounts.real.json"), "{\"accounts\":[]}", "utf8");
    await fs.writeFile(path.join(hk, "keep.json"), "other", "utf8");

    const result = await resetWorkspaceChainState(root, new Date("2026-11-13T10:00:00.000Z"));

    assert.deepEqual(result.wiped.sort(), [".hardkas/localnet", ".hardkas/node-data"]);
    assert.deepEqual(result.backedUp.sort(), [".hardkas/accounts.real.json", ".hardkas/dev-accounts"]);
    assert.equal(result.backupDir, ".hardkas/backups/reset-2026-11-13T10-00-00-000Z");
    const backup = path.join(root, ...result.backupDir!.split("/"));
    assert.equal(await fs.readFile(path.join(backup, "accounts.real.json"), "utf8"), "{\"accounts\":[]}");
    assert.equal(await fs.readFile(path.join(backup, "dev-accounts", "alice.json"), "utf8"), "{\"k\":1}");
    await assert.rejects(fs.access(path.join(hk, "node-data")));
    await assert.rejects(fs.access(path.join(hk, "accounts.real.json")));
    assert.equal(await fs.readFile(path.join(hk, "keep.json"), "utf8"), "other");
  });

  it("creates no backup when there are no keys", async () => {
    const root = await makeWorkspace();
    const result = await resetWorkspaceChainState(root);
    assert.deepEqual(result, { wiped: [], backedUp: [], backupDir: null });
    await assert.rejects(fs.access(path.join(root, ".hardkas", "backups")));
  });

  it("deletes nothing when a key cannot be moved", async () => {
    const root = await makeWorkspace();
    const hk = path.join(root, ".hardkas");
    await fs.mkdir(path.join(hk, "node-data"), { recursive: true });
    await fs.writeFile(path.join(hk, "accounts.real.json"), "{}", "utf8");
    // A file where the backup folder must go makes the move fail.
    await fs.writeFile(path.join(hk, "backups"), "not a folder", "utf8");
    await assert.rejects(resetWorkspaceChainState(root), (e: unknown) => e instanceof LocalNodeError && e.code === "KEY_BACKUP_FAILED");
    await fs.access(path.join(hk, "node-data"));
    await fs.access(path.join(hk, "accounts.real.json"));
  });
});

describe("Miner identity", () => {
  it("recognises HardKas' cpuminer in the node's network namespace", () => {
    assert.equal(isHardkasMiner({ image: "kaspanet/cpuminer@sha256:60f78ab2", networkMode: "container:5e1b6f89" }), true);
    assert.equal(isHardkasMiner({ image: "docker.io/kaspanet/cpuminer:latest", networkMode: "container:abc" }), true);
  });

  it("refuses another image or a container on its own network", () => {
    assert.equal(isHardkasMiner({ image: "nginx:latest", networkMode: "container:abc" }), false);
    assert.equal(isHardkasMiner({ image: "evil/kaspanet-cpuminer", networkMode: "container:abc" }), false);
    assert.equal(isHardkasMiner({ image: "kaspanet/cpuminer", networkMode: "bridge" }), false);
  });
});
