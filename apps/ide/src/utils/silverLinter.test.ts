import { describe, expect, it } from "vitest";
import { buildStarterContractCode } from "@/shell/silverTemplates";
import { getSilverSymbolHover, lintSilverSource } from "./silverLinter";

describe("silverLinter", () => {
  it("reports zero errors on all starter SilverScript & Covenant templates", () => {
    const kinds = ["silver-basic", "covenant-1-n", "covenant-1-1", "covenant-escrow", "covenant-timelock"] as const;
    for (const kind of kinds) {
      const built = buildStarterContractCode({ kind, className: "Vault", fanout: 3 }, "demo")!;
      const diags = lintSilverSource(`contracts/${built.fileName}`, built.code);
      const errors = diags.filter((d) => d.severity === "error");
      expect(errors, `Unexpected errors in ${kind}: ${JSON.stringify(errors)}`).toEqual([]);
    }
  });

  it("flags keyword typos, missing semicolons, and undefined identifiers with exact spans and quick fixes", () => {
    const src = `pragma silverscript ^0.1.0;

contract Escrow(pubkey buyer, pubkey seller) {
  entri bad() {}

  entry release(sig s) {
    require(checkSig(s, seler))
  }
}`;
    const diags = lintSilverSource("contracts/Escrow.sil", src);
    const typoKw = diags.find((d) => d.code === "SIL-TYPO-KW");
    expect(typoKw).toBeDefined();
    expect(typoKw?.line).toBe(4);
    expect(typoKw?.fixes?.[0]?.edit.text).toBe("entry");

    const undef = diags.find((d) => d.code === "SIL-UNDEF-IDENT");
    expect(undef).toBeDefined();
    expect(undef?.line).toBe(7);
    expect(undef?.message).toContain("seler");
    expect(undef?.fixes?.[0]?.edit.text).toBe("seller");

    const semi = diags.find((d) => d.code === "SIL-SYNTAX-SEMI");
    expect(semi).toBeDefined();
    expect(semi?.line).toBe(7);
    expect(semi?.fixes?.[0]?.edit.text).toBe(";");
  });

  it("takes a type name before '(' as a cast, not an unknown call (pubkey(x), int(x))", () => {
    const src = `pragma silverscript ^0.1.0;

contract Owned(byte[32] owner) {
  entry transfer(sig ownerSig, byte[32] newOwnerPk) {
    require(checkSig(ownerSig, pubkey(owner)));
    require(int(1) == 1);
  }
}`;
    const diags = lintSilverSource("contracts/Owned.sil", src);
    expect(diags.filter((d) => d.code === "SIL-UNKNOWN-CALL")).toEqual([]);
    // A real unknown call is still caught.
    const bad = lintSilverSource("contracts/Owned.sil", src.replace("int(1)", "frobnicate(1)"));
    expect(bad.some((d) => d.code === "SIL-UNKNOWN-CALL" && d.message.includes("frobnicate"))).toBe(true);
  });

  it("accepts the SilverScript that silverc compiles: constants, covenant builtins, loops, structs, locks", () => {
    const src = `pragma silverscript ^0.1.0;

contract Swap(byte[32] init_owner, int max_outs, int max_ins) {
  byte[32] constant ZERO32 = byte[32](0x0000000000000000000000000000000000000000000000000000000000000000);
  int constant MAX_TX_FEE = 1000000;
  byte[32] owner = init_owner;

  struct Note {
    byte[32] owner;
    int amount;
  }

  entry transfer(sig ownerSig, byte[32] newOwner, sig s2) {
    require(checkSig(ownerSig, pubkey(owner)));
    require(checkMultiSig(sig[]{ownerSig, s2}, pubkey[]{pubkey(owner), pubkey(newOwner)}));
    require(newOwner != ZERO32);
    require(tx.daa >= 10 && this.ageDaa >= 5);
    byte[32] covid = OpInputCovenantId(this.activeInputIndex);
    for(i, 0, OpCovInputCount(covid), max_ins) {
      State { owner: byte[32] prevOwner } = readInputState(OpCovInputIdx(covid, i));
      require(prevOwner != ZERO32);
    }
    for(i, 0, OpCovOutputCount(covid), max_outs) {
      int idx = OpCovOutputIdx(covid, i);
      require(tx.outputs[idx].value >= tx.inputs[this.activeInputIndex].value - MAX_TX_FEE);
      validateOutputState(idx, State { owner: newOwner });
    }
  }
}`;
    const errors = lintSilverSource("contracts/Swap.sil", src).filter((d) => d.severity !== "info");
    expect(errors.map((d) => `${d.code} ${d.line}: ${d.message}`)).toEqual([]);
  });

  it("still catches undeclared names and unknown calls next to all that", () => {
    const src = `pragma silverscript ^0.1.0;

contract C(byte[32] owner) {
  int constant FEE = 1;
  entry go(sig s) {
    require(checkSig(s, pubkey(owner)));
    require(FEES > 0);
    require(validateOutputStat(0, owner));
  }
}`;
    const codes = lintSilverSource("contracts/C.sil", src).map((d) => `${d.code}:${d.line}`);
    expect(codes).toContain("SIL-UNDEF-IDENT:7");
    expect(codes).toContain("SIL-UNKNOWN-CALL:8");
  });

  it("catches assignment '=' inside require(), wrong builtin arity, and tx.outputs typos", () => {
    const src = `pragma silverscript ^0.1.0;

contract Cov(pubkey owner, int target) {
  entry spend(sig s) {
    require(checkSig(s));
    require(tx.outputs[0].valu = target);
  }
}`;
    const diags = lintSilverSource("contracts/Cov.sil", src);
    expect(diags.some((d) => d.code === "SIL-CALL-ARITY" && d.line === 5)).toBe(true);
    const fieldDiag = diags.find((d) => d.code === "SIL-TX-FIELD" && d.line === 6);
    expect(fieldDiag?.fixes?.[0]?.edit.text).toBe("value");
    const assignDiag = diags.find((d) => d.code === "SIL-REQ-ASSIGN" && d.line === 6);
    expect(assignDiag?.fixes?.[0]?.edit.text).toBe("==");
  });

  it("warns on covenant outputs whose value is constrained without locking scriptPubKey, and entries without require()", () => {
    const src = `pragma silverscript ^0.1.0;

contract LeakyVault(pubkey owner, int minAmt) {
  entry openPath(sig s) {
    int unused = 1;
  }

  entry partial(sig s) {
    require(checkSig(s, owner));
    require(tx.outputs[0].value >= minAmt);
  }
}`;
    const diags = lintSilverSource("contracts/LeakyVault.sil", src);
    expect(diags.some((d) => d.code === "SIL-COV-NOREQ" && d.line === 4)).toBe(true);
    expect(diags.some((d) => d.code === "SIL-COV-UNBOUND-OUT" && d.line === 10)).toBe(true);
  });

  it("resolves Eclipse-style symbol hovers for constructor params, entries, and local vars", () => {
    const src = `pragma silverscript ^0.1.0;

contract Vault(pubkey owner, int cap) {
  entry withdraw(sig ownerSig) {
    byte[32] lock = this.activeScriptPubKey;
    require(checkSig(ownerSig, owner));
  }
}`;
    const ownerHover = getSilverSymbolHover(src, 6, 33);
    expect(ownerHover?.signature).toBe("(constructor param) pubkey owner");

    const localHover = getSilverSymbolHover(src, 5, 15);
    expect(localHover?.signature).toBe("(local var) byte[32] lock");

    const sigHover = getSilverSymbolHover(src, 6, 23);
    expect(sigHover?.signature).toBe("(parameter) sig ownerSig");
  });
});
