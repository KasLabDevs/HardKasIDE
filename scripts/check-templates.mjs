#!/usr/bin/env node
// Compiles every starter contract the New Project wizard offers with a real silverc binary.
//
// The templates come from buildStarterContractCode in packages/ide-server/src/frontendScaffold.ts,
// extracted at run time and stripped with node:module's stripTypeScriptTypes (no TS toolchain,
// no network). Constructor arguments are derived from each generated contract's parameter list.
//
// silverc binary: $SILVERC, else ~/.hardkas/toolchains/silverc/1.0.0/silverc(.exe).
// Exit codes: 0 all compile, 1 at least one template fails, 2 silverc not found / setup error.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { stripTypeScriptTypes } from "node:module";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// The New Project wizard (server) and the New File dialog (UI) each carry a copy of the generator: check both.
const GENERATORS = [
  path.join(repoRoot, "packages", "ide-server", "src", "frontendScaffold.ts"),
  path.join(repoRoot, "apps", "ide", "src", "shell", "silverTemplates.ts")
];
const SILVERC_VERSION = "1.0.0";

function resolveSilverc() {
  if (process.env.SILVERC) return { file: process.env.SILVERC, from: "SILVERC" };
  const exe = process.platform === "win32" ? "silverc.exe" : "silverc";
  return { file: path.join(os.homedir(), ".hardkas", "toolchains", "silverc", SILVERC_VERSION, exe), from: "default path" };
}

function loadGenerator(scaffoldPath) {
  const src = fs.readFileSync(scaffoldPath, "utf8");
  const start = src.indexOf("function buildStarterContractCode");
  if (start < 0) throw new Error(`buildStarterContractCode not found in ${scaffoldPath}`);
  const end = src.indexOf("\nexport ", start);
  const js = stripTypeScriptTypes(src.slice(start, end < 0 ? undefined : end));
  return new Function(`${js}\nreturn buildStarterContractCode;`)();
}

// Placeholder values per SilverScript parameter type (CONSTRUCTOR_ARGS.md kinds).
const P2PK_SPK = [0, 0, 32, ...Array(32).fill(0x22), 0xac]; // version 0 + OP_DATA_32 <x-only key> OP_CHECKSIG
function ctorValue(type, name) {
  if (type === "pubkey") return { kind: "bytes", value: Array(32).fill(0x11) };
  if (type === "byte[]" || type === "bytes") return { kind: "bytes", value: P2PK_SPK }; // let silverc judge `bytes`
  const fixed = /^byte\[(\d+)\]$/.exec(type);
  if (fixed) return { kind: "bytes", value: Array(Number(fixed[1])).fill(0x33) };
  if (type === "temporal") return { kind: "int", value: 1_800_000_000_000 }; // 2027 in Unix ms (>= LOCK_TIME_THRESHOLD)
  if (type === "int") return { kind: "int", value: 1000 };
  if (type === "bool") return { kind: "bool", value: true };
  throw new Error(`no placeholder constructor value for parameter ${name} of type ${type}`);
}

function constructorArgs(code) {
  const m = /contract\s+\w+\s*\(([^)]*)\)/.exec(code);
  if (!m) throw new Error("contract declaration not found");
  return m[1]
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => {
      const parts = p.split(/\s+/);
      return ctorValue(parts[0], parts[1]);
    });
}

const CASES = [
  { kind: "silver-basic", className: "Hello" },
  { kind: "covenant-1-n", className: "Split2", fanout: 2 },
  { kind: "covenant-1-n", className: "Split3", fanout: 3 },
  { kind: "covenant-1-n", className: "Split5", fanout: 5 },
  { kind: "covenant-1-n", className: "Split6", fanout: 6 },
  { kind: "covenant-1-1", className: "Vault" },
  { kind: "covenant-escrow", className: "Escrow" },
  { kind: "covenant-timelock", className: "Vesting" }
];

function main() {
  const silverc = resolveSilverc();
  if (!fs.existsSync(silverc.file)) {
    console.error(`silverc not found (${silverc.from}): ${silverc.file}`);
    console.error("Install the pinned compiler with:  npx -y @hardkas/cli@0.13.0-rc.1 toolchain install silverc");
    console.error("or point SILVERC at a silverc v1.0.0 binary.");
    return 2;
  }

  const gens = [];
  for (const file of GENERATORS) {
    try {
      gens.push({ gen: loadGenerator(file), from: path.relative(repoRoot, file).replace(/\\/g, "/") });
    } catch (err) {
      console.error(`cannot load template generator: ${err.message}`);
      return 2;
    }
  }

  console.log(`silverc: ${silverc.file} (${silverc.from})`);

  const work = fs.mkdtempSync(path.join(os.tmpdir(), "hkide-templates-"));
  const rows = [];
  try {
    for (const { gen, from } of gens)
    for (const c of CASES) {
      const label = `${from.split("/").pop()}: ${c.fanout ? `${c.kind} (fanout ${c.fanout})` : c.kind}`;
      let status = "FAIL";
      let detail = "";
      try {
        const built = gen({ kind: c.kind, className: c.className, fanout: c.fanout }, "check-templates");
        if (!built) throw new Error("generator returned null");
        const dir = path.join(work, `${rows.length}-${c.className}`);
        fs.mkdirSync(dir);
        const sil = path.join(dir, built.fileName);
        const ctor = path.join(dir, "ctor.json");
        const out = path.join(dir, "out.json");
        fs.writeFileSync(sil, built.code, "utf8");
        fs.writeFileSync(ctor, JSON.stringify(constructorArgs(built.code)), "utf8");
        const r = spawnSync(silverc.file, [sil, "--constructor-args", ctor, "-o", out], { encoding: "utf8" });
        const msg = `${r.stderr || ""}${r.stdout || ""}`.trim().split(/\r?\n/)[0] || "";
        if (r.error) detail = r.error.message;
        else if (r.status !== 0) detail = msg || `exit ${r.status}`;
        else if (!fs.existsSync(out)) detail = "no artifact written";
        else {
          const artifact = JSON.parse(fs.readFileSync(out, "utf8"));
          const contract = Object.values(artifact.contracts ?? {})[0];
          const bytecode = contract?.compiled?.bytecode;
          if (!contract || !Array.isArray(bytecode) || bytecode.length === 0) {
            detail = "artifact has no compiled bytecode";
          } else {
            status = "PASS";
            const entries = Object.keys(contract.entries ?? {}).join(", ");
            detail = `${built.fileName}, ${bytecode.length} B, entries: ${entries}`;
          }
        }
      } catch (err) {
        detail = err.message;
      }
      rows.push({ template: label, status, detail });
    }
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }

  const w0 = Math.max(8, ...rows.map((r) => r.template.length));
  console.log(`${"template".padEnd(w0)}  result  detail`);
  console.log(`${"-".repeat(w0)}  ------  ${"-".repeat(40)}`);
  for (const r of rows) console.log(`${r.template.padEnd(w0)}  ${r.status.padEnd(6)}  ${r.detail}`);
  const failed = rows.filter((r) => r.status !== "PASS").length;
  console.log(failed ? `\n${failed} of ${rows.length} templates FAILED to compile.` : `\nAll ${rows.length} templates compile.`);
  return failed ? 1 : 0;
}

process.exitCode = main();
