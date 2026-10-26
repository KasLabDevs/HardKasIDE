import { create } from "zustand";

/** Test debugger state: breakpoints (persisted per project), the session and what the debuggee is showing. */

export type DebugRunState = "idle" | "starting" | "running" | "paused" | "finished" | "error";

export interface DebugFrame {
  id: string;
  name: string;
  file: string | null;
  url: string;
  line: number;
  column: number;
  scopes: Array<{ type: string; name?: string; objectId?: string }>;
}

export interface DebugVariable {
  name: string;
  value: string;
  type: string;
  objectId?: string;
}

export interface BreakpointStatus {
  verified: boolean;
  /** The line the debugger really stops on (a click on a blank line moves to the next code line). */
  actual?: number;
}

export interface OutputLine {
  stream: "stdout" | "stderr" | "debug";
  text: string;
}

export interface WatchResult {
  value: string;
  type: string;
  error?: string;
  objectId?: string;
}

interface DebugStore {
  /** project-relative file → breakpoint lines (1-based) */
  breakpoints: Record<string, number[]>;
  /** what the debugger said about each breakpoint during the last session */
  status: Record<string, Record<number, BreakpointStatus>>;
  state: DebugRunState;
  message: string;
  reason: string;
  /** Extra text for the stop, e.g. the exception message. */
  detail: string;
  frames: DebugFrame[];
  frame: number;
  /** objectId → its properties, valid while paused */
  vars: Record<string, DebugVariable[]>;
  watches: string[];
  watchResults: Record<string, WatchResult>;
  pauseOnExceptions: "none" | "uncaught" | "all";
  output: OutputLine[];
  /** what the session was started for, to offer "restart" */
  target: { file?: string; testName?: string } | null;
  set(p: Partial<Omit<DebugStore, "set">>): void;
}

export const useDebug = create<DebugStore>((set) => ({
  breakpoints: {},
  status: {},
  state: "idle",
  message: "",
  reason: "",
  detail: "",
  frames: [],
  frame: 0,
  vars: {},
  watches: [],
  watchResults: {},
  pauseOnExceptions: "none",
  output: [],
  target: null,
  set: (p) => set(p)
}));

/** Where the debuggee is stopped, for the editor to highlight. */
export function currentLocation(s: Pick<DebugStore, "state" | "frames" | "frame">): { file: string; line: number } | null {
  if (s.state !== "paused") return null;
  const f = s.frames[s.frame];
  return f?.file ? { file: f.file, line: f.line } : null;
}
