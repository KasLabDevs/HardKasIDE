import { describe, expect, it } from "vitest";
import { activeSymbolTrail, collectBreadcrumbTreeSegments, extractDocumentSymbols } from "./symbols";

const SAMPLE_SIL = `pragma silverscript ^0.1.0;

contract TiendaEscrow(pubkey merchant, pubkey buyer, int orderId) {
  entry release(sig merchantSig) {
    require(checkSig(merchantSig, merchant));
  }

  entry refund(sig buyerSig) {
    require(checkSig(buyerSig, buyer));
  }
}
`;

describe("extractDocumentSymbols", () => {
  it("extracts SilverScript contract and entry hierarchy with parameter & require details", () => {
    const syms = extractDocumentSymbols("contracts/tienda.sil", SAMPLE_SIL);
    expect(syms.map((s) => `${s.kind}:${s.name}@${s.line}-${s.endLine}`)).toEqual([
      "contract:TiendaEscrow@3-11",
      "entry:release@4-6",
      "entry:refund@8-10"
    ]);
    expect(syms[0].detail).toBe("(pubkey merchant, pubkey buyer, int orderId)");
    expect(syms[1].detail).toBe("(sig merchantSig) · 1 require");
    expect(syms[1].parentId).toBe(syms[0].id);
  });

  it("extracts TypeScript functions, interfaces, exports, and nested describe/it tests", () => {
    const ts = `export interface PaymentConfig { amount: number; }
export const MIN_FEE = 1000;
export async function submitPayment() {}
describe("escrow", () => {
  it("releases funds", () => {});
});
`;
    const syms = extractDocumentSymbols("test/payment.test.ts", ts);
    expect(syms.map((s) => `${s.kind}:${s.name}`)).toEqual([
      "interface:PaymentConfig",
      "const:MIN_FEE",
      "function:submitPayment",
      "test:escrow",
      "test:releases funds"
    ]);
    expect(syms[4].parentId).toBe(syms[3].id);
  });

  it("ignores fenced headings in Markdown and extracts only top-level keys in JSON", () => {
    const md = `# Overview\n\`\`\`sh\n# not a heading\n\`\`\`\n## Setup\n`;
    expect(extractDocumentSymbols("README.md", md).map((s) => s.name)).toEqual(["Overview", "Setup"]);

    const json = `{\n  "name": "demo",\n  "scripts": {\n    "dev": "vite"\n  },\n  "version": "1.0.0"\n}\n`;
    expect(extractDocumentSymbols("package.json", json).map((s) => s.name)).toEqual(["name", "scripts", "version"]);
  });
});

describe("activeSymbolTrail", () => {
  it("tracks the enclosing SilverScript contract and active entry for a cursor line", () => {
    const syms = extractDocumentSymbols("contracts/tienda.sil", SAMPLE_SIL);
    expect(activeSymbolTrail(syms, 1)).toEqual([]);
    expect(activeSymbolTrail(syms, 3).map((s) => s.name)).toEqual(["TiendaEscrow"]);
    expect(activeSymbolTrail(syms, 5).map((s) => s.name)).toEqual(["TiendaEscrow", "release"]);
    expect(activeSymbolTrail(syms, 9).map((s) => s.name)).toEqual(["TiendaEscrow", "refund"]);
  });
});

describe("collectBreadcrumbTreeSegments", () => {
  it("collects parent folders and file siblings from the explorer tree", () => {
    const tree = [
      {
        name: "contracts",
        path: "contracts",
        type: "dir" as const,
        children: [
          { name: "tienda.sil", path: "contracts/tienda.sil", type: "file" as const },
          { name: "escrow.sil", path: "contracts/escrow.sil", type: "file" as const }
        ]
      },
      { name: "package.json", path: "package.json", type: "file" as const }
    ];

    const res = collectBreadcrumbTreeSegments(tree, "contracts/tienda.sil");
    expect(res.folders.map((f) => f.dirPath)).toEqual(["contracts"]);
    expect(res.fileSiblings.map((n) => n.path)).toEqual(["contracts/tienda.sil", "contracts/escrow.sil"]);
  });
});
