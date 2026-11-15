import clsx from "clsx";
import { ArrowRightLeft, Coins, FileCode2, GitBranch, Lock } from "lucide-react";
import { useMemo, useState, type KeyboardEvent, type ReactNode } from "react";
import { useIde } from "@/store/ide";
import { useSilver } from "@/store/silver";
import { groupCovenantChains } from "@/utils/silverRecords";
import { NodeBusyCover } from "@/shell/NodeOpProgress";
import { ContractGUI } from "./ContractGUI";
import { CovenantChainSection } from "./CovenantGUI";
import { CardGroup } from "./run/CommandCard";
import { COVENANT_CARDS, KCC20_CARDS, SILVER_CARDS, ZK_CARDS } from "./run/cards";
import { PaymentsTab } from "./run/PaymentsTab";

type TabId = "payments" | "silver" | "covenants" | "kcc20" | "zk";

const TABS: ReadonlyArray<{ id: TabId; label: string; icon: typeof Lock }> = [
  { id: "payments", label: "Payments", icon: ArrowRightLeft },
  { id: "silver", label: "SilverScript", icon: FileCode2 },
  { id: "covenants", label: "Covenants", icon: GitBranch },
  { id: "kcc20", label: "KCC20", icon: Coins },
  { id: "zk", label: "ZK", icon: Lock }
];

const TAB_KEY = "hardkas-ide.run-tab";

function loadTab(): TabId {
  try {
    const saved = localStorage.getItem(TAB_KEY);
    if (TABS.some((t) => t.id === saved)) return saved as TabId;
  } catch {
    /* storage can be blocked: start on the first tab */
  }
  return "payments";
}

/**
 * Deploy & Run: one tab per kind of work, in the editor's tab style: payments, SilverScript, covenants, KCC20, ZK.
 * Where it runs (simulator, local node, testnet) is chosen in the top bar, not here.
 */
export function RunPanel() {
  const target = useIde((s) => s.target);
  const covenants = useSilver((s) => s.covenants);
  const covenantCount = useMemo(() => groupCovenantChains(covenants).length, [covenants]);
  const [tab, setTab] = useState<TabId>(loadTab);

  const select = (id: TabId) => {
    setTab(id);
    try {
      localStorage.setItem(TAB_KEY, id);
    } catch {
      /* not remembered: fine */
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = TABS.findIndex((t) => t.id === tab);
    const next = e.key === "ArrowRight" ? (i + 1) % TABS.length : e.key === "ArrowLeft" ? (i - 1 + TABS.length) % TABS.length : e.key === "Home" ? 0 : e.key === "End" ? TABS.length - 1 : -1;
    if (next < 0) return;
    e.preventDefault();
    select(TABS[next].id);
    requestAnimationFrame(() => document.getElementById(`run-tab-${TABS[next].id}`)?.focus());
  };

  let body: ReactNode;
  switch (tab) {
    case "payments":
      body = <PaymentsTab />;
      break;
    case "silver":
      body = (
        <div className="space-y-4">
          <div className="space-y-2">
            <div className="label">Your contracts</div>
            <ContractGUI includeCovenants={false} />
          </div>
          <div className="border-t border-border pt-3">
            <CardGroup title="Inspect, verify, test" note="Work on a compile record, or plan a multisig transaction from a spec." specs={SILVER_CARDS} />
          </div>
        </div>
      );
      break;
    case "covenants":
      body = (
        <div className="space-y-4">
          <CovenantChainSection alwaysShowHeader />
          <div className="border-t border-border pt-3">
            <CardGroup title="Inspect" specs={COVENANT_CARDS} />
          </div>
        </div>
      );
      break;
    case "kcc20":
      body = (
        <CardGroup
          title="KCC-20 tokens"
          note="Encode and decode a token state, check a transfer against the leader's rules, read a program artifact. Everything here is read-only."
          specs={KCC20_CARDS}
          openFirst
        />
      );
      break;
    case "zk":
      body = (
        <CardGroup
          title="Zero-knowledge"
          note="Inspect and verify Groth16 proofs and RISC Zero receipts, and build the Toccata scripts that lock funds to them. Testnet addresses only: mainnet is refused."
          specs={ZK_CARDS}
          openFirst
        />
      );
      break;
  }

  return (
    <div className="relative min-h-full flex flex-col text-xs">
      {target === "localnet" && <NodeBusyCover label="The local node is changing…" />}

      <div role="tablist" aria-label="Deploy and run" onKeyDown={onKeyDown} className="sticky top-0 z-20 h-[30px] shrink-0 flex items-end px-1 gap-0.5 border-b border-border bg-bg-panel overflow-x-auto" data-testid="deploy-run-mode-bar">
        {TABS.map((t) => {
          const active = t.id === tab;
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              id={`run-tab-${t.id}`}
              type="button"
              role="tab"
              aria-selected={active}
              aria-controls="run-tabpanel"
              tabIndex={active ? 0 : -1}
              data-testid={`run-tab-${t.id}`}
              onClick={() => select(t.id)}
              className={clsx(
                "h-[calc(100%-2px)] flex items-center gap-1 px-2 text-[12px] leading-none rounded-t-[4px] border-t border-x cursor-pointer select-none whitespace-nowrap outline-none focus-visible:ring-1 focus-visible:ring-accent",
                active ? "bg-bg text-fg border-border border-t-accent relative z-10 -mb-px pb-px" : "text-fg-muted border-transparent hover:text-fg hover:bg-bg-hover/70"
              )}
            >
              <Icon size={13} className={clsx("shrink-0", active && "text-accent")} />
              {t.label}
              {t.id === "covenants" && covenantCount > 0 && <span className="rounded-full bg-accent/20 px-1 font-mono text-[12px] tabular-nums text-accent">{covenantCount}</span>}
            </button>
          );
        })}
      </div>

      <div id="run-tabpanel" role="tabpanel" aria-labelledby={`run-tab-${tab}`} className="p-3 flex-1">
        {body}
      </div>
    </div>
  );
}
