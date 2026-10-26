import { History as HistoryIcon } from "lucide-react";
import { api } from "@/api/client";
import { Plugin } from "@/engine/engine";
import { useHistory, type HistoryItem } from "@/store/history";
import { useIde } from "@/store/ide";
import { useSilver } from "@/store/silver";
import { HistoryView } from "@/views/HistoryView";

/**
 * Run history: every payment, contract deploy and contract entry call of the project in one place,
 * with tabs per contract. It reads the artifacts HardKas already saves (receipts, submissions, plans and the
 * SilverScript deploy/spend records), so nothing is stored twice and it also shows what earlier sessions did.
 */
export class HistoryPlugin extends Plugin {
  view = HistoryView;
  private offs: Array<() => void> = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  /** Artifacts are content-addressed (immutable): parse each file once. */
  private cache = new Map<string, HistoryItem | null>();

  constructor() {
    super({
      name: "runHistory",
      displayName: "Run history",
      description: "Payments, deploys and contract calls with their balances",
      location: "mainPanel",
      icon: HistoryIcon,
      order: 40,
      methods: ["open", "refresh", "show"],
      events: ["updated"]
    });
  }

  onActivation(): void {
    const again = () => this.schedule(500);
    this.offs.push(
      this.on("deployRun", "transactionExecuted", again),
      this.on("silverContracts", "deploymentsChanged", again),
      this.on("silverContracts", "deployed", again),
      this.on("silverContracts", "spent", again)
    );
    void this.refresh();
  }

  onDeactivation(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    for (const off of this.offs) off();
    this.offs = [];
    this.cache.clear();
  }

  open(): void {
    useIde.getState().openView(this.profile.name, "Run history");
    void this.refresh();
  }

  /** Opens the history on one tab ("transfers", or "contract:<deploy content hash>"). */
  show(tab: string): void {
    useHistory.getState().setTab(tab);
    this.open();
  }

  private schedule(ms: number): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.refresh(), ms);
  }

  async refresh(): Promise<void> {
    const store = useHistory.getState();
    store.setLoading(true);
    try {
      const files = await api.fs.find(".hardkas/artifacts/receipts", ".json");
      const transfers = (await Promise.all(files.map((f) => this.readTransfer(f)))).filter((x): x is HistoryItem => x !== null);

      const { deployments, spends } = useSilver.getState();
      const contractItems: HistoryItem[] = [];
      for (const d of deployments) {
        contractItems.push({
          id: `deploy:${d.contentHash}`,
          kind: "deploy",
          at: d.createdAt ?? "",
          title: `Deploy ${d.contract}`,
          status: d.status,
          txId: d.txId,
          recordPath: d.recordPath,
          networkId: d.networkId,
          mode: "localnet",
          to: d.address,
          amountSompi: d.valueSompi,
          feeSompi: d.feeSompi,
          balanceAfterSompi: d.valueSompi,
          group: `contract:${d.contentHash}`
        });
      }
      for (const s of spends) {
        if (!s.deployContentHash) continue;
        contractItems.push({
          id: `spend:${s.txId}`,
          kind: "spend",
          at: s.createdAt ?? "",
          title: `${s.contract}.${s.entry}`,
          status: s.status,
          txId: s.txId,
          recordPath: s.recordPath,
          to: s.to,
          amountSompi: s.outputSompi,
          feeSompi: s.feeSompi,
          // The contract holds a single output and a spend moves all of it.
          balanceAfterSompi: "0",
          group: `contract:${s.deployContentHash}`
        });
      }

      const items = [...transfers, ...contractItems].sort((a, b) => b.at.localeCompare(a.at));
      store.setItems(items);
      store.setError(null);
      this.emit("updated");
    } catch (e) {
      store.setError(e instanceof Error ? e.message : String(e));
    } finally {
      store.setLoading(false);
    }
  }

  private async readTransfer(path: string): Promise<HistoryItem | null> {
    if (this.cache.has(path)) return this.cache.get(path) ?? null;
    let item: HistoryItem | null = null;
    try {
      const r = JSON.parse(await api.fs.read(path)) as Record<string, unknown>;
      const schema = String(r.schema ?? "");
      const txId = String(r.txId ?? (r.submitResult as { transactionId?: string } | undefined)?.transactionId ?? "");
      if (schema.includes("txReceipt")) {
        item = {
          id: `tx:${txId || path}`,
          kind: "transfer",
          at: String(r.createdAt ?? ""),
          title: "Payment",
          status: String(r.status ?? "unknown"),
          txId,
          recordPath: path,
          networkId: str(r.networkId),
          mode: str(r.mode),
          from: (r.from as { address?: string } | undefined)?.address,
          to: (r.to as { address?: string } | undefined)?.address,
          amountSompi: str(r.amountSompi),
          feeSompi: str(r.feeSompi),
          changeSompi: str(r.changeSompi),
          group: "transfers"
        };
      } else if (schema.includes("txSubmission")) {
        const fee = r.fee as { feeSompi?: string; planArtifactId?: string; outputsSompi?: string } | undefined;
        const submit = r.submitResult as { accepted?: boolean; error?: string } | undefined;
        const planId = fee?.planArtifactId ?? (r.lineage as { rootArtifactId?: string } | undefined)?.rootArtifactId;
        const plan = planId ? await this.readPlan(planId) : null;
        item = {
          id: `tx:${txId || path}`,
          kind: "transfer",
          at: String(r.submittedAt ?? r.createdAt ?? ""),
          title: "Payment",
          status: submit ? (submit.accepted ? "accepted" : `rejected${submit.error ? `: ${submit.error}` : ""}`) : "unknown",
          txId,
          recordPath: path,
          networkId: str(r.networkId),
          mode: str(r.mode),
          from: plan?.from,
          to: plan?.to,
          amountSompi: plan?.amountSompi,
          feeSompi: fee?.feeSompi,
          group: "transfers"
        };
      }
    } catch {
      item = null;
    }
    this.cache.set(path, item);
    return item;
  }

  private async readPlan(artifactId: string): Promise<{ from?: string; to?: string; amountSompi?: string } | null> {
    try {
      const p = JSON.parse(await api.fs.read(`.hardkas/artifacts/plans/txPlan-${artifactId}.json`)) as Record<string, unknown>;
      return { from: (p.from as { address?: string } | undefined)?.address, to: (p.to as { address?: string } | undefined)?.address, amountSompi: str(p.amountSompi) };
    } catch {
      return null;
    }
  }
}

const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
