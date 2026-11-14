/**
 * The script a child `node` runs inside the project to prepare a SilverScript debug session. It uses the project's
 * own `@hardkas/core` (the same code `hardkas silver test` uses), so the signatures it makes are HardKAS's:
 *   1. compiles the source with the pinned silverc and the given constructor arguments;
 *   2. turns the entry arguments into the runner's test file, signing each `sig` argument for its account over the
 *      scenario transaction the runner builds.
 *
 * Input (stdin, JSON): { source, constructorArgs, entry, args, keys }. `constructorArgs` and `args` use the
 * constructor-args file format ([{ "type": "int", "value": 7 }, …]); a `sig` argument is { "type": "sig", "account":
 * "alice" }. `keys` maps those accounts to their private keys: they come on stdin, never in argv or the environment.
 * Output (stdout, JSON): { ok: true, runnerTestFile, testName, contract, entries } or { ok: false, code, message }.
 */
export const PREPARE_SCRIPT = String.raw`
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import path from "node:path";

const fail = (code, message) => { process.stdout.write(JSON.stringify({ ok: false, code, message })); process.exit(0); };
let input = "";
process.stdin.setEncoding("utf8");
for await (const chunk of process.stdin) input += chunk;
let req;
try { req = JSON.parse(input.replace(/^﻿/, "")); } catch { fail("BAD_INPUT", "the debug request is not JSON"); }

let core;
try {
  const require = createRequire(path.join(process.cwd(), "package.json"));
  core = await import(pathToFileURL(require.resolve("@hardkas/core")).href);
} catch {
  fail("NO_HARDKAS_CORE", "this project has no @hardkas/core in node_modules: run npm install first");
}

const TEST_NAME = "hardkas_ide_debug";
// The constructor-args file format is { kind, value }; "type" is accepted as a spelling of "kind".
// Byte values may be given as hex ("0x…"), and pubkey / byte[N] as names of "bytes".
const hexBytes = (s) => {
  const h = s.trim().replace(/^0x/i, "");
  if (!/^(?:[0-9a-fA-F]{2})*$/.test(h)) return s;
  return Array.from({ length: h.length / 2 }, (_, i) => parseInt(h.slice(i * 2, i * 2 + 2), 16));
};
const norm = (v) => {
  if (!v || typeof v !== "object") return v;
  let kind = v.kind ?? v.type;
  if (kind === "pubkey" || kind === "byte[]" || /^byte\[\d+\]$/.test(String(kind))) kind = "bytes";
  const value = kind === "bytes" && typeof v.value === "string" ? hexBytes(v.value) : kind === "int" && typeof v.value === "string" && /^-?\d+$/.test(v.value) ? Number.isSafeInteger(Number(v.value)) ? Number(v.value) : v.value : v.value;
  return { kind, value };
};
const values = (list, what) => {
  try { return core.parseSilArtifactValuesJson(JSON.stringify((list ?? []).map(norm))); }
  catch (e) { fail("BAD_ARGUMENTS", what + ": " + String(e?.message ?? e)); }
};

const ctor = values(req.constructorArgs, "constructor arguments");
let compiled;
try { compiled = await core.compileSilverScript({ source: req.source, constructorArgs: ctor }); }
catch (e) { fail("COMPILE_FAILED", String(e?.message ?? e)); }

const contracts = Object.keys(compiled.artifact.contracts ?? {});
const contract = compiled.artifact.contracts[contracts[0]];
const entries = Object.entries(contract?.entries ?? {}).map(([name, e]) => ({ name, params: (e.params ?? []).map((p) => ({ name: p.name, type: p.type?.kind ?? String(p.type) })) }));
if (!contract?.entries?.[req.entry]) fail("NO_SUCH_ENTRY", "the contract has no entry '" + req.entry + "'. Entries: " + entries.map((e) => e.name).join(", "));

const args = [];
for (const [i, a] of (req.args ?? []).entries()) {
  if (a && (a.type === "sig" || a.kind === "sig") && typeof a.account === "string") { args.push({ signature: a.account }); continue; }
  const [v] = values([a], "argument " + (i + 1));
  try { args.push(core.silverRunnerValue(v, "args[" + i + "]")); }
  catch (e) { fail("BAD_ARGUMENTS", "argument " + (i + 1) + ": " + String(e?.message ?? e)); }
}

const keys = req.keys ?? {};
let prepared;
try {
  prepared = await core.prepareSilverVmTests({
    artifact: compiled.artifact,
    constructorArgs: ctor,
    tests: { tests: [{ name: TEST_NAME, function: req.entry, args, expect: "pass" }] },
    signer: async (account) => {
      if (typeof keys[account] !== "string") throw Object.assign(new Error("SILVER_TEST_SIGNER_FAILED: no key for account " + account), { code: "SILVER_TEST_SIGNER_FAILED" });
      return keys[account];
    }
  });
} catch (e) {
  fail(e?.code ?? "PREPARE_FAILED", String(e?.message ?? e).replace(/^[A-Z_]+: /, ""));
}
process.stdout.write(JSON.stringify({ ok: true, runnerTestFile: prepared.runnerTestFile, testName: TEST_NAME, contract: prepared.contract, entries }));
`;
