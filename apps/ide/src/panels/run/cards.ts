import type { CommandSpec } from "./commandSpec";

/**
 * The commands of Deploy & Run that are a form and an answer: each one is a `CommandSpec`, drawn by `CommandCard`.
 * The samples are real: `kcc20 encode-state` / `check` and `kcc dispatch` were run with exactly these inputs.
 * Nothing here takes a password or a private key, and nothing touches mainnet: `--address-network` and `--network` offer
 * testnet-10 at most, because HardKAS itself refuses mainnet while it is locked down. The cards that sign (`kcc20 deploy`,
 * `kcc20 transfer`) sign with the workspace's development accounts, which need no password.
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

// ---- KCC20 on the node (HardKAS 0.13: `kcc20 deploy | transfer | balance`, experimental) ------------------------

/**
 * The seven constructor arguments the reference KCC20.sil is compiled with (argent-lang/kcc20-reference): all zero.
 * A `bytes` value is a list of bytes here, as `silver compile --args` reads it (a hex string is "not a byte array").
 */
const ZERO_BYTES32 = Array.from({ length: 32 }, () => 0);
const KCC20_ZERO_CTOR_SAMPLE = JSON.stringify(
  [
    { kind: "bytes", value: ZERO_BYTES32 },
    { kind: "int", value: 0 },
    { kind: "bytes", value: ZERO_BYTES32 },
    { kind: "byte", value: 0 },
    { kind: "byte", value: 0 },
    { kind: "bytes", value: ZERO_BYTES32 },
    { kind: "bytes", value: ZERO_BYTES32 }
  ]
);

/** HardKAS's own limitation (docs/status/limitations.md, "Covenants and KCC-20"). */
const KCC20_CAVEAT =
  "A token's outputs are found through this workspace's records of the covenant (a node cannot be asked by covenant id): a transfer made by another workspace is not seen, only its effect. Balances count only outputs the node lists unspent and whose state commits to their address.";

const WAIT = { id: "wait", label: "Wait for confirmation", kind: "flag" as const, as: "option" as const, flag: "--wait", initial: "true", hint: "Blocks confirm only while the miner runs: use Mine a burst in Servers." };
// 600 like the covenant forms: a burst's miner can take a minute or two to find its first block, and the CLI's default
// 120 s gave SILVER_CONFIRMATION_TIMEOUT on a transfer the node then confirmed (nothing lost: the record says so).
const TIMEOUT = { id: "timeout", label: "Confirmation timeout (s)", kind: "text" as const, as: "option" as const, flag: "--timeout", initial: "600", hint: "The CLI's own default is 120." };
const YES = { id: "yes", label: "Confirm the broadcast (--yes)", kind: "flag" as const, as: "option" as const, flag: "--yes", hint: "Needed on testnet-10; simnet needs no confirmation. Without it HardKAS refuses (NOT EXECUTED) and sends nothing." };
const FEE = { id: "fee", label: "Fee (sompi)", kind: "text" as const, as: "option" as const, flag: "--fee", placeholder: "the node's floor" };
const COVENANT_ID = { id: "covenant", label: "Token covenant id", kind: "text" as const, as: "option" as const, flag: "--covenant", required: true, placeholder: "64 hex characters, from the deploy's answer" };
const KCC20_ARTIFACT = { id: "artifact", label: "Program artifact (kcc20.json)", kind: "path" as const, as: "option" as const, flag: "--artifact", suggest: "kcc20.*\\.json$", hint: "Empty: KCC-20's default configuration." };

export const KCC20_NODE_CARDS: ReadonlyArray<CommandSpec> = [
  {
    id: "kcc20-deploy",
    title: "Deploy a token",
    summary: "A covenant genesis of the token program (its compile record, e.g. the reference KCC20.sil compiled by silver compile) with one token output per initial holder, all one covenant id; planned, checked, signed and sent by the SDK's v1 engine.",
    words: ["kcc20", "deploy"],
    experimental: true,
    sends: true,
    caveat: KCC20_CAVEAT,
    action: "Deploy",
    fields: [
      { id: "record", label: "Compile record of the program", required: true, placeholder: ".hardkas/artifacts/silver/silverCompile-….json", ...jsonFile },
      { id: "from", label: "Funding account", kind: "account", as: "option", flag: "--from", required: true, hint: "Pays the token outputs' KAS and the fee, gets the change." },
      { id: "holder", label: "Initial holders", kind: "text", as: "option", flag: "--holder", required: true, list: true, placeholder: "alice=1000, bob=500", hint: "<owner>=<amount>, in output order: an account of this workspace, a P2PK address or a 32-byte x-only public key; the amount an exact integer." },
      { id: "kas", label: "KAS locked in each token output", kind: "text", as: "option", flag: "--kas", placeholder: "10" },
      { id: "constructorArgs", label: "Constructor arguments (JSON)", kind: "json", as: "option", flag: "--constructor-args", sample: KCC20_ZERO_CTOR_SAMPLE, hint: "What the program was compiled with. This sample is the reference KCC20.sil's seven zero arguments; clear it to let HardKAS prove them from the initial State." },
      { id: "extensionCommitment", label: "Extension commitment (hex)", kind: "text", as: "option", flag: "--extension-commitment", placeholder: "32 bytes; empty: zero" },
      KCC20_ARTIFACT,
      { id: "contract", label: "Contract", kind: "text", as: "option", flag: "--contract", placeholder: "KCC20", hint: "Only when the record has several." },
      FEE,
      { id: "network", label: "Network", kind: "select", as: "option", flag: "--network", choices: NETWORKS, hint: "Empty: the workspace's. Mainnet is refused before anything is read." },
      WAIT,
      TIMEOUT,
      YES
    ]
  },
  {
    id: "kcc20-transfer",
    title: "Transfer tokens",
    summary: "Spends the sender's token outputs to the recipients, the change back to the sender, through the program's transfer (the leader) and transfer_delegator (the other inputs). Checked against the KCC-20 rules before anything is signed; the token's program on the node is the final judge.",
    words: ["kcc20", "transfer"],
    experimental: true,
    sends: true,
    caveat: KCC20_CAVEAT,
    action: "Transfer",
    fields: [
      COVENANT_ID,
      { id: "from", label: "Sender", kind: "account", as: "option", flag: "--from", required: true, hint: "Whose token outputs are spent and who signs them; the change in tokens goes back to it." },
      { id: "to", label: "Recipients", kind: "text", as: "option", flag: "--to", required: true, list: true, placeholder: "bob=600, carol=300", hint: "<owner>=<amount>, in output order." },
      { id: "input", label: "Token outputs to spend", kind: "text", as: "option", flag: "--input", list: true, placeholder: "txid:index, …", hint: "Empty: the sender's live outputs, largest first, as few as cover the amounts." },
      { id: "funder", label: "Fee paid by", kind: "account", as: "option", flag: "--funder", hint: "Empty: the sender's token change keeps what the fee leaves, else the sender's own KAS coins." },
      KCC20_ARTIFACT,
      FEE,
      { id: "maxFee", label: "Fee limit (sompi)", kind: "text", as: "option", flag: "--max-fee" },
      { id: "computeBudget", label: "Compute budget per token input", kind: "text", as: "option", flag: "--compute-budget", placeholder: "estimate" },
      { id: "network", label: "Network", kind: "select", as: "option", flag: "--network", choices: NETWORKS, hint: "Empty: the workspace's. Mainnet is refused before anything is read." },
      WAIT,
      TIMEOUT,
      YES
    ]
  },
  {
    id: "kcc20-balance",
    title: "Read balances",
    summary: "A holder's live token outputs (or every holder's), from this workspace's records of the token's covenant, each listed unspent at the node with its covenant id and its state checked against its address. Asks the node, signs nothing.",
    words: ["kcc20", "balance"],
    experimental: true,
    caveat: KCC20_CAVEAT,
    action: "Read",
    fields: [
      { id: "holder", label: "Holder", kind: "account", as: "arg", hint: "Empty: every holder." },
      COVENANT_ID,
      { id: "network", label: "Network", kind: "select", as: "option", flag: "--network", choices: NETWORKS, hint: "Empty: the workspace's." }
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

// ---- Escrow: the v2 lifecycle (EscrowFull / EscrowSplit) on the local node ----------------------------------

/** The local node only: `hardkas escrow` refuses mainnet itself and testnet needs an opt-in the IDE does not offer. */
const ESCROW_NETWORK = { id: "network", label: "Network", kind: "select" as const, as: "option" as const, flag: "--network", required: true, initial: "simnet", choices: [NETWORKS[0]] };
const ESCROW_ID = { id: "id", label: "Escrow", kind: "text" as const, as: "arg" as const, required: true, placeholder: "escrow id (uuid)", hint: "Pick one in the list above, or paste its id." };
const ESCROW_BRANCHES = [
  { value: "mutualRelease", label: "mutualRelease (buyer + seller; Full and Split)" },
  { value: "releaseToSeller", label: "releaseToSeller (seller + arbiter; EscrowFull)" },
  { value: "refundBuyer", label: "refundBuyer (buyer + arbiter; EscrowFull)" },
  { value: "executeSplit", label: "executeSplit (a party + arbiter; EscrowSplit)" },
  { value: "fullRelease", label: "fullRelease (EscrowSplit)" },
  { value: "fullRefund", label: "fullRefund (EscrowSplit)" }
];

export const ESCROW_CARDS: ReadonlyArray<CommandSpec> = [
  {
    id: "escrow-create",
    title: "Create an escrow",
    summary: "Compiles a v2 escrow between three parties with the pinned silverc and records it under .hardkas/escrows. Nothing is sent: fund it next.",
    words: ["escrow", "create"],
    action: "Create",
    fields: [
      { id: "buyer", label: "Buyer", kind: "account", as: "option", flag: "--buyer", required: true, initial: "alice", hint: "Pays the funding; refunds go back to this account." },
      { id: "seller", label: "Seller", kind: "account", as: "option", flag: "--seller", required: true, initial: "bob", hint: "Releases pay this account." },
      { id: "arbiter", label: "Arbiter", kind: "account", as: "option", flag: "--arbiter", required: true, initial: "carol", hint: "Co-signs a one-sided release or refund." },
      { id: "amount", label: "Principal (KAS) · EscrowFull", kind: "text", as: "option", flag: "--amount", initial: "1", hint: "Every branch pays this whole amount. Empty it to make an EscrowSplit instead." },
      { id: "buyerAmount", label: "Buyer allocation (KAS) · EscrowSplit", kind: "text", as: "option", flag: "--buyer-amount", hint: "With the seller allocation; executeSplit pays both at once." },
      { id: "sellerAmount", label: "Seller allocation (KAS) · EscrowSplit", kind: "text", as: "option", flag: "--seller-amount" },
      { id: "feeBudget", label: "Fee budget (sompi)", kind: "text", as: "option", flag: "--fee-budget", placeholder: "2000000", hint: "The fee of every release, added to the funding. Default 0.02 KAS; at least the node's minimum relay fee, checked before funding." },
      { id: "buyerDestination", label: "Refunds pay", kind: "text", as: "option", flag: "--buyer-destination", placeholder: "default: the buyer's own address" },
      { id: "sellerDestination", label: "Releases pay", kind: "text", as: "option", flag: "--seller-destination", placeholder: "default: the seller's own address" },
      ESCROW_NETWORK
    ]
  },
  {
    id: "escrow-fund",
    title: "Fund the escrow",
    summary: "One payment of principal + fee budget from the buyer's account to the escrow's address, planned, signed and sent by HardKAS's payment path. Refused before signing if a release could not pay the node's minimum fee.",
    words: ["escrow", "fund"],
    action: "Fund",
    fields: [
      ESCROW_ID,
      { id: "from", label: "Buyer's account", kind: "account", as: "option", flag: "--from", required: true, signs: true, initial: "alice", hint: "Its key must be the escrow's buyer key." },
      { id: "wait", label: "Wait until a chain block accepts it (120 s)", kind: "flag", as: "option", flag: "--wait", hint: "Needs blocks: mine a burst or start the miner while it waits. Without it the funding is broadcast and reconcile confirms it later." },
      ESCROW_NETWORK
    ]
  },
  {
    id: "escrow-status",
    title: "Status of an escrow",
    summary: "What the workspace's record says: state, funding, prepared release, signatures and release. No node is contacted; reconcile asks the node.",
    words: ["escrow", "status"],
    offline: true,
    action: "Show",
    fields: [ESCROW_ID]
  },
  {
    id: "escrow-prepare",
    title: "Prepare a release",
    summary: "Builds the one transaction of a branch over the recorded funding and writes the release request each required signer signs (here, or in their own workspace).",
    words: ["escrow", "prepare"],
    action: "Prepare",
    fields: [
      ESCROW_ID,
      { id: "branch", label: "Branch", kind: "select", as: "option", flag: "--branch", required: true, initial: "mutualRelease", choices: ESCROW_BRANCHES },
      { id: "buyerShare", label: "Buyer's share (KAS)", kind: "text", as: "option", flag: "--buyer-share", hint: "mutualRelease only, with the seller's share; together the principal. Empty: the contract's default allocation." },
      { id: "sellerShare", label: "Seller's share (KAS)", kind: "text", as: "option", flag: "--seller-share" },
      { id: "out", label: "Write the request to", kind: "text", as: "option", flag: "--out", placeholder: "default: escrow-<id>-<branch>.request.json in the workspace" },
      ESCROW_NETWORK
    ]
  },
  {
    id: "escrow-sign",
    title: "Sign the release",
    summary: "Signs the prepared release as one role with an account of this workspace. Given an escrow id the signature goes into its record; given a request file from another workspace, the file is checked against the escrow's terms and signed.",
    words: ["escrow", "sign"],
    action: "Sign",
    fields: [
      { id: "target", label: "Escrow id or release request", kind: "path", as: "arg", required: true, suggest: "\\.request\\.json$", placeholder: "escrow id, or escrow-….request.json", hint: "Pick an escrow in the list above, or a request file another workspace prepared." },
      {
        id: "role",
        label: "Role",
        kind: "select",
        as: "option",
        flag: "--role",
        required: true,
        initial: "buyer",
        choices: [
          { value: "buyer", label: "buyer" },
          { value: "seller", label: "seller" },
          { value: "arbiter", label: "arbiter" }
        ]
      },
      { id: "account", label: "Signing account", kind: "account", as: "option", flag: "--account", required: true, signs: true, initial: "alice", hint: "Its key must be the escrow's key for that role." },
      { id: "out", label: "Write the signed request to", kind: "text", as: "option", flag: "--out", placeholder: "with a request file; default: the file itself" },
      ESCROW_NETWORK
    ]
  },
  {
    id: "escrow-release",
    title: "Release",
    summary: "Sends the prepared release once every required role signed: each signature verified (BIP340) first, then one send. Refused while the node does not list the funding unspent (ESCROW_FUNDING_NOT_UNSPENT): reconcile after a block, then release.",
    words: ["escrow", "release"],
    action: "Release",
    fields: [
      ESCROW_ID,
      { id: "signatures", label: "Signed request files", kind: "text", as: "option", flag: "--signatures", list: true, variadic: true, placeholder: "a.request.json, b.request.json", hint: "From signers in other workspaces, separated by commas. Empty when everyone signed here." },
      { id: "wait", label: "Wait until a chain block accepts it (120 s)", kind: "flag", as: "option", flag: "--wait", hint: "Needs blocks: mine a burst or start the miner while it waits." },
      ESCROW_NETWORK
    ]
  },
  {
    id: "escrow-reconcile",
    title: "Reconcile with the node",
    summary: "Looks at the node once for the pending funding and release (mempool, then chain) and records what it shows: accepted by a chain block → FUNDED / RELEASED.",
    words: ["escrow", "reconcile"],
    action: "Reconcile",
    fields: [ESCROW_ID, ESCROW_NETWORK]
  }
];

export const ALL_CARDS: ReadonlyArray<CommandSpec> = [...SILVER_CARDS, ...COVENANT_CARDS, ...KCC20_CARDS, ...KCC20_NODE_CARDS, ...ZK_CARDS, ...TX_CARDS, ...PSKT_CARDS, ...ESCROW_CARDS];
