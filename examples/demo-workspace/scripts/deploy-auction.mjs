// deploy-auction.mjs
// Compiles and deploys KaspaAuction contract on Kaspa simnet/localnet

import fs from "fs";
import { execSync } from "child_process";

const CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
function decodeKaspaAddress(address) {
  const idx = address.indexOf(":");
  const body = [...address.slice(idx + 1).toLowerCase()].slice(0, -8).map((c) => CHARSET.indexOf(c));
  const bytes = [];
  let acc = 0;
  let bits = 0;
  for (const v of body) {
    acc = (acc << 5) | v;
    bits += 5;
    while (bits >= 8) {
      bits -= 8;
      bytes.push((acc >> bits) & 0xff);
    }
  }
  return bytes.slice(1);
}

async function main() {
  console.log("=== DEPLOYING KASPA AUCTION COVENANT ===");

  // 1. Fetch real addresses for Alice (Seller) and Bob (Bidder)
  const base = "http://127.0.0.1:7421";
  const aliceRes = await fetch(`${base}/api/devkeys/reveal`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "alice" })
  });
  const alice = await aliceRes.json();

  const bobRes = await fetch(`${base}/api/devkeys/reveal`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "bob" })
  });
  const bob = await bobRes.json();

  console.log(`Seller (Alice): ${alice.address}`);
  console.log(`Bidder (Bob):   ${bob.address}`);

  // 2. Build constructor args
  const alicePubkey = decodeKaspaAddress(alice.address);
  const bobPubkey = decodeKaspaAddress(bob.address);
  const minBidSompi = 1000000000; // 10 KAS

  const args = [
    { kind: "bytes", value: alicePubkey },
    { kind: "bytes", value: bobPubkey },
    { kind: "int", value: minBidSompi }
  ];

  fs.mkdirSync("contracts", { recursive: true });
  fs.writeFileSync("contracts/auction.constructor-args.json", JSON.stringify(args, null, 2));

  // 3. Compile contract with silverc
  console.log("Compiling contracts/auction.sil...");
  const compileOut = execSync(
    "npx hardkas silver compile contracts/auction.sil --args contracts/auction.constructor-args.json --json",
    { encoding: "utf8" }
  );
  const compileRecord = JSON.parse(compileOut);
  console.log(`Compiled: ${compileRecord.contracts[0].name} -> ${compileRecord.contracts[0].address}`);

  // 4. Deploy contract to Localnet
  console.log("Deploying contract to Localnet via Alice (5 KAS reserve)...");
  const deployOut = execSync(
    `npx hardkas silver deploy "${compileRecord.recordPath}" --from alice --amount 5 --wait --json`,
    { encoding: "utf8" }
  );
  const deployRecord = JSON.parse(deployOut);
  console.log(`\n🎉 AUCTION DEPLOYED SUCCESSFULLY!`);
  console.log(`Contract Address (P2SH): ${deployRecord.address}`);
  console.log(`TxID: ${deployRecord.txId}`);
  console.log(`Locked Value: ${deployRecord.valueSompi} Sompi (5 KAS)`);

  // 5. Write dApp configuration
  fs.mkdirSync("dapp", { recursive: true });
  const dappConfig = {
    contractName: "KaspaAuction",
    network: "simnet",
    address: deployRecord.address,
    txId: deployRecord.txId,
    outpoint: deployRecord.outpoint,
    valueSompi: deployRecord.valueSompi,
    sellerAddress: alice.address,
    highestBidderAddress: bob.address,
    minBidSompi: minBidSompi,
    currentHighestBidKas: 10,
    rpcUrl: "ws://127.0.0.1:18210",
    deployedAt: new Date().toISOString(),
    entries: {
      close: { dispatchTag: "53422444", description: "Seller closes auction and takes winning bid" },
      claim: { dispatchTag: "dd9ab092", description: "Highest bidder claims auction lot" },
      cancel: { dispatchTag: "a0893109", description: "Seller cancels auction and reclaims deposit" }
    }
  };

  fs.writeFileSync("dapp/contract-config.json", JSON.stringify(dappConfig, null, 2));
  console.log("Written config to dapp/contract-config.json");
}

main().catch(console.error);
