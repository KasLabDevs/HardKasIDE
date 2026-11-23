/**
 * What lives under a project's `.hardkas` folder, in one short label (shown next to the name in the Explorer) and one
 * sentence (its tooltip). Everything here is written by the HardKas CLI; the IDE only reads it.
 */
export interface FolderNote {
  label: string;
  detail: string;
}

const NOTES: Record<string, FolderNote> = {
  ".hardkas": { label: "HardKas state", detail: "Everything HardKas writes for this project: transaction artifacts, records, the local node's data, accounts. Written by the CLI; safe to read." },
  ".hardkas/artifacts": { label: "artifacts", detail: "One JSON file per step of every transaction and contract, content-hashed. The Index and Lineage views read these." },
  ".hardkas/artifacts/plans": { label: "planned, unsigned", detail: "txPlan: what a transaction will spend and pay, before anyone signs it (tx plan)." },
  ".hardkas/artifacts/signed": { label: "signed", detail: "signedTx: the signed transaction, ready to send; nothing has reached a node yet (tx sign)." },
  ".hardkas/artifacts/receipts": { label: "node answers", detail: "txReceipt / txSubmission: what the simulator or the node answered when the transaction was sent (tx send)." },
  ".hardkas/artifacts/observations": { label: "seen on chain", detail: "txObservation: what HardKas saw of a transaction on the node afterwards (tx status, tx wait)." },
  ".hardkas/artifacts/silver": { label: "contracts", detail: "silverCompile / silverDeploy / silverSpend / silverCovenant: the records of SilverScript compiles, deploys, entry calls and covenant chains." },
  ".hardkas/artifacts/misc": { label: "snapshots", detail: "Snapshots and other artifacts that are not a step of one transaction." },
  ".hardkas/runs": { label: "run history", detail: "One record per command run from Deploy & Run; the Run history view lists them." },
  ".hardkas/escrows": { label: "escrows", detail: "One record per escrow (hardkas escrow create … reconcile): its terms, funding, signatures and release." },
  ".hardkas/telemetry": { label: "telemetry", detail: "HardKas' runtime pressure log (JSON lines), rotated at 10 MiB. Local only." },
  ".hardkas/locks": { label: "locks", detail: "Workspace locks. A lock left here by a command that crashed makes others wait: `hardkas repair` reports it." },
  ".hardkas/kaspad": { label: "node data", detail: "The local rusty-kaspad's chain database and logs (simnet). Wiped by Reset from scratch." },
  ".hardkas/node-data": { label: "node data", detail: "The local node's chain-derived state. Wiped by Reset from scratch." },
  ".hardkas/localnet": { label: "localnet", detail: "Local node state HardKas keeps between runs. Wiped by Reset from scratch." },
  ".hardkas/ide": { label: "IDE files", detail: "What the IDE writes for itself: scratch JSON for the command cards, test results, spend arguments." },
  ".hardkas/localnet.json": { label: "node config", detail: "Which local node profile and ports this project uses." },
  ".hardkas/store.db": { label: "query index", detail: "HardKas' SQLite index of the artifacts (hardkas query, the Index view). Rebuilt with `hardkas rebuild`." },
  ".hardkas/events.jsonl": { label: "event log", detail: "Every HardKas event of this project, one JSON per line." }
};

/** Key stores: listed with a lock, never opened (the server refuses them to everyone). */
const LOCKED_NOTES: Record<string, FolderNote> = {
  "dev-accounts": { label: "keys", detail: "Keystores of the simnet dev accounts. Never opened here: copy a dev key from the Accounts view." },
  backups: { label: "keys", detail: "Copies of account keys taken by Reset from scratch. Never opened here." },
  "accounts.real.json": { label: "keys", detail: "Your real accounts with their private keys. Never opened here." },
  "dev-server-token": { label: "token", detail: "The dev server's bearer token. Never opened here." }
};

const LOCKED_DEFAULT: FolderNote = { label: "keys", detail: "Holds private keys or tokens, so the IDE lists it and never opens it." };

/** The note for a path, or null. `locked` nodes get the key note whatever their name. */
export function hardkasNote(path: string, locked = false): FolderNote | null {
  const p = path.replace(/\\/g, "/").replace(/\/+$/, "");
  if (locked) return LOCKED_NOTES[p.split("/").pop() ?? ""] ?? LOCKED_DEFAULT;
  if (NOTES[p]) return NOTES[p];
  // A project inside a folder (apps/x/.hardkas/…) has the same layout.
  const at = p.lastIndexOf("/.hardkas");
  return at > 0 ? (NOTES[p.slice(at + 1)] ?? null) : null;
}

/** What a hidden folder is, for its tooltip. */
export function hiddenNote(name: string): string {
  switch (name) {
    case "node_modules":
      return "Installed dependencies. Read one level at a time, on demand (it can hold thousands of files).";
    case "dist":
      return "Build output.";
    case "coverage":
      return "Test coverage report.";
    case ".turbo":
      return "Turborepo cache.";
    default:
      return "Not read with the rest of the tree; opened on demand.";
  }
}
