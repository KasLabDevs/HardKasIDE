import { describe, expect, it } from "vitest";
import { buildCommand, checkWord, commandLine, encryptedSigners, failureText, initialValues, psktSupport, readVerdict, resultRows, scratchPath, type CommandSpec } from "./commandSpec";
import { ALL_CARDS, ESCROW_CARDS, KCC20_NODE_CARDS } from "./cards";

const spec: CommandSpec = {
  id: "kcc20-check",
  title: "Check a transfer",
  summary: "x",
  words: ["kcc20", "check"],
  fields: [
    { id: "transfer", label: "Transfer", kind: "json", as: "arg", required: true, sample: '{"a":1}' },
    { id: "network", label: "Network", kind: "select", as: "option", flag: "--network", choices: [{ value: "simnet", label: "simnet" }] },
    { id: "noNode", label: "No node", kind: "flag", as: "option", flag: "--no-node" },
    { id: "name", label: "Name", kind: "text", as: "option", flag: "--contract" }
  ]
};

describe("buildCommand", () => {
  it("puts JSON in a scratch file and gives the command its path, never the JSON", () => {
    const r = buildCommand(spec, { transfer: '{ "a": 1 }' });
    expect(r).toEqual({
      ok: true,
      args: ["kcc20", "check", ".hardkas/ide/scratch/kcc20-check-transfer.json", "--json"],
      files: [{ path: ".hardkas/ide/scratch/kcc20-check-transfer.json", content: '{\n  "a": 1\n}\n' }]
    });
  });

  it("orders words, then arguments, then options, with --json last", () => {
    const r = buildCommand(spec, { transfer: "{}", network: "simnet", noNode: "true", name: "Vault" });
    expect(r.ok && r.args).toEqual(["kcc20", "check", ".hardkas/ide/scratch/kcc20-check-transfer.json", "--network", "simnet", "--no-node", "--contract", "Vault", "--json"]);
  });

  it("asks for a required field and names it", () => {
    expect(buildCommand(spec, { transfer: "  " })).toEqual({ ok: false, error: "Transfer is required.", fieldId: "transfer" });
  });

  it("says when the JSON does not parse, and writes nothing", () => {
    const r = buildCommand(spec, { transfer: "{oops" });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatch(/^Transfer: not valid JSON/);
  });

  it("refuses a choice that is not offered", () => {
    const r = buildCommand(spec, { transfer: "{}", network: "mainnet" });
    expect(r.ok).toBe(false);
  });

  it("leaves out an option that was not filled in", () => {
    const r = buildCommand(spec, { transfer: "{}" });
    expect(r.ok && r.args).not.toContain("--network");
  });

  it("gives a variadic option (`<files...>`) its flag once, then every word", () => {
    const s: CommandSpec = { id: "x", title: "x", summary: "x", words: ["escrow", "release"], fields: [{ id: "sigs", label: "Signatures", kind: "text", as: "option", flag: "--signatures", list: true, variadic: true }] };
    const r = buildCommand(s, { sigs: "a.json, b.json c.json" });
    expect(r.ok && r.args).toEqual(["escrow", "release", "--signatures", "a.json", "b.json", "c.json", "--json"]);
  });

  it("treats an account field as a plain word", () => {
    const s: CommandSpec = { id: "x", title: "x", summary: "x", words: ["escrow", "fund"], fields: [{ id: "from", label: "From", kind: "account", as: "option", flag: "--from", required: true }] };
    expect(buildCommand(s, { from: "alice" })).toMatchObject({ ok: true, args: ["escrow", "fund", "--from", "alice", "--json"] });
    expect(buildCommand(s, { from: "a&b" }).ok).toBe(false);
    expect(buildCommand(s, {})).toEqual({ ok: false, error: "From is required.", fieldId: "from" });
  });
});

describe("initialValues and encryptedSigners", () => {
  const s: CommandSpec = {
    id: "x",
    title: "x",
    summary: "x",
    words: ["escrow", "sign"],
    fields: [
      { id: "id", label: "Escrow", kind: "text", as: "arg", required: true },
      { id: "account", label: "Account", kind: "account", as: "option", flag: "--account", signs: true, initial: "alice" },
      { id: "arbiter", label: "Arbiter", kind: "account", as: "option", flag: "--arbiter", initial: "carol" }
    ]
  };
  it("a preset wins over a field's own starting value", () => {
    expect(initialValues(s)).toEqual({ id: "", account: "alice", arbiter: "carol" });
    expect(initialValues(s, { id: "abc", account: "bob" })).toEqual({ id: "abc", account: "bob", arbiter: "carol" });
  });
  it("names the signing accounts that are encrypted, and only those", () => {
    const accounts = [
      { name: "alice", keystore: "dev-keystore" },
      { name: "bob", keystore: "encrypted" },
      { name: "carol", keystore: "encrypted" }
    ];
    expect(encryptedSigners(s, { account: "alice", arbiter: "carol" }, accounts)).toEqual([]);
    expect(encryptedSigners(s, { account: "bob", arbiter: "carol" }, accounts)).toEqual(["bob"]); // carol does not sign here
    expect(encryptedSigners(s, { account: "nobody" }, accounts)).toEqual([]); // unknown: the CLI says ACCOUNT_NOT_FOUND
  });
});

describe("the escrow cards", () => {
  const byId = (id: string) => ESCROW_CARDS.find((c) => c.id === id)!;
  const ID = "0b0a3a4e-1234-4abc-8def-0123456789ab";

  it("cover the whole lifecycle, and nothing takes a password or a key", () => {
    expect(ESCROW_CARDS.map((c) => c.words.join(" "))).toEqual(["escrow create", "escrow fund", "escrow status", "escrow prepare", "escrow sign", "escrow release", "escrow reconcile"]);
    for (const c of ESCROW_CARDS) for (const f of c.fields) expect(`${f.id} ${f.label} ${f.flag ?? ""}`, `${c.id}.${f.id}`).not.toMatch(/password|private|secret|mnemonic/i);
  });

  it("offer the local node only: simnet, never mainnet or testnet", () => {
    for (const c of ESCROW_CARDS) {
      const net = c.fields.find((f) => f.flag === "--network");
      if (!net) continue;
      expect(net.choices?.map((x) => x.value), c.id).toEqual(["simnet"]);
      expect(net.required, c.id).toBe(true);
    }
  });

  it("create: the parties are accounts, EscrowFull by its principal, and the record is written, nothing sent", () => {
    const c = byId("escrow-create");
    expect(c.fields.filter((f) => f.kind === "account").map((f) => f.flag)).toEqual(["--buyer", "--seller", "--arbiter"]);
    const r = buildCommand(c, initialValues(c));
    expect(r.ok && r.args).toEqual(["escrow", "create", "--buyer", "alice", "--seller", "bob", "--arbiter", "carol", "--amount", "1", "--network", "simnet", "--json"]);
    const split = buildCommand(c, { ...initialValues(c), amount: "", buyerAmount: "0.6", sellerAmount: "0.4", feeBudget: "2000000" });
    expect(split.ok && split.args).toEqual(["escrow", "create", "--buyer", "alice", "--seller", "bob", "--arbiter", "carol", "--buyer-amount", "0.6", "--seller-amount", "0.4", "--fee-budget", "2000000", "--network", "simnet", "--json"]);
  });

  it("fund: the escrow id, the buyer's account (it signs), --wait only when asked", () => {
    const c = byId("escrow-fund");
    expect(c.fields.find((f) => f.id === "from")).toMatchObject({ kind: "account", signs: true, required: true });
    expect(buildCommand(c, initialValues(c))).toEqual({ ok: false, error: "Escrow is required.", fieldId: "id" });
    const r = buildCommand(c, initialValues(c, { id: ID }));
    expect(r.ok && r.args).toEqual(["escrow", "fund", ID, "--from", "alice", "--network", "simnet", "--json"]);
    const w = buildCommand(c, { ...initialValues(c, { id: ID }), wait: "true" });
    expect(w.ok && w.args).toContain("--wait");
  });

  it("status reads only; reconcile asks the node", () => {
    const s = byId("escrow-status");
    expect(s.offline).toBe(true);
    expect(buildCommand(s, { id: ID })).toMatchObject({ ok: true, args: ["escrow", "status", ID, "--json"] });
    const r = byId("escrow-reconcile");
    expect(r.offline).toBeUndefined();
    expect(buildCommand(r, initialValues(r, { id: ID }))).toMatchObject({ ok: true, args: ["escrow", "reconcile", ID, "--network", "simnet", "--json"] });
  });

  it("prepare: a branch of either contract, the mutual shares together", () => {
    const c = byId("escrow-prepare");
    const branches = c.fields.find((f) => f.id === "branch")!.choices!.map((x) => x.value);
    expect(branches).toEqual(["mutualRelease", "releaseToSeller", "refundBuyer", "executeSplit", "fullRelease", "fullRefund"]);
    const r = buildCommand(c, initialValues(c, { id: ID }));
    expect(r.ok && r.args).toEqual(["escrow", "prepare", ID, "--branch", "mutualRelease", "--network", "simnet", "--json"]);
    const shares = buildCommand(c, { ...initialValues(c, { id: ID }), buyerShare: "0.25", sellerShare: "0.75", out: ".hardkas/ide/release.request.json" });
    expect(shares.ok && shares.args).toEqual(["escrow", "prepare", ID, "--branch", "mutualRelease", "--buyer-share", "0.25", "--seller-share", "0.75", "--out", ".hardkas/ide/release.request.json", "--network", "simnet", "--json"]);
  });

  it("sign: an escrow id or a request file, one role, a signing account", () => {
    const c = byId("escrow-sign");
    expect(c.fields.find((f) => f.id === "account")).toMatchObject({ kind: "account", signs: true });
    const r = buildCommand(c, initialValues(c, { target: ID, account: "bob", role: "seller" }));
    expect(r.ok && r.args).toEqual(["escrow", "sign", ID, "--role", "seller", "--account", "bob", "--network", "simnet", "--json"]);
    const file = buildCommand(c, initialValues(c, { target: "escrow-0b0a3a4e-mutualRelease.request.json", account: "carol", role: "arbiter" }));
    expect(file.ok && file.args[2]).toBe("escrow-0b0a3a4e-mutualRelease.request.json");
    expect(buildCommand(c, initialValues(c, { target: ID, role: "owner" })).ok).toBe(false);
  });

  it("release: the signed request files of other workspaces, one argument each", () => {
    const c = byId("escrow-release");
    const r = buildCommand(c, initialValues(c, { id: ID }));
    expect(r.ok && r.args).toEqual(["escrow", "release", ID, "--network", "simnet", "--json"]);
    const files = buildCommand(c, { ...initialValues(c, { id: ID }), signatures: "a.request.json, b.request.json" });
    expect(files.ok && files.args).toEqual(["escrow", "release", ID, "--signatures", "a.request.json", "b.request.json", "--network", "simnet", "--json"]);
  });
});

describe("repeatable options", () => {
  const repeatable: CommandSpec = {
    id: "x",
    title: "x",
    summary: "x",
    words: ["kcc20", "transfer"],
    fields: [
      { id: "to", label: "Recipients", kind: "text", as: "option", flag: "--to", list: true },
      { id: "from", label: "Sender", kind: "account", as: "option", flag: "--from", required: true },
      { id: "ctor", label: "Constructor args", kind: "json", as: "option", flag: "--constructor-args" }
    ]
  };

  it("repeats a list option once per value, the way HardKAS's repeatable options are given", () => {
    const r = buildCommand(repeatable, { to: "bob=600, carol=300", from: "alice" });
    expect(r.ok && r.args).toEqual(["kcc20", "transfer", "--to", "bob=600", "--to", "carol=300", "--from", "alice", "--json"]);
  });

  it("an account field is a plain word; a JSON option goes to a scratch file after its flag", () => {
    const r = buildCommand(repeatable, { from: "al ice", ctor: "[1]" });
    expect(r.ok && r.args).toEqual(["kcc20", "transfer", "--from", "al ice", "--constructor-args", ".hardkas/ide/scratch/x-ctor.json", "--json"]);
    expect(r.ok && r.files).toEqual([{ path: ".hardkas/ide/scratch/x-ctor.json", content: "[\n  1\n]\n" }]);
    expect(buildCommand(repeatable, { from: "a|b" })).toMatchObject({ ok: false, fieldId: "from" });
  });
});

describe("checkWord", () => {
  it("refuses what the runner would refuse, and a positional that looks like an option", () => {
    expect(checkWord("Hex", "ab\ncd", true)).toMatch(/line breaks/);
    expect(checkWord("Hex", "a&b", false)).toMatch(/not allowed/);
    expect(checkWord("File", "--help", true)).toMatch(/start with "-"/);
    expect(checkWord("Amount", "-5", false)).toBeNull();
    expect(checkWord("File", "contracts/Vault.sil", true)).toBeNull();
  });
});

describe("commandLine and scratchPath", () => {
  it("writes the command as typed, without --json, quoting what needs it", () => {
    expect(commandLine(["kcc", "dispatch", "transfer(byte[32],int)", "--json"])).toBe('hardkas kcc dispatch "transfer(byte[32],int)"');
    expect(commandLine(["silver", "inspect", ".hardkas/a.json", "--json"])).toBe("hardkas silver inspect .hardkas/a.json");
  });
  it("makes a file name from the card and the field", () => {
    expect(scratchPath("Zk Toccata/Build", "Receipt!")).toBe(".hardkas/ide/scratch/zk-toccata-build-receipt.json");
  });
});

describe("readVerdict", () => {
  it("reads the verdict field the commands use", () => {
    expect(readVerdict({ verdict: "STRUCTURALLY_VALID" }, true)).toEqual({ verdict: "ok", label: "structurally valid" });
    expect(readVerdict({ verdict: "REJECTED" }, false)).toEqual({ verdict: "bad", label: "rejected" });
  });
  it("reads a boolean verdict, and the error envelope", () => {
    expect(readVerdict({ kcc20Valid: true, problems: [] }, true)).toEqual({ verdict: "ok", label: "valid" });
    expect(readVerdict({ valid: false }, true).label).toBe("not valid");
    expect(readVerdict({ valid: false }, true).verdict).toBe("bad");
    expect(readVerdict({ ok: true, issues: [] }, true)).toEqual({ verdict: "ok", label: "ok" });
    expect(readVerdict({ reproduced: true }, true)).toEqual({ verdict: "ok", label: "reproduced" });
    expect(readVerdict({ ok: false, code: "KCC20_TRANSFER_INVALID" }, false)).toEqual({ verdict: "bad", label: "KCC20_TRANSFER_INVALID" });
  });
  it("reads the verdict `kcc20 transfer` nests ({ verdict: { verdict, path, reason } })", () => {
    expect(readVerdict({ verdict: { verdict: "STRUCTURALLY_VALID", path: "standard", reason: null }, txId: "ab" }, true)).toEqual({ verdict: "ok", label: "structurally valid" });
    expect(readVerdict({ verdict: { verdict: "REJECTED", reason: "conservation" } }, false).verdict).toBe("bad");
  });
  it("is just information when the command judges nothing, a failure when it exited badly", () => {
    expect(readVerdict({ dispatchTag: "892896f5" }, true).verdict).toBe("info");
    expect(readVerdict(null, false).verdict).toBe("bad");
  });
});

describe("resultRows", () => {
  it("lists scalars as text, long values as long, objects and lists as folded JSON", () => {
    const rows = resultRows({ length: 112, encodedState: "ab".repeat(60), state: { amount: "1000" }, problems: [], note: null });
    expect(rows.find((r) => r.key === "length")).toEqual({ key: "length", value: "112", long: false, nested: false });
    expect(rows.find((r) => r.key === "encodedState")?.long).toBe(true);
    expect(rows.find((r) => r.key === "state")).toMatchObject({ nested: true, long: true });
    expect(rows.find((r) => r.key === "problems")).toEqual({ key: "problems", value: "none", long: false, nested: false });
    expect(rows.find((r) => r.key === "note")?.value).toBe("null");
  });
  it("has nothing for nothing", () => {
    expect(resultRows(undefined)).toEqual([]);
  });
});

describe("psktSupport", () => {
  it("reads which PSKT operations the runtime offers from `pskt capabilities`", () => {
    const s = psktSupport({ providerId: "kaspa-wasm-local", operations: { export: false, inspect: true, sign: true } });
    expect(s).toEqual({ known: true, supported: ["inspect", "sign"], unsupported: ["export"], provider: "kaspa-wasm-local" });
    expect(psktSupport({ operations: { export: false, sign: false } }).supported).toEqual([]);
  });
  it("says it does not know when the answer has no operations", () => {
    expect(psktSupport(null).known).toBe(false);
    expect(psktSupport({ providerId: "x" }).known).toBe(false);
  });
});

describe("failureText", () => {
  it("prefers the command's own message, with its code", () => {
    expect(failureText({ code: "KCC20_TRANSFER_INVALID", message: "inputs[0].witness is a hex string" }, "", 2)).toBe("KCC20_TRANSFER_INVALID: inputs[0].witness is a hex string");
    expect(failureText({ reason: "owner scheme" }, "", 1)).toBe("owner scheme");
  });
  it("falls back to the tail of stderr, then to the exit code", () => {
    expect(failureText(null, "a\nb\nc\nd\n", 1)).toBe("b\nc\nd");
    expect(failureText(null, "", 3)).toBe("The command failed (exit code 3).");
    expect(failureText(null, undefined, null)).toBe("The command did not finish.");
  });
});

describe("the cards of Deploy & Run", () => {
  it("each one builds from its own starting values when its required fields have a sample", () => {
    for (const c of ALL_CARDS) {
      const r = buildCommand(c, initialValues(c));
      if (!r.ok) expect(r.error, c.id).toMatch(/is required\.$/); // a path or an address the person has to choose
    }
  });
  it("ids are unique, so their scratch files never collide", () => {
    expect(new Set(ALL_CARDS.map((c) => c.id)).size).toBe(ALL_CARDS.length);
  });
  it("a JSON sample in a card is valid JSON", () => {
    for (const c of ALL_CARDS) for (const f of c.fields) if (f.kind === "json" && f.sample) expect(() => JSON.parse(f.sample!), `${c.id}.${f.id}`).not.toThrow();
  });
  it("every option names its flag and every flag looks like one", () => {
    for (const c of ALL_CARDS) for (const f of c.fields) if (f.as === "option") expect(f.flag, `${c.id}.${f.id}`).toMatch(/^--[a-z0-9-]+$/);
  });
  it("no card offers mainnet, takes a password or a private key", () => {
    for (const c of ALL_CARDS)
      for (const f of c.fields) {
        for (const ch of f.choices ?? []) expect(ch.value, `${c.id}.${f.id}`).not.toMatch(/mainnet/i);
        expect(f.flag ?? "", `${c.id}.${f.id}`).not.toMatch(/password|private-key|secret/);
      }
  });
});

describe("the KCC-20 node cards (HardKAS 0.13, experimental)", () => {
  const by = (id: string) => KCC20_NODE_CARDS.find((c) => c.id === id)!;

  it("are the three commands, each labelled experimental with HardKAS's own caveat, the two that sign saying so", () => {
    expect(KCC20_NODE_CARDS.map((c) => c.words.join(" "))).toEqual(["kcc20 deploy", "kcc20 transfer", "kcc20 balance"]);
    for (const c of KCC20_NODE_CARDS) {
      expect(c.experimental, c.id).toBe(true);
      expect(c.caveat, c.id).toMatch(/this workspace's records/);
      expect(c.offline, c.id).toBeUndefined();
    }
    expect(by("kcc20-deploy").sends).toBe(true);
    expect(by("kcc20-transfer").sends).toBe(true);
    expect(by("kcc20-balance").sends).toBeUndefined();
  });

  it("deploy: the record, the funding account, one --holder per initial holder, the constructor args in a scratch file, --wait by default", () => {
    const r = buildCommand(by("kcc20-deploy"), { ...initialValues(by("kcc20-deploy")), record: ".hardkas/artifacts/silver/silverCompile-abc.json", from: "alice", holder: "alice=1000, bob=500", kas: "1" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.args).toEqual([
      "kcc20",
      "deploy",
      ".hardkas/artifacts/silver/silverCompile-abc.json",
      "--from",
      "alice",
      "--holder",
      "alice=1000",
      "--holder",
      "bob=500",
      "--kas",
      "1",
      "--constructor-args",
      ".hardkas/ide/scratch/kcc20-deploy-constructorargs.json",
      "--wait",
      "--timeout",
      "600",
      "--json"
    ]);
    expect(r.files).toHaveLength(1);
    const ctor = JSON.parse(r.files[0].content) as Array<{ kind: string; value: unknown }>;
    expect(ctor.map((a) => a.kind)).toEqual(["bytes", "int", "bytes", "byte", "byte", "bytes", "bytes"]); // the reference KCC20.sil's constructor
    expect(commandLine(r.args)).toBe("hardkas kcc20 deploy .hardkas/artifacts/silver/silverCompile-abc.json --from alice --holder alice=1000 --holder bob=500 --kas 1 --constructor-args .hardkas/ide/scratch/kcc20-deploy-constructorargs.json --wait --timeout 600");
  });

  it("deploy and transfer need the signing account and the holders / recipients; balance needs only the covenant id", () => {
    expect(buildCommand(by("kcc20-deploy"), { record: "r.json", holder: "alice=1" })).toMatchObject({ ok: false, fieldId: "from" });
    expect(buildCommand(by("kcc20-transfer"), { covenant: "ab".repeat(32), from: "alice" })).toMatchObject({ ok: false, fieldId: "to" });
    const t = buildCommand(by("kcc20-transfer"), { covenant: "ab".repeat(32), from: "alice", to: "bob=600", input: `${"cd".repeat(32)}:0 ${"ef".repeat(32)}:1`, funder: "carol" });
    expect(t.ok && t.args).toEqual(["kcc20", "transfer", "--covenant", "ab".repeat(32), "--from", "alice", "--to", "bob=600", "--input", `${"cd".repeat(32)}:0`, "--input", `${"ef".repeat(32)}:1`, "--funder", "carol", "--json"]);
    const b = buildCommand(by("kcc20-balance"), { covenant: "ab".repeat(32) });
    expect(b.ok && b.args).toEqual(["kcc20", "balance", "--covenant", "ab".repeat(32), "--json"]);
    const bh = buildCommand(by("kcc20-balance"), { holder: "bob", covenant: "ab".repeat(32) });
    expect(bh.ok && bh.args).toEqual(["kcc20", "balance", "bob", "--covenant", "ab".repeat(32), "--json"]);
  });
});
