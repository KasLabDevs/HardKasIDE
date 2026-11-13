/**
 * Key and node edge cases that security.test.ts does not cover: the simnet-only rule for plaintext and encrypted
 * dev keys, path traversal in account names, the key backup of a node reset (byte-identical copies, failures that
 * must delete nothing), the miner identity check and the Host allowlist.
 *
 * Every key and address here is fake: random hex and made-up `kaspa*:qfake…` strings, never a real account.
 *
 * The HTTP routes (/api/node/reset, /api/node/miner, /api/devkeys/reveal, the FORBIDDEN_HOST middleware) are not
 * tested here: src/index.ts does not export its Hono app and calls serve() on import.
 */
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import { argon2id } from "hash-wasm";
import { listDevAccountAddresses, listDevAccountNames, networkFromAddress, revealDevAccountKey } from "../src/devkeys.js";
import { FsError } from "../src/fs.js";
import { allowedHostnames, isAllowedHost } from "../src/guard.js";
import { isHardkasMiner, LocalNodeError, resetWorkspaceChainState } from "../src/localNode.js";

// ------------------------------------------------------------------------------------------------ helpers

const tempDirs: string[] = [];

async function makeTemp(prefix = "hardkas-ide-keys-"): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

async function makeWorkspace(): Promise<string> {
  const dir = await makeTemp();
  await fs.mkdir(path.join(dir, ".hardkas"), { recursive: true });
  return dir;
}

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) await fs.rm(dir, { recursive: true, force: true });
});

/** A fake 32-byte private key (random hex, never a real account). */
const fakeKey = (): string => crypto.randomBytes(32).toString("hex");

/** The promise rejects with an FsError of this code, and its message does not contain any of the keys. */
async function assertRefused(p: Promise<unknown>, code: string, secrets: string[], label: string): Promise<void> {
  await assert.rejects(p, (e: unknown) => {
    assert.ok(e instanceof FsError, `${label}: expected an FsError, got ${String(e)}`);
    assert.equal(e.code, code, `${label}: ${e.message}`);
    for (const s of secrets) assert.ok(!e.message.includes(s), `${label}: the error message contains the key`);
    return true;
  });
}

async function writeRealStore(root: string, store: unknown, bom = false): Promise<void> {
  const text = (bom ? "\uFEFF" : "") + JSON.stringify(store, null, 2);
  await fs.writeFile(path.join(root, ".hardkas", "accounts.real.json"), text, "utf8");
}

// The fixed, public password HardKas encrypts its simnet dev keystores with (see devkeys.ts).
const DEV_PASSWORD = "hardkas-local-dev";

interface KeystoreOptions {
  payload: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  password?: string;
  type?: string;
  kdfAlgorithm?: string;
  tamperTag?: boolean;
}

/** A `hardkas.encryptedKeystore.v2` file (argon2id + AES-256-GCM) with cheap KDF parameters. */
async function buildKeystore(o: KeystoreOptions): Promise<Record<string, unknown>> {
  const salt = crypto.randomBytes(16);
  const params = { memory: 64, iterations: 1, parallelism: 1 };
  const key = Buffer.from(
    await argon2id({
      password: o.password ?? DEV_PASSWORD,
      salt,
      parallelism: params.parallelism,
      iterations: params.iterations,
      memorySize: params.memory,
      hashLength: 32,
      outputType: "hex"
    }),
    "hex"
  );
  const nonce = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, nonce);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(o.payload), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  if (o.tamperTag) tag[0] ^= 0xff;
  return {
    version: "2",
    type: o.type ?? "hardkas.encryptedKeystore.v2",
    kdf: { algorithm: o.kdfAlgorithm ?? "argon2id", ...params, salt: salt.toString("base64") },
    cipher: { algorithm: "aes-256-gcm", nonce: nonce.toString("base64"), tag: tag.toString("base64") },
    encryptedPayload: encrypted.toString("base64"),
    ...(o.metadata ? { metadata: o.metadata } : {})
  };
}

async function writeKeystore(root: string, name: string, keystore: unknown): Promise<void> {
  const dir = path.join(root, ".hardkas", "dev-accounts");
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, `${name}.json`), JSON.stringify(keystore), "utf8");
}

/** Every regular file under `dir`, by forward-slash relative path. Does not follow links. */
async function snapshot(dir: string): Promise<Map<string, Buffer>> {
  const out = new Map<string, Buffer>();
  async function walk(abs: string, rel: string): Promise<void> {
    for (const ent of await fs.readdir(abs, { withFileTypes: true })) {
      const a = path.join(abs, ent.name);
      const r = rel ? `${rel}/${ent.name}` : ent.name;
      if (ent.isDirectory()) await walk(a, r);
      else if (ent.isFile()) out.set(r, await fs.readFile(a));
    }
  }
  await walk(dir, "");
  return out;
}

function assertSameBytes(actual: Map<string, Buffer>, expected: Map<string, Buffer>, label: string): void {
  assert.deepEqual([...actual.keys()].sort(), [...expected.keys()].sort(), `${label}: file list`);
  for (const [rel, bytes] of expected) {
    assert.equal(Buffer.compare(actual.get(rel)!, bytes), 0, `${label}: ${rel} is not byte-identical`);
  }
}

const FIXED_NOW = new Date("2026-11-13T12:34:56.789Z");
const STAMP_DIR = "reset-2026-11-13T12-34-56-789Z";

/** Key state with awkward bytes: nested files, binary content, a BOM, CRLF line ends. */
async function seedKeyState(hk: string): Promise<void> {
  await fs.mkdir(path.join(hk, "dev-accounts", "nested"), { recursive: true });
  await fs.writeFile(path.join(hk, "dev-accounts", "alice.json"), JSON.stringify({ fake: fakeKey() }), "utf8");
  await fs.writeFile(
    path.join(hk, "dev-accounts", "bob.json"),
    Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(`{"fake":"${fakeKey()}"}\r\n`, "utf8")])
  );
  await fs.writeFile(path.join(hk, "dev-accounts", "nested", "raw.bin"), crypto.randomBytes(257));
  const store = { accounts: [{ name: "tn", network: "testnet-10", address: "kaspatest:qfaketn", privateKey: fakeKey() }] };
  await fs.writeFile(path.join(hk, "accounts.real.json"), "\uFEFF" + JSON.stringify(store, null, 2).replace(/\n/g, "\r\n"), "utf8");
}

async function seedChainState(hk: string): Promise<void> {
  await fs.mkdir(path.join(hk, "node-data", "datadir", "db"), { recursive: true });
  await fs.writeFile(path.join(hk, "node-data", "datadir", "db", "000001.sst"), crypto.randomBytes(1024));
  await fs.writeFile(path.join(hk, "node-data", "LOCK"), "", "utf8");
  await fs.mkdir(path.join(hk, "localnet"), { recursive: true });
  await fs.writeFile(path.join(hk, "localnet", "state.json"), "{\"running\":false}", "utf8");
}

// ------------------------------------------------------------------------------------------------ plaintext keys

describe("Key export: a plaintext non-simnet key never leaves accounts.real.json", () => {
  it("reads every known address prefix, case-insensitively, and nothing else", () => {
    assert.equal(networkFromAddress("kaspadev:qfake"), "devnet");
    assert.equal(networkFromAddress("KASPASIM:QFAKE"), "simnet");
    assert.equal(networkFromAddress("Kaspa:qfake"), "mainnet");
    assert.equal(networkFromAddress("kaspa:qfake:extra"), "mainnet");
    for (const a of [undefined, "", ":qfake", "kaspa", "kaspax:qfake", "kaspatest10:qfake", "bitcoin:qfake"]) {
      assert.equal(networkFromAddress(a), undefined, String(a));
    }
  });

  it("refuses testnet, devnet and mainnet accounts, and accounts with no network at all", async () => {
    const cases: Array<{ label: string; entry: Record<string, unknown> }> = [
      { label: "testnet-10 field + kaspatest address", entry: { network: "testnet-10", address: "kaspatest:qfaketn10" } },
      { label: "testnet-11 field + kaspatest address", entry: { network: "testnet-11", address: "kaspatest:qfaketn11" } },
      { label: "mainnet field + kaspa address", entry: { network: "mainnet", address: "kaspa:qfakemain" } },
      { label: "devnet field + kaspadev address", entry: { network: "devnet", address: "kaspadev:qfakedev" } },
      { label: "no field, kaspatest address", entry: { address: "kaspatest:qfakelegacy" } },
      { label: "no field, kaspa address", entry: { address: "kaspa:qfakelegacymain" } },
      { label: "no field, upper-case KASPA address", entry: { address: "KASPA:QFAKEUPPER" } },
      { label: "no field, upper-case KASPATEST address", entry: { address: "KASPATEST:QFAKEUPPER" } },
      { label: "empty field, kaspa address", entry: { network: "", address: "kaspa:qfakeempty" } },
      { label: "blank field, kaspatest address", entry: { network: "   ", address: "kaspatest:qfakeblank" } },
      { label: "non-string field, kaspa address", entry: { network: 1, address: "kaspa:qfakenum" } },
      { label: "mainnet field, no address", entry: { network: "mainnet" } },
      { label: "no field, no address", entry: {} }
    ];
    const root = await makeWorkspace();
    const accounts = cases.map((c, i) => ({ name: `acct${i}`, privateKey: fakeKey(), ...c.entry }));
    await writeRealStore(root, { accounts });
    for (const [i, c] of cases.entries()) {
      await assertRefused(revealDevAccountKey(`acct${i}`, root), "NOT_SIMNET", [accounts[i].privateKey], c.label);
    }
    assert.deepEqual(await listDevAccountNames(root), []);
  });

  it("refuses an entry whose network field and address prefix disagree, in either direction", async () => {
    const cases: Array<{ network: string; address: string }> = [
      { network: "simnet", address: "kaspa:qfakemain" },
      { network: "simnet", address: "KASPA:QFAKEMAIN" },
      { network: "simnet", address: "kaspatest:qfaketn" },
      { network: "simnet", address: "kaspadev:qfakedev" },
      { network: "  simnet  ", address: "kaspa:qfakepadded" },
      { network: "testnet-10", address: "kaspasim:qfakesim" },
      { network: "mainnet", address: "kaspasim:qfakesim" },
      { network: "devnet", address: "kaspasim:qfakesim" }
    ];
    const root = await makeWorkspace();
    const accounts = cases.map((c, i) => ({ name: `liar${i}`, privateKey: fakeKey(), ...c }));
    await writeRealStore(root, { accounts });
    for (const [i, c] of cases.entries()) {
      await assertRefused(revealDevAccountKey(`liar${i}`, root), "NETWORK_MISMATCH", [accounts[i].privateKey], `${c.network} + ${c.address}`);
    }
    assert.deepEqual(await listDevAccountNames(root), []);
  });

  it("applies the rule to every store layout and key field it reads", async () => {
    type Entry = Record<string, unknown>;
    const layouts: Array<{ label: string; build: (sim: Entry, tn: Entry) => unknown }> = [
      { label: "top-level array", build: (sim, tn) => [{ name: "sim", ...sim }, { name: "tn", ...tn }] },
      { label: "{ accounts: [...] }", build: (sim, tn) => ({ accounts: [{ name: "sim", ...sim }, { name: "tn", ...tn }] }) },
      { label: "object keyed by name", build: (sim, tn) => ({ sim, tn }) },
      { label: "label instead of name", build: (sim, tn) => ({ accounts: [{ label: "sim", ...sim }, { label: "tn", ...tn }] }) }
    ];
    const root = await makeWorkspace();
    let n = 0;
    for (const layout of layouts) {
      for (const field of ["privateKey", "privateKeyHex", "secretKey", "secret"]) {
        const simKey = fakeKey();
        const tnKey = fakeKey();
        const sim = { network: "simnet", address: "kaspasim:qfakesim", [field]: simKey };
        const tn = { address: "kaspatest:qfaketn", [field]: tnKey };
        await writeRealStore(root, layout.build(sim, tn), n++ % 2 === 0);
        const label = `${layout.label} / ${field}`;
        const got = await revealDevAccountKey("sim", root);
        assert.equal(got.privateKey, simKey, label);
        assert.equal(got.network, "simnet", label);
        await assertRefused(revealDevAccountKey("tn", root), "NOT_SIMNET", [tnKey], label);
        assert.deepEqual(await listDevAccountNames(root), ["sim"], label);
      }
    }
  });

  it("a duplicated name never yields the testnet key, whichever entry comes first", async () => {
    const root = await makeWorkspace();
    for (const simFirst of [true, false]) {
      const simKey = fakeKey();
      const tnKey = fakeKey();
      const sim = { name: "dup", network: "simnet", address: "kaspasim:qfakedup", privateKey: simKey };
      const tn = { name: "dup", network: "testnet-10", address: "kaspatest:qfakedup", privateKey: tnKey };
      await writeRealStore(root, { accounts: simFirst ? [sim, tn] : [tn, sim] });
      const outcome = await revealDevAccountKey("dup", root).then(
        (k) => k.privateKey,
        (e: unknown) => e
      );
      assert.notEqual(outcome, tnKey, `simFirst=${simFirst}`);
      assert.ok(outcome === simKey || (outcome instanceof FsError && outcome.code === "NOT_SIMNET"), `simFirst=${simFirst}`);
    }
  });

  it("a non-simnet plaintext entry is refused even when a simnet keystore has the same name", async () => {
    const root = await makeWorkspace();
    const tnKey = fakeKey();
    const simKey = fakeKey();
    await writeRealStore(root, { accounts: [{ name: "alice", network: "testnet-10", address: "kaspatest:qfakealice", privateKey: tnKey }] });
    await writeKeystore(
      root,
      "alice",
      await buildKeystore({
        payload: { address: "kaspasim:qfakealice", privateKey: simKey, network: "simnet" },
        metadata: { label: "alice", network: "simnet", address: "kaspasim:qfakealice" }
      })
    );
    await assertRefused(revealDevAccountKey("alice", root), "NOT_SIMNET", [tnKey, simKey], "alice");
  });

  it("with no workspace open nothing is listed or revealed", async () => {
    assert.deepEqual(await listDevAccountNames(null), []);
    await assertRefused(revealDevAccountKey("alice", null), "NO_WORKSPACE", [], "no workspace");
  });
});

// ------------------------------------------------------------------------------------------------ account names

describe("Key export: names with path traversal reveal nothing", () => {
  it("rejects every name that is not a plain account name, even when a key sits at the traversed path", async () => {
    const root = await makeWorkspace();
    const hk = path.join(root, ".hardkas");
    const key = fakeKey();
    const keystore = await buildKeystore({
      payload: { address: "kaspasim:qfakex", privateKey: key, network: "simnet" },
      metadata: { label: "x", network: "simnet", address: "kaspasim:qfakex" }
    });
    // Exportable keys one and two levels above dev-accounts, and a plaintext entry literally named "../x".
    await fs.mkdir(path.join(hk, "dev-accounts"), { recursive: true });
    await fs.writeFile(path.join(hk, "x.json"), JSON.stringify(keystore), "utf8");
    await fs.writeFile(path.join(root, "x.json"), JSON.stringify(keystore), "utf8");
    await writeRealStore(root, { accounts: [{ name: "../x", network: "simnet", address: "kaspasim:qfakex", privateKey: key }] });

    const bad = [
      "../x", "..\\x", "../../x", "..", ".", "./x", "x/../../x", "dev-accounts/../x", "a/b", "a\\b", "/x", "\\x",
      "C:\\x", "C:x", "x.json", "x:stream", "x\0", "", " x", "x ", "%2e%2e%2fx", "1x", "-x", "_x", "x".repeat(33), "ålice"
    ];
    for (const name of bad) await assertRefused(revealDevAccountKey(name, root), "BAD_REQUEST", [key], JSON.stringify(name));

    // Control: the same keystore inside dev-accounts is exportable, so the refusals above are the name check.
    await writeKeystore(root, "x", keystore);
    assert.equal((await revealDevAccountKey("x", root)).privateKey, key);
  });
});

// ------------------------------------------------------------------------------------------------ dev keystores

describe("Key export: encrypted dev keystores must be simnet", () => {
  it("exports a simnet dev keystore (control for the cases below)", async () => {
    const root = await makeWorkspace();
    const key = fakeKey();
    await writeKeystore(
      root,
      "alice",
      await buildKeystore({
        payload: { address: "kaspasim:qfakealice", privateKey: key, network: "simnet" },
        metadata: { label: "alice", network: "simnet", address: "kaspasim:qfakealice" }
      })
    );
    assert.deepEqual(await revealDevAccountKey("alice", root), { name: "alice", address: "kaspasim:qfakealice", network: "simnet", privateKey: key });
    assert.deepEqual(await listDevAccountNames(root), ["alice"]);
  });

  it("refuses a keystore whose metadata names another network, or none", async () => {
    const root = await makeWorkspace();
    const cases: Array<{ label: string; metadata?: Record<string, unknown> }> = [
      { label: "testnet-10", metadata: { network: "testnet-10", address: "kaspatest:qfake" } },
      { label: "mainnet", metadata: { network: "mainnet", address: "kaspa:qfake" } },
      { label: "network missing", metadata: { address: "kaspasim:qfake" } },
      { label: "metadata missing" }
    ];
    for (const [i, c] of cases.entries()) {
      const key = fakeKey();
      // The payload claims simnet: the metadata gate alone must refuse.
      await writeKeystore(root, `k${i}`, await buildKeystore({ payload: { privateKey: key, network: "simnet" }, metadata: c.metadata }));
      await assertRefused(revealDevAccountKey(`k${i}`, root), "NOT_SIMNET", [key], c.label);
    }
  });

  it("refuses a simnet-labelled keystore whose decrypted payload names another network", async () => {
    const root = await makeWorkspace();
    for (const [i, network] of ["testnet-10", "mainnet", "devnet"].entries()) {
      const key = fakeKey();
      await writeKeystore(root, `k${i}`, await buildKeystore({ payload: { privateKey: key, network }, metadata: { network: "simnet" } }));
      await assertRefused(revealDevAccountKey(`k${i}`, root), "NOT_SIMNET", [key], network);
    }
  });

  it("refuses a keystore whose decrypted address differs from its metadata", async () => {
    const root = await makeWorkspace();
    for (const [i, address] of ["kaspasim:qfakeother", "kaspa:qfakemain"].entries()) {
      const key = fakeKey();
      await writeKeystore(
        root,
        `k${i}`,
        await buildKeystore({ payload: { address, privateKey: key, network: "simnet" }, metadata: { network: "simnet", address: "kaspasim:qfakelabel" } })
      );
      await assertRefused(revealDevAccountKey(`k${i}`, root), "ADDRESS_MISMATCH", [key], address);
    }
  });

  it("refuses a keystore not encrypted with the dev password, or with a tampered tag", async () => {
    const root = await makeWorkspace();
    const cases: Array<{ label: string; opts: Partial<KeystoreOptions> }> = [
      { label: "another password", opts: { password: "not-the-dev-password" } },
      { label: "tampered tag", opts: { tamperTag: true } }
    ];
    for (const [i, c] of cases.entries()) {
      const key = fakeKey();
      await writeKeystore(root, `k${i}`, await buildKeystore({ payload: { privateKey: key, network: "simnet" }, metadata: { network: "simnet" }, ...c.opts }));
      await assertRefused(revealDevAccountKey(`k${i}`, root), "DECRYPT_FAILED", [key], c.label);
    }
  });

  it("refuses unsupported formats, unreadable files and payloads without a raw hex key", async () => {
    const root = await makeWorkspace();
    await writeKeystore(root, "v1", await buildKeystore({ payload: { privateKey: fakeKey() }, metadata: { network: "simnet" }, type: "hardkas.encryptedKeystore.v1" }));
    await assertRefused(revealDevAccountKey("v1", root), "UNSUPPORTED_KEYSTORE", [], "v1");
    await writeKeystore(root, "scrypt", await buildKeystore({ payload: { privateKey: fakeKey() }, metadata: { network: "simnet" }, kdfAlgorithm: "scrypt" }));
    await assertRefused(revealDevAccountKey("scrypt", root), "UNSUPPORTED_KEYSTORE", [], "scrypt");
    await fs.writeFile(path.join(root, ".hardkas", "dev-accounts", "garbage.json"), "{not json", "utf8");
    await assertRefused(revealDevAccountKey("garbage", root), "NOT_FOUND", [], "garbage");
    await assertRefused(revealDevAccountKey("missing", root), "NOT_FOUND", [], "missing");

    const badKeys: unknown[] = ["zz".repeat(32), "a".repeat(63), "a".repeat(65), `0x${"a".repeat(64)}`, 42, undefined];
    for (const [i, privateKey] of badKeys.entries()) {
      await writeKeystore(root, `bad${i}`, await buildKeystore({ payload: { privateKey, network: "simnet" }, metadata: { network: "simnet" } }));
      await assertRefused(revealDevAccountKey(`bad${i}`, root), "BAD_PAYLOAD", [], String(privateKey));
    }
  });

  it(
    "refuses a simnet-labelled keystore whose decrypted address is a testnet or mainnet address",
    async () => {
      const root = await makeWorkspace();
      const cases: Array<{ label: string; payload: Record<string, unknown>; metadata: Record<string, unknown> }> = [
        { label: "payload has no network, mainnet address", payload: { address: "kaspa:qfakemain" }, metadata: { network: "simnet" } },
        {
          label: "metadata and payload agree on a testnet address",
          payload: { address: "kaspatest:qfaketn" },
          metadata: { network: "simnet", address: "kaspatest:qfaketn" }
        },
        { label: "payload says simnet, mainnet address", payload: { address: "kaspa:qfakemain", network: "simnet" }, metadata: { network: "simnet" } }
      ];
      for (const [i, c] of cases.entries()) {
        const key = fakeKey();
        await writeKeystore(root, `k${i}`, await buildKeystore({ payload: { ...c.payload, privateKey: key }, metadata: c.metadata }));
        await assert.rejects(revealDevAccountKey(`k${i}`, root), (e: unknown) => e instanceof FsError, c.label);
      }
    }
  );
});

// ------------------------------------------------------------------------------------------------ node reset

describe("Node reset: the key backup", () => {
  it("backs up byte-identical copies of the key files and touches nothing else", async () => {
    const root = await makeWorkspace();
    const hk = path.join(root, ".hardkas");
    await seedKeyState(hk);
    await seedChainState(hk);
    // An earlier reset's backup, and files that are neither key nor chain state.
    const older = path.join(hk, "backups", "reset-2026-01-01T00-00-00-000Z");
    await fs.mkdir(older, { recursive: true });
    await fs.writeFile(path.join(older, "accounts.real.json"), `{"older":"${fakeKey()}"}`, "utf8");
    await fs.writeFile(path.join(hk, "keep.json"), "other", "utf8");
    await fs.writeFile(path.join(root, "hardkas.config.ts"), "export default {}\n", "utf8");

    const devBefore = await snapshot(path.join(hk, "dev-accounts"));
    const realBefore = await fs.readFile(path.join(hk, "accounts.real.json"));
    const olderBefore = await snapshot(older);

    const result = await resetWorkspaceChainState(root, FIXED_NOW);

    assert.equal(result.backupDir, `.hardkas/backups/${STAMP_DIR}`);
    assert.deepEqual([...result.backedUp].sort(), [".hardkas/accounts.real.json", ".hardkas/dev-accounts"]);
    assert.deepEqual([...result.wiped].sort(), [".hardkas/localnet", ".hardkas/node-data"]);
    const backup = path.join(hk, "backups", STAMP_DIR);
    assert.deepEqual((await fs.readdir(backup)).sort(), ["accounts.real.json", "dev-accounts"]);
    assertSameBytes(await snapshot(path.join(backup, "dev-accounts")), devBefore, "dev-accounts backup");
    assert.equal(Buffer.compare(await fs.readFile(path.join(backup, "accounts.real.json")), realBefore), 0, "accounts.real.json backup");
    assertSameBytes(await snapshot(older), olderBefore, "earlier backup");

    for (const rel of ["dev-accounts", "accounts.real.json", "node-data", "localnet"]) {
      await assert.rejects(fs.access(path.join(hk, rel)), `${rel} should be gone from .hardkas`);
    }
    assert.equal(await fs.readFile(path.join(hk, "keep.json"), "utf8"), "other");
    assert.equal(await fs.readFile(path.join(root, "hardkas.config.ts"), "utf8"), "export default {}\n");
  });

  it("deletes nothing when the backups path is a file", async () => {
    const root = await makeWorkspace();
    const hk = path.join(root, ".hardkas");
    await seedKeyState(hk);
    await seedChainState(hk);
    await fs.writeFile(path.join(hk, "backups"), "not a folder", "utf8");
    const before = await snapshot(hk);

    await assert.rejects(resetWorkspaceChainState(root, FIXED_NOW), (e: unknown) => {
      assert.ok(e instanceof LocalNodeError, String(e));
      assert.equal(e.code, "KEY_BACKUP_FAILED");
      assert.equal(e.status, 409);
      assert.match(e.message, /Nothing was deleted/);
      return true;
    });
    assertSameBytes(await snapshot(hk), before, ".hardkas after a failed backup");
  });

  it("backs up next to a file that blocks the timestamped folder, and leaves that file alone", async () => {
    const root = await makeWorkspace();
    const hk = path.join(root, ".hardkas");
    await seedKeyState(hk);
    await seedChainState(hk);
    await fs.mkdir(path.join(hk, "backups"), { recursive: true });
    await fs.writeFile(path.join(hk, "backups", STAMP_DIR), "in the way", "utf8");
    const keysBefore = await snapshot(hk);

    const result = await resetWorkspaceChainState(root, FIXED_NOW);
    assert.equal(result.backupDir, `.hardkas/backups/${STAMP_DIR}-2`);
    assert.equal(await fs.readFile(path.join(hk, "backups", STAMP_DIR), "utf8"), "in the way");
    for (const [rel, bytes] of keysBefore) {
      if (!rel.startsWith("dev-accounts") && rel !== "accounts.real.json") continue;
      assert.deepEqual(await fs.readFile(path.join(hk, "backups", `${STAMP_DIR}-2`, ...rel.split("/"))), bytes, rel);
    }
  });

  it("never moves keys into an existing backup folder of the same timestamp, and leaves that folder alone", async () => {
    const root = await makeWorkspace();
    const hk = path.join(root, ".hardkas");
    await seedKeyState(hk);
    await seedChainState(hk);
    // An earlier backup at the same timestamp already holds an accounts.real.json (here a folder with a file in it).
    const earlier = path.join(hk, "backups", STAMP_DIR);
    await fs.mkdir(path.join(earlier, "accounts.real.json"), { recursive: true });
    await fs.writeFile(path.join(earlier, "accounts.real.json", "blocker"), "x", "utf8");
    const earlierBefore = await snapshot(earlier);
    const devBefore = await snapshot(path.join(hk, "dev-accounts"));
    const realBefore = await fs.readFile(path.join(hk, "accounts.real.json"));

    const result = await resetWorkspaceChainState(root, FIXED_NOW);

    assert.equal(result.backupDir, `.hardkas/backups/${STAMP_DIR}-2`);
    assertSameBytes(await snapshot(earlier), earlierBefore, "the earlier backup");
    const fresh = path.join(hk, "backups", `${STAMP_DIR}-2`);
    assertSameBytes(await snapshot(path.join(fresh, "dev-accounts")), devBefore, "dev-accounts");
    assert.equal(Buffer.compare(await fs.readFile(path.join(fresh, "accounts.real.json")), realBefore), 0, "accounts.real.json");
    assert.deepEqual([...result.wiped].sort(), [".hardkas/localnet", ".hardkas/node-data"]);
  });

  it("resets a workspace that has chain state but no keys, without creating a backup", async () => {
    const root = await makeWorkspace();
    const hk = path.join(root, ".hardkas");
    await seedChainState(hk);

    const result = await resetWorkspaceChainState(root, FIXED_NOW);

    assert.deepEqual(result.backedUp, []);
    assert.equal(result.backupDir, null);
    assert.deepEqual([...result.wiped].sort(), [".hardkas/localnet", ".hardkas/node-data"]);
    await assert.rejects(fs.access(path.join(hk, "backups")));
    await assert.rejects(fs.access(path.join(hk, "node-data")));
    await assert.rejects(fs.access(path.join(hk, "localnet")));
  });

  it("backs up only the key path that exists", async () => {
    const root = await makeWorkspace();
    const hk = path.join(root, ".hardkas");
    const real = `{"accounts":[{"name":"tn","network":"testnet-10","address":"kaspatest:qfake","privateKey":"${fakeKey()}"}]}`;
    await fs.writeFile(path.join(hk, "accounts.real.json"), real, "utf8");

    const result = await resetWorkspaceChainState(root, FIXED_NOW);

    assert.deepEqual(result, { wiped: [], backedUp: [".hardkas/accounts.real.json"], backupDir: `.hardkas/backups/${STAMP_DIR}` });
    assert.deepEqual(await fs.readdir(path.join(hk, "backups", STAMP_DIR)), ["accounts.real.json"]);
    assert.equal(await fs.readFile(path.join(hk, "backups", STAMP_DIR, "accounts.real.json"), "utf8"), real);
  });

  it("is a no-op on a folder without .hardkas, and creates nothing", async () => {
    const root = await makeTemp();
    const result = await resetWorkspaceChainState(root, FIXED_NOW);
    assert.deepEqual(result, { wiped: [], backedUp: [], backupDir: null });
    assert.deepEqual(await fs.readdir(root), []);
  });

  it(
    "never overwrites an earlier backup made at the same timestamp",
    async () => {
      const root = await makeWorkspace();
      const hk = path.join(root, ".hardkas");
      const realFile = path.join(hk, "accounts.real.json");
      const first = `{"accounts":[{"name":"tn","network":"testnet-10","address":"kaspatest:qfirst","privateKey":"${fakeKey()}"}]}`;
      const second = `{"accounts":[{"name":"tn","network":"testnet-10","address":"kaspatest:qsecond","privateKey":"${fakeKey()}"}]}`;
      await fs.writeFile(realFile, first, "utf8");
      await resetWorkspaceChainState(root, FIXED_NOW);
      await fs.writeFile(realFile, second, "utf8");
      await resetWorkspaceChainState(root, FIXED_NOW).catch(() => undefined);

      const texts = [...(await snapshot(hk)).values()].map((b) => b.toString("utf8"));
      assert.ok(texts.includes(second), "the second key file was lost");
      assert.ok(texts.includes(first), "the first reset's backup was overwritten");
    }
  );

  it("does not follow a link inside node-data out of the workspace", async (t) => {
    const root = await makeWorkspace();
    const outside = await makeTemp("hardkas-ide-outside-");
    const hk = path.join(root, ".hardkas");
    const walletKey = fakeKey();
    await fs.writeFile(path.join(outside, "wallet.key"), walletKey, "utf8");
    await fs.mkdir(path.join(hk, "node-data"), { recursive: true });
    try {
      // A junction on Windows (no admin rights needed), a directory symlink elsewhere.
      await fs.symlink(outside, path.join(hk, "node-data", "linked"), "junction");
    } catch (error) {
      t.skip(`cannot create a directory link here: ${error instanceof Error ? error.message : String(error)}`);
      return;
    }

    const result = await resetWorkspaceChainState(root, FIXED_NOW);

    assert.deepEqual(result.wiped, [".hardkas/node-data"]);
    assert.equal(await fs.readFile(path.join(outside, "wallet.key"), "utf8"), walletKey);
  });
});

// ------------------------------------------------------------------------------------------------ miner identity

describe("Miner identity: edge cases", () => {
  it("accepts the kaspanet/cpuminer image by tag, digest or both, with surrounding whitespace", () => {
    for (const image of ["kaspanet/cpuminer", "kaspanet/cpuminer:v0.2.6", `kaspanet/cpuminer:latest@sha256:${"0".repeat(64)}`, "  kaspanet/cpuminer:latest  "]) {
      assert.equal(isHardkasMiner({ image, networkMode: " container:5e1b6f89 " }), true, image);
    }
  });

  it("refuses look-alike image names", () => {
    for (const image of [
      "",
      "kaspanet/cpuminer-evil",
      "kaspanet/cpuminerx:latest",
      "kaspanet/cpuminer2",
      "kaspanet/cpu-miner",
      "notkaspanet/cpuminer",
      "kaspanet-cpuminer",
      "kaspanet/kaspad",
      "cpuminer",
      "kaspanet/cpuminer/../nginx"
    ]) {
      assert.equal(isHardkasMiner({ image, networkMode: "container:abc" }), false, image);
    }
  });

  it("refuses the right image outside another container's network namespace", () => {
    for (const networkMode of ["", "host", "none", "default", "bridge", "hardkas-net", "containers:abc", "service:abc"]) {
      assert.equal(isHardkasMiner({ image: "kaspanet/cpuminer:latest", networkMode }), false, networkMode);
    }
  });

  it(
    "refuses a kaspanet/cpuminer path published under another registry namespace",
    () => {
      for (const image of ["ghcr.io/attacker/kaspanet/cpuminer:latest", "evil.example/kaspanet/cpuminer", "attacker/kaspanet/cpuminer"]) {
        assert.equal(isHardkasMiner({ image, networkMode: "container:abc" }), false, image);
      }
    }
  );
});

// ------------------------------------------------------------------------------------------------ Host allowlist

describe("Host allowlist: cases security.test.ts misses", () => {
  it("accepts IPv6 loopback with or without a port, in its long form too", () => {
    for (const h of ["[::1]", "[::1]:80", "[::1]:5173", "[0:0:0:0:0:0:0:1]:7421"]) assert.equal(isAllowedHost(h), true, h);
  });

  it("refuses IPv6 loopback without brackets, and other IPv6 addresses", () => {
    for (const h of ["::1", "::1:7421", "[::1", "[::2]:7421", "[::ffff:127.0.0.1]:7421", "[fe80::1]:7421"]) {
      assert.equal(isAllowedHost(h), false, h);
    }
  });

  it("ignores case in the Host header and in configured names", () => {
    for (const h of ["LocalHost:5173", "LOCALHOST", "Localhost:7421"]) assert.equal(isAllowedHost(h), true, h);
    const allowed = allowedHostnames({ HARDKAS_IDE_ALLOWED_HOSTS: "IDE.Internal" } as NodeJS.ProcessEnv);
    assert.equal(isAllowedHost("ide.INTERNAL:7421", allowed), true);
    assert.equal(isAllowedHost("IDE.INTERNAL", allowed), true);
  });

  it("refuses empty, blank and garbage Host headers", () => {
    for (const h of [
      " ",
      "   ",
      ":",
      ":7421",
      "localhost:abc",
      "localhost:99999",
      "local host:7421",
      "localhost@evil.example",
      "http://localhost:7421",
      "%6c%6f%63%61%6c%68%6f%73%74x"
    ]) {
      assert.equal(isAllowedHost(h), false, JSON.stringify(h));
    }
  });

  it("refuses host names that merely contain localhost or a loopback address", () => {
    for (const h of [
      "mylocalhost:7421",
      "localhostx",
      "localhost-evil.example",
      "evil.localhost:7421",
      "localhost.",
      "localhost.:7421",
      "127.0.0.1.nip.io:7421",
      "127.0.0.10:7421",
      "127.0.0.2:7421"
    ]) {
      assert.equal(isAllowedHost(h), false, h);
    }
  });

  it("an empty, blank or wildcard HARDKAS_IDE_ALLOWED_HOSTS adds nothing", () => {
    const loopback = ["127.0.0.1", "[::1]", "localhost"];
    assert.deepEqual([...allowedHostnames({} as NodeJS.ProcessEnv)].sort(), loopback);
    for (const v of ["", " ", ",", " , ,, "]) {
      assert.deepEqual([...allowedHostnames({ HARDKAS_IDE_ALLOWED_HOSTS: v } as NodeJS.ProcessEnv)].sort(), loopback, JSON.stringify(v));
    }
    const star = allowedHostnames({ HARDKAS_IDE_ALLOWED_HOSTS: "*" } as NodeJS.ProcessEnv);
    assert.equal(isAllowedHost("evil.example:7421", star), false);
    // Entries are host names: one written with a port never matches, so it widens nothing.
    const withPort = allowedHostnames({ HARDKAS_IDE_ALLOWED_HOSTS: "ide.internal:7421" } as NodeJS.ProcessEnv);
    assert.equal(isAllowedHost("ide.internal:7421", withPort), false);
    assert.equal(isAllowedHost("ide.internal", withPort), false);
  });

  it("without an explicit list, reads HARDKAS_IDE_ALLOWED_HOSTS at call time", () => {
    const saved = process.env.HARDKAS_IDE_ALLOWED_HOSTS;
    try {
      process.env.HARDKAS_IDE_ALLOWED_HOSTS = "ide.internal";
      assert.equal(isAllowedHost("IDE.INTERNAL:7421"), true);
      assert.equal(isAllowedHost("evil.example:7421"), false);
      delete process.env.HARDKAS_IDE_ALLOWED_HOSTS;
      assert.equal(isAllowedHost("ide.internal:7421"), false);
      assert.equal(isAllowedHost("localhost:7421"), true);
    } finally {
      if (saved === undefined) delete process.env.HARDKAS_IDE_ALLOWED_HOSTS;
      else process.env.HARDKAS_IDE_ALLOWED_HOSTS = saved;
    }
  });
});

describe("listDevAccountAddresses", () => {
  it("returns public simnet addresses from dev-accounts metadata and ignores non-simnet stores", async () => {
    const root = await makeWorkspace();
    const devDir = path.join(root, ".hardkas", "dev-accounts");
    await fs.mkdir(devDir, { recursive: true });
    await fs.writeFile(
      path.join(devDir, "alice.json"),
      JSON.stringify({ version: 2, type: "hardkas.encryptedKeystore.v2", metadata: { network: "simnet", address: "kaspasim:qfakealice" } })
    );
    await fs.writeFile(
      path.join(devDir, "testnet_user.json"),
      JSON.stringify({ version: 2, type: "hardkas.encryptedKeystore.v2", metadata: { network: "testnet-10", address: "kaspatest:qfaketest" } })
    );
    await writeRealStore(root, {
      realSim: { privateKey: fakeKey(), network: "simnet", address: "kaspasim:qfakereal" },
      realTest: { privateKey: fakeKey(), network: "testnet-10", address: "kaspatest:qfakereal" }
    });

    const addrs = await listDevAccountAddresses(root);
    assert.deepEqual(addrs, {
      alice: "kaspasim:qfakealice",
      realSim: "kaspasim:qfakereal"
    });
  });
});
