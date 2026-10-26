import { Database } from "lucide-react";
import { Plugin } from "@/engine/engine";
import { useIde } from "@/store/ide";
import { useIndex, type IndexTab, type StoreHealth } from "@/store/indexStore";
import { storeGet } from "@/utils/storeApi";
import { IndexView } from "@/views/IndexView";
import type { ConsolePlugin } from "./console";

/**
 * Index: a visual window onto HardKAS's SQLite query store (.hardkas/store.db). The store is read straight from the
 * database, read-only; building it (sync, rebuild) and checking it (verify, doctor) go through the HardKAS CLI.
 */
export class IndexPlugin extends Plugin {
  view = IndexView;
  private offs: Array<() => void> = [];

  constructor() {
    super({
      name: "queryIndex",
      displayName: "Index",
      description: "Browse artifacts, events and transactions HardKAS has indexed, and query them with SQL",
      location: "mainPanel",
      icon: Database,
      order: 55,
      methods: ["open", "refresh", "showArtifact", "showTx", "sync", "rebuild", "doctor", "verify", "query"],
      events: ["updated"]
    });
  }

  onActivation(): void {
    // New artifacts make the index stale: re-read the health so the banner is right.
    const again = () => void this.refresh();
    this.offs.push(this.on("deployRun", "transactionExecuted", again), this.on("silverContracts", "deploymentsChanged", again));
  }

  onDeactivation(): void {
    for (const off of this.offs) off();
    this.offs = [];
    useIndex.getState().set({ health: null, selectedId: null, txId: "", actionMessage: null });
  }

  private console(): ConsolePlugin {
    return this.engine.get<ConsolePlugin>("console");
  }

  open(tab?: IndexTab): void {
    if (tab) useIndex.getState().set({ tab });
    useIde.getState().openView(this.profile.name, "Index");
    void this.refresh();
  }

  showArtifact(id: string): void {
    useIndex.getState().set({ tab: "artifacts", selectedId: id });
    this.open();
  }

  showTx(txId: string): void {
    useIndex.getState().set({ tab: "transactions", txId });
    this.open();
  }

  async refresh(): Promise<void> {
    const s = useIndex.getState();
    s.set({ loading: true });
    try {
      const health = await storeGet<StoreHealth & { ok: boolean }>("health");
      useIndex.getState().set({ health, healthError: null });
      this.emit("updated");
    } catch (e) {
      useIndex.getState().set({ healthError: e instanceof Error ? e.message : String(e), health: null });
    } finally {
      useIndex.getState().set({ loading: false });
    }
  }

  /** Runs a HardKAS maintenance command with a visible "busy" state, then re-reads the health. */
  private async maintain(label: string, args: string[], done: (result: unknown) => string, options: { quiet?: boolean; failure?: string } = {}): Promise<void> {
    const s = useIndex.getState();
    if (s.busyAction) return;
    s.set({ busyAction: label, actionMessage: null });
    try {
      const run = await this.console().runHardkas(args, { quiet: options.quiet ?? true });
      const message = run.status === "succeeded" ? done(run.result) : options.failure ?? `${label} failed${(run.result as { message?: string } | null)?.message ? `: ${(run.result as { message: string }).message}` : ` (exit code ${run.exitCode})`}`;
      useIndex.getState().set({ actionMessage: message });
      this.console().info(`Index: ${message}`);
    } catch (e) {
      useIndex.getState().set({ actionMessage: e instanceof Error ? e.message : String(e) });
    } finally {
      useIndex.getState().set({ busyAction: null });
      await this.refresh();
    }
  }

  sync(): Promise<void> {
    return this.maintain("Sync", ["query", "store", "sync", "--json"], () => "Synced: new artifacts and events are in the index.");
  }

  rebuild(): Promise<void> {
    return this.maintain("Rebuild", ["query", "store", "rebuild", "--json"], () => "Rebuilt the index from the artifacts on disk.");
  }

  doctor(): Promise<void> {
    // Its answer is plain text, so it is shown in the Console rather than parsed.
    useIde.getState().setTerminalOpen(true);
    return this.maintain("Doctor", ["query", "store", "doctor"], () => "Doctor says the store is healthy.", { quiet: false, failure: "Doctor reported issues: its explanation is in the Console. If the store is current, they are usually artifacts that fail verification (see the Problems tab)." });
  }

  /** `hardkas verify` over every artifact: hash, schema and lineage checks. Returns the raw document for the Problems tab. */
  async verify(): Promise<unknown> {
    const run = await this.console().runHardkas(["verify", "--json"], { quiet: true });
    return run.result;
  }

  /** Any other quiet CLI query the Problems tab needs. */
  async query(args: string[]): Promise<unknown> {
    const run = await this.console().runHardkas(args, { quiet: true });
    return run.result;
  }
}
