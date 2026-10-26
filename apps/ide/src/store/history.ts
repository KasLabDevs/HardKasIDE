import { create } from "zustand";

/** One call or transfer in the Run history: a payment, a contract deploy or a contract entry call. */
export interface HistoryItem {
  /** Stable key: the tx id (or the record hash when a record has none). */
  id: string;
  kind: "transfer" | "deploy" | "spend";
  at: string;
  title: string;
  status: string;
  txId: string;
  recordPath: string;
  networkId?: string;
  mode?: string;
  from?: string;
  to?: string;
  amountSompi?: string;
  feeSompi?: string;
  /** Transfers: what went back to the sender as change. */
  changeSompi?: string;
  /** Contracts: value locked in the contract after this step ("0" once the output was spent). */
  balanceAfterSompi?: string;
  /** "transfers" or "contract:<deploy content hash>". */
  group: string;
}

export interface HistoryTab {
  id: string; // "all" | "transfers" | "contract:<hash>"
  label: string;
}

interface HistoryState {
  items: HistoryItem[];
  tab: string;
  loading: boolean;
  error: string | null;
  setItems(items: HistoryItem[]): void;
  setTab(tab: string): void;
  setLoading(loading: boolean): void;
  setError(error: string | null): void;
}

export const useHistory = create<HistoryState>((set) => ({
  items: [],
  tab: "all",
  loading: false,
  error: null,
  setItems: (items) => set({ items }),
  setTab: (tab) => set({ tab }),
  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error })
}));
