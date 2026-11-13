import type * as Monaco from "monaco-editor";
import { hasWiredGrammar } from "./textmate";

const FLOW_KEYWORDS = [
  "as",
  "await",
  "break",
  "case",
  "catch",
  "continue",
  "default",
  "do",
  "else",
  "export",
  "finally",
  "for",
  "from",
  "if",
  "import",
  "in",
  "of",
  "return",
  "switch",
  "throw",
  "try",
  "while",
  "with",
  "yield"
];

const TS_TYPE_KEYWORDS = ["any", "bigint", "boolean", "never", "number", "object", "string", "symbol", "unknown", "void"];

const TS_DECL_KEYWORDS = [
  "abstract",
  "asserts",
  "async",
  "class",
  "const",
  "constructor",
  "debugger",
  "declare",
  "delete",
  "enum",
  "extends",
  "false",
  "function",
  "get",
  "global",
  "implements",
  "infer",
  "instanceof",
  "interface",
  "is",
  "keyof",
  "let",
  "module",
  "namespace",
  "new",
  "null",
  "out",
  "override",
  "package",
  "private",
  "protected",
  "public",
  "readonly",
  "require",
  "satisfies",
  "set",
  "static",
  "super",
  "this",
  "true",
  "type",
  "typeof",
  "undefined",
  "unique",
  "var"
];

const JS_DECL_KEYWORDS = [
  "async",
  "class",
  "const",
  "constructor",
  "debugger",
  "delete",
  "extends",
  "false",
  "function",
  "get",
  "instanceof",
  "let",
  "new",
  "null",
  "set",
  "static",
  "super",
  "symbol",
  "this",
  "true",
  "typeof",
  "undefined",
  "var",
  "void"
];

const OPERATORS = [
  "<=",
  ">=",
  "==",
  "!=",
  "===",
  "!==",
  "=>",
  "+",
  "-",
  "**",
  "*",
  "/",
  "%",
  "++",
  "--",
  "<<",
  "</",
  ">>",
  ">>>",
  "&",
  "|",
  "^",
  "!",
  "~",
  "&&",
  "||",
  "??",
  "?",
  ":",
  "=",
  "+=",
  "-=",
  "*=",
  "**=",
  "/=",
  "%=",
  "<<=",
  ">>=",
  ">>>=",
  "&=",
  "|=",
  "^=",
  "@"
];

function buildEcmaMonarch(tokenPostfix: ".ts" | ".js", keywords: string[], typeKeywords: string[]): Monaco.languages.IMonarchLanguage {
  return {
    defaultToken: "invalid",
    tokenPostfix,
    flowKeywords: FLOW_KEYWORDS,
    typeKeywords,
    keywords,
    operators: OPERATORS,
    symbols: /[=><!~?:&|+\-*/^%]+/,
    escapes: /\\(?:[abfnrtv\\"']|x[0-9A-Fa-f]{1,4}|u[0-9A-Fa-f]{4}|U[0-9A-Fa-f]{8})/,
    digits: /\d+(_+\d+)*/,
    octaldigits: /[0-7]+(_+[0-7]+)*/,
    binarydigits: /[0-1]+(_+[0-1]+)*/,
    hexdigits: /[0-9a-fA-F]+(_+[0-9a-fA-F]+)*/,
    regexpctl: /[(){}[\]$^|\-*+?.]/,
    regexpesc: /\\(?:[bBdDfnrstvwWn0\\/]|@regexpctl|c[A-Z]|x[0-9a-fA-F]{2}|u[0-9a-fA-F]{4})/,
    tokenizer: {
      root: [[/[{}]/, "delimiter.bracket"], { include: "common" }],
      common: [
        [
          /([a-z_$][\w$]*)(?=\s*\()/,
          {
            cases: {
              "@flowKeywords": "keyword.flow",
              "@typeKeywords": "type.primitive",
              "@keywords": "keyword",
              "@default": "identifier.function"
            }
          }
        ],
        [
          /#?[a-z_$][\w$]*/,
          {
            cases: {
              "@flowKeywords": "keyword.flow",
              "@typeKeywords": "type.primitive",
              "@keywords": "keyword",
              "@default": "identifier"
            }
          }
        ],
        [/[A-Z][A-Z0-9]*_[A-Z0-9_]+\b/, "variable.predefined"],
        [/[A-Z][\w$]*/, "type.identifier"],
        { include: "@whitespace" },
        [
          /\/(?=([^\\/]|\\.)+\/([dgimsuy]*)(\s*)(\.|;|,|\)|\]|\}|$))/,
          { token: "regexp", bracket: "@open", next: "@regexp" }
        ],
        [
          /(<\/)([a-z][a-zA-Z0-9-]*)(?=\s*>)/,
          ["delimiter.html", "tag"]
        ],
        [
          /(<\/)([A-Z][\w$]*)(?=\s*>)/,
          ["delimiter.html", "type.identifier"]
        ],
        [/[()[\]]/, "@brackets"],
        [/[<>](?!@symbols)/, "@brackets"],
        [/!(?=([^=]|$))/, "delimiter"],
        [/@symbols/, { cases: { "@operators": "operator", "@default": "" } }],
        [/(@digits)[eE]([+-]?(@digits))?/, "number.float"],
        [/(@digits)\.(@digits)([eE][+-]?(@digits))?/, "number.float"],
        [/0[xX](@hexdigits)n?/, "number.hex"],
        [/0[oO]?(@octaldigits)n?/, "number.octal"],
        [/0[bB](@binarydigits)n?/, "number.binary"],
        [/(@digits)n?/, "number"],
        [/[;,.]/, "delimiter"],
        [/"([^"\\]|\\.)*$/, "string.invalid"],
        [/'([^'\\]|\\.)*$/, "string.invalid"],
        [/"/, "string", "@string_double"],
        [/'/, "string", "@string_single"],
        [/`/, "string", "@string_backtick"]
      ],
      whitespace: [
        [/[ \t\r\n]+/, ""],
        [/\/\*\*(?!\/)/, "comment.doc", "@jsdoc"],
        [/\/\*/, "comment", "@comment"],
        [/\/\/.*$/, "comment"]
      ],
      comment: [
        [/[^/*]+/, "comment"],
        [/\*\//, "comment", "@pop"],
        [/[/*]/, "comment"]
      ],
      jsdoc: [
        [/[^/*]+/, "comment.doc"],
        [/\*\//, "comment.doc", "@pop"],
        [/[/*]/, "comment.doc"]
      ],
      regexp: [
        [/(\{)(\d+(?:,\d*)?)(\})/, ["regexp.escape.control", "regexp.escape.control", "regexp.escape.control"]],
        [/(\[)(\^?)(?=(?:[^\]\\/]|\\.)+)/, ["regexp.escape.control", { token: "regexp.escape.control", next: "@regexrange" }]],
        [/(\()(\?:|\?=|\?!)/, ["regexp.escape.control", "regexp.escape.control"]],
        [/[()]/, "regexp.escape.control"],
        [/@regexpctl/, "regexp.escape.control"],
        [/[^\\/]/, "regexp"],
        [/@regexpesc/, "regexp.escape"],
        [/\\\./, "regexp.invalid"],
        [/(\/)([dgimsuy]*)/, [{ token: "regexp", bracket: "@close", next: "@pop" }, "keyword"]]
      ],
      regexrange: [
        [/-/, "regexp.escape.control"],
        [/\^/, "regexp.invalid"],
        [/@regexpesc/, "regexp.escape"],
        [/[^\]]/, "regexp"],
        [/\]/, { token: "regexp.escape.control", next: "@pop", bracket: "@close" }]
      ],
      string_double: [
        [/[^\\"]+/, "string"],
        [/@escapes/, "string.escape"],
        [/\\./, "string.escape.invalid"],
        [/"/, "string", "@pop"]
      ],
      string_single: [
        [/[^\\']+/, "string"],
        [/@escapes/, "string.escape"],
        [/\\./, "string.escape.invalid"],
        [/'/, "string", "@pop"]
      ],
      string_backtick: [
        [/\$\{/, { token: "keyword", next: "@bracketCounting" }],
        [/[^\\`$]+/, "string"],
        [/@escapes/, "string.escape"],
        [/\\./, "string.escape.invalid"],
        [/`/, "string", "@pop"]
      ],
      bracketCounting: [
        [/\{/, "delimiter.bracket", "@bracketCounting"],
        [/\}/, "delimiter.bracket", "@pop"],
        { include: "common" }
      ]
    }
  };
}

const TS_MONARCH = buildEcmaMonarch(".ts", TS_DECL_KEYWORDS, TS_TYPE_KEYWORDS);
const JS_MONARCH = buildEcmaMonarch(".js", JS_DECL_KEYWORDS, []);

/** Installs VS Code Dark Modern-aligned tokenizers for TS and JS without overriding installed VSX grammars. */
export function registerVscodeMonarchLanguages(monaco: typeof Monaco): void {
  const apply = (id: "typescript" | "javascript", def: Monaco.languages.IMonarchLanguage) => {
    if (!hasWiredGrammar(id)) monaco.languages.setMonarchTokensProvider(id, def);
  };
  apply("typescript", TS_MONARCH);
  apply("javascript", JS_MONARCH);
  monaco.languages.onLanguage("typescript", () => apply("typescript", TS_MONARCH));
  monaco.languages.onLanguage("javascript", () => apply("javascript", JS_MONARCH));
}
