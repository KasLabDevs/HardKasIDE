import { describe, expect, it } from "vitest";
import { formatCompactKas, summarizeAccountsBar } from "./EnvAccountsTrigger";
import type { AccountInfo } from "@/store/env";

const makeAccount = (name: string, balanceSompi: string | null): AccountInfo => ({
  name,
  kind: "dev",
  address: `kaspasim:${name}`,
  balanceSompi,
  utxoCount: balanceSompi ? 1 : 0,
  balanceNetwork: "simnet",
  hasPlainKey: true,
  keystore: "dev-keystore"
});

describe("EnvAccountsTrigger helpers", () => {
  it("formats compact KAS values cleanly for medium-width viewports", () => {
    expect(formatCompactKas(null)).toBe("…");
    expect(formatCompactKas("0")).toBe("0 KAS");
    expect(formatCompactKas("97860000000000")).toBe("978.6k KAS");
    expect(formatCompactKas("150000000")).toBe("1.5 KAS");
  });

  it("summarizes funded primary account and total sompi across accounts", () => {
    const summary = summarizeAccountsBar([
      makeAccount("alice", "97860000000000"),
      makeAccount("bob", "36790000000000"),
      makeAccount("carol", "0")
    ]);
    expect(summary.primaryName).toBe("alice");
    expect(summary.primaryCompact).toBe("978.6k KAS");
    expect(summary.fundedCount).toBe(2);
    expect(summary.totalSompi).toBe("134650000000000");
  });
});
