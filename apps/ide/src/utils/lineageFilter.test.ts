import { describe, expect, it } from "vitest";
import type { ArtifactRow } from "@/store/lineage";
import { collectArtifactKeys, matchesArtifactFilter } from "./lineageFilter";

const aliceAddr = "kaspasim:qz7y5acr8m82cwhlhw3w7scsk9fyzc769smm26swmwwgju9h7d0jjhzv0rlt8";
const alicePubkey = "bc4a77033eceac3affbba2ef4310b1524163da2c37b56a0edb9c8970b7f35f29";
const contractAddr = "kaspasim:ppsctkwgklkr0n8uzxghsszpw4fk4jzuklra70dlzz44fsf0tutm56s7rkrw4";
const bobAddr = "kaspasim:qryj23rch0n5rc7klfug58zcrnuc966qljwgzpu3mflqgxu6w2pjg6n575980";

const accounts = [
  { name: "alice", address: aliceAddr },
  { name: "bob", address: bobAddr }
];

const planArtifact: ArtifactRow = {
  artifactId: "00d8e8a6b68cfffc319d089a7087b8e209112cec4cb1918aec5a7ad69a411c7e",
  schema: "hardkas.txPlan",
  summary: { verb: "Payment plan", from: "alice", to: contractAddr, kas: "5" },
  keys: [aliceAddr, alicePubkey, contractAddr]
};

describe("lineageFilter", () => {
  it("expands account names into full Bech32 addresses and decoded x-only hex pubkeys", () => {
    const keys = collectArtifactKeys(
      { artifactId: "x1", schema: "hardkas.txReceipt", summary: { verb: "Payment receipt", from: "alice", to: "bob" } },
      accounts
    );
    expect(keys.aliases).toEqual(expect.arrayContaining(["alice", "bob"]));
    expect(keys.addresses).toEqual(expect.arrayContaining([aliceAddr, bobAddr]));
    expect(keys.pubkeys).toContain(alicePubkey);
  });

  it("matches by full Bech32 address, address suffix, 0x-prefixed pubkey, bare hex pubkey, and alias", () => {
    expect(matchesArtifactFilter(planArtifact, aliceAddr, accounts)).toBe(true);
    expect(matchesArtifactFilter(planArtifact, "26swmwwgju9h7d0jjhzv0rlt8", accounts)).toBe(true);
    expect(matchesArtifactFilter(planArtifact, `0x${alicePubkey}`, accounts)).toBe(true);
    expect(matchesArtifactFilter(planArtifact, alicePubkey.slice(0, 14), accounts)).toBe(true);
    expect(matchesArtifactFilter(planArtifact, "contract", accounts)).toBe(false);
    expect(matchesArtifactFilter(planArtifact, contractAddr, accounts)).toBe(true);
    expect(matchesArtifactFilter(planArtifact, "alice", accounts)).toBe(true);
    expect(matchesArtifactFilter(planArtifact, "bob", accounts)).toBe(false);
  });

  it("matches deploy artifacts using extracted pubkeys even without account names in summary", () => {
    const spendByPubkey: ArtifactRow = {
      artifactId: "s1",
      schema: "hardkas.silverSpend.v1",
      summary: { verb: "Spend", subject: "Escrow.release", to: aliceAddr },
      keys: [aliceAddr]
    };
    expect(matchesArtifactFilter(spendByPubkey, `0x${alicePubkey.slice(0, 12)}`, accounts)).toBe(true);
    expect(matchesArtifactFilter(spendByPubkey, "alice", accounts)).toBe(true);
  });
});
