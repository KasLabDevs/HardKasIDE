// Minimal HardKas workspace used to try the IDE. Mirrors what `hardkas init` scaffolds.
export default {
  execution: {
    default: "simulator",
    targets: {
      simulator: { mode: "simulator", domain: "kaspa-l1", network: "simulated" },
      localnet: { mode: "localnet", domain: "kaspa-l1", network: "simnet" }
    }
  },
  accounts: {
    alice: { kind: "dev" },
    bob: { kind: "dev" }
  }
};
