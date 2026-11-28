import assert from "node:assert/strict";
import { describe, it } from "node:test";

process.env.HARDKAS_IDE_NO_LISTEN = "1";
const { synthesizeDummyConstructorArgs } = await import("../src/runner.ts");

const kinds = (src: string) => (JSON.parse(synthesizeDummyConstructorArgs(src) ?? "[]") as Array<{ kind: string; value: unknown }>).map((a) => [a.kind, Array.isArray(a.value) ? a.value.length : a.value]);

describe("synthesizeDummyConstructorArgs", () => {
  it("gives byte[32] a 32-byte value, not an int (silverc: cannot convert artifact int to byte[32])", () => {
    const src = `contract CardAtomicSwapCovenant(
    byte[32] init_covenantTemplate,
    byte[32] init_assetHash,
    int init_swapActive,
    byte[ 20 ] short,
    byte[] any
) { }`;
    assert.deepEqual(kinds(src), [
      ["bytes", 32],
      ["bytes", 32],
      ["int", 1],
      ["bytes", 20],
      ["bytes", 32]
    ]);
  });

  it("keeps the older spellings and the key types", () => {
    assert.deepEqual(kinds("contract C(pubkey owner, bytes32 h, bool on, sig s) { }"), [
      ["bytes", 32],
      ["bytes", 32],
      ["bool", true],
      ["bytes", 64]
    ]);
  });

  it("has nothing to give a contract without parameters", () => {
    assert.equal(synthesizeDummyConstructorArgs("contract C() { }"), null);
  });
});
