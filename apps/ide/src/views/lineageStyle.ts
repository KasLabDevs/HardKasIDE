/** Colours and labels per artifact kind, shared by the flow view and the Git-style graph. */
export const SCHEMA_STYLE: Record<string, { color: string; label: string }> = {
  txPlan: { color: "var(--info)", label: "plan" },
  signedTx: { color: "var(--warn)", label: "signed" },
  txReceipt: { color: "var(--ok)", label: "receipt" },
  txSubmission: { color: "var(--ok)", label: "submitted" },
  txObservation: { color: "var(--accent)", label: "observation" },
  txTrace: { color: "var(--fg-muted)", label: "trace" },
  snapshot: { color: "var(--fg-muted)", label: "snapshot" },
  silverCompile: { color: "var(--accent)", label: "silver" },
  replayReport: { color: "var(--ok)", label: "replay" }
};

/** Lane colours of the Git-style graph (one per branch, reused round-robin). */
export const LANE_COLORS = ["var(--accent)", "var(--info)", "var(--warn)", "#c084fc", "var(--ok)", "#fb7185", "#f59e0b", "#38bdf8"];
