/**
 * The one place that knows where the HardKas IDE version is written.
 *
 *   node scripts/version.mjs check                 every field holds the same version
 *   node scripts/version.mjs check --tag v0.3.0    ... and it is the version of that release tag
 *   node scripts/version.mjs set 0.3.1             writes the version everywhere (then commit)
 *
 * CI runs `check` on every push; the release workflow runs `check --tag` before building, so a tag pushed on a
 * commit that still carries another version fails in seconds instead of publishing mislabelled installers.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SEMVER = String.raw`\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?`;

/** Each field: file, a regex whose first group is the version, and how to write it back. Each must match exactly once. */
const json = (file) => ({ file, re: new RegExp(String.raw`^(\s*"version":\s*")(${SEMVER})(")`, "m") });
const FIELDS = [
  json("package.json"),
  json("apps/desktop/package.json"),
  json("apps/ide/package.json"),
  json("packages/ide-server/package.json"),
  json("packages/mcp-server/package.json"),
  json("apps/desktop/src-tauri/tauri.conf.json"),
  { file: "apps/desktop/src-tauri/Cargo.toml", re: new RegExp(String.raw`(\[package\][^\[]*?\nversion = ")(${SEMVER})(")`) },
  { file: "apps/desktop/src-tauri/Cargo.lock", re: new RegExp(String.raw`(name = "hardkas-ide"\r?\nversion = ")(${SEMVER})(")`) },
  { file: "packages/ide-server/src/acpAgent.ts", re: new RegExp(String.raw`(clientInfo: \{ name: "hardkas-ide", version: ")(${SEMVER})(")`) },
  { file: "packages/ide-server/src/updates.ts", re: new RegExp(String.raw`(return ")(${SEMVER})(";)`) },
  { file: "packages/mcp-server/src/index.ts", re: new RegExp(String.raw`(\{ name: "hardkas-ide", version: ")(${SEMVER})(")`) },
  { file: ".github/workflows/build-desktop.yml", re: new RegExp(String.raw`(default: "v)(${SEMVER})(")`) }
];

function read() {
  return FIELDS.map(({ file, re }) => {
    const text = fs.readFileSync(path.join(root, file), "utf8");
    const all = text.match(new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g")) ?? [];
    if (all.length !== 1) throw new Error(`${file}: expected exactly one version field, found ${all.length}`);
    return { file, re, text, version: text.match(re)[2] };
  });
}

const [cmd, arg, value] = process.argv.slice(2);
try {
  const fields = read();
  if (cmd === "set") {
    if (!arg || !new RegExp(`^${SEMVER}$`).test(arg)) throw new Error(`usage: node scripts/version.mjs set <x.y.z>  (got "${arg ?? ""}")`);
    for (const f of fields) {
      fs.writeFileSync(path.join(root, f.file), f.text.replace(f.re, (_m, a, _v, b) => `${a}${arg}${b}`), "utf8");
      console.log(`${f.version} -> ${arg}  ${f.file}`);
    }
    console.log(`\nVersion ${arg} written in ${fields.length} places. Run \`pnpm install\` only if you also changed dependencies.`);
  } else if (cmd === "check") {
    const versions = new Set(fields.map((f) => f.version));
    if (versions.size !== 1) {
      for (const f of fields) console.error(`  ${f.version}  ${f.file}`);
      throw new Error(`the version fields disagree (${[...versions].join(", ")}): run node scripts/version.mjs set <x.y.z>`);
    }
    const [version] = versions;
    if (arg === "--tag") {
      const tag = (value ?? "").replace(/^refs\/tags\//, "");
      if (tag.replace(/^v/, "") !== version) {
        throw new Error(
          `release tag "${tag}" does not match the version in the code (${version}). ` +
            `Either the tag points at the wrong commit (merge develop into main first, then tag main) or the version was not bumped.`
        );
      }
      console.log(`✔ tag ${tag} matches version ${version} in all ${fields.length} fields`);
    } else {
      console.log(`✔ version ${version} in all ${fields.length} fields`);
    }
  } else {
    throw new Error("usage: node scripts/version.mjs check [--tag <tag>] | set <x.y.z>");
  }
} catch (error) {
  console.error(`✖ ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
