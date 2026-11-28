import { describe, expect, it } from "vitest";
import {
  STARTER_CONTRACTS,
  filterBlueprints,
  joinPath,
  nextWizardStep,
  prevWizardStep
} from "./newProjectWizard";

describe("newProjectWizard helpers", () => {
  it("filters blueprints case-insensitively across name, badge, class and description", () => {
    expect(filterBlueprints("")).toHaveLength(STARTER_CONTRACTS.length);
    expect(filterBlueprints("escrow").map((b) => b.id)).toEqual(["covenant-escrow"]);
    expect(filterBlueprints("1:N").map((b) => b.id)).toEqual(["covenant-1-n"]);
    expect(filterBlueprints("PaymentSplitter").map((b) => b.id)).toEqual(["covenant-1-n"]);
    expect(filterBlueprints("minimal").map((b) => b.id)).toEqual(["none"]);
  });

  it("navigates across steps 1 -> 2 -> 3 and skips step 2 in minimal mode", () => {
    expect(nextWizardStep(1, false)).toBe(2);
    expect(nextWizardStep(2, false)).toBe(3);
    expect(nextWizardStep(3, false)).toBe(3);

    expect(nextWizardStep(1, true)).toBe(3);
    expect(prevWizardStep(3, true)).toBe(1);
    expect(prevWizardStep(3, false)).toBe(2);
    expect(prevWizardStep(2, false)).toBe(1);
  });

  it("preserves Windows backslash or POSIX forward slash when joining paths", () => {
    expect(joinPath("C:\\Users\\jrodr\\hardkas-projects\\", "my-app")).toBe("C:\\Users\\jrodr\\hardkas-projects\\my-app");
    expect(joinPath("/home/user/projects/", "my-app")).toBe("/home/user/projects/my-app");
  });
});
