import { describe, expect, it } from "vitest";
import {
  analyzeSilverVersion,
  isSilvercMissing,
  parseSilverDiagnostics,
  summarizeSilverSource
} from "./silverInspector";

const SAMPLE_COVENANT_SIL = `pragma silverscript ^0.1.0;

contract PaymentSplitter(pubkey owner, pubkey recipient1, pubkey recipient2, int splitAmount) {
    entrypoint function split(sig ownerSig) {
        require(checkSig(ownerSig, owner));
        require(tx.outputs[0].scriptPubKey == new ScriptPubKeyP2PK(recipient1));
        require(tx.outputs[0].value >= splitAmount);
        require(tx.outputs[1].scriptPubKey == new ScriptPubKeyP2PK(recipient2));
        require(tx.outputs[1].value >= splitAmount);
    }
}
`;

describe("silverInspector", () => {
  it("validates pragma silverscript ^0.1.0 version compatibility", () => {
    const okCheck = analyzeSilverVersion(SAMPLE_COVENANT_SIL);
    expect(okCheck.status).toBe("ok");
    expect(okCheck.pragmaLine).toBe(1);

    const mismatchCheck = analyzeSilverVersion("pragma silverscript ^0.2.0;\ncontract A() {}");
    expect(mismatchCheck.status).toBe("mismatch");

    const missingCheck = analyzeSilverVersion("contract A() {}");
    expect(missingCheck.status).toBe("missing");
  });

  it("summarizes what the source says and invents nothing", () => {
    const s = summarizeSilverSource(SAMPLE_COVENANT_SIL);
    expect(s.entrypoints).toEqual([{ name: "split", line: 4 }]);
    expect(s.requireCount).toBe(5);
    expect(s.sigChecks).toBe(1);
    expect(s.outputRefs).toHaveLength(4);
    expect(s.outputRefs[0]).toMatchObject({ entrypoint: "split", line: 6, outputIndex: 0, field: "scriptPubKey", constraint: "== new ScriptPubKeyP2PK(recipient1)" });
    expect(s.outputRefs[1]).toMatchObject({ line: 7, outputIndex: 0, field: "value", constraint: ">= splitAmount" });
    // Not compiled: no script, no size, nothing made up.
    expect(s.compiledScriptHex).toBeNull();
    expect(s.compiledScriptBytes).toBeNull();
    expect(Object.keys(s)).not.toContain("covenantId");
  });

  it("takes the script size only from a successful silverc result", () => {
    expect(summarizeSilverSource(SAMPLE_COVENANT_SIL, { ok: true, scriptPublicKey: "20aabbac" }).compiledScriptBytes).toBe(4);
    expect(summarizeSilverSource(SAMPLE_COVENANT_SIL, { ok: false, scriptPublicKey: "20aabbac" }).compiledScriptBytes).toBeNull();
    expect(summarizeSilverSource(SAMPLE_COVENANT_SIL, { ok: true, scriptPublicKey: "not hex" }).compiledScriptHex).toBeNull();
  });

  it("recognizes a missing silverc", () => {
    expect(isSilvercMissing("TOOLCHAIN_NOT_INSTALLED: silverc 1.0.0 is not installed (install it with: hardkas toolchain install silverc)")).toBe(true);
    expect(isSilvercMissing("compile error: unexpected token")).toBe(false);
    expect(isSilvercMissing(undefined)).toBe(false);
  });

  it("does not flag a require that continues on the next line", () => {
    const sil = `pragma silverscript ^0.1.0;
contract A(pubkey owner) {
    entrypoint function spend(sig s) {
        require(
            checkSig(s, owner)
        );
    }
}`;
    expect(parseSilverDiagnostics("a.sil", sil).filter((d) => d.code === "SIL-SYNTAX-SEMI")).toEqual([]);
  });

  it("parses silverc line-linked diagnostics and static syntax errors with exact line numbers", () => {
    const brokenSil = `pragma silverscript ^0.1.0;
contract Broken(pubkey owner) {
    entrypoint function spend(sig s) {
        require(checkSig(s, owner))
    }
}`;
    const diags = parseSilverDiagnostics("contracts/Broken.sil", brokenSil, {
      file: "contracts/Broken.sil",
      ok: false,
      errorText: "SyntaxError at line 4, col 35: expected ';'"
    });
    expect(diags.some((d) => d.line === 4 && d.severity === "error")).toBe(true);
  });

  it("maps StatefulVault silverc introspection errors to exact tx.inputs lines without matching ISO timestamps", () => {
    const vaultSil = `pragma silverscript ^0.1.0;

contract StatefulVault(pubkey owner, int maxWithdraw) {
  entry withdraw(sig ownerSig, int amount) {
    require(checkSig(ownerSig, owner));
    bytes selfLock = tx.inputs[this.activeInputIndex].lockingBytecode;
    int currentBalance = tx.inputs[this.activeInputIndex].value;
    require(tx.outputs[0].lockingBytecode == selfLock);
  }
}`;
    const diags = parseSilverDiagnostics("contracts/StatefulVault.sil", vaultSil, {
      file: "contracts/StatefulVault.sil",
      ok: false,
      errorText: "SILVERC_COMPILE_FAILED: compile error: unsupported feature: field access on transaction introspection is not supported",
      raw: { createdAt: "2026-11-13T03:54:00.123Z", message: "SILVERC_COMPILE_FAILED: compile error: unsupported feature: field access on transaction introspection is not supported" }
    });
    const errors = diags.filter((d) => d.severity === "error");
    expect(errors.length).toBeGreaterThanOrEqual(2);
    expect(errors.map((e) => e.line)).toEqual([6, 7]);
    expect(errors[0].column).toBe(22);
    expect(errors[0].endColumn).toBe(70);
    expect(errors.some((e) => e.line === 54)).toBe(false);
  });
});
