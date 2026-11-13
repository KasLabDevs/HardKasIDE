import { beforeEach, describe, expect, it, vi } from "vitest";
import { api, type UpdateReport } from "@/api/client";
import { hasPendingUpdate, updateVersionKey, useUpdates } from "./updates";

function makeReport(overrides?: { ideUpdate?: boolean; cliUpdate?: boolean; cliTarget?: string }): UpdateReport {
  return {
    checkedAt: "2026-11-13T00:00:00.000Z",
    ide: {
      currentVersion: "0.2.0",
      latestVersion: overrides?.ideUpdate ? "0.3.0" : "0.2.0",
      hasUpdate: Boolean(overrides?.ideUpdate),
      releaseName: overrides?.ideUpdate ? "HardKas IDE v0.3.0" : "HardKas IDE v0.2.0",
      releaseUrl: "https://github.com/KasLabDevs/HardKasIDE/releases",
      downloadUrl: overrides?.ideUpdate ? "https://github.com/KasLabDevs/HardKasIDE/releases/download/v0.3.0/HardKas-IDE-setup.exe" : null,
      publishedAt: "2026-11-13T00:00:00.000Z",
      notes: null,
      error: null
    },
    cli: {
      runtimeVersion: "0.13.0-rc.1",
      runtimeSource: "project",
      projectVersion: overrides?.cliUpdate ? "0.12.0-rc.27" : "0.13.0-rc.1",
      pinnedVersion: "0.13.0-rc.1",
      npmLatest: "0.13.0-rc.1",
      npmNext: null,
      targetVersion: overrides?.cliTarget ?? "0.13.0-rc.1",
      hasUpdate: Boolean(overrides?.cliUpdate),
      reason: overrides?.cliUpdate ? "project-behind" : null,
      updateCommand: `pnpm add -D @hardkas/cli@${overrides?.cliTarget ?? "0.13.0-rc.1"}`,
      error: null
    }
  };
}

describe("useUpdates store and update visibility logic", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useUpdates.setState({
      report: null,
      checking: false,
      error: null,
      popoverOpen: false,
      dismissedKey: null
    });
  });

  it("hides pending flag when both IDE and CLI are up to date", () => {
    const report = makeReport({ ideUpdate: false, cliUpdate: false });
    expect(updateVersionKey(report)).toBeNull();
    expect(hasPendingUpdate(report, null)).toBe(false);
  });

  it("activates pending flag when an IDE update or workspace CLI update is detected and supports dismissing only that version", () => {
    const cliReport = makeReport({ ideUpdate: false, cliUpdate: true });
    const cliKey = updateVersionKey(cliReport);
    expect(cliKey).toBe("|cli:0.13.0-rc.1:project-behind");
    expect(hasPendingUpdate(cliReport, null)).toBe(true);

    useUpdates.setState({ report: cliReport, popoverOpen: true });
    useUpdates.getState().dismissCurrent();
    expect(useUpdates.getState().popoverOpen).toBe(false);
    expect(hasPendingUpdate(cliReport, useUpdates.getState().dismissedKey)).toBe(false);

    // If a new IDE release arrives later, the new composite key re-enables the Update button.
    const bothReport = makeReport({ ideUpdate: true, cliUpdate: true });
    expect(hasPendingUpdate(bothReport, useUpdates.getState().dismissedKey)).toBe(true);
  });

  it("deduplicates concurrent non-forced checks, clears dismissal on force check, and handles errors gracefully", async () => {
    const report = makeReport({ ideUpdate: true, cliUpdate: false });
    const spy = vi.spyOn(api, "updates").mockResolvedValue(report);

    useUpdates.setState({ dismissedKey: "ide:0.3.0|" });
    const [r1, r2] = await Promise.all([useUpdates.getState().check(false), useUpdates.getState().check(false)]);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(r1).toEqual(report);
    expect(r2).toEqual(report);
    expect(useUpdates.getState().checking).toBe(false);

    // Forced check clears prior dismissal so manual Check for Updates surfaces active notices.
    await useUpdates.getState().check(true);
    expect(spy).toHaveBeenCalledTimes(2);
    expect(useUpdates.getState().dismissedKey).toBeNull();

    // Errors are captured cleanly without throwing.
    spy.mockRejectedValueOnce(new Error("server unavailable"));
    const failed = await useUpdates.getState().check(true);
    expect(failed).toBeNull();
    expect(useUpdates.getState().checking).toBe(false);
    expect(useUpdates.getState().error).toBe("server unavailable");
  });
});
