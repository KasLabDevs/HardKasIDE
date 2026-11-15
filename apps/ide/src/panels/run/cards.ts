import type { CommandSpec } from "./commandSpec";

/**
 * The commands of Deploy & Run that are a form and an answer: each one is a `CommandSpec`, drawn by `CommandCard`.
 * The samples are real: `kcc20 encode-state` / `check` and `kcc dispatch` were run with exactly these inputs.
 * Nothing here signs with a real key or touches mainnet: `--address-network` offers testnet-10 only, because
 * HardKAS itself refuses mainnet while it is locked down.
 */

const ZERO32 = "00".repeat(32);
const state = (amount: string, owner: string) => ({ amount, owner: owner.repeat(32), ownerScheme: 0, borrowScheme: 0, borrowGuard: ZERO32, extensionCommitment: ZERO32 });

const KCC20_STATE_SAMPLE = JSON.stringify(state("1000", "11"), null, 2);
const KCC20_ENCODED_SAMPLE =
  "08e80300000000000020111111111111111111111111111111111111111111111111111111111111111101000100200000000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000000";
const KCC20_TRANSFER_SAMPLE = JSON.stringify(
  {
    inputs: [{ state: state("1000", "11"), kasValueSompi: "100000000", witness: "00".repeat(66) }],
    nextStates: [state("600", "22"), state("400", "11")],
    outputs: [
      { state: state("600", "22"), kasValueSompi: "50000000" },
      { state: state("400", "11"), kasValueSompi: "49000000" }
    ]
  },
  null,
  2
);

const NETWORKS = [
  { value: "simnet", label: "simnet (local node)" },
  { value: "testnet-10", label: "testnet-10" }
];

const jsonFile = { kind: "path" as const, as: "arg" as const, suggest: "\\.json$" };

// ---- SilverScript -------------------------------------------------------------------------------------------

export const SILVER_CARDS: ReadonlyArray<CommandSpec> = [
  {
    id: "silver-inspect",
    title: "Inspect a compile record",
    summary: "What a compiled contract is: its entries, parameters and the hash of what was compiled.",
    words: ["silver", "inspect"],
    offline: true,
    fields: [{ id: "record", label: "Compile record", required: true, placeholder: ".hardkas/artifacts/silver/….json", ...jsonFile }]
  },
  {
    id: "silver-verify",
    title: "Reproduce a compile",
    summary: "Compiles the source again with the managed compiler and says whether it gives the same bytes.",
    words: ["silver", "verify"],
    offline: true,
    fields: [
      { id: "record", label: "Compile record", required: true, placeholder: ".hardkas/artifacts/silver/….json", ...jsonFile },
      { id: "args", label: "Constructor arguments", kind: "path", as: "option", flag: "--args", suggest: "\\.json$", hint: "The file the record was compiled with." }
    ]
  },
  {
    id: "silver-test",
    title: "Run the contract's tests",
    summary: "Runs a .test.json on the SilverScript runner. It checks the script engine on scenario transactions, not transaction validity.",
    words: ["silver", "test"],
    alpha: true,
    action: "Run tests",
    offline: true,
    fields: [
      { id: "record", label: "Compile record", required: true, placeholder: ".hardkas/artifacts/silver/….json", ...jsonFile },
      { id: "tests", label: "Test file", kind: "path", as: "option", flag: "--tests", suggest: "\\.test\\.json$", hint: "A runner test file (.test.json)." },
      { id: "args", label: "Constructor arguments", kind: "path", as: "option", flag: "--args", suggest: "\\.json$" },
      { id: "contract", label: "Contract", kind: "text", as: "option", flag: "--contract", hint: "Only when the record has several." }
    ]
  },
  {
    id: "silver-engine-plan",
    title: "Plan a transaction from a spec",
    summary: "Builds the plan of a genesis, transition, deploy or spend from a JSON spec, without signing or sending it.",
    words: ["silver", "engine", "plan"],
    action: "Plan",
    fields: [
      {
        id: "operation",
        label: "Operation",
        kind: "select",
        as: "arg",
        required: true,
        initial: "deploy",
        choices: [
          { value: "genesis", label: "genesis" },
          { value: "transition", label: "transition" },
          { value: "deploy", label: "deploy" },
          { value: "spend", label: "spend" }
        ]
      },
      { id: "spec", label: "Spec (JSON)", kind: "json", as: "arg", required: true, hint: "The SDK's options for that operation, sompi as text.", sample: "{\n}" },
      { id: "network", label: "Network", kind: "select", as: "option", flag: "--network", choices: NETWORKS, hint: "Empty: the workspace's." }
    ]
  },
  {
    id: "silver-draft-prepare",
    title: "Prepare a multisig draft",
    summary: "Turns a plan into a draft the signers pass around.",
    words: ["silver", "engine", "draft", "prepare"],
    action: "Prepare",
    fields: [
      { id: "plan", label: "Plan", required: true, placeholder: "plan.json", ...jsonFile },
      { id: "out", label: "Write draft to", kind: "text", as: "option", flag: "--out", initial: ".hardkas/ide/draft.json" },
      { id: "network", label: "Network", kind: "select", as: "option", flag: "--network", choices: NETWORKS }
    ]
  },
  {
    id: "silver-draft-combine",
    title: "Combine signed drafts",
    summary: "Merges the drafts each signer returned into one.",
    words: ["silver", "engine", "draft", "combine"],
    action: "Combine",
    fields: [
      { id: "drafts", label: "Drafts", kind: "text", as: "arg", required: true, list: true, placeholder: "a.json, b.json", hint: "File paths, separated by commas." },
      { id: "plan", label: "Plan", kind: "path", as: "option", flag: "--plan", suggest: "\\.json$" },
      { id: "out", label: "Write result to", kind: "text", as: "option", flag: "--out", initial: ".hardkas/ide/combined.json" }
    ]
  },
  {
    id: "silver-draft-finalize",
    title: "Finalize a draft",
    summary: "Checks that a combined draft has every signature and builds the transaction to send.",
    words: ["silver", "engine", "draft", "finalize"],
    action: "Finalize",
    fields: [
      { id: "draft", label: "Draft", required: true, placeholder: ".hardkas/ide/combined.json", ...jsonFile },
      { id: "plan", label: "Plan", kind: "path", as: "option", flag: "--plan", suggest: "\\.json$" },
      { id: "network", label: "Network", kind: "select", as: "option", flag: "--network", choices: NETWORKS }
    ]
  }
];

// ---- Covenants ----------------------------------------------------------------------------------------------

export const COVENANT_CARDS: ReadonlyArray<CommandSpec> = [
  {
    id: "covenant-inspect",
    title: "Inspect a covenant",
    summary: "Its id, its current state and whether the node still has its output, from a genesis or transition record.",
    words: ["silver", "covenant", "inspect"],
    fields: [
      { id: "covenant", label: "Covenant record", required: true, placeholder: ".hardkas/artifacts/silver/….json", ...jsonFile },
      { id: "network", label: "Network", kind: "select", as: "option", flag: "--network", choices: NETWORKS },
      { id: "noNode", label: "Do not ask the node", kind: "flag", as: "option", flag: "--no-node", hint: "Read the record only." },
      { id: "noStates", label: "Leave out the states", kind: "flag", as: "option", flag: "--no-states" }
    ]
  }
];

// ---- KCC20 --------------------------------------------------------------------------------------------------

export const KCC20_CARDS: ReadonlyArray<CommandSpec> = [
  {
    id: "kcc20-encode-state",
    title: "Encode a token state",
    summary: "Turns amount, owner and schemes into the 112-byte state a KCC-20 output carries.",
    words: ["kcc20", "encode-state"],
    offline: true,
    action: "Encode",
    fields: [{ id: "state", label: "State (JSON)", kind: "json", as: "arg", required: true, sample: KCC20_STATE_SAMPLE, hint: "amount, owner, ownerScheme, borrowScheme, borrowGuard, extensionCommitment." }]
  },
  {
    id: "kcc20-decode-state",
    title: "Decode a token state",
    summary: "Reads the hex of a state back into its fields and says whether it is a valid KCC-20 state.",
    words: ["kcc20", "decode-state"],
    offline: true,
    action: "Decode",
    fields: [{ id: "hex", label: "State (hex)", kind: "text", as: "arg", required: true, multiline: true, initial: KCC20_ENCODED_SAMPLE }]
  },
  {
    id: "kcc20-check",
    title: "Check a transfer",
    summary: "Tests a transfer off chain against the leader's rules: cardinality, conservation, token identity, owner and borrow schemes. Signatures are listed, not verified.",
    words: ["kcc20", "check"],
    offline: true,
    action: "Check",
    fields: [{ id: "transfer", label: "Transfer (JSON)", kind: "json", as: "arg", required: true, sample: KCC20_TRANSFER_SAMPLE, hint: "inputs (leader first), nextStates and outputs." }]
  },
  {
    id: "kcc20-artifact",
    title: "Read a program artifact",
    summary: "Prints a kcc20.json's configuration and the KCC-1 dispatch tag of each entrypoint.",
    words: ["kcc20", "artifact"],
    offline: true,
    fields: [{ id: "file", label: "kcc20.json", kind: "path", as: "arg", required: true, suggest: "kcc20.*\\.json$|\\.json$", placeholder: "kcc20.json" }]
  },
  {
    id: "kcc-dispatch",
    title: "KCC-1 dispatch tag",
    summary: "The 4-byte tag a function signature dispatches to.",
    words: ["kcc", "dispatch"],
    offline: true,
    action: "Compute",
    fields: [{ id: "signature", label: "Function signature", kind: "text", as: "arg", required: true, initial: "transfer(byte[32],int)" }]
  },
  {
    id: "kcc-template-hash",
    title: "KCC-1 template hash",
    summary: "The hash of a template: Hash(LE64(len(prefix)) + prefix + LE64(len(suffix)) + suffix).",
    words: ["kcc", "template-hash"],
    offline: true,
    action: "Compute",
    fields: [
      { id: "prefix", label: "Prefix (hex)", kind: "text", as: "option", flag: "--prefix", initial: "20", multiline: true },
      { id: "suffix", label: "Suffix (hex)", kind: "text", as: "option", flag: "--suffix", initial: "ac", multiline: true }
    ]
  }
];

// ---- ZK -----------------------------------------------------------------------------------------------------

const zkPath = (id: string, label: string, hint: string) => ({ id, label, kind: "path" as const, as: "arg" as const, required: true, hint, suggest: "\\.json$|\\.hex$" });
const IMAGE = { id: "imageId", label: "Image ID", kind: "text" as const, as: "option" as const, flag: "--image-id", placeholder: "32-byte hex" };
const JOURNAL = { id: "journalHash", label: "Journal hash", kind: "text" as const, as: "option" as const, flag: "--journal-hash", placeholder: "32-byte hex" };
const RECEIPT = { id: "receipt", label: "Receipt", kind: "text" as const, as: "option" as const, flag: "--receipt", placeholder: "path to a .hex file, or the hex itself", multiline: true };

export const ZK_CARDS: ReadonlyArray<CommandSpec> = [
  {
    id: "zk-capabilities",
    title: "What this build can do",
    summary: "What HardKAS inspects, verifies and generates for each proof system, and what it does not claim.",
    words: ["zk", "capabilities"],
    offline: true,
    action: "Show",
    fields: []
  },
  {
    id: "zk-toccata-rules",
    title: "Toccata ZK rules",
    summary: "The consensus facts a script has to respect: the opcode, the curve, the proof format and the compute budget.",
    words: ["zk", "toccata", "rules"],
    offline: true,
    action: "Show",
    fields: []
  },
  {
    id: "zk-proof-inspect",
    title: "Inspect a proof",
    summary: "What a proof fixture or artifact holds, without verifying it.",
    words: ["zk", "proof", "inspect"],
    offline: true,
    fields: [zkPath("path", "Proof", "A proof fixture or artifact.")]
  },
  {
    id: "zk-proof-verify",
    title: "Verify a proof (fixture)",
    summary: "Checks that a fixture is coherent. It does not run the pairing: use the math check below for that.",
    words: ["zk", "proof", "verify"],
    alpha: true,
    offline: true,
    fields: [zkPath("path", "Proof", "A proof fixture.")]
  },
  {
    id: "zk-proof-verify-math",
    title: "Verify a proof (pairing)",
    summary: "Runs the BN254 pairing check with snarkjs against a pinned verifying key.",
    words: ["zk", "proof", "verify-math"],
    alpha: true,
    offline: true,
    fields: [
      zkPath("path", "Proof", "A Groth16 proof fixture."),
      { id: "vk", label: "Expected verifying-key hash", kind: "text", as: "option", flag: "--expect-vk-hash", placeholder: "hex" },
      { id: "timeout", label: "Timeout (ms)", kind: "text", as: "option", flag: "--timeout", placeholder: "10000" },
      { id: "mathOnly", label: "Math only", kind: "flag", as: "option", flag: "--math-only", hint: "Skip the fixture checks." },
      { id: "weak", label: "Allow a weak verifying key", kind: "flag", as: "option", flag: "--allow-weak-vk" }
    ]
  },
  {
    id: "zk-corpus-verify",
    title: "Verify a corpus",
    summary: "Checks every fixture a corpus lists, with the pairing where a fixture claims it.",
    words: ["zk", "corpus", "verify"],
    offline: true,
    fields: [{ id: "path", label: "Corpus", kind: "path", as: "arg", required: true, suggest: "corpus.*\\.json$|\\.json$", placeholder: "path to the corpus" }]
  },
  {
    id: "zk-toccata-verify-receipt",
    title: "Verify a RISC Zero receipt",
    summary: "Checks a Groth16 receipt against the pinned official verifying key for the claim of (image ID, journal hash). Claims nothing on chain.",
    words: ["zk", "toccata", "verify-receipt"],
    alpha: true,
    offline: true,
    fields: [IMAGE, JOURNAL, RECEIPT, { id: "timeout", label: "Timeout (ms)", kind: "text", as: "option", flag: "--timeout", placeholder: "10000" }]
  },
  {
    id: "zk-toccata-build-scripts",
    title: "Build the lock and unlock scripts",
    summary: "The redeem and signature scripts for a receipt. Proof-only locks the image ID alone; output-bound also fixes who is paid.",
    words: ["zk", "toccata", "build-scripts"],
    offline: true,
    action: "Build",
    fields: [
      IMAGE,
      JOURNAL,
      RECEIPT,
      {
        id: "mode",
        label: "Mode",
        kind: "select",
        as: "option",
        flag: "--mode",
        initial: "proof-only",
        choices: [
          { value: "proof-only", label: "proof-only (binds the image ID only)" },
          { value: "proof-and-output-bound", label: "proof-and-output-bound (fixes the outputs)" }
        ]
      },
      { id: "payoutAddress", label: "Payout address", kind: "text", as: "option", flag: "--payout-address", hint: "Output-bound mode." },
      { id: "payoutAmount", label: "Payout (sompi)", kind: "text", as: "option", flag: "--payout-amount", hint: "Output-bound mode." },
      { id: "changeAddress", label: "Change address", kind: "text", as: "option", flag: "--change-address" },
      { id: "changeAmount", label: "Change (sompi)", kind: "text", as: "option", flag: "--change-amount" },
      { id: "maxFee", label: "Highest fee (sompi)", kind: "text", as: "option", flag: "--max-fee", hint: "Output-bound mode." },
      {
        id: "addressNetwork",
        label: "Also give the address on",
        kind: "select",
        as: "option",
        flag: "--address-network",
        choices: [{ value: "testnet-10", label: "testnet-10" }],
        hint: "Testnet only: HardKAS refuses mainnet."
      },
      { id: "ack", label: "I know a proof-only lock binds only the image ID", kind: "flag", as: "option", flag: "--ack-image-id-only-lock", hint: "Required to get a testnet address for a proof-only lock." }
    ]
  },
  {
    id: "zk-toccata-verify-scripts",
    title: "Check a pair of scripts",
    summary: "Decodes a redeem script and a signature script and checks them against the claim and the outputs you expect.",
    words: ["zk", "toccata", "verify-scripts"],
    offline: true,
    fields: [
      { id: "redeem", label: "Redeem script (hex)", kind: "text", as: "option", flag: "--redeem-script", multiline: true },
      { id: "sig", label: "Signature script (hex)", kind: "text", as: "option", flag: "--sig-script", multiline: true },
      IMAGE,
      JOURNAL,
      {
        id: "expectedMode",
        label: "Expected mode",
        kind: "select",
        as: "option",
        flag: "--expected-mode",
        choices: [
          { value: "proof-only", label: "proof-only" },
          { value: "proof-and-output-bound", label: "proof-and-output-bound" }
        ]
      },
      { id: "expAddr", label: "Expected payout address", kind: "text", as: "option", flag: "--expected-payout-address" },
      { id: "expAmt", label: "Expected payout (sompi)", kind: "text", as: "option", flag: "--expected-payout-amount" },
      { id: "expChAddr", label: "Expected change address", kind: "text", as: "option", flag: "--expected-change-address" },
      { id: "expChAmt", label: "Expected change (sompi)", kind: "text", as: "option", flag: "--expected-change-amount" }
    ]
  }
];

// ---- Payments: reading a transaction, and PSKT (partly signed transactions) ---------------------------------

export const TX_CARDS: ReadonlyArray<CommandSpec> = [
  {
    id: "tx-receipt",
    title: "Receipt of a transaction",
    summary: "What the HardKAS store knows about a transaction by its ID.",
    words: ["tx", "receipt"],
    offline: true,
    fields: [{ id: "txId", label: "Transaction ID", kind: "text", as: "arg", required: true, placeholder: "64 hex characters" }]
  },
  {
    id: "tx-verify",
    title: "Verify an artifact",
    summary: "Checks a plan, a signed transaction or a receipt: its schema, its hash and what it claims.",
    words: ["tx", "verify"],
    offline: true,
    fields: [{ id: "path", label: "Artifact", required: true, placeholder: ".hardkas/artifacts/…json", ...jsonFile }]
  },
  {
    id: "tx-profile",
    title: "Profile an artifact",
    summary: "Mass, fee and shape of a plan or signed transaction.",
    words: ["tx", "profile"],
    offline: true,
    fields: [{ id: "path", label: "Artifact", required: true, placeholder: ".hardkas/artifacts/…json", ...jsonFile }]
  },
  {
    id: "tx-compare",
    title: "Compare simulated and real",
    summary: "Puts a simulator artifact next to the real one and says what differs.",
    words: ["tx", "compare"],
    offline: true,
    action: "Compare",
    fields: [
      { id: "simulated", label: "Simulated artifact", required: true, ...jsonFile },
      { id: "real", label: "Real artifact", required: true, ...jsonFile }
    ]
  }
];

export const PSKT_CARDS: ReadonlyArray<CommandSpec> = [
  {
    id: "pskt-capabilities",
    title: "What PSKT can do here",
    summary: "The adapters this build knows for partly signed transactions.",
    words: ["pskt", "capabilities"],
    offline: true,
    action: "Show",
    fields: [{ id: "adapter", label: "Adapter", kind: "text", as: "option", flag: "--adapter" }]
  },
  {
    id: "pskt-export",
    title: "Export a plan as a PSKT session",
    summary: "Writes the session file a co-signer can sign.",
    words: ["pskt", "export"],
    action: "Export",
    fields: [
      { id: "plan", label: "Plan", kind: "path", as: "option", flag: "--plan", required: true, suggest: "plan.*\\.json$|\\.json$" },
      { id: "out", label: "Write session to", kind: "text", as: "option", flag: "--out", initial: ".hardkas/ide/session.pskt.json" },
      { id: "force", label: "Overwrite", kind: "flag", as: "option", flag: "--force" }
    ]
  },
  {
    id: "pskt-inspect",
    title: "Inspect a session",
    summary: "Who has signed, which inputs are covered and what is missing.",
    words: ["pskt", "inspect"],
    offline: true,
    fields: [{ id: "session", label: "Session", required: true, ...jsonFile }]
  },
  {
    id: "pskt-verify",
    title: "Verify a session",
    summary: "Checks the session's structure and that its signatures belong to its inputs.",
    words: ["pskt", "verify"],
    offline: true,
    fields: [{ id: "session", label: "Session", required: true, ...jsonFile }]
  },
  {
    id: "pskt-merge",
    title: "Merge two sessions",
    summary: "Joins the signatures two co-signers added to the same plan.",
    words: ["pskt", "merge"],
    action: "Merge",
    fields: [
      { id: "a", label: "Session A", required: true, ...jsonFile },
      { id: "b", label: "Session B", required: true, ...jsonFile },
      { id: "out", label: "Write result to", kind: "text", as: "option", flag: "--out", initial: ".hardkas/ide/merged.pskt.json" },
      { id: "force", label: "Overwrite", kind: "flag", as: "option", flag: "--force" }
    ]
  },
  {
    id: "pskt-finalize",
    title: "Finalize a session",
    summary: "Builds the final signature scripts once every input is signed.",
    words: ["pskt", "finalize"],
    action: "Finalize",
    fields: [
      { id: "session", label: "Session", required: true, ...jsonFile },
      { id: "out", label: "Write result to", kind: "text", as: "option", flag: "--out", initial: ".hardkas/ide/final.pskt.json" },
      { id: "force", label: "Overwrite", kind: "flag", as: "option", flag: "--force" }
    ]
  },
  {
    id: "pskt-extract",
    title: "Extract the transaction",
    summary: "Takes the signed transaction out of a finalized session, ready to send.",
    words: ["pskt", "extract"],
    action: "Extract",
    fields: [
      { id: "session", label: "Session", required: true, ...jsonFile },
      { id: "out", label: "Write result to", kind: "text", as: "option", flag: "--out", initial: ".hardkas/ide/extracted.tx.json" },
      { id: "force", label: "Overwrite", kind: "flag", as: "option", flag: "--force" }
    ]
  }
];

export const ALL_CARDS: ReadonlyArray<CommandSpec> = [...SILVER_CARDS, ...COVENANT_CARDS, ...KCC20_CARDS, ...ZK_CARDS, ...TX_CARDS, ...PSKT_CARDS];
