/** Colours and labels per artifact kind, shared by the flow view and the timeline. */
export const SCHEMA_STYLE: Record<string, { color: string; label: string }> = {
  txPlan: { color: "var(--info)", label: "plan" },
  signedTx: { color: "var(--warn)", label: "signed" },
  txReceipt: { color: "var(--ok)", label: "receipt" },
  txSubmission: { color: "var(--ok)", label: "sent" },
  txObservation: { color: "var(--accent)", label: "node check" },
  txTrace: { color: "var(--fg-muted)", label: "trace" },
  // "snapshot" is the saved state of the simulator; the word is also used for "read from disk", so the kind says "state".
  snapshot: { color: "var(--fg-muted)", label: "state" },
  silverCompile: { color: "var(--accent)", label: "compile" },
  silverDeploy: { color: "var(--info)", label: "deploy" },
  silverSpend: { color: "var(--warn)", label: "spend" },
  scenarioResult: { color: "var(--ok)", label: "scenario" },
  replayReport: { color: "var(--ok)", label: "replay" }
};

/** Lane colours of the timeline (one per branch, reused round-robin). */
export const LANE_COLORS = ["var(--accent)", "var(--info)", "var(--warn)", "#c084fc", "var(--ok)", "#fb7185", "#f59e0b", "#38bdf8"];
