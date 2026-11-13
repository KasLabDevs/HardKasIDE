/**
 * The script a child `node` runs to read the HardKas CLI's command tree. It imports `@hardkas/cli/public` from the
 * workspace (the file path is the last argv), builds the Commander program the same way the CLI's docs generator does
 * (`buildHardkasProgram({ forDocs: true })`: no extension, no action runs) and prints the tree as one JSON document.
 *
 * Kept as a string so it works the same from `src/` (tsx) and from `dist/` (tsc does not copy .mjs files).
 */
export const CLI_CATALOG_DUMP_SCRIPT = String.raw`
import { pathToFileURL } from "node:url";
const target = process.argv[process.argv.length - 1];
const mod = await import(pathToFileURL(target).href);
if (typeof mod.buildHardkasProgram !== "function") {
  process.stdout.write(JSON.stringify({ ok: false, code: "NO_PROGRAM", message: "@hardkas/cli/public does not export buildHardkasProgram" }));
  process.exit(0);
}
const program = mod.buildHardkasProgram({ forDocs: true });
const argsOf = (cmd) => (cmd.registeredArguments ?? cmd._args ?? []).map((a) => ({
  name: typeof a.name === "function" ? a.name() : a._name,
  description: a.description ?? "",
  required: Boolean(a.required),
  variadic: Boolean(a.variadic),
  defaultValue: a.defaultValue === undefined ? undefined : a.defaultValue,
  choices: a.argChoices ?? undefined
}));
const optsOf = (cmd) => (cmd.options ?? []).filter((o) => !o.hidden).map((o) => ({
  flags: o.flags,
  long: o.long ?? null,
  short: o.short ?? null,
  attribute: typeof o.attributeName === "function" ? o.attributeName() : null,
  description: o.description ?? "",
  takesValue: Boolean(o.required || o.optional),
  valueOptional: Boolean(o.optional),
  variadic: Boolean(o.variadic),
  mandatory: Boolean(o.mandatory),
  negate: Boolean(o.negate),
  defaultValue: typeof o.defaultValue === "function" ? undefined : o.defaultValue,
  choices: o.argChoices ?? undefined
}));
const walk = (cmd, path) => ({
  name: cmd.name(),
  path,
  aliases: cmd.aliases?.() ?? [],
  description: cmd.description?.() ?? "",
  summary: cmd.summary?.() ?? "",
  hidden: Boolean(cmd._hidden),
  arguments: argsOf(cmd),
  options: optsOf(cmd),
  commands: cmd.commands.map((c) => walk(c, [...path, c.name()]))
});
const tree = walk(program, []);
process.stdout.write(JSON.stringify({ ok: true, version: program.version?.() ?? null, globalOptions: tree.options, commands: tree.commands }));
`;
