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
      methods: ["refresh", "refreshNode", "refreshAccounts", "startNode", "stopNode", "restartNode", "createAccount", "copyPrivateKey", "fund"],
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

  async refreshNode(quiet = false): Promise<NodeStatus | null> {
    const env = useEnv.getState();
    try {
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

  async startNode(): Promise<void> {
    await this.nodeAction("start", ["localnet", "start", "--toccata", "--json"]);
  }

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

  async refreshAccounts(): Promise<AccountInfo[]> {
    const env = useEnv.getState();
    env.setAccountsBusy(true);
    try {
      const network = networkForTarget(useIde.getState().target);
      const run = await this.console().runHardkas(["accounts", "list", "--json"], { quiet: true });
      const list = Array.isArray(run.result) ? (run.result as Array<{ name: string; kind: string; address: string }>) : [];
      const plainKeys = await this.readPlainKeys();
      const accounts: AccountInfo[] = list.map((a) => ({
        name: a.name,
        kind: a.kind,
        address: a.address,
        balanceSompi: null,
        utxoCount: null,
        balanceNetwork: network,
        hasPlainKey: plainKeys.has(a.name),
        keystore: plainKeys.has(a.name) ? "plain" : a.kind === "synthetic" ? "encrypted" : "unknown"
      }));
      env.setAccounts(accounts);
      this.emit("accountsChanged", accounts);
      // Balances one by one (the CLI has no batch call); keep the UI responsive.
      for (const a of accounts) {
        try {
          const b = await this.console().runHardkas(["accounts", "balance", a.name, "--network", network, "--json"], { quiet: true });
          const res = (b.result as { result?: { balanceSompi?: string; utxoCount?: number; address?: string } } | null)?.result;
          // `accounts list` always reports the synthetic address; `accounts balance` reports the one used on this network.
          env.patchAccount(a.name, {
            balanceSompi: res?.balanceSompi ?? "0",
            utxoCount: res?.utxoCount ?? 0,
            balanceNetwork: network,
            address: res?.address ?? a.address
          });
        } catch {
          env.patchAccount(a.name, { balanceSompi: "0", utxoCount: 0, balanceNetwork: network });
        }
      }
      return useEnv.getState().accounts;
    } finally {
      env.setAccountsBusy(false);
      env.touch();
    }
  }

  async createAccount(name: string): Promise<void> {
    if (!/^[a-z][a-z0-9_-]{0,31}$/i.test(name)) throw new Error("Account name: letters, digits, dash or underscore, starting with a letter");
    await this.console().runHardkas(["localnet", "account", "create", name, "--json"]);
    await this.refreshAccounts();
  }

  async fund(name: string, amountKas: string): Promise<void> {
    const target = useIde.getState().target;
    if (target === "localnet") {
      await this.console().runHardkas(["localnet", "fund", name, "--amount", amountKas, "--profile", "toccata-v2", "--json"]);
    } else {
      await this.console().runHardkas(["localnet", "fund", name, "--amount", amountKas, "--json"]);
    }
    await this.refreshAccounts();
  }

  /**
   * Copies the private key to the clipboard without ever rendering it.
   * Only accounts stored in plaintext by `localnet account create` can be copied;
   * alice…erin live in argon2id/AES-GCM keystores the CLI does not export.
   */
  async copyPrivateKey(name: string): Promise<boolean> {
    const keys = await this.readPlainKeys();
    const key = keys.get(name);
    if (!key) return false;
    await navigator.clipboard.writeText(key);
    this.console().info(`Private key of ${name} copied to the clipboard (simnet dev account). It was not displayed.`);
    return true;
  }

  private async readPlainKeys(): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    try {
      const text = await api.fs.read(".hardkas/accounts.real.json");
      const parsed = JSON.parse(text) as unknown;
      const entries: Array<Record<string, unknown>> = Array.isArray(parsed)
        ? (parsed as Array<Record<string, unknown>>)
        : parsed && typeof parsed === "object" && Array.isArray((parsed as { accounts?: unknown }).accounts)
          ? ((parsed as { accounts: Array<Record<string, unknown>> }).accounts)
          : parsed && typeof parsed === "object"
            ? Object.entries(parsed as Record<string, unknown>).map(([k, v]) => ({ name: k, ...(v as Record<string, unknown>) }))
            : [];
      for (const e of entries) {
        const name = typeof e.name === "string" ? e.name : typeof e.label === "string" ? e.label : null;
        const key = ["privateKey", "privateKeyHex", "secretKey", "secret"].map((k) => e[k]).find((v) => typeof v === "string") as string | undefined;
        if (name && key) map.set(name, key);
      }
    } catch {
      // no plaintext store: nothing to copy
    }
    return map;
  }
}

function parseNodeStatus(raw: Record<string, unknown>): NodeStatus {
  const node = (raw.node ?? {}) as Record<string, unknown>;
  const identity = (raw.identity ?? {}) as Record<string, unknown>;
  const observed = (identity.observed ?? {}) as Record<string, unknown>;
  const server = (observed.server ?? {}) as Record<string, unknown>;
  const expected = (identity.expected ?? {}) as Record<string, unknown>;
  const miner = (raw.miner ?? {}) as Record<string, unknown>;
  const transports = (node.transports ?? {}) as Record<string, { port?: number; ready?: boolean }>;
  const running = Boolean(node.running);
  const rpcReady = Boolean(node.rpcReady ?? node.ready);
  return {
    profile: String(raw.profile ?? "toccata-v2"),
    status: String(raw.status ?? (rpcReady ? "READY" : running ? "STARTING" : "STOPPED")),
    running,
    rpcReady,
    containerName: (node.containerName as string | undefined) ?? (expected.containerName as string | undefined),
    image: (node.image as string | undefined) ?? (expected.image as string | undefined),
    network: (node.network as string | undefined) ?? (expected.network as string | undefined),
    rpcUrl: node.rpcUrl as string | undefined,
    ports: node.ports as NodeStatus["ports"],
    serverVersion: (server.serverVersion as string | undefined) ?? (expected.serverVersion as string | undefined),
    isSynced: server.isSynced as boolean | undefined,
    virtualDaaScore: server.virtualDaaScore as string | undefined,
    miner: miner && typeof miner.running === "boolean" ? { running: Boolean(miner.running), status: String(miner.status ?? "") } : undefined,
    lastError: (node.lastError as string | null | undefined) ?? null,
    checkedAt: identity.checkedAt as string | undefined,
    raw: { ...raw, transports }
  };
}
