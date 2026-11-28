import { describe, expect, it } from "vitest";
import { hardkasNote, hiddenNote } from "./hardkasNotes";

describe("hardkasNote", () => {
  it("names the artifact folders by what they hold", () => {
    expect(hardkasNote(".hardkas/artifacts/plans")?.label).toBe("planned, unsigned");
    expect(hardkasNote(".hardkas/artifacts/signed")?.label).toBe("signed");
    expect(hardkasNote(".hardkas/artifacts/receipts")?.label).toBe("node answers");
    expect(hardkasNote(".hardkas")?.label).toBe("HardKas state");
  });

  it("reads the same layout in a project inside a folder, and Windows separators", () => {
    expect(hardkasNote("apps/dapp/.hardkas/artifacts/silver")?.label).toBe("contracts");
    expect(hardkasNote(".hardkas\\locks\\")?.label).toBe("locks");
  });

  it("gives key stores the key note, and nothing for unknown paths", () => {
    expect(hardkasNote(".hardkas/dev-accounts", true)?.label).toBe("keys");
    expect(hardkasNote(".hardkas/dev-server-token", true)?.label).toBe("token");
    expect(hardkasNote("config/my.keystore.json", true)?.detail).toMatch(/never opens it/);
    expect(hardkasNote("contracts")).toBeNull();
    expect(hardkasNote(".hardkas/artifacts/plans/txPlan-1.json")).toBeNull();
  });
});

describe("hiddenNote", () => {
  it("says why node_modules is read on demand", () => {
    expect(hiddenNote("node_modules")).toMatch(/on demand/);
    expect(hiddenNote("dist")).toBe("Build output.");
  });
});
