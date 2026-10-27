import { create } from "zustand";

/**
 * In-app dialogs. The IDE is a desktop app: the browser's own confirm/prompt boxes ("localhost:5173 dice…") must never
 * show. These return promises, so `if (!confirm(x)) return` becomes `if (!(await confirmDialog(x))) return`.
 */

export interface DialogOptions {
  title?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Red confirm button for destructive actions (delete, reset, discard). */
  danger?: boolean;
}

interface DialogRequest extends DialogOptions {
  id: number;
  kind: "confirm" | "prompt";
  message: string;
  defaultValue?: string;
  resolve: (value: boolean | string | null) => void;
}

interface DialogState {
  queue: DialogRequest[];
  push: (r: DialogRequest) => void;
  settle: (id: number, value: boolean | string | null) => void;
}

let nextId = 1;

export const useDialogs = create<DialogState>((set, get) => ({
  queue: [],
  push: (r) => set((s) => ({ queue: [...s.queue, r] })),
  settle: (id, value) => {
    const r = get().queue.find((q) => q.id === id);
    set((s) => ({ queue: s.queue.filter((q) => q.id !== id) }));
    r?.resolve(value);
  }
}));

export function confirmDialog(message: string, options: DialogOptions = {}): Promise<boolean> {
  return new Promise((resolve) => {
    useDialogs.getState().push({ id: nextId++, kind: "confirm", message, ...options, resolve: (v) => resolve(v === true) });
  });
}

/** Resolves with the entered text, or null when cancelled. */
export function promptDialog(message: string, defaultValue = "", options: DialogOptions = {}): Promise<string | null> {
  return new Promise((resolve) => {
    useDialogs.getState().push({ id: nextId++, kind: "prompt", message, defaultValue, ...options, resolve: (v) => resolve(typeof v === "string" ? v : null) });
  });
}
