import { Server } from "lucide-react";
import { api } from "@/api/client";
import { Plugin } from "@/engine/engine";
import { ServersPanel } from "@/panels/ServersPanel";
import { useEnv, type AccountInfo, type NodeStatus } from "@/store/env";
import { useIde, type ExecutionTarget } from "@/store/ide";
import type { ConsolePlugin } from "./console";

/**
 * Environment service, in the spirit of Eclipse's "Servers" view: the node you
 * are pointing at (start / stop / restart / status) and the accounts that exist
 * in the workspace, with balances on the current target's network.
 *
 * Everything goes through the HardKas CLI:
 *   localnet status|start|stop --json          node lifecycle (Docker rusty-kaspad, Toccata profile)
 *   accounts list --json                       accounts known to the workspace
 *   accounts balance <name> --network <net>    balance per account
 *   localnet account create <name> --json      new real simnet account (plaintext key in accounts.real.json)
 */

export function networkForTarget(target: ExecutionTarget): string {
  return target === "simulator" ? "simulated" : target === "localnet" ? "simnet" : "testnet-10";
}

export class EnvironmentPlugin extends Plugin {
  view = ServersPanel;
  private offs: Array<() => void> = [];
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    super({
      name: "environment",
      displayName: "Servers",
      description: "Node status and accounts",
      location: "sidePanel",
      icon: Server,
      order: 15,
      methods: ["refresh", "refreshNode", "refreshDocker", "refreshAccounts", "startNode", "stopNode", "restartNode", "createAccount", "copyPrivateKey", "getPrivateKey", "fund"],
      events: ["nodeChanged", "accountsChanged"]
    });
  }

  async onActivation(): Promise<void> {
    void this.refresh();
    this.offs.push(
      this.on("deployRun", "transactionExecuted", () => void this.refreshAccounts()),
      useIde.subscribe((s, prev) => {
        if (s.target !== prev.target) void this.refreshAccounts();
      })
    );
    // Light polling of the node, like Eclipse's server state refresh.
    this.timer = setInterval(() => void this.refreshNode(true), 30_000);
  }

  onDeactivation(): void {
    for (const off of this.offs) off();
    this.offs = [];
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private console(): ConsolePlugin {
    return this.engine.get<ConsolePlugin>("console");
  }

  async refresh(): Promise<void> {
    await Promise.all([this.refreshNode(true), this.refreshAccounts()]);
    useEnv.getState().touch();
  }

  /** Is Docker there? Checked once per refresh; the Servers view explains what to do when it is not. */
  async refreshDocker(): Promise<void> {
    try {
      const sys = await api.system();
      useEnv.getState().setDocker(sys.docker);
    } catch {
      useEnv.getState().setDocker(null);
    }
  }

  async refreshNode(quiet = false): Promise<NodeStatus | null> {
    const env = useEnv.getState();
    await this.refreshDocker();
    try {
      // `localnet status` knows the Toccata profile: identity verification, miner, DAA, server version.
      // `node status` is the generic Docker view; parseNodeStatus understands both shapes.
      const run = await this.console().runHardkas(["localnet", "status", "--json"], { quiet });
      const raw = run.result as Record<string, unknown> | null;
      if (!raw) throw new Error("localnet status returned no JSON");
      const node = parseNodeStatus(raw);
      env.setNode(node);
      env.setError(null);
      this.emit("nodeChanged", node);
      return node;
    } catch (e) {
      env.setError(e instanceof Error ? e.message : String(e));
      return null;
    }
  }

  /** `localnet start --toccata` starts (or adopts) rusty-kaspad AND creates the dev accounts alice…erin. */
  async startNode(): Promise<void> {
    await this.nodeAction("start", ["localnet", "start", "--toccata", "--json"]);
  }

  /** `localnet stop` stops the node and its CPU miner (plain `node stop` would leave the miner running). */
  async stopNode(): Promise<void> {
    await this.nodeAction("stop", ["localnet", "stop", "--toccata", "--json"]);
  }

  async restartNode(): Promise<void> {
    const env = useEnv.getState();
    env.setNodeBusy("restart");
    try {
      await this.console().runHardkas(["localnet", "stop", "--toccata", "--json"]);
      await this.console().runHardkas(["localnet", "start", "--toccata", "--json"]);
    } finally {
      env.setNodeBusy(null);
      await this.refreshNode(true);
      await this.refreshAccounts();
    }
  }

  private async nodeAction(label: string, args: string[]): Promise<void> {
    const env = useEnv.getState();
    env.setNodeBusy(label);
    try {
      await this.console().runHardkas(args);
    } finally {
      env.setNodeBusy(null);
      await this.refreshNode(true);
      await this.refreshAccounts();
    }
  }

  private accountsSeq = 0;

  async refreshAccounts(): Promise<AccountInfo[]> {
    const seq = ++this.accountsSeq;
    const env = useEnv.getState();
    env.setAccountsBusy(true);
    try {
      const network = networkForTarget(useIde.getState().target);
      const [run, devKeyNames] = await Promise.all([
        this.console().runHardkas(["accounts", "list", "--json"], { quiet: true }),
        api.devkeys.list().catch(() => [] as string[])
      ]);
      if (seq !== this.accountsSeq) return useEnv.getState().accounts;
      const devKeySet = new Set(devKeyNames);
      const list = Array.isArray(run.result) ? (run.result as Array<{ name: string; kind: string; address: string }>) : [];
      const accounts: AccountInfo[] = list.map((a) => {
        const canExport = devKeySet.has(a.name);
        return {
          name: a.name,
          kind: a.kind,
          address: a.address,
          balanceSompi: null,
          utxoCount: null,
          balanceNetwork: network,
          hasPlainKey: canExport,
          keystore: canExport ? "dev-keystore" : a.kind === "synthetic" ? "encrypted" : "unknown"
        };
      });
      env.setAccounts(accounts);
      this.emit("accountsChanged", accounts);
      await Promise.all(
        accounts.map(async (a) => {
          try {
            const b = await this.console().runHardkas(["accounts", "balance", a.name, "--network", network, "--json"], { quiet: true });
            if (seq !== this.accountsSeq) return;
            const res = (b.result as { result?: { balanceSompi?: string; utxoCount?: number; address?: string } } | null)?.result;
            env.patchAccount(a.name, {
              balanceSompi: res?.balanceSompi ?? "0",
              utxoCount: res?.utxoCount ?? 0,
              balanceNetwork: network,
              address: res?.address ?? a.address
            });
          } catch {
            if (seq !== this.accountsSeq) return;
            env.patchAccount(a.name, { balanceSompi: "0", utxoCount: 0, balanceNetwork: network });
          }
        })
      );
      return useEnv.getState().accounts;
    } finally {
      if (seq === this.accountsSeq) {
        env.setAccountsBusy(false);
        env.touch();
      }
    }
  }

  async createAccount(name: string): Promise<void> {
    if (!/^[a-z][a-z0-9_-]{0,31}$/i.test(name)) throw new Error("Account name: letters, digits, dash or underscore, starting with a letter");
    await this.console().runHardkas(["localnet", "account", "create", name, "--json"]);
    await this.refreshAccounts();
  }

  /**
   * Funding depends on the environment:
   *   Simulator  → `accounts fund` (HardKas' in-memory faucet; marked deprecated but the only simulator faucet)
   *   Local node → `localnet fund --profile toccata-v2` (mines real simnet blocks to the account)
   *   Testnet    → no faucet from the IDE
   */
  async fund(name: string, amountKas: string): Promise<void> {
    const target = useIde.getState().target;
    if (target === "localnet") {
      await this.console().runHardkas(["localnet", "fund", name, "--amount", amountKas, "--profile", "toccata-v2", "--json"]);
    } else if (target === "simulator") {
      await this.console().runHardkas(["accounts", "fund", name, "--amount", amountKas]);
    } else {
      throw new Error("No faucet for the public testnet from the IDE; use a testnet faucet and send to the address.");
    }
    await this.refreshAccounts();
  }

  /**
   * Copies the raw hex private key to the clipboard without rendering it.
   * Works for both accounts.real.json and HardKas dev keystores (.hardkas/dev-accounts).
   * Format is raw 64 hex characters, directly importable into KasWare.
   */
  async copyPrivateKey(name: string): Promise<boolean> {
    const key = await this.getPrivateKey(name);
    if (!key) return false;
    await navigator.clipboard.writeText(key);
    this.console().info(`Private key of ${name} copied to clipboard (raw hex, KasWare compatible).`);
    return true;
  }

  /** Returns the raw hex private key so the Accounts view can reveal it for KasWare; null if not exportable. */
  async getPrivateKey(name: string): Promise<string | null> {
    try {
      const dev = await api.devkeys.reveal(name);
      return dev.privateKey;
    } catch {
      return null;
    }
  }
}

function parseNodeStatus(raw: Record<string, unknown>): NodeStatus {
  const container = (raw.container ?? {}) as Record<string, unknown>;
  const rpc = (raw.rpc ?? {}) as Record<string, unknown>;
  const node = (raw.node ?? {}) as Record<string, unknown>;
  const identity = (raw.identity ?? {}) as Record<string, unknown>;
  const observed = (identity.observed ?? {}) as Record<string, unknown>;
  const server = (observed.server ?? {}) as Record<string, unknown>;
  const expected = (identity.expected ?? {}) as Record<string, unknown>;
  const miner = (raw.miner ?? {}) as Record<string, unknown>;

  const running = Boolean(container.running ?? node.running);
  const rpcReady = Boolean(rpc.ready ?? node.rpcReady ?? node.ready);

  const rpcTransports = (rpc.transports ?? {}) as Record<string, { port?: number; ready?: boolean }>;
  const nodeTransports = (node.transports ?? {}) as Record<string, { port?: number; ready?: boolean }>;
  const transports = Object.keys(rpcTransports).length > 0 ? rpcTransports : nodeTransports;

  const nodePorts = (node.ports ?? {}) as Record<string, number | undefined>;
  const ports: NodeStatus["ports"] = {
    rpc: rpcTransports.grpc?.port ?? nodePorts.rpc,
    borshRpc: rpcTransports.borsh?.port ?? nodePorts.borshRpc,
    jsonRpc: rpcTransports.json?.port ?? nodePorts.jsonRpc
  };

  return {
    profile: String(raw.profile ?? "toccata-v2"),
    status: String(raw.status ?? (rpcReady ? "READY" : running ? "STARTING" : "STOPPED")),
    running,
    rpcReady,
    containerName: (container.name as string | undefined) ?? (node.containerName as string | undefined) ?? (expected.containerName as string | undefined),
    image: (container.image as string | undefined) ?? (node.image as string | undefined) ?? (expected.image as string | undefined),
    network: (node.network as string | undefined) ?? (expected.network as string | undefined) ?? "simnet",
    rpcUrl: (rpc.url as string | undefined) ?? (node.rpcUrl as string | undefined),
    ports,
    serverVersion: (server.serverVersion as string | undefined) ?? (expected.serverVersion as string | undefined),
    isSynced: server.isSynced as boolean | undefined,
    virtualDaaScore: server.virtualDaaScore as string | undefined,
    miner: miner && typeof miner.running === "boolean" ? { running: Boolean(miner.running), status: String(miner.status ?? "") } : undefined,
    lastError: (rpc.lastError as string | null | undefined) ?? (node.lastError as string | null | undefined) ?? null,
    checkedAt: identity.checkedAt as string | undefined,
    raw: { ...raw, transports }
  };
}
