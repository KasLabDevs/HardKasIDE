import { scenario, expect } from "@hardkas/testing/scenarios";

scenario("Kaspa Auction Covenant flow", async ({ hk }) => {
  const alice = await hk.accounts.resolve("alice");
  const bob = await hk.accounts.resolve("bob");

  expect(alice).toBeDefined();
  expect(bob).toBeDefined();

  // 1. Verify accounts have funds for auction interaction
  const aliceBalance = await hk.accounts.balance(alice.address);
  expect(aliceBalance.sompi).toBeGreaterThan(0n);

  // 2. Plan bidding transaction from Bob into the Auction
  const bidPlan = await hk.tx.plan({
    from: bob.name,
    to: alice.address,
    amount: "10"
  });

  expect(bidPlan).toBeDefined();
  expect(bidPlan.amountSompi).toBe("1000000000");

  // 3. Sign and execute bid
  const signedBid = await hk.tx.sign(bidPlan);
  expect(signedBid).toBeDefined();

  const receipt = await hk.tx.send(signedBid);
  expect(receipt.receipt).toBeDefined();
  expect(receipt.receipt?.status).toBe("accepted");
});
