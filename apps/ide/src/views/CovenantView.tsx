import {
  Background,
  Controls,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
  useEdgesState,
  useNodesState
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import clsx from "clsx";
import {
  Check,
  Coins,
  Copy,
  FileCode2,
  GitBranch,
  Layers,
  Play,
  ShieldCheck,
  Sparkles,
  Wallet,
  X
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useEngine } from "@/engine/context";
import { useSilver } from "@/store/silver";
import { useIde } from "@/store/ide";
import { copyText } from "@/utils/clipboard";

// ---------------------------------------------------------------- Node Types & Models

export type FundingNodeData = {
  title: string;
  account: string;
  address: string;
  amountKas: string;
  txHash: string;
  status: "confirmed" | "planned" | "simulated";
  selected?: boolean;
  [key: string]: unknown;
};

export type CovenantNodeData = {
  contractName: string;
  address: string;
  outpoint: string;
  amountKas: string;
  amountSompi: string;
  lockingScript?: string;
  status: "locked" | "spent" | "simulated";
  entriesCount: number;
  selected?: boolean;
  [key: string]: unknown;
};

export type EntrypointNodeData = {
  name: string;
  contractName: string;
  params: Array<{ name: string; kind: string }>;
  opcodes: string[];
  condition: string;
  witnessStack: string[];
  spendTarget?: string;
  selected?: boolean;
  [key: string]: unknown;
};

export type SettlementNodeData = {
  title: string;
  recipient: string;
  address: string;
  amountKas: string;
  feeKas: string;
  status: "claimable" | "spent" | "expired";
  conditionMet: string;
  selected?: boolean;
  [key: string]: unknown;
};

export type CovenantGraphNode =
  | Node<FundingNodeData, "funding">
  | Node<CovenantNodeData, "covenant">
  | Node<EntrypointNodeData, "entrypoint">
  | Node<SettlementNodeData, "settlement">;

// ---------------------------------------------------------------- Presets for Kaspa Covenants

interface PresetDefinition {
  id: string;
  name: string;
  description: string;
  contractName: string;
  contractFile: string;
  funding: FundingNodeData;
  covenant: CovenantNodeData;
  entrypoints: Array<{
    data: EntrypointNodeData;
    settlement: SettlementNodeData;
  }>;
}

const PRESETS: PresetDefinition[] = [
  {
    id: "escrow",
    name: "Escrow con Timeout Refund (2-Party)",
    description: "Covenant clásico de Kaspa donde los fondos se bloquean hasta que el comprador firma la entrega, o se devuelven al comprador tras un timeout relativo.",
    contractName: "Escrow",
    contractFile: "contracts/escrow.sil",
    funding: {
      title: "Depósito del Comprador",
      account: "alice",
      address: "kaspa:qqalice9823h89dha983ydha098ydha7612ga7",
      amountKas: "100.00",
      txHash: "7b4c91a02e88f4c891...32d1",
      status: "confirmed"
    },
    covenant: {
      contractName: "Escrow",
      address: "kaspa:p2sh_escrow_7781a92bf0c...881a",
      outpoint: "7b4c91a02e88f4c891...32d1:0",
      amountKas: "100.00",
      amountSompi: "10,000,000,000",
      lockingScript: "OP_IF OP_CHECKSIG OP_ELSE OP_CHECKSEQUENCEVERIFY OP_DROP OP_CHECKSIG OP_ENDIF",
      status: "locked",
      entriesCount: 2
    },
    entrypoints: [
      {
        data: {
          name: "spend_claim",
          contractName: "Escrow",
          params: [
            { name: "buyerSig", kind: "sig" }
          ],
          opcodes: ["OP_CHECKSIG", "OP_VERIFY"],
          condition: "Firma válida del comprador autorizando la liberación inmediata del pago al vendedor.",
          witnessStack: ["<buyer_sig>", "<0x01 (branch 0)>"],
          spendTarget: "bob"
        },
        settlement: {
          title: "Liquidación a Vendedor",
          recipient: "bob",
          address: "kaspa:qqbob458293hfiaushdf8374hd784920hf8472",
          amountKas: "99.98",
          feeKas: "0.02",
          status: "claimable",
          conditionMet: "Firma de Alice verificada"
        }
      },
      {
        data: {
          name: "spend_refund",
          contractName: "Escrow",
          params: [
            { name: "buyerSig", kind: "sig" }
          ],
          opcodes: ["OP_CHECKSEQUENCEVERIFY", "OP_DROP", "OP_CHECKSIG"],
          condition: "Timeout de 172,800 segundos (48h transcurridas en el DAG) + firma del comprador.",
          witnessStack: ["<buyer_sig>", "<0x00 (branch 1)>"],
          spendTarget: "alice"
        },
        settlement: {
          title: "Reembolso por Timeout",
          recipient: "alice",
          address: "kaspa:qqalice9823h89dha983ydha098ydha7612ga7",
          amountKas: "99.98",
          feeKas: "0.02",
          status: "expired",
          conditionMet: "CSV 48h cumplido"
        }
      }
    ]
  },
  {
    id: "htlc",
    name: "HTLC (Atomic Swap Cross-Chain)",
    description: "Hashed Time-Lock Contract para intercambio atómico entre cadenas: liberación mediante secreto hash256 o reembolso por DAA score.",
    contractName: "HTLC",
    contractFile: "contracts/htlc.sil",
    funding: {
      title: "Fondeo Swap",
      account: "alice",
      address: "kaspa:qqalice9823h89dha983ydha098ydha7612ga7",
      amountKas: "250.00",
      txHash: "4f8a291bc7190de...889a",
      status: "confirmed"
    },
    covenant: {
      contractName: "HTLC",
      address: "kaspa:p2sh_htlc_39f02919...aa11",
      outpoint: "4f8a291bc7190de...889a:0",
      amountKas: "250.00",
      amountSompi: "25,000,000,000",
      lockingScript: "OP_IF OP_SHA256 <secretHash> OP_EQUALVERIFY OP_CHECKSIG OP_ELSE OP_CHECKLOCKTIMEVERIFY OP_DROP OP_CHECKSIG OP_ENDIF",
      status: "locked",
      entriesCount: 2
    },
    entrypoints: [
      {
        data: {
          name: "claim",
          contractName: "HTLC",
          params: [
            { name: "preimage", kind: "bytes32" },
            { name: "bobSig", kind: "sig" }
          ],
          opcodes: ["OP_SHA256", "OP_EQUALVERIFY", "OP_CHECKSIG"],
          condition: "Preimagen revelada: sha256(preimage) == hashLock + firma de Bob.",
          witnessStack: ["<bob_sig>", "<preimage_32b>", "<0x01>"],
          spendTarget: "bob"
        },
        settlement: {
          title: "Canje Atómico",
          recipient: "bob",
          address: "kaspa:qqbob458293hfiaushdf8374hd784920hf8472",
          amountKas: "249.98",
          feeKas: "0.02",
          status: "claimable",
          conditionMet: "Preimagen revelada"
        }
      },
      {
        data: {
          name: "refund",
          contractName: "HTLC",
          params: [
            { name: "aliceSig", kind: "sig" }
          ],
          opcodes: ["OP_CHECKLOCKTIMEVERIFY", "OP_DROP", "OP_CHECKSIG"],
          condition: "DAA Score absoluto alcanzado (bloques transcurridos) + firma de Alice.",
          witnessStack: ["<alice_sig>", "<0x00>"],
          spendTarget: "alice"
        },
        settlement: {
          title: "Reembolso Atomic Swap",
          recipient: "alice",
          address: "kaspa:qqalice9823h89dha983ydha098ydha7612ga7",
          amountKas: "249.98",
          feeKas: "0.02",
          status: "expired",
          conditionMet: "CLTV Expiry alcanzado"
        }
      }
    ]
  },
  {
    id: "multisig",
    name: "Multi-Sig 2 de 3 Treasury Covenant",
    description: "Covenant con regla m-of-n donde se exigen al menos 2 firmas de los 3 custodios para liberar fondos hacia tesorería.",
    contractName: "Treasury2of3",
    contractFile: "contracts/treasury.sil",
    funding: {
      title: "Depósito de Tesorería",
      account: "dao_treasury",
      address: "kaspa:qqdao889920192hda8129yda78129ga9982",
      amountKas: "500.00",
      txHash: "e331bc0092fa71...aa98",
      status: "confirmed"
    },
    covenant: {
      contractName: "Treasury2of3",
      address: "kaspa:p2sh_multisig_881920aa...44bb",
      outpoint: "e331bc0092fa71...aa98:0",
      amountKas: "500.00",
      amountSompi: "50,000,000,000",
      lockingScript: "OP_2 <pubkey1> <pubkey2> <pubkey3> OP_3 OP_CHECKMULTISIG",
      status: "locked",
      entriesCount: 1
    },
    entrypoints: [
      {
        data: {
          name: "spend",
          contractName: "Treasury2of3",
          params: [
            { name: "sig1", kind: "sig" },
            { name: "sig2", kind: "sig" }
          ],
          opcodes: ["OP_2", "OP_3", "OP_CHECKMULTISIG"],
          condition: "Al menos 2 firmas válidas de custodios registrados (Alice, Bob o Charlie).",
          witnessStack: ["<0>", "<sig_alice>", "<sig_bob>"],
          spendTarget: "destination"
        },
        settlement: {
          title: "Transferencia Aprobada",
          recipient: "payout_destination",
          address: "kaspa:qqdest992817264859201hd8274619ga8716",
          amountKas: "499.96",
          feeKas: "0.04",
          status: "claimable",
          conditionMet: "2/3 firmas verificadas"
        }
      }
    ]
  }
];

// ---------------------------------------------------------------- Custom Node Views

function FundingNodeView({ data }: NodeProps<Node<FundingNodeData, "funding">>) {
  return (
    <div
      className={clsx(
        "rounded-lg border bg-bg-elev/95 p-3 shadow-md transition-all select-none w-64",
        data.selected ? "border-info ring-2 ring-info/30" : "border-border hover:border-info/60"
      )}
    >
      <div className="flex items-center justify-between gap-1 pb-2 border-b border-border text-info">
        <div className="flex items-center gap-1.5 font-semibold text-xs">
          <Wallet size={13} />
          <span>{data.title}</span>
        </div>
        <span className="text-[9px] font-mono uppercase px-1.5 py-0.5 rounded bg-info/10 border border-info/30 text-info">
          Input UTXO
        </span>
      </div>

      <div className="pt-2 space-y-1.5 text-[11px]">
        <div className="flex items-center justify-between">
          <span className="text-fg-muted">Cuenta:</span>
          <span className="font-medium text-fg font-mono">@{data.account}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-fg-muted">Monto fondeo:</span>
          <span className="font-semibold text-info font-mono tabular-nums">{data.amountKas} KAS</span>
        </div>
        <div className="flex items-center justify-between text-[10px] text-fg-muted">
          <span>Outpoint:</span>
          <span className="font-mono truncate max-w-[120px]">{data.txHash}</span>
        </div>
      </div>

      <Handle
        type="source"
        position={Position.Right}
        className="!bg-info !w-3 !h-3 !border-2 !border-bg"
      />
    </div>
  );
}

function CovenantNodeView({ data }: NodeProps<Node<CovenantNodeData, "covenant">>) {
  return (
    <div
      className={clsx(
        "rounded-lg border bg-bg-elev/95 p-3.5 shadow-lg transition-all select-none w-72",
        data.selected ? "border-accent ring-2 ring-accent/30" : "border-accent/40 hover:border-accent"
      )}
    >
      <Handle
        type="target"
        position={Position.Left}
        className="!bg-info !w-3 !h-3 !border-2 !border-bg"
      />

      <div className="flex items-center justify-between gap-1 pb-2 border-b border-border">
        <div className="flex items-center gap-1.5 font-semibold text-xs text-accent">
          <ShieldCheck size={14} />
          <span>Covenant: {data.contractName}</span>
        </div>
        <span className="text-[9px] font-mono uppercase px-1.5 py-0.5 rounded bg-accent/15 border border-accent/40 text-accent font-semibold">
          P2SH Lock
        </span>
      </div>

      <div className="pt-2 space-y-2 text-[11px]">
        <div className="p-2 rounded bg-bg border border-border/80 space-y-1">
          <div className="text-[10px] text-fg-muted flex items-center justify-between">
            <span>UTXO Bloqueado</span>
            <span className="text-ok font-mono font-medium">● Activo</span>
          </div>
          <div className="text-sm font-semibold text-fg font-mono tabular-nums">{data.amountKas} KAS</div>
          <div className="text-[10px] text-fg-muted font-mono truncate">{data.amountSompi} sompi</div>
        </div>

        <div className="space-y-1 text-[10px]">
          <div className="flex items-center justify-between text-fg-muted">
            <span>Dirección del Contrato:</span>
          </div>
          <div className="font-mono text-[10px] text-accent truncate bg-bg px-1.5 py-0.5 rounded border border-border">
            {data.address}
          </div>
        </div>

        <div className="flex items-center justify-between text-[10px] text-fg-muted pt-1">
          <span>Ramas disponibles:</span>
          <span className="font-mono font-semibold text-fg">{data.entriesCount} entrypoints</span>
        </div>
      </div>

      <Handle
        type="source"
        position={Position.Right}
        className="!bg-accent !w-3 !h-3 !border-2 !border-bg"
      />
    </div>
  );
}

function EntrypointNodeView({ data }: NodeProps<Node<EntrypointNodeData, "entrypoint">>) {
  return (
    <div
      className={clsx(
        "rounded-lg border bg-bg-elev/95 p-3 shadow-md transition-all select-none w-64",
        data.selected ? "border-warn ring-2 ring-warn/30" : "border-border hover:border-warn/60"
      )}
    >
      <Handle
        type="target"
        position={Position.Left}
        className="!bg-accent !w-3 !h-3 !border-2 !border-bg"
      />

      <div className="flex items-center justify-between gap-1 pb-2 border-b border-border text-warn">
        <div className="flex items-center gap-1.5 font-semibold text-xs">
          <GitBranch size={13} />
          <span>{data.name}()</span>
        </div>
        <span className="text-[9px] font-mono uppercase px-1.5 py-0.5 rounded bg-warn/10 border border-warn/30 text-warn">
          Entrypoint
        </span>
      </div>

      <div className="pt-2 space-y-2 text-[11px]">
        <div>
          <div className="text-[10px] text-fg-muted mb-1">Parámetros requeridos:</div>
          <div className="flex flex-wrap gap-1">
            {data.params.length === 0 ? (
              <span className="text-[10px] text-fg-muted italic">sin argumentos</span>
            ) : (
              data.params.map((p, i) => (
                <span
                  key={i}
                  className="px-1.5 py-0.5 rounded bg-bg border border-border text-[10px] font-mono text-fg"
                >
                  {p.name}: <span className="text-warn">{p.kind}</span>
                </span>
              ))
            )}
          </div>
        </div>

        <div className="p-1.5 rounded bg-bg border border-border/80 space-y-1">
          <div className="text-[10px] text-fg-muted">Opcodes de validación:</div>
          <div className="flex flex-wrap gap-1 font-mono text-[9px]">
            {data.opcodes.map((op, i) => (
              <span key={i} className="px-1 py-0.2 rounded bg-bg-elev text-accent border border-border">
                {op}
              </span>
            ))}
          </div>
        </div>
      </div>

      <Handle
        type="source"
        position={Position.Right}
        className="!bg-warn !w-3 !h-3 !border-2 !border-bg"
      />
    </div>
  );
}

function SettlementNodeView({ data }: NodeProps<Node<SettlementNodeData, "settlement">>) {
  return (
    <div
      className={clsx(
        "rounded-lg border bg-bg-elev/95 p-3 shadow-md transition-all select-none w-64",
        data.selected ? "border-ok ring-2 ring-ok/30" : "border-border hover:border-ok/60"
      )}
    >
      <Handle
        type="target"
        position={Position.Left}
        className="!bg-warn !w-3 !h-3 !border-2 !border-bg"
      />

      <div className="flex items-center justify-between gap-1 pb-2 border-b border-border text-ok">
        <div className="flex items-center gap-1.5 font-semibold text-xs">
          <Coins size={13} />
          <span>{data.title}</span>
        </div>
        <span className="text-[9px] font-mono uppercase px-1.5 py-0.5 rounded bg-ok/10 border border-ok/30 text-ok">
          Output UTXO
        </span>
      </div>

      <div className="pt-2 space-y-1.5 text-[11px]">
        <div className="flex items-center justify-between">
          <span className="text-fg-muted">Destinatario:</span>
          <span className="font-semibold text-fg font-mono">@{data.recipient}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-fg-muted">Monto recibido:</span>
          <span className="font-semibold text-ok font-mono tabular-nums">{data.amountKas} KAS</span>
        </div>
        <div className="flex items-center justify-between text-[10px] text-fg-muted">
          <span>Fee minero:</span>
          <span className="font-mono tabular-nums">{data.feeKas} KAS</span>
        </div>
        <div className="p-1 rounded bg-bg border border-border/80 text-[10px] text-fg-muted">
          Condición: <span className="text-fg font-medium">{data.conditionMet}</span>
        </div>
      </div>
    </div>
  );
}

const NODE_TYPES = {
  funding: FundingNodeView,
  covenant: CovenantNodeView,
  entrypoint: EntrypointNodeView,
  settlement: SettlementNodeView
};

// ---------------------------------------------------------------- Main Covenant Graph View

export function CovenantView() {
  const engine = useEngine();
  const compiled = useSilver((s) => s.compiled);
  const deployments = useSilver((s) => s.deployments);
  const activeFile = useIde((s) => s.activeFile);

  const [presetId, setPresetId] = useState<string>("escrow");
  const [selectedNode, setSelectedNode] = useState<CovenantGraphNode | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const allPresets = useMemo<PresetDefinition[]>(() => {
    const list: PresetDefinition[] = [...PRESETS];
    if (compiled && compiled.contracts.length > 0) {
      const activeContract = compiled.contracts[0];
      const activeDeploy = deployments.find((d) => d.contract === activeContract.name);
      list.unshift({
        id: "workspace_active",
        name: `Workspace: ${activeContract.name} (Compilado)`,
        description: `Contrato activo del workspace (${compiled.sourcePath || "actual"}) compilado con SilverScript.`,
        contractName: activeContract.name,
        contractFile: compiled.sourcePath || activeFile || "contracts/contract.sil",
        funding: {
          title: "Fondeo del Contrato",
          account: "alice",
          address: "kaspa:qqalice9823h89dha983ydha098ydha7612ga7",
          amountKas: activeDeploy?.valueSompi ? (Number(activeDeploy.valueSompi) / 1e8).toFixed(2) : "100.00",
          txHash: activeDeploy?.txId ? `${activeDeploy.txId.slice(0, 16)}...` : "plan_workspace_init",
          status: "confirmed"
        },
        covenant: {
          contractName: activeContract.name,
          address: activeContract.address || activeDeploy?.address || "kaspa:p2sh_active_contract...",
          outpoint: activeDeploy?.outpoint ? `${activeDeploy.outpoint.transactionId}:${activeDeploy.outpoint.index}` : "tx_compiled:0",
          amountKas: activeDeploy?.valueSompi ? (Number(activeDeploy.valueSompi) / 1e8).toFixed(2) : "100.00",
          amountSompi: activeDeploy?.valueSompi || "10,000,000,000",
          lockingScript: activeContract.lockingScript || "OP_IF OP_CHECKSIG OP_ELSE OP_CHECKSEQUENCEVERIFY OP_ENDIF",
          status: activeDeploy?.spent ? "spent" : "locked",
          entriesCount: activeContract.entries.length
        },
        entrypoints: activeContract.entries.map((entry, idx) => ({
          data: {
            name: entry.name,
            contractName: activeContract.name,
            params: entry.params.map((p) => ({ name: p.name, kind: p.kind })),
            opcodes: entry.name.toLowerCase().includes("refund") ? ["OP_CHECKSEQUENCEVERIFY", "OP_CHECKSIG"] : ["OP_CHECKSIG", "OP_VERIFY"],
            condition: `Ejecución de ${entry.name}() con ${entry.params.length} argumento(s) requeridos.`,
            witnessStack: entry.params.map((p) => `<${p.name}>`).concat([`<0x0${idx}>`]),
            spendTarget: "beneficiary"
          },
          settlement: {
            title: `Liquidación ${entry.name}`,
            recipient: "beneficiary",
            address: "kaspa:qqbeneficiary_payout_address...",
            amountKas: "99.98",
            feeKas: "0.02",
            status: "claimable",
            conditionMet: `Entrada ${entry.name} verificada`
          }
        }))
      });
    }
    return list;
  }, [compiled, deployments, activeFile]);

  // Generate graph elements based on selected preset or active compiled contract
  const { initialNodes, initialEdges, activePreset } = useMemo(() => {
    const preset = allPresets.find((p) => p.id === presetId) || allPresets[0];

    const nodes: CovenantGraphNode[] = [];
    const edges: Edge[] = [];

    const startX = 50;
    const covenantX = 380;
    const entryX = 740;
    const settlementX = 1080;

    const totalEntries = preset.entrypoints.length;
    const verticalGap = 190;
    const startY = 100;
    const centerY = startY + ((totalEntries - 1) * verticalGap) / 2;

    // 1. Funding Node
    nodes.push({
      id: "node_funding",
      type: "funding",
      position: { x: startX, y: centerY },
      data: preset.funding
    });

    // 2. Covenant Contract Node
    nodes.push({
      id: "node_covenant",
      type: "covenant",
      position: { x: covenantX, y: centerY },
      data: preset.covenant
    });

    // Edge from Funding -> Covenant
    edges.push({
      id: "edge_fund_covenant",
      source: "node_funding",
      target: "node_covenant",
      animated: true,
      style: { stroke: "var(--info)", strokeWidth: 2 },
      label: "Fondeo P2SH"
    });

    // 3. Entrypoints & Settlement Outputs
    preset.entrypoints.forEach((ep, i) => {
      const epY = startY + i * verticalGap;
      const epId = `node_ep_${i}`;
      const settleId = `node_settle_${i}`;

      nodes.push({
        id: epId,
        type: "entrypoint",
        position: { x: entryX, y: epY },
        data: ep.data
      });

      edges.push({
        id: `edge_covenant_${epId}`,
        source: "node_covenant",
        target: epId,
        animated: true,
        style: { stroke: "var(--accent)", strokeWidth: 2 },
        label: `Gasto: ${ep.data.name}`
      });

      nodes.push({
        id: settleId,
        type: "settlement",
        position: { x: settlementX, y: epY },
        data: ep.settlement
      });

      edges.push({
        id: `edge_${epId}_${settleId}`,
        source: epId,
        target: settleId,
        animated: false,
        style: { stroke: "var(--ok)", strokeWidth: 2 },
        label: "Pago confirmado"
      });
    });

    return { initialNodes: nodes, initialEdges: edges, activePreset: preset };
  }, [allPresets, presetId]);

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  // Sync nodes when preset changes
  useEffect(() => {
    setNodes(initialNodes);
    setEdges(initialEdges);
    setSelectedNode(null);
  }, [initialNodes, initialEdges, setNodes, setEdges]);

  const handleNodeClick = (_: React.MouseEvent, node: Node) => {
    setSelectedNode(node as CovenantGraphNode);
  };

  const handleCopy = async (key: string, text: string) => {
    await copyText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 1500);
  };

  const openInEditor = (file: string) => {
    void engine.call("fileManager", "open", file);
  };

  return (
    <div className="h-full flex flex-col min-w-0 bg-bg text-fg select-none">
      {/* Top Toolbar */}
      <div className="shrink-0 flex items-center justify-between px-3 h-10 border-b border-border bg-bg-panel text-xs">
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 font-semibold text-fg">
            <Layers size={14} className="text-accent" />
            <span>Covenant Graph</span>
          </div>

          <div className="h-4 w-px bg-border mx-1" />

          {/* Preset Selector */}
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] text-fg-muted">Flujo:</span>
            <select
              className="input !py-0.5 !h-7 text-xs bg-bg font-medium cursor-pointer"
              value={presetId}
              onChange={(e) => setPresetId(e.target.value)}
            >
              {allPresets.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => openInEditor(activePreset.contractFile)}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded border border-border bg-bg-elev hover:bg-bg-hover hover:border-accent/40 text-[11px] text-fg cursor-pointer transition-colors"
            title="Abrir contrato SilverScript en el editor"
          >
            <FileCode2 size={12} className="text-accent" />
            <span>Ver {activePreset.contractFile}</span>
          </button>

          <button
            type="button"
            onClick={() => useIde.getState().setActiveSidePlugin("deployRun")}
            className="btn-primary !py-1 !h-7 text-[11px] cursor-pointer"
            title="Desplegar o interactuar en simnet"
          >
            <Play size={11} />
            <span>Deploy & Run</span>
          </button>
        </div>
      </div>

      {/* Main Graph Canvas + Inspector Sidebar */}
      <div className="flex-1 min-h-0 relative flex">
        {/* ReactFlow Interactive Canvas */}
        <div className="flex-1 h-full min-w-0 relative">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onNodeClick={handleNodeClick}
            nodeTypes={NODE_TYPES}
            fitView
            fitViewOptions={{ padding: 0.2 }}
            minZoom={0.3}
            maxZoom={1.8}
            className="bg-bg"
          >
            <Background color="var(--border)" gap={20} size={1} />
            <Controls className="!bg-bg-elev !border-border !rounded-md" />
            <MiniMap
              className="!bg-bg-elev !border-border !rounded-md"
              nodeColor={(n) => {
                if (n.type === "funding") return "var(--info)";
                if (n.type === "covenant") return "var(--accent)";
                if (n.type === "entrypoint") return "var(--warn)";
                return "var(--ok)";
              }}
            />
          </ReactFlow>

          {/* Quick Legend Overlay */}
          <div className="absolute bottom-3 left-3 z-10 flex items-center gap-3 px-3 py-1.5 rounded-lg border border-border bg-bg-elev/90 backdrop-blur-sm text-[11px] shadow-sm select-none">
            <span className="flex items-center gap-1 text-info font-medium">
              <span className="w-2 h-2 rounded-full bg-info" /> Fondeo (In)
            </span>
            <span className="flex items-center gap-1 text-accent font-medium">
              <span className="w-2 h-2 rounded-full bg-accent" /> Covenant P2SH
            </span>
            <span className="flex items-center gap-1 text-warn font-medium">
              <span className="w-2 h-2 rounded-full bg-warn" /> Entrypoints
            </span>
            <span className="flex items-center gap-1 text-ok font-medium">
              <span className="w-2 h-2 rounded-full bg-ok" /> Settlement (Out)
            </span>
          </div>
        </div>

        {/* Inspector Sidebar Drawer */}
        {selectedNode ? (
          <div className="w-80 shrink-0 border-l border-border bg-bg-panel flex flex-col h-full animate-in slide-in-from-right duration-150">
            <div className="flex items-center justify-between px-3.5 py-2.5 border-b border-border">
              <div className="flex items-center gap-2 font-semibold text-xs">
                {selectedNode.type === "funding" && <Wallet size={14} className="text-info" />}
                {selectedNode.type === "covenant" && <ShieldCheck size={14} className="text-accent" />}
                {selectedNode.type === "entrypoint" && <GitBranch size={14} className="text-warn" />}
                {selectedNode.type === "settlement" && <Coins size={14} className="text-ok" />}
                <span>
                  {selectedNode.type === "funding" && "Input UTXO"}
                  {selectedNode.type === "covenant" && "Covenant UTXO"}
                  {selectedNode.type === "entrypoint" && "Condición de Gasto"}
                  {selectedNode.type === "settlement" && "Output Settlement"}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setSelectedNode(null)}
                className="p-1 rounded text-fg-muted hover:text-fg hover:bg-bg-hover cursor-pointer"
                title="Cerrar inspector"
              >
                <X size={13} />
              </button>
            </div>

            <div className="flex-1 overflow-auto p-3.5 space-y-4 text-xs">
              {/* Covenant Node Inspector */}
              {selectedNode.type === "covenant" && (
                <>
                  <div className="space-y-1">
                    <div className="text-[10px] text-fg-muted uppercase tracking-wider font-semibold">Contrato</div>
                    <div className="font-semibold text-sm text-accent">{selectedNode.data.contractName}</div>
                  </div>

                  <div className="p-2.5 rounded-lg border border-border bg-bg space-y-2">
                    <div className="text-[10px] text-fg-muted uppercase tracking-wider font-semibold">Monto Bloqueado</div>
                    <div className="text-base font-mono font-semibold text-fg tabular-nums">{selectedNode.data.amountKas} KAS</div>
                    <div className="text-[10px] font-mono text-fg-muted">{selectedNode.data.amountSompi} sompi</div>
                  </div>

                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-[10px] text-fg-muted font-semibold uppercase tracking-wider">
                      <span>Dirección P2SH</span>
                      <button
                        type="button"
                        onClick={() => handleCopy("covenantAddr", selectedNode.data.address)}
                        className="text-accent hover:underline flex items-center gap-1 cursor-pointer"
                      >
                        {copiedKey === "covenantAddr" ? <Check size={11} className="text-ok" /> : <Copy size={11} />}
                        <span>{copiedKey === "covenantAddr" ? "Copiado" : "Copiar"}</span>
                      </button>
                    </div>
                    <div className="font-mono text-[10px] p-2 rounded bg-bg border border-border break-all">
                      {selectedNode.data.address}
                    </div>
                  </div>

                  {selectedNode.data.lockingScript && (
                    <div className="space-y-1">
                      <div className="text-[10px] text-fg-muted uppercase tracking-wider font-semibold">Locking Script (Opcodes)</div>
                      <pre className="font-mono text-[10px] p-2 rounded bg-bg border border-border text-accent whitespace-pre-wrap leading-relaxed">
                        {selectedNode.data.lockingScript}
                      </pre>
                    </div>
                  )}
                </>
              )}

              {/* Entrypoint Node Inspector */}
              {selectedNode.type === "entrypoint" && (
                <>
                  <div className="space-y-1">
                    <div className="text-[10px] text-fg-muted uppercase tracking-wider font-semibold">Función de Gasto</div>
                    <div className="font-semibold text-sm text-warn font-mono">{selectedNode.data.name}()</div>
                  </div>

                  <div className="p-2.5 rounded-lg border border-border bg-bg space-y-2">
                    <div className="text-[10px] text-fg-muted uppercase tracking-wider font-semibold">Lógica de Desbloqueo</div>
                    <p className="text-[11px] text-fg leading-relaxed">{selectedNode.data.condition}</p>
                  </div>

                  <div className="space-y-1.5">
                    <div className="text-[10px] text-fg-muted uppercase tracking-wider font-semibold">Witness Stack Requerido</div>
                    <div className="p-2 rounded bg-bg border border-border space-y-1 font-mono text-[11px]">
                      <div className="text-[9px] text-fg-muted pb-1 border-b border-border">Pila de ejecución (Stack Top al inicio):</div>
                      {selectedNode.data.witnessStack.map((item, idx) => (
                        <div key={idx} className="flex items-center gap-2 text-fg">
                          <span className="text-[9px] text-accent font-semibold w-4">#{idx}</span>
                          <span className="text-ok">{item}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <div className="text-[10px] text-fg-muted uppercase tracking-wider font-semibold">Secuencia de Opcodes</div>
                    <div className="flex flex-wrap gap-1 font-mono text-[10px]">
                      {selectedNode.data.opcodes.map((op, i) => (
                        <span key={i} className="px-2 py-1 rounded bg-bg border border-border text-accent font-medium">
                          {op}
                        </span>
                      ))}
                    </div>
                  </div>
                </>
              )}

              {/* Funding Node Inspector */}
              {selectedNode.type === "funding" && (
                <>
                  <div className="space-y-1">
                    <div className="text-[10px] text-fg-muted uppercase tracking-wider font-semibold">Fondeador</div>
                    <div className="font-semibold text-sm text-info font-mono">@{selectedNode.data.account}</div>
                  </div>

                  <div className="p-2.5 rounded-lg border border-border bg-bg space-y-1.5">
                    <div className="text-[10px] text-fg-muted uppercase tracking-wider font-semibold">Depósito de Entrada</div>
                    <div className="text-base font-mono font-semibold text-fg tabular-nums">{selectedNode.data.amountKas} KAS</div>
                    <div className="text-[10px] text-ok">Estado: {selectedNode.data.status}</div>
                  </div>

                  <div className="space-y-1">
                    <div className="text-[10px] text-fg-muted uppercase tracking-wider font-semibold">Outpoint TxHash</div>
                    <div className="font-mono text-[10px] p-2 rounded bg-bg border border-border break-all">
                      {selectedNode.data.txHash}
                    </div>
                  </div>
                </>
              )}

              {/* Settlement Node Inspector */}
              {selectedNode.type === "settlement" && (
                <>
                  <div className="space-y-1">
                    <div className="text-[10px] text-fg-muted uppercase tracking-wider font-semibold">Destino de Salida</div>
                    <div className="font-semibold text-sm text-ok font-mono">@{selectedNode.data.recipient}</div>
                  </div>

                  <div className="p-2.5 rounded-lg border border-border bg-bg space-y-1.5">
                    <div className="text-[10px] text-fg-muted uppercase tracking-wider font-semibold">Net Payout</div>
                    <div className="text-base font-mono font-semibold text-ok tabular-nums">{selectedNode.data.amountKas} KAS</div>
                    <div className="text-[10px] text-fg-muted">Fee deducido: {selectedNode.data.feeKas} KAS</div>
                  </div>

                  <div className="space-y-1">
                    <div className="text-[10px] text-fg-muted uppercase tracking-wider font-semibold">Dirección de Destino</div>
                    <div className="font-mono text-[10px] p-2 rounded bg-bg border border-border break-all">
                      {selectedNode.data.address}
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        ) : (
          <div className="w-72 shrink-0 border-l border-border bg-bg-panel/40 p-4 text-xs flex flex-col justify-between hidden md:flex">
            <div className="space-y-3">
              <div className="font-semibold text-fg text-xs flex items-center gap-1.5">
                <Sparkles size={13} className="text-accent" />
                <span>Inspector de UTXOs</span>
              </div>
              <p className="text-fg-muted text-[11px] leading-relaxed">
                Haz clic en cualquier nodo o rama del diagrama para inspeccionar los opcodes de Kaspa Script, el stack de testigos (witness) y las condiciones de validación del covenant.
              </p>
            </div>

            <div className="p-3 rounded-lg border border-border bg-bg space-y-2">
              <div className="text-[10px] uppercase font-semibold text-fg-muted tracking-wider">Flujo Activo</div>
              <div className="font-medium text-fg text-xs">{activePreset.name}</div>
              <div className="text-[10px] text-fg-muted leading-relaxed">{activePreset.description}</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
