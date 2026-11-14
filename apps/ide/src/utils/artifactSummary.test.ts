import { describe, expect, it } from "vitest";
import { describeSummary, partyName, shortAddress } from "./artifactSummary";

const accounts = [
  { name: "alice", address: "kaspasim:qqlpk9rs7yag6eqj3lttzqd8vgvssz8l8fxlpdag4h7zx2rjjr8lkkerwkezn" },
  { name: "bob", address: "kaspasim:qryj23rch0n5rc7klfug58zcrnuc966qljwgzpu3mflqgxu6w2pjg6n575980" }
];

describe("artifactSummary", () => {
  it("swaps a project account's address for its name", () => {
    expect(partyName(accounts[1].address, accounts)).toBe("bob");
    expect(partyName("alice", accounts)).toBe("alice");
  });

  it("reads the account name out of a simulator address", () => {
    expect(partyName("kaspa:sim_alice", [])).toBe("alice");
  });

  it("shortens an address that is not one of the accounts", () => {
    expect(partyName("kaspasim:qzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz1234", accounts)).toBe("kaspasim:qzzzzz…1234");
    expect(shortAddress("kaspasim:q123")).toBe("kaspasim:q123");
  });

  it("writes a payment as 'alice → bob · 10 KAS'", () => {
    const t = describeSummary({ verb: "Payment receipt", from: accounts[0].address, to: accounts[1].address, kas: "10", note: "confirmed" }, accounts);
    expect(t).toEqual({ title: "Payment receipt", detail: "alice → bob · 10 KAS · confirmed" });
  });

  it("writes a deploy and a compile without sender and receiver", () => {
    expect(describeSummary({ verb: "Deploy", subject: "VaultGuard", kas: "5", note: "confirmed" })).toEqual({ title: "Deploy VaultGuard", detail: "5 KAS · confirmed" });
    expect(describeSummary({ verb: "Compile", subject: "VaultGuard" })).toEqual({ title: "Compile VaultGuard", detail: "" });
  });

  it("names only the side the artifact states, without inventing the other", () => {
    expect(describeSummary({ verb: "Spend", subject: "V.spend", to: "bob" }, accounts).detail).toBe("to bob");
    expect(describeSummary({ verb: "Payment", from: "alice" }, accounts).detail).toBe("from alice");
  });
});
