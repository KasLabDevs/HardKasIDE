import { describe, expect, it } from "vitest";
import { buildCommand, checkWord, commandLine, failureText, initialValues, psktSupport, readVerdict, resultRows, scratchPath, type CommandSpec } from "./commandSpec";
import { ALL_CARDS } from "./cards";

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
});
