import { create } from "zustand";
import type { SilverDebugView } from "@/api/client";

/** The SilverScript debugger session as the server last reported it (the editor marks its line from here). */
interface SilverDebugState {
  view: SilverDebugView | null;
  set: (view: SilverDebugView | null) => void;
}

export const useSilverDebug = create<SilverDebugState>((set) => ({
  view: null,
  set: (view) => set({ view })
}));

/** The line to mark in `file`, while a session is stopped on it. */
export function silverDebugLine(view: SilverDebugView | null, file: string | null): number | null {
  if (!view || !file || view.file !== file || view.line === null) return null;
  return view.state === "paused" || view.state === "failed" ? view.line : null;
}
