import { describe, expect, it } from "vitest";
import { SEARCH_DEFAULT_MAX_WIDTH, SEARCH_SIDE_GAP, computeSearchBarFrame } from "./titleBarLayout";

describe("computeSearchBarFrame", () => {
  it("centers over the main editor area when only the left sidebar is open", () => {
    const frame = computeSearchBarFrame({
      header: { left: 0, width: 1920 },
      left: { left: 0, width: 410 },
      right: { left: 1920, width: 0 },
      main: { left: 454, width: 1466 } // center = 1187
    });

    expect(frame.width).toBe(SEARCH_DEFAULT_MAX_WIDTH);
    expect(frame.left + frame.width / 2).toBeCloseTo(1187, 1);
  });

  it("shifts dynamically when the right panel opens or Explorer resizes", () => {
    const withOutline = computeSearchBarFrame({
      header: { left: 0, width: 1920 },
      left: { left: 0, width: 410 },
      right: { left: 1840, width: 80 },
      main: { left: 454, width: 1090 } // center = 999
    });
    expect(withOutline.left + withOutline.width / 2).toBeCloseTo(999, 1);

    const widerSidebar = computeSearchBarFrame({
      header: { left: 0, width: 1920 },
      left: { left: 0, width: 410 },
      right: { left: 1840, width: 80 },
      main: { left: 680, width: 864 } // center = 1112
    });
    expect(widerSidebar.left + widerSidebar.width / 2).toBeCloseTo(1112, 1);
    expect(widerSidebar.left).toBeGreaterThan(withOutline.left);
  });

  it("clamps strictly between menu bar and right controls without overlap on narrow viewports", () => {
    const frame = computeSearchBarFrame({
      header: { left: 0, width: 900 },
      left: { left: 0, width: 410 },
      right: { left: 810, width: 90 }, // Update button + padding
      main: { left: 40, width: 620 } // center = 350 (would collide with menu)
    });

    expect(frame.left).toBe(410 + SEARCH_SIDE_GAP);
    expect(frame.left + frame.width).toBeLessThanOrEqual(810 - SEARCH_SIDE_GAP);
    expect(frame.width).toBe(810 - SEARCH_SIDE_GAP - (410 + SEARCH_SIDE_GAP));
  });

  it("falls back to header center when main area is unavailable and handles non-zero header offset", () => {
    const frame = computeSearchBarFrame({
      header: { left: 100, width: 1280 },
      left: { left: 100, width: 390 },
      right: { left: 1380, width: 0 },
      main: null
    });

    expect(frame.width).toBe(SEARCH_DEFAULT_MAX_WIDTH);
    expect(frame.left + frame.width / 2).toBeCloseTo(640, 1);
  });

  it("collapses width cleanly to 0 when controls leave no horizontal room", () => {
    const frame = computeSearchBarFrame({
      header: { left: 0, width: 420 },
      left: { left: 0, width: 410 },
      right: { left: 415, width: 5 },
      main: { left: 40, width: 380 }
    });

    expect(frame.width).toBe(0);
    expect(frame.left).toBeGreaterThanOrEqual(410 + SEARCH_SIDE_GAP);
  });
});
