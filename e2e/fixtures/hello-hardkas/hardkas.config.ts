// Minimal HardKas project for the IDE's end-to-end smoke test. Nothing here runs: the test never trusts the folder.
export default {
  execution: {
    default: "simulator",
    targets: {
      simulator: { mode: "simulator", domain: "kaspa-l1", network: "simulated" }
    }
  }
};
