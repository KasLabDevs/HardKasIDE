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
  keywords: [
    "pragma",
    "silverscript",
    "contract",
    "entry",
    "function",
    "require",
    "if",
    "else",
    "return",
    "true",
    "false",
    "covenant",
    "transition",
    "state",
    "const",
    "let",
    "import",
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
      [/pragma\b/, { token: "keyword", next: "@pragma" }],
      [/[a-zA-Z_]\w*/, { cases: { "@typeKeywords": "type", "@keywords": "keyword", "@builtins": "support.function", "@default": "identifier" } }],
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

export const silverscriptCompletions = [
  { label: "contract", insertText: "contract ${1:Name}(${2:pubkey owner}) {\n\t$0\n}", detail: "SilverScript contract" },
  { label: "entry", insertText: "entry ${1:name}(${2:sig s}) {\n\trequire(${3:checkSig(s, owner)});\n}", detail: "Spending path" },
  { label: "require", insertText: "require(${1:condition});", detail: "Abort unless condition holds" },
  { label: "checkSig", insertText: "checkSig(${1:s}, ${2:pubkey})", detail: "Verify a signature against a public key" },
  { label: "pragma", insertText: "pragma silverscript ^0.1.0;", detail: "Language version pragma" }
];
