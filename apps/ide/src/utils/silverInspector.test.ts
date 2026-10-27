import { describe, expect, it } from "vitest";
import {
  analyzeSilverVersion,
  buildSilverDebugTrace,
  inspectTxV1AndCovenant,
  parseSilverDiagnostics
} from "./silverInspector";

const SAMPLE_COVENANT_SIL = `pragma silverscript ^0.1.0;

contract PaymentSplitter(pubkey owner, pubkey recipient1, pubkey recipient2, int splitAmount) {
    entrypoint function split(sig ownerSig) {
        require(checkSig(ownerSig, owner));
        require(tx.outputs[0].lockingBytecode == new LockingBytecodeP2PK(recipient1));
        require(tx.outputs[0].value >= splitAmount);
        require(tx.outputs[1].lockingBytecode == new LockingBytecodeP2PK(recipient2));
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

  it("extracts TX v1 compute_budget, covenant_id, output bindings and resulting scripts", () => {
    const info = inspectTxV1AndCovenant(SAMPLE_COVENANT_SIL);
    expect(info.txVersion).toBe(1);
    expect(info.covenantId).toHaveLength(64);
    expect(info.computeBudgetUsed).toBeGreaterThan(0);
    expect(info.outputBindings).toHaveLength(2);
    expect(info.outputBindings[0].outputIndex).toBe(0);
    expect(info.outputBindings[0].lockingBinding).toContain("P2PK(recipient1)");
    expect(info.outputBindings[0].valueBinding).toContain(">= splitAmount");
    expect(info.stateTransitions[0].mode).toBe("fanout-1-n");
    expect(info.stateTransitions[0].afterOutputs).toHaveLength(2);
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

  it("builds a source-level step debugger trace (cli-debugger) for covenant entrypoints", () => {
    const trace = buildSilverDebugTrace(SAMPLE_COVENANT_SIL, "split", {
      inputSompi: 10_000_000_000,
      outputSompi: 5_000_000_000,
      signatureValid: true
    });
    expect(trace.selectedEntrypoint).toBe("split");
    expect(trace.steps.length).toBeGreaterThanOrEqual(5);
    expect(trace.steps.every((s) => s.status === "pass")).toBe(true);
  });
});
