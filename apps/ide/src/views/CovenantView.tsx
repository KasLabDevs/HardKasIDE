import { Background, Controls, Handle, MiniMap, Position, ReactFlow, type Edge, type Node, type NodeProps } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import clsx from "clsx";
import { AlertTriangle, Check, Coins, Copy, FileCode2, FileJson, GitBranch, GitFork, Play, RadioTower, Rocket, ShieldCheck, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useEngine } from "@/engine/context";
import type { ConsolePlugin } from "@/plugins/console";
import { formatKas, useEnv } from "@/store/env";
import { useSilver, type DeployRecord, type SpendRecord } from "@/store/silver";
import { useIde } from "@/store/ide";
import { copyText } from "@/utils/clipboard";
import {
  accepted,
  buildGraph,
  deploysFor,
  parseUtxos,
  reconcile,
  selectSubjects,
  spendsFor,
  sumSompi,
  type ChainCheck,
  type CovenantNodeData,
  type DeployNodeData,
  type EntryNodeData,
  type GraphNode,
  type Reconciled,
  type SpendNodeData,
  type Subject,
  type UnrecordedNodeData
} from "./covenantGraph";

/**
 * Covenant graph: the life of one compiled SilverScript contract, drawn from HardKas records and, when the
 * Local node is up, checked against it.
 *
 *   deploy records ──► covenant (the P2SH output) ──► one node per entry ──► spend records
 *
 * The contract and its entries come from the compile record (ABI), the left column from silverDeploy
 * records and the right column from silverSpend records. What has not happened is not drawn. The node
 * check (`hardkas rpc utxos <address>`) then says which deploy outputs still exist, which are gone even
 * without a spend record, and which outputs at the address have no record at all (a deploy whose
 * confirmation the CLI stopped waiting for). The data side lives in covenantGraph.ts.
 */

const short = (hash: string, n = 10) => (hash.length > n * 2 + 1 ? `${hash.slice(0, n)}…${hash.slice(-6)}` : hash);

// ---------------------------------------------------------------- node views

type Tone = "info" | "accent" | "warn" | "ok";

function Card({ selected, tone, children, left, right, dashed }: { selected: boolean; tone: Tone; children: React.ReactNode; left?: boolean; right?: boolean; dashed?: boolean }) {
  const ring = { info: "border-info ring-2 ring-info/30", accent: "border-accent ring-2 ring-accent/30", warn: "border-warn ring-2 ring-warn/30", ok: "border-ok ring-2 ring-ok/30" }[tone];
  const hover = { info: "hover:border-info/60", accent: "border-accent/40 hover:border-accent", warn: "hover:border-warn/60", ok: "hover:border-ok/60" }[tone];
  const dot = { info: "!bg-info", accent: "!bg-accent", warn: "!bg-warn", ok: "!bg-ok" }[tone];
  return (
    <div className={clsx("rounded-lg border bg-bg-elev/95 p-3 shadow-md transition-all select-none w-64", dashed && "border-dashed", selected ? ring : clsx("border-border", hover))}>
      {left && <Handle type="target" position={Position.Left} className={clsx(dot, "!w-3 !h-3 !border-2 !border-bg")} />}
      {children}
      {right && <Handle type="source" position={Position.Right} className={clsx(dot, "!w-3 !h-3 !border-2 !border-bg")} />}
    </div>
  );
}

function Head({ icon, title, badge, tone }: { icon: React.ReactNode; title: string; badge: string; tone: Tone }) {
  const color = { info: "text-info", accent: "text-accent", warn: "text-warn", ok: "text-ok" }[tone];
  const chip = { info: "bg-info/10 border-info/30", accent: "bg-accent/15 border-accent/40", warn: "bg-warn/10 border-warn/30", ok: "bg-ok/10 border-ok/30" }[tone];
  return (
    <div className={clsx("flex items-center justify-between gap-1 pb-2 border-b border-border", color)}>
      <div className="flex items-center gap-1.5 font-semibold text-xs min-w-0">
        {icon}
        <span className="truncate">{title}</span>
      </div>
      <span className={clsx("text-[9px] font-mono uppercase px-1.5 py-0.5 rounded border shrink-0", chip)}>{badge}</span>
    </div>
  );
}

function Row({ label, value, mono = true, className }: { label: string; value: React.ReactNode; mono?: boolean; className?: string }) {
  return (
    <div className="flex items-center justify-between gap-2 text-[11px]">
      <span className="text-fg-muted shrink-0">{label}</span>
      <span className={clsx("truncate text-fg", mono && "font-mono tabular-nums", className)}>{value}</span>
    </div>
  );
}

function DeployNodeView({ data }: NodeProps<Node<DeployNodeData, "deploy">>) {
  const d = data.deploy;
  const gone = data.state === "spent" || data.state === "spent on chain";
  return (
    <Card selected={data.selected} tone="info" right>
      <Head icon={<Rocket size={13} />} title="Deploy" badge={data.state} tone="info" />
      <div className="pt-2 space-y-1.5">
        <Row label="Locked" value={formatKas(d.valueSompi)} className={gone ? "text-fg-muted line-through" : "font-semibold text-info"} />
        <Row label="Tx" value={short(d.txId)} />
        <Row label="Output" value={`#${d.outpoint?.index ?? 0}`} />
        {d.createdAt && <Row label="When" value={new Date(d.createdAt).toLocaleString()} mono={false} />}
      </div>
    </Card>
  );
}

function CovenantNodeView({ data }: NodeProps<Node<CovenantNodeData, "covenant">>) {
  const state = data.deployCount === 0 ? "not deployed" : data.liveCount > 0 ? `${data.liveCount} live` : "all spent";
  return (
    <Card selected={data.selected} tone="accent" left right>
      <Head icon={<ShieldCheck size={14} />} title={data.contract.name} badge="P2SH covenant" tone="accent" />
      <div className="pt-2 space-y-1.5">
        <Row label={data.fromChain ? "On the node" : "State"} value={state} mono={false} className={data.deployCount === 0 ? "text-fg-muted" : data.liveCount > 0 ? "text-ok" : "text-fg-muted"} />
        <Row label="Deploys" value={String(data.deployCount)} />
        <Row label="Entries" value={String(data.contract.entries.length)} />
        {data.contract.constructorParams && data.contract.constructorParams.length > 0 && (
          <div className="flex flex-wrap gap-1 pt-0.5">
            {data.contract.constructorParams.map((p) => (
              <span key={p.name} className="px-1.5 py-0.5 rounded bg-bg border border-border text-[10px] font-mono text-fg">
                {p.name}: <span className="text-accent">{p.kind}</span>
              </span>
            ))}
          </div>
        )}
        <div className="font-mono text-[10px] text-accent truncate bg-bg px-1.5 py-0.5 rounded border border-border" title={data.address ?? undefined}>
          {data.address ?? "address unknown until compiled with constructor args"}
        </div>
      </div>
    </Card>
  );
}

function EntryNodeView({ data }: NodeProps<Node<EntryNodeData, "entry">>) {
  return (
    <Card selected={data.selected} tone="warn" left right>
      <Head icon={<GitBranch size={13} />} title={`${data.entry.name}()`} badge={data.entry.dispatchTag ? `tag ${data.entry.dispatchTag}` : "entry"} tone="warn" />
      <div className="pt-2 space-y-1.5">
        <div className="flex flex-wrap gap-1">
          {data.entry.params.length === 0 ? (
            <span className="text-[10px] text-fg-muted italic">no arguments</span>
          ) : (
            data.entry.params.map((p) => (
              <span key={p.name} className="px-1.5 py-0.5 rounded bg-bg border border-border text-[10px] font-mono text-fg">
                {p.name}: <span className="text-warn">{p.kind}</span>
              </span>
            ))
          )}
        </div>
        <Row label="Spends" value={data.spendCount === 0 ? "none yet" : String(data.spendCount)} mono={data.spendCount > 0} />
      </div>
    </Card>
  );
}

function SpendNodeView({ data }: NodeProps<Node<SpendNodeData, "spend">>) {
  const s = data.spend;
  return (
    <Card selected={data.selected} tone="ok" left>
      <Head icon={<Coins size={13} />} title={`${s.entry}()`} badge={accepted(s.status) ? "accepted" : s.status || "?"} tone="ok" />
      <div className="pt-2 space-y-1.5">
        <Row label="Output" value={formatKas(s.outputSompi)} className="font-semibold text-ok" />
        {s.feeSompi && <Row label="Fee" value={formatKas(s.feeSompi)} />}
        <Row label="To" value={short(s.to, 12)} />
        <Row label="Tx" value={short(s.txId)} />
      </div>
    </Card>
  );
}

function UnrecordedNodeView({ data }: NodeProps<Node<UnrecordedNodeData, "unrecorded">>) {
  return (
    <Card selected={data.selected} tone="warn" right dashed>
      <Head icon={<AlertTriangle size={13} />} title="Without a record" badge={`${data.utxos.length} on node`} tone="warn" />
      <div className="pt-2 space-y-1.5">
        <Row label="Locked" value={formatKas(sumSompi(data.utxos))} className="font-semibold text-warn" />
        <p className="text-[10px] text-fg-muted leading-snug">
          The node holds {data.utxos.length === 1 ? "an output" : "outputs"} at this address that no deploy record describes.
        </p>
      </div>
    </Card>
  );
}

const NODE_TYPES = { deploy: DeployNodeView, covenant: CovenantNodeView, entry: EntryNodeView, spend: SpendNodeView, unrecorded: UnrecordedNodeView };

// ---------------------------------------------------------------- view

export function CovenantView() {
  const engine = useEngine();
  const compiled = useSilver((s) => s.compiled);
  const deployments = useSilver((s) => s.deployments);
  const spends = useSilver((s) => s.spends);
  const target = useIde((s) => s.target);
  const nodeReady = useEnv((s) => s.node?.rpcReady === true);

  const [contractName, setContractName] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (copyTimer.current && clearTimeout(copyTimer.current)), []);

  const subjects = useMemo<Subject[]>(() => selectSubjects(compiled, deployments), [compiled, deployments]);
  const subject = subjects.find((s) => s.key === contractName) ?? subjects[0] ?? null;
  const contract = subject?.contract ?? null;
  const deploys = useMemo(() => (subject ? deploysFor(subject, deployments) : []), [subject, deployments]);
  const contractSpends = useMemo(() => (contract ? spendsFor(contract, deploys, spends) : []), [contract, deploys, spends]);
  const address = deploys[0]?.address ?? contract?.address ?? null;

  // ---- the node's view of the address: one check per address, refreshed on demand or after a deploy/spend
  const canAskNode = target === "localnet" && nodeReady && address !== null;
  const [checks, setChecks] = useState<Record<string, ChainCheck>>({});
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState<string | null>(null);
  const checkChain = useCallback(
    async (addr: string) => {
      setChecking(true);
      setCheckError(null);
      try {
        const run = await engine.get<ConsolePlugin>("console").runHardkas(["rpc", "utxos", addr, "--json"], { quiet: true });
        const utxos = run.status === "succeeded" ? parseUtxos(run.result) : null;
        if (!utxos) throw new Error((run.result as { message?: string } | null)?.message ?? `rpc utxos failed (exit ${run.exitCode})`);
        setChecks((c) => ({ ...c, [addr]: { address: addr, checkedAt: Date.now(), utxos } }));
      } catch (e) {
        setCheckError(e instanceof Error ? e.message : String(e));
      } finally {
        setChecking(false);
      }
    },
    [engine]
  );
  useEffect(() => {
    if (canAskNode && address && !checks[address]) void checkChain(address);
  }, [canAskNode, address, checks, checkChain]);
  useEffect(() => {
    // A deploy or spend from the IDE changes what the node holds.
    const off = [engine.on("silverContracts", "deployed", () => address && canAskNode && void checkChain(address)), engine.on("silverContracts", "spent", () => address && canAskNode && void checkChain(address))];
    return () => off.forEach((f) => f());
  }, [engine, address, canAskNode, checkChain]);

  const chain = useMemo<Reconciled | null>(() => (address && checks[address] ? reconcile(deploys, checks[address]) : null), [address, checks, deploys]);

  const { nodes, edges } = useMemo(() => (contract ? buildGraph(contract, deploys, contractSpends, selectedId, chain) : { nodes: [], edges: [] }), [contract, deploys, contractSpends, selectedId, chain]);
  const selected = nodes.find((n) => n.id === selectedId) ?? null;

  const copy = async (key: string, text: string) => {
    await copyText(text);
    setCopied(key);
    if (copyTimer.current) clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => setCopied(null), 1500);
  };
  const open = (path: string) => {
    engine.call("fileManager", "open", path).catch((e: unknown) => engine.get<ConsolePlugin>("console").error(`Could not open ${path}: ${e instanceof Error ? e.message : String(e)}`));
  };

  if (!contract || !subject) {
    return (
      <div className="h-full flex items-center justify-center bg-bg text-fg p-6">
        <div className="max-w-md text-center space-y-3">
          <GitFork size={28} className="mx-auto text-fg-muted" />
          <div className="text-sm font-semibold">Nothing to draw yet</div>
          <p className="text-[11px] text-fg-muted leading-relaxed">
            The covenant graph draws a SilverScript contract from its compile record, plus the deploy and spend records HardKas wrote for it. This workspace has no deploy records, and nothing has been compiled in this session: compile a <code>.sil</code> file (Ctrl+Enter in the editor) to see it here.
          </p>
          <button type="button" className="btn-primary mx-auto" onClick={() => useIde.getState().setActiveSidePlugin("silverCompiler")}>
            <FileCode2 size={13} /> Open the compiler
          </button>
        </div>
      </div>
    );
  }

  const chainSummary = chain
    ? `${chain.unspent.size} of ${deploys.filter((d) => d.address === chain.address).length} deploy outputs on the node${chain.unrecorded.length > 0 ? ` · ${chain.unrecorded.length} without a record` : ""}`
    : null;

  return (
    <div className="h-full flex flex-col min-w-0 bg-bg text-fg select-none">
      <div className="shrink-0 flex items-center justify-between gap-2 px-3 h-10 border-b border-border bg-bg-panel text-xs">
        <div className="flex items-center gap-2 min-w-0">
          <div className="flex items-center gap-1.5 font-semibold text-fg shrink-0">
            <GitFork size={14} className="text-accent" />
            <span>Covenant graph</span>
          </div>
          <div className="h-4 w-px bg-border mx-1" />
          {subjects.length > 1 ? (
            <select aria-label="Contract" className="input !py-0.5 !h-7 text-xs bg-bg font-medium cursor-pointer" value={subject.key} onChange={(e) => (setContractName(e.target.value), setSelectedId(null))}>
              {subjects.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.contract.name} {s.fromDeploy ? "(deployed)" : "(compiled now)"}
                </option>
              ))}
            </select>
          ) : (
            <span className="font-medium text-fg">{contract.name}</span>
          )}
          <span className="text-fg-muted truncate font-mono text-[10px]" title={subject.recordPath}>
            {subject.sourcePath ?? subject.recordPath}
          </span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {subject.sourcePath && (
            <button type="button" onClick={() => open(subject.sourcePath!)} className="btn-ghost !py-1 !h-7 text-[11px]" title="Open the contract source in the editor">
              <FileCode2 size={12} className="text-accent" /> Source
            </button>
          )}
          <button type="button" onClick={() => open(subject.recordPath)} className="btn-ghost !py-1 !h-7 text-[11px]" title="Open the compile record (JSON)">
            <FileJson size={12} /> Compile record
          </button>
          <button
            type="button"
            onClick={() => address && void checkChain(address)}
            disabled={!canAskNode || checking}
            className="btn-ghost !py-1 !h-7 text-[11px]"
            title={canAskNode ? `hardkas rpc utxos ${address}` : target !== "localnet" ? "Switch the environment to Local node to compare the records with the chain" : "Start the local node to compare the records with the chain"}
          >
            <RadioTower size={12} className={clsx(canAskNode ? "text-ok" : "text-fg-muted", checking && "animate-pulse")} /> {checking ? "Asking the node…" : chain ? "Check again" : "Check on node"}
          </button>
          <button type="button" onClick={() => useIde.getState().setActiveSidePlugin("deployRun")} className="btn-primary !py-1 !h-7 text-[11px]" title="Deploy or call the contract from Deploy & Run">
            <Play size={11} /> Deploy &amp; Run
          </button>
        </div>
      </div>

      <div className="flex-1 min-h-0 flex">
        <div className="flex-1 h-full min-w-0 relative">
          <ReactFlow<GraphNode, Edge>
            nodes={nodes}
            edges={edges}
            nodeTypes={NODE_TYPES}
            fitView
            fitViewOptions={{ padding: 0.2, maxZoom: 1 }}
            minZoom={0.3}
            maxZoom={1.8}
            proOptions={{ hideAttribution: true }}
            onNodeClick={(_e, n) => setSelectedId(n.id)}
            onPaneClick={() => setSelectedId(null)}
            nodesDraggable={false}
            nodesConnectable={false}
            colorMode="dark"
          >
            <Background color="var(--border)" gap={20} size={1} />
            <Controls showInteractive={false} />
            <MiniMap pannable zoomable nodeColor={(n) => ({ deploy: "var(--info)", covenant: "var(--accent)", entry: "var(--warn)", spend: "var(--ok)", unrecorded: "var(--warn)" })[n.type ?? "covenant"] ?? "#888"} />
          </ReactFlow>

          <div className="absolute bottom-3 left-3 z-10 flex flex-col gap-1 px-3 py-1.5 rounded-lg border border-border bg-bg-elev/90 backdrop-blur-sm text-[11px] shadow-sm">
            <div className="flex items-center gap-3">
              <span className="flex items-center gap-1 text-info font-medium"><span className="w-2 h-2 rounded-full bg-info" /> Deploys ({deploys.length})</span>
              <span className="flex items-center gap-1 text-accent font-medium"><span className="w-2 h-2 rounded-full bg-accent" /> Covenant</span>
              <span className="flex items-center gap-1 text-warn font-medium"><span className="w-2 h-2 rounded-full bg-warn" /> Entries ({contract.entries.length})</span>
              <span className="flex items-center gap-1 text-ok font-medium"><span className="w-2 h-2 rounded-full bg-ok" /> Spends ({contractSpends.length})</span>
            </div>
            <div className="flex items-center gap-1.5 text-[10px] text-fg-muted tabular-nums">
              <RadioTower size={10} className={chain ? "text-ok" : "text-fg-muted"} />
              {checkError ? (
                <span className="text-error">{checkError}</span>
              ) : chain ? (
                <span>
                  {chainSummary} · checked {new Date(chain.checkedAt).toLocaleTimeString(undefined, { hour12: false })}
                </span>
              ) : canAskNode ? (
                <span>Asking the node what it holds at this address…</span>
              ) : (
                <span>Records only: {target !== "localnet" ? "the Local node environment" : "a running local node"} is needed to compare them with the chain.</span>
              )}
            </div>
          </div>
        </div>

        <aside className="w-80 shrink-0 border-l border-border bg-bg-panel flex flex-col h-full hidden md:flex">
          {selected ? (
            <>
              <div className="flex items-center justify-between px-3.5 py-2.5 border-b border-border">
                <div className="flex items-center gap-2 font-semibold text-xs">
                  {selected.type === "deploy" && <Rocket size={14} className="text-info" />}
                  {selected.type === "covenant" && <ShieldCheck size={14} className="text-accent" />}
                  {selected.type === "entry" && <GitBranch size={14} className="text-warn" />}
                  {selected.type === "spend" && <Coins size={14} className="text-ok" />}
                  {selected.type === "unrecorded" && <AlertTriangle size={14} className="text-warn" />}
                  <span>{{ deploy: "Deploy record", covenant: "Covenant", entry: "Entry", spend: "Spend record", unrecorded: "Outputs without a record" }[selected.type!]}</span>
                </div>
                <button type="button" onClick={() => setSelectedId(null)} className="p-1 rounded text-fg-muted hover:text-fg hover:bg-bg-hover cursor-pointer" aria-label="Close inspector">
                  <X size={13} />
                </button>
              </div>
              <div className="flex-1 overflow-auto p-3.5 space-y-3 text-xs">
                {selected.type === "covenant" && <CovenantInspector data={selected.data} compiled={subject} chain={chain} copied={copied} onCopy={copy} onOpen={open} />}
                {selected.type === "deploy" && <DeployInspector d={selected.data.deploy} state={selected.data.state} copied={copied} onCopy={copy} onOpen={open} />}
                {selected.type === "entry" && <EntryInspector data={selected.data} spends={contractSpends.filter((s) => s.entry === selected.data.entry.name)} onOpen={open} />}
                {selected.type === "spend" && <SpendInspector s={selected.data.spend} copied={copied} onCopy={copy} onOpen={open} />}
                {selected.type === "unrecorded" && <UnrecordedInspector data={selected.data} copied={copied} onCopy={copy} />}
              </div>
            </>
          ) : (
            <div className="p-4 text-xs space-y-3">
              <div className="font-semibold text-fg">Inspector</div>
              <p className="text-fg-muted text-[11px] leading-relaxed">Click a node to see the record behind it: the compile record for the covenant and its entries, the silverDeploy and silverSpend records for the rest. Every value shown comes from those files, or from the node when it has been asked.</p>
              {deploys.length === 0 && (
                <p className="text-fg-muted text-[11px] leading-relaxed">
                  <span className="text-fg font-medium">{contract.name}</span> has not been deployed from this compile record, so there are no deploy or spend nodes yet. Deploy it from Deploy &amp; Run and they appear here.
                </p>
              )}
              {subject.fromDeploy && <p className="text-fg-muted text-[11px] leading-relaxed">Shown from its deploy record and the compile record that deploy points at. Compile the source again to refresh the ABI.</p>}
              {chain && chain.unrecorded.length > 0 && (
                <p className="text-warn text-[11px] leading-relaxed">
                  The node holds {chain.unrecorded.length} output{chain.unrecorded.length === 1 ? "" : "s"} at this address with no deploy record: usually a deploy whose confirmation the CLI stopped waiting for. The coins are locked by the covenant all the same; they can be spent from Deploy &amp; Run only once a record exists.
                </p>
              )}
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- inspector panels

function Field({ label, value, copyKey, copied, onCopy, mono = true }: { label: string; value: string; copyKey?: string; copied?: string | null; onCopy?: (key: string, text: string) => void; mono?: boolean }) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-[10px] text-fg-muted font-semibold uppercase tracking-wider">
        <span>{label}</span>
        {copyKey && onCopy && (
          <button type="button" onClick={() => onCopy(copyKey, value)} className="text-accent hover:underline flex items-center gap-1 cursor-pointer normal-case tracking-normal font-normal">
            {copied === copyKey ? <Check size={11} className="text-ok" /> : <Copy size={11} />}
            <span>{copied === copyKey ? "Copied" : "Copy"}</span>
          </button>
        )}
      </div>
      <div className={clsx("text-[10px] p-2 rounded bg-bg border border-border break-all", mono && "font-mono")}>{value}</div>
    </div>
  );
}

function RecordButton({ path, onOpen, label = "Open record (JSON)" }: { path: string; onOpen: (p: string) => void; label?: string }) {
  return (
    <button type="button" onClick={() => onOpen(path)} className="btn-ghost w-full justify-center text-[11px]" title={path}>
      <FileJson size={12} /> {label}
    </button>
  );
}

type CopyProps = { copied: string | null; onCopy: (key: string, text: string) => void; onOpen: (path: string) => void };

function CovenantInspector({ data, compiled, chain, copied, onCopy, onOpen }: { data: CovenantNodeData; compiled: { recordPath: string; contentHash: string; networkId?: string }; chain: Reconciled | null } & CopyProps) {
  const c = data.contract;
  return (
    <>
      <div>
        <div className="text-[10px] text-fg-muted uppercase tracking-wider font-semibold">Contract</div>
        <div className="font-semibold text-sm text-accent">{c.name}</div>
        <div className="text-[10px] text-fg-muted">
          {data.deployCount === 0 ? "compiled, not deployed" : `${data.deployCount} deploy${data.deployCount === 1 ? "" : "s"}, ${data.liveCount} live${data.fromChain ? " on the node" : " by the records"}`}
          {compiled.networkId ? ` · ${compiled.networkId}` : ""}
        </div>
      </div>
      {chain && (
        <div className="p-2.5 rounded-lg border border-border bg-bg space-y-1 text-[11px]">
          <div className="flex items-center gap-1.5 text-ok font-semibold">
            <RadioTower size={12} /> On the node
          </div>
          <div className="text-fg-muted">
            {chain.unspent.size} deploy output{chain.unspent.size === 1 ? "" : "s"} unspent, {chain.spent.size} gone
            {chain.unrecorded.length > 0 ? `, ${chain.unrecorded.length} without a record (${formatKas(sumSompi(chain.unrecorded))})` : ""}
          </div>
          <div className="text-[10px] text-fg-muted tabular-nums">hardkas rpc utxos · {new Date(chain.checkedAt).toLocaleTimeString(undefined, { hour12: false })}</div>
        </div>
      )}
      {data.address && <Field label="P2SH address" value={data.address} copyKey="addr" copied={copied} onCopy={onCopy} />}
      {c.lockingScript && <Field label="Locking script (hex)" value={c.lockingScript} copyKey="script" copied={copied} onCopy={onCopy} />}
      {c.constructorParams && c.constructorParams.length > 0 && (
        <div className="space-y-1">
          <div className="text-[10px] text-fg-muted uppercase tracking-wider font-semibold">Constructor</div>
          <div className="flex flex-wrap gap-1">
            {c.constructorParams.map((p) => (
              <span key={p.name} className="px-1.5 py-0.5 rounded bg-bg border border-border text-[10px] font-mono">
                {p.name}: <span className="text-accent">{p.kind}</span>
              </span>
            ))}
          </div>
        </div>
      )}
      <div className="space-y-1">
        <div className="text-[10px] text-fg-muted uppercase tracking-wider font-semibold">Entries</div>
        {c.entries.map((e) => (
          <div key={e.name} className="flex items-center justify-between gap-2 text-[11px] font-mono">
            <span className="text-warn">{e.name}({e.params.map((p) => p.name).join(", ")})</span>
            {e.dispatchTag && <span className="text-fg-muted text-[10px]">{e.dispatchTag}</span>}
          </div>
        ))}
      </div>
      {compiled.contentHash && <Field label="Content hash" value={compiled.contentHash} copyKey="hash" copied={copied} onCopy={onCopy} />}
      <RecordButton path={compiled.recordPath} onOpen={onOpen} label="Open compile record" />
    </>
  );
}

function DeployInspector({ d, state, copied, onCopy, onOpen }: { d: DeployRecord; state: string } & CopyProps) {
  return (
    <>
      <div className="p-2.5 rounded-lg border border-border bg-bg space-y-1">
        <div className="text-[10px] text-fg-muted uppercase tracking-wider font-semibold">Locked in the covenant</div>
        <div className="text-base font-mono font-semibold text-fg tabular-nums">{formatKas(d.valueSompi)}</div>
        <div className="text-[10px] text-fg-muted">
          {state}
          {d.feeSompi ? ` · fee ${formatKas(d.feeSompi)}` : ""}
          {d.networkId ? ` · ${d.networkId}` : ""}
          {d.createdAt ? ` · ${new Date(d.createdAt).toLocaleString()}` : ""}
        </div>
        {state === "spent on chain" && <div className="text-[10px] text-warn leading-snug">The node no longer holds this output, but no spend record names it: it was spent outside the IDE, or the CLI stopped waiting before the spend confirmed.</div>}
        {d.hardkasVersion && <div className="text-[10px] text-fg-muted">written by HardKas {d.hardkasVersion}</div>}
      </div>
      <Field label="Transaction" value={d.txId} copyKey="tx" copied={copied} onCopy={onCopy} />
      <Field label="Outpoint" value={`${d.outpoint?.transactionId ?? d.txId}:${d.outpoint?.index ?? 0}`} copyKey="outpoint" copied={copied} onCopy={onCopy} />
      <Field label="Address" value={d.address} copyKey="daddr" copied={copied} onCopy={onCopy} />
      <RecordButton path={d.recordPath} onOpen={onOpen} />
      {d.compileRecordPath && <RecordButton path={d.compileRecordPath} onOpen={onOpen} label="Open its compile record" />}
    </>
  );
}

function EntryInspector({ data, spends, onOpen }: { data: EntryNodeData; spends: SpendRecord[]; onOpen: (p: string) => void }) {
  const e = data.entry;
  return (
    <>
      <div>
        <div className="text-[10px] text-fg-muted uppercase tracking-wider font-semibold">Entry of {data.contractName}</div>
        <div className="font-semibold text-sm text-warn font-mono">{e.name}()</div>
        {e.dispatchTag && <div className="text-[10px] text-fg-muted font-mono">dispatch tag {e.dispatchTag}</div>}
      </div>
      <div className="space-y-1">
        <div className="text-[10px] text-fg-muted uppercase tracking-wider font-semibold">Arguments</div>
        {e.params.length === 0 ? (
          <div className="text-[11px] text-fg-muted italic">none</div>
        ) : (
          e.params.map((p) => (
            <div key={p.name} className="flex items-center justify-between text-[11px] font-mono">
              <span>{p.name}</span>
              <span className="text-warn">{p.kind}</span>
            </div>
          ))
        )}
      </div>
      <p className="text-[10px] text-fg-muted leading-relaxed">The compile record carries the entry's name, dispatch tag and argument types; the opcodes it validates are only in the locking script of the covenant node.</p>
      <div className="space-y-1">
        <div className="text-[10px] text-fg-muted uppercase tracking-wider font-semibold">Spends through this entry</div>
        {spends.length === 0 ? (
          <div className="text-[11px] text-fg-muted italic">none recorded</div>
        ) : (
          spends.map((s) => (
            <button key={s.recordPath} type="button" onClick={() => onOpen(s.recordPath)} className="w-full text-left text-[11px] font-mono flex items-center justify-between gap-2 hover:text-accent cursor-pointer" title={s.recordPath}>
              <span className="truncate">{short(s.txId)}</span>
              <span className="text-ok shrink-0">{formatKas(s.outputSompi)}</span>
            </button>
          ))
        )}
      </div>
    </>
  );
}

function SpendInspector({ s, copied, onCopy, onOpen }: { s: SpendRecord } & CopyProps) {
  return (
    <>
      <div className="p-2.5 rounded-lg border border-border bg-bg space-y-1">
        <div className="text-[10px] text-fg-muted uppercase tracking-wider font-semibold">
          {s.contract}.{s.entry}()
        </div>
        <div className="text-base font-mono font-semibold text-ok tabular-nums">{formatKas(s.outputSompi)}</div>
        <div className="text-[10px] text-fg-muted">
          {s.status}
          {s.feeSompi ? ` · fee ${formatKas(s.feeSompi)}` : ""}
          {s.createdAt ? ` · ${new Date(s.createdAt).toLocaleString()}` : ""}
        </div>
      </div>
      <Field label="Transaction" value={s.txId} copyKey="stx" copied={copied} onCopy={onCopy} />
      {s.spentOutpoint && <Field label="Consumed outpoint" value={`${s.spentOutpoint.transactionId}:${s.spentOutpoint.index}`} copyKey="sout" copied={copied} onCopy={onCopy} />}
      <Field label="Paid to" value={s.to} copyKey="to" copied={copied} onCopy={onCopy} />
      <RecordButton path={s.recordPath} onOpen={onOpen} />
    </>
  );
}

function UnrecordedInspector({ data, copied, onCopy }: { data: UnrecordedNodeData; copied: string | null; onCopy: (key: string, text: string) => void }) {
  return (
    <>
      <div className="p-2.5 rounded-lg border border-warn/40 bg-warn/5 space-y-1">
        <div className="text-[10px] text-warn uppercase tracking-wider font-semibold">Locked, unrecorded</div>
        <div className="text-base font-mono font-semibold text-fg tabular-nums">{formatKas(sumSompi(data.utxos))}</div>
        <p className="text-[10px] text-fg-muted leading-relaxed">
          These outputs sit at the covenant address on the node, but no silverDeploy record describes them. The usual cause: <code>hardkas silver deploy --wait</code> gave up before the block arrived and wrote nothing, although the transaction confirmed later. The IDE now waits up to ten minutes to avoid this. The coins are spendable through the entries, but Deploy &amp; Run needs a deploy record to build the spend.
        </p>
      </div>
      <Field label="Address" value={data.address} copyKey="uaddr" copied={copied} onCopy={onCopy} />
      <div className="space-y-1">
        <div className="text-[10px] text-fg-muted uppercase tracking-wider font-semibold">Outpoints on the node</div>
        {data.utxos.map((u) => (
          <div key={`${u.txId}:${u.index}`} className="flex items-center justify-between gap-2 text-[11px] font-mono">
            <button type="button" onClick={() => onCopy(`u:${u.txId}:${u.index}`, `${u.txId}:${u.index}`)} className="truncate hover:text-accent cursor-pointer text-left" title={`${u.txId}:${u.index} · copy`}>
              {copied === `u:${u.txId}:${u.index}` ? "copied" : `${short(u.txId)}:${u.index}`}
            </button>
            <span className="text-warn shrink-0">{formatKas(u.amountSompi)}</span>
          </div>
        ))}
      </div>
    </>
  );
}
