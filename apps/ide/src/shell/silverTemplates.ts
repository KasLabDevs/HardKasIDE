/**
 * Starter SilverScript contracts for the New File dialog. A copy of buildStarterContractCode in
 * packages/ide-server/src/frontendScaffold.ts (the New Project wizard); scripts/check-templates.mjs compiles
 * both with the pinned silverc, so the two cannot drift into code that does not compile.
 */

export interface StarterContractSpec {
  kind: "none" | "silver-basic" | "covenant-1-n" | "covenant-1-1" | "covenant-escrow" | "covenant-timelock";
  className?: string;
  fanout?: number;
}

export function buildStarterContractCode(spec: StarterContractSpec, projectName: string): { fileName: string; code: string } | null {
  if (spec.kind === "none") return null;
  const rawName = (spec.className ?? "").replace(/\.[^.]+$/, "").replace(/[^A-Za-z0-9_]/g, "");
  const className = rawName && /^[A-Za-z]/.test(rawName) ? rawName.charAt(0).toUpperCase() + rawName.slice(1) : "MainContract";
  const fileName = `${className}.sil`;

  if (spec.kind === "covenant-1-n") {
    const count = Math.min(Math.max(spec.fanout ?? 3, 2), 6);
    const lockParams = Array.from({ length: count }, (_, i) => `  byte[] recipient${i + 1}Spk`).join(",\n");
    const checks = Array.from(
      { length: count },
      (_, i) =>
        `    require(tx.outputs[${i}].scriptPubKey == recipient${i + 1}Spk);\n` +
        `    require(tx.outputs[${i}].value >= shareSompi);`
    ).join("\n\n");
    return {
      fileName,
      code: `pragma silverscript ^0.1.0;

/**
 * @title ${className} (Covenant 1:${count})
 * distribute: operator-signed; the transaction must spend exactly 1 input (this UTXO)
 * and outputs 0..${count - 1} must pay each recipient scriptPubKey at least shareSompi.
 * Any further outputs (change) are unconstrained.
 * cancel: the operator alone can spend this UTXO anywhere (no output checks).
 */
contract ${className}(
  pubkey operator,
${lockParams},
  int shareSompi
) {
  entry distribute(sig operatorSig) {
    require(checkSig(operatorSig, operator));
    require(tx.inputs.length == 1);
    require(tx.outputs.length >= ${count});

${checks}
  }

  entry cancel(sig operatorSig) {
    require(checkSig(operatorSig, operator));
  }
}
`
    };
  }

  if (spec.kind === "covenant-1-1") {
    return {
      fileName,
      code: `pragma silverscript ^0.1.0;

/**
 * @title ${className} (Covenant 1:1)
 * Recursive vault: withdrawPartial must spend this UTXO as the only input and send
 * output[0] back to this same contract (same scriptPubKey) with at least
 * currentBalance - withdrawSompi; withdrawSompi is capped at maxWithdrawSompi.
 * emergencySweep: owner + guardian together can spend anywhere (no output checks).
 */
contract ${className}(
  pubkey owner,
  pubkey guardian,
  int maxWithdrawSompi
) {
  entry withdrawPartial(sig ownerSig, int withdrawSompi) {
    require(checkSig(ownerSig, owner));
    require(withdrawSompi > 0);
    require(withdrawSompi <= maxWithdrawSompi);
    require(tx.inputs.length == 1);

    byte[] selfSpk = this.activeScriptPubKey;
    int currentBalance = tx.inputs[this.activeInputIndex].value;

    require(tx.outputs[0].scriptPubKey == selfSpk);
    require(tx.outputs[0].value >= currentBalance - withdrawSompi);
  }

  entry emergencySweep(sig ownerSig, sig guardianSig) {
    require(checkSig(ownerSig, owner));
    require(checkSig(guardianSig, guardian));
  }
}
`
    };
  }

  if (spec.kind === "covenant-escrow") {
    return {
      fileName,
      code: `pragma silverscript ^0.1.0;

/**
 * @title ${className} (2-of-3 Escrow Covenant)
 * Every spend path needs two of the three signatures (buyer, seller, arbiter), and
 * output[0] must pay the fixed destination scriptPubKey at least amountSompi:
 *   buyer + seller   -> releaseToSeller (seller) or refundToBuyer (buyer)
 *   arbiter + seller -> arbitrateSeller (seller)
 *   arbiter + buyer  -> arbitrateBuyer (buyer)
 */
contract ${className}(
  pubkey buyer,
  pubkey seller,
  pubkey arbiter,
  byte[] sellerSpk,
  byte[] buyerSpk,
  int amountSompi
) {
  entry releaseToSeller(sig buyerSig, sig sellerSig) {
    require(checkSig(buyerSig, buyer));
    require(checkSig(sellerSig, seller));
    require(tx.outputs[0].scriptPubKey == sellerSpk);
    require(tx.outputs[0].value >= amountSompi);
  }

  entry refundToBuyer(sig buyerSig, sig sellerSig) {
    require(checkSig(buyerSig, buyer));
    require(checkSig(sellerSig, seller));
    require(tx.outputs[0].scriptPubKey == buyerSpk);
    require(tx.outputs[0].value >= amountSompi);
  }

  entry arbitrateSeller(sig arbiterSig, sig sellerSig) {
    require(checkSig(arbiterSig, arbiter));
    require(checkSig(sellerSig, seller));
    require(tx.outputs[0].scriptPubKey == sellerSpk);
    require(tx.outputs[0].value >= amountSompi);
  }

  entry arbitrateBuyer(sig arbiterSig, sig buyerSig) {
    require(checkSig(arbiterSig, arbiter));
    require(checkSig(buyerSig, buyer));
    require(tx.outputs[0].scriptPubKey == buyerSpk);
    require(tx.outputs[0].value >= amountSompi);
  }
}
`
    };
  }

  if (spec.kind === "covenant-timelock") {
    return {
      fileName,
      code: `pragma silverscript ^0.1.0;

/**
 * @title ${className} (Timelock Vesting Covenant)
 * claim: beneficiary-signed; tx.time >= unlockTime is an absolute timestamp lock (CLTV
 * on the transaction lock time, Unix milliseconds, must be >= 500000000000), and
 * output[0] must pay beneficiarySpk at least vestAmountSompi.
 * revoke: grantor + beneficiary together can spend anywhere (no output checks).
 */
contract ${className}(
  pubkey beneficiary,
  pubkey grantor,
  byte[] beneficiarySpk,
  temporal unlockTime,
  int vestAmountSompi
) {
  entry claim(sig beneficiarySig) {
    require(checkSig(beneficiarySig, beneficiary));
    require(tx.time >= unlockTime);
    require(tx.outputs[0].scriptPubKey == beneficiarySpk);
    require(tx.outputs[0].value >= vestAmountSompi);
  }

  entry revoke(sig grantorSig, sig beneficiarySig) {
    require(checkSig(grantorSig, grantor));
    require(checkSig(beneficiarySig, beneficiary));
  }
}
`
    };
  }

  return {
    fileName,
    code: `pragma silverscript ^0.1.0;

// Starter contract for ${projectName}
contract ${className}(pubkey owner) {
  entry spend(sig ownerSig) {
    require(checkSig(ownerSig, owner));
  }
}
`
  };
}
