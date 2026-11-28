import { describe, expect, it } from "vitest";
import { splitSummary } from "./CommandCard";

describe("splitSummary", () => {
  it("keeps the first sentence as the lead and the rest for 'More'", () => {
    const { lead, rest } = splitSummary("Compiles a v2 escrow between three parties. Nothing is sent: fund it next.");
    expect(lead).toBe("Compiles a v2 escrow between three parties.");
    expect(rest).toBe("Nothing is sent: fund it next.");
  });

  it("does not cut at a dot inside a name or a decimal", () => {
    const { lead, rest } = splitSummary("Reads a hardkas.silverDeploy.v1 record (0.02 KAS). Then stops.");
    expect(lead).toBe("Reads a hardkas.silverDeploy.v1 record (0.02 KAS).");
    expect(rest).toBe("Then stops.");
  });

  it("gives one sentence back whole, with nothing behind More", () => {
    expect(splitSummary("Shows a compile record.")).toEqual({ lead: "Shows a compile record.", rest: "" });
    expect(splitSummary("No full stop at all")).toEqual({ lead: "No full stop at all", rest: "" });
  });
});
