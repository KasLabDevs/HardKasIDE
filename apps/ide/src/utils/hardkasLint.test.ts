import { describe, expect, it } from "vitest";
import { indexWorkspaceContracts, lintHardkasWorkspaceFile } from "./hardkasLint";

const AUCTION_SIL = `pragma silverscript ^0.1.0;

contract KaspaAuction(pubkey seller, int minBidSompi) {
  entry close(sig sellerSig) {
    require(checkSig(sellerSig, seller));
  }
  entry claim(sig winnerSig) {
    require(checkSig(winnerSig, seller));
  }
}`;

describe("hardkasLint", () => {
  const index = indexWorkspaceContracts([{ path: "contracts/auction.sil", content: AUCTION_SIL }]);

  it("flags constructor-args count and kind mismatches against sibling .sil with quick fixes", () => {
    const badArgs = JSON.stringify([{ kind: "bool", value: true }], null, 2);
    const diags = lintHardkasWorkspaceFile("contracts/auction.constructor-args.json", badArgs, index);
    const countDiag = diags.find((d) => d.code === "HK-ARGS-COUNT");
    expect(countDiag).toBeDefined();
    expect(countDiag?.fixes?.[0]?.title).toContain("Sync array");

    const typeDiag = diags.find((d) => d.code === "HK-ARGS-TYPE");
    expect(typeDiag).toBeDefined();
    expect(typeDiag?.fixes?.[0]?.edit.text).toBe('"kind": "bytes"');
  });

  it("detects cross-file entry typos in TS/JS spendContract calls and offers a quick fix", () => {
    const script = `await provider.spendContract({
  address: cfg.address,
  contract: "KaspaAuction",
  entry: "claime",
  to: buyerAddress,
  args: []
});`;
    const diags = lintHardkasWorkspaceFile("dapp/src/bid.tsx", script, index);
    expect(diags).toHaveLength(1);
    expect(diags[0].code).toBe("HK-UNKNOWN-ENTRY");
    expect(diags[0].line).toBe(4);
    expect(diags[0].fixes?.[0]?.edit.text).toBe("claim");
  });

  it("warns on allowPublic: true in hardkas.config.ts", () => {
    const cfg = `export default { network: { allowPublic: true } };`;
    const diags = lintHardkasWorkspaceFile("hardkas.config.ts", cfg, index);
    expect(diags.some((d) => d.code === "HK-POLICY-PUBLIC")).toBe(true);
    expect(diags[0].fixes?.[0]?.edit.text).toBe("allowPublic: false");
  });
});
