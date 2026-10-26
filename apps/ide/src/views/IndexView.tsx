import clsx from "clsx";
import { RefreshCw } from "lucide-react";
import { useEffect } from "react";
import { useEngine } from "@/engine/context";
import type { IndexPlugin } from "@/plugins/indexView";
import { useIndex, type IndexTab } from "@/store/indexStore";
import { ArtifactsTab } from "./index/ArtifactsTab";
import { OverviewTab } from "./index/OverviewTab";
import { ProblemsTab } from "./index/ProblemsTab";
import { SqlTab } from "./index/SqlTab";
import { TransactionsTab } from "./index/TransactionsTab";

const TABS: Array<[IndexTab, string]> = [
  ["overview", "Overview"],
  ["artifacts", "Artifacts"],
  ["transactions", "Transactions"],
  ["sql", "SQL"],
  ["problems", "Problems"]
];

/** HardKAS's query store, made visible: health, a browsable artifact table, transactions, SQL and integrity checks. */
export function IndexView() {
  const engine = useEngine();
  const plugin = engine.get<IndexPlugin>("queryIndex");
  const tab = useIndex((s) => s.tab);
  const set = useIndex((s) => s.set);
  const loading = useIndex((s) => s.loading);
  const health = useIndex((s) => s.health);

  useEffect(() => {
    void plugin.refresh();
  }, [plugin]);

  const needsStore = health && !health.exists;

  return (
    <div className="h-full flex flex-col min-w-0 text-xs">
      <div role="tablist" aria-label="Index sections" className="shrink-0 flex items-stretch border-b border-border bg-bg-panel">
        {TABS.map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            onClick={() => set({ tab: id })}
            className={clsx("px-4 h-9 cursor-pointer border-r border-border outline-none focus-visible:ring-1 focus-visible:ring-accent", tab === id ? "bg-bg text-fg border-b-2 border-b-accent" : "text-fg-muted hover:text-fg hover:bg-bg-hover")}
          >
            {label}
          </button>
        ))}
        <span className="ml-auto flex items-center gap-3 pr-3 text-fg-muted tabular-nums">
          {health?.exists && health.stale && <span className="text-warn">behind the files on disk</span>}
          <button type="button" aria-label="Refresh the index view" title="Refresh" className="p-1 rounded hover:text-fg hover:bg-bg-hover cursor-pointer" onClick={() => void plugin.refresh()}>
            <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
          </button>
        </span>
      </div>
      <div className="flex-1 min-h-0 overflow-auto">
        {tab === "overview" && <OverviewTab />}
        {tab !== "overview" && needsStore && (
          <div className="p-6 text-fg-muted max-w-lg space-y-2">
            <p>There is no index yet, so there is nothing to browse. Build it from the Overview tab first.</p>
            <button type="button" className="btn-primary" onClick={() => set({ tab: "overview" })}>
              Go to Overview
            </button>
          </div>
        )}
        {tab === "artifacts" && !needsStore && <ArtifactsTab />}
        {tab === "transactions" && !needsStore && <TransactionsTab />}
        {tab === "sql" && !needsStore && <SqlTab />}
        {tab === "problems" && <ProblemsTab />}
      </div>
    </div>
  );
}
