import type { languages } from "monaco-editor";

/**
 * SilverScript (.sil) language for Monaco: Monarch tokenizer + language configuration.
 *
 * Based on the SilverScript v1.0.0 (language 0.1.0) samples shipped with HardKas:
 *
 *   pragma silverscript ^0.1.0;
 *   contract Escrow(pubkey buyer, pubkey seller) {
 *     entry release(sig s) { require(checkSig(s, seller)); }
 *   }
 *
 * HardKas has no official grammar yet, so this list is intentionally generous and
 * should be tightened once silverc exposes its keyword set.
 */

export const SILVERSCRIPT_ID = "silverscript";

export const silverscriptConfiguration: languages.LanguageConfiguration = {
  comments: { lineComment: "//", blockComment: ["/*", "*/"] },
  brackets: [
    ["{", "}"],
    ["[", "]"],
    ["(", ")"]
  ],
  autoClosingPairs: [
    { open: "{", close: "}" },
    { open: "[", close: "]" },
    { open: "(", close: ")" },
    { open: '"', close: '"', notIn: ["string"] },
    { open: "'", close: "'", notIn: ["string"] }
  ],
  surroundingPairs: [
    { open: "{", close: "}" },
    { open: "[", close: "]" },
    { open: "(", close: ")" },
    { open: '"', close: '"' }
  ],
  folding: { markers: { start: /^\s*\/\/\s*#?region\b/, end: /^\s*\/\/\s*#?endregion\b/ } }
};

export const silverscriptMonarch: languages.IMonarchLanguage = {
  defaultToken: "",
  tokenPostfix: ".sil",
  flowKeywords: ["if", "else", "return", "import"],
  keywords: [
    "pragma",
    "silverscript",
    "contract",
    "entry",
    "function",
    "require",
    "true",
    "false",
    "covenant",
    "transition",
    "state",
    "const",
    "let",
    "assert"
  ],
  typeKeywords: ["pubkey", "sig", "bytes", "byte", "int", "bool", "string", "datasig", "address", "hash160", "hash256", "sompi"],
  builtins: [
    "checkSig",
    "checkMultiSig",
    "checkDataSig",
    "sha256",
    "blake2b",
    "hash160",
    "hash256",
    "tx",
    "inputs",
    "outputs",
    "scriptPubKey",
    "value",
    "lockTime",
    "sequence",
    "this",
    "length",
    "abi",
    "bytes"
  ],
  operators: ["=", ">", "<", "!", "~", "?", ":", "==", "<=", ">=", "!=", "&&", "||", "+", "-", "*", "/", "&", "|", "^", "%", "<<", ">>"],
  symbols: /[=><!~?:&|+\-*/^%]+/,
  escapes: /\\(?:[abfnrtv\\"']|x[0-9A-Fa-f]{1,4}|u[0-9A-Fa-f]{4}|U[0-9A-Fa-f]{8})/,
  tokenizer: {
    root: [
      [/pragma\b/, { token: "keyword.flow", next: "@pragma" }],
      [
        /([a-zA-Z_]\w*)(?=\s*\()/,
        {
          cases: {
            "@flowKeywords": "keyword.flow",
            "@typeKeywords": "type",
            "@keywords": "keyword",
            "@builtins": "support.function",
            "@default": "identifier.function"
          }
        }
      ],
      [
        /[a-z_]\w*/,
        {
          cases: {
            "@flowKeywords": "keyword.flow",
            "@typeKeywords": "type",
            "@keywords": "keyword",
            "@builtins": "support.function",
            "@default": "identifier"
          }
        }
      ],
      [/[A-Z]\w*/, "type.identifier"],
      { include: "@whitespace" },
      [/[{}()[\]]/, "@brackets"],
      [/@symbols/, { cases: { "@operators": "operator", "@default": "" } }],
      [/0x[0-9a-fA-F]+/, "number.hex"],
      [/\d+/, "number"],
      [/[;,.]/, "delimiter"],
      [/"([^"\\]|\\.)*$/, "string.invalid"],
      [/"/, { token: "string.quote", bracket: "@open", next: "@string" }],
      [/'[^\\']'/, "string"],
      [/'/, "string.invalid"]
    ],
    pragma: [
      [/[^;]+/, "string"],
      [/;/, { token: "delimiter", next: "@pop" }]
    ],
    whitespace: [
      [/[ \t\r\n]+/, ""],
      [/\/\*/, "comment", "@comment"],
      [/\/\/.*$/, "comment"]
    ],
    comment: [
      [/[^/*]+/, "comment"],
      [/\*\//, "comment", "@pop"],
      [/[/*]/, "comment"]
    ],
    string: [
      [/[^\\"]+/, "string"],
      [/@escapes/, "string.escape"],
      [/\\./, "string.escape.invalid"],
      [/"/, { token: "string.quote", bracket: "@close", next: "@pop" }]
    ]
  }
};

export interface SilverscriptDocEntry {
  signature: string;
  summary: string;
}

export const SILVERSCRIPT_DOCS: Record<string, SilverscriptDocEntry> = {
  pragma: {
    signature: "pragma silverscript ^0.1.0;",
    summary: "Pins the target SilverScript language & compiler specification for this contract."
  },
  contract: {
    signature: "contract Name(pubkey owner, ...) { ... }",
    summary: "Defines a Kaspa covenant/P2SH smart contract parameterized by immutable constructor arguments."
  },
  entry: {
    signature: "entry spend(sig ownerSig, ...) { ... }",
    summary: "Declares an external spending path (covenant entrypoint) that unlocks the contract UTXO."
  },
  require: {
    signature: "require(bool condition)",
    summary: "Aborts script validation immediately if `condition` evaluates to false."
  },
  assert: {
    signature: "assert(bool condition)",
    summary: "Alias assertion enforcing a boolean invariant inside a spending path."
  },
  checkSig: {
    signature: "checkSig(sig s, pubkey pk) -> bool",
    summary: "Verifies a Schnorr/Kaspa signature `s` against public key `pk` for the spending transaction."
  },
  checkMultiSig: {
    signature: "checkMultiSig(sig[] sigs, pubkey[] pks) -> bool",
    summary: "Verifies a m-of-n threshold signature list against ordered public keys."
  },
  checkDataSig: {
    signature: "checkDataSig(datasig s, bytes msg, pubkey pk) -> bool",
    summary: "Verifies an off-chain oracle/message signature `s` over arbitrary bytes `msg`."
  },
  sha256: {
    signature: "sha256(bytes data) -> hash256",
    summary: "Computes the 32-byte SHA-256 digest of `data`."
  },
  blake2b: {
    signature: "blake2b(bytes data) -> hash256",
    summary: "Computes the 32-byte BLAKE2b digest used natively across Kaspa."
  },
  hash160: {
    signature: "hash160(bytes data) -> hash160",
    summary: "Computes the 20-byte RIPEMD-160(SHA-256(data)) digest."
  },
  hash256: {
    signature: "hash256(bytes data) -> hash256",
    summary: "Computes double SHA-256 of `data`."
  },
  pubkey: {
    signature: "pubkey",
    summary: "32-byte Kaspa Schnorr public key (or 33-byte compressed key depending on mode)."
  },
  sig: {
    signature: "sig",
    summary: "Transaction spending signature passed into an `entry` and verified with `checkSig`."
  },
  datasig: {
    signature: "datasig",
    summary: "Arbitrary-message signature verified against `bytes` using `checkDataSig`."
  },
  sompi: {
    signature: "sompi",
    summary: "Integer Kaspa base unit (`1 KAS = 100,000,000 sompi`)."
  },
  tx: {
    signature: "tx",
    summary: "Kaspa transaction introspection namespace (`tx.inputs`, `tx.outputs`, `tx.lockTime`, `tx.version`)."
  },
  inputs: {
    signature: "tx.inputs[i].{ value, scriptPubKey, outpointTransactionHash, outpointIndex }",
    summary: "Introspects the inputs being spent by the current Kaspa transaction."
  },
  outputs: {
    signature: "tx.outputs[i].{ value, scriptPubKey }",
    summary: "Introspects outputs created by the transaction (essential for covenants and escrow)."
  },
  lockTime: {
    signature: "tx.lockTime -> int",
    summary: "Transaction nLockTime constraint (DAA score / block time depending on flag) enforced by script consensus."
  },
  scriptPubKey: {
    signature: "output.scriptPubKey -> bytes",
    summary: "Locking script bytes of an input or output UTXO; compare against `tx.outputs[i].scriptPubKey` for covenants."
  }
};

export function getSilverscriptHover(word: string): SilverscriptDocEntry | null {
  return SILVERSCRIPT_DOCS[word] ?? null;
}

export const silverscriptCompletions = [
  { label: "contract", insertText: "contract ${1:Name}(${2:pubkey owner}) {\n\t$0\n}", detail: "SilverScript contract" },
  { label: "entry", insertText: "entry ${1:name}(${2:sig s}) {\n\trequire(${3:checkSig(s, owner)});\n}", detail: "Spending path" },
  { label: "require", insertText: "require(${1:condition});", detail: "Abort unless condition holds" },
  { label: "checkSig", insertText: "checkSig(${1:s}, ${2:pubkey})", detail: "Verify a signature against a public key" },
  { label: "checkMultiSig", insertText: "checkMultiSig(${1:sigs}, ${2:pubkeys})", detail: "Verify m-of-n signatures" },
  { label: "checkDataSig", insertText: "checkDataSig(${1:s}, ${2:msg}, ${3:pubkey})", detail: "Verify an off-chain message signature" },
  { label: "blake2b", insertText: "blake2b(${1:data})", detail: "32-byte Kaspa BLAKE2b hash" },
  { label: "sha256", insertText: "sha256(${1:data})", detail: "32-byte SHA-256 hash" },
  { label: "tx.outputs", insertText: "tx.outputs[${1:0}].value >= ${2:amount}", detail: "Covenant output introspection" },
  { label: "tx.lockTime", insertText: "require(tx.lockTime >= ${1:timeout});", detail: "Timelock constraint" },
  { label: "pragma", insertText: "pragma silverscript ^0.1.0;", detail: "Language version pragma" }
];
