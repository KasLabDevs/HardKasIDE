import { create } from "zustand";
import { api, type UpdateReport } from "@/api/client";

const DISMISSED_KEY = "hardkas.ide.dismissedUpdate";

function readDismissed(): string | null {
  try {
    return typeof window !== "undefined" ? window.localStorage.getItem(DISMISSED_KEY) : null;
  } catch {
    return null;
  }
}

function writeDismissed(value: string | null): void {
  try {
    if (typeof window === "undefined") return;
    if (value === null) window.localStorage.removeItem(DISMISSED_KEY);
    else window.localStorage.setItem(DISMISSED_KEY, value);
  } catch {
    // ignore storage quota/security errors
  }
}

/** Stable identifier for the pending update(s) in a report so "Remind me later" hides only this exact notice. */
export function updateVersionKey(report: UpdateReport | null): string | null {
  if (!report) return null;
  const idePart = report.ide.hasUpdate ? `ide:${report.ide.latestVersion ?? ""}` : "";
  const cliPart = report.cli.hasUpdate ? `cli:${report.cli.targetVersion}:${report.cli.reason ?? ""}` : "";
  if (!idePart && !cliPart) return null;
  return `${idePart}|${cliPart}`;
}

export function hasPendingUpdate(report: UpdateReport | null, dismissedKey: string | null): boolean {
  const key = updateVersionKey(report);
  return key !== null && key !== dismissedKey;
}

interface UpdatesState {
  report: UpdateReport | null;
  checking: boolean;
  error: string | null;
  popoverOpen: boolean;
  dismissedKey: string | null;
  check(force?: boolean): Promise<UpdateReport | null>;
  openPopover(): void;
  closePopover(): void;
  togglePopover(): void;
  dismissCurrent(): void;
  clearDismissed(): void;
}

let inFlight: Promise<UpdateReport | null> | null = null;

export const useUpdates = create<UpdatesState>((set, get) => ({
  report: null,
  checking: false,
  error: null,
  popoverOpen: false,
  dismissedKey: readDismissed(),

  check: async (force = false) => {
    if (inFlight && !force) return inFlight;
    if (force) {
      get().clearDismissed();
    }
    set({ checking: true, error: null });
    const run = api
      .updates(force)
      .then((report) => {
        set({ report, checking: false, error: null });
        return report;
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        set({ checking: false, error: message });
        return null;
      })
      .finally(() => {
        if (inFlight === run) inFlight = null;
      });
    inFlight = run;
    return run;
  },

  openPopover: () => set({ popoverOpen: true }),
  closePopover: () => set({ popoverOpen: false }),
  togglePopover: () => set((s) => ({ popoverOpen: !s.popoverOpen })),

  dismissCurrent: () => {
    const key = updateVersionKey(get().report);
    if (!key) {
      set({ popoverOpen: false });
      return;
    }
    writeDismissed(key);
    set({ dismissedKey: key, popoverOpen: false });
  },

  clearDismissed: () => {
    writeDismissed(null);
    set({ dismissedKey: null });
  }
}));
