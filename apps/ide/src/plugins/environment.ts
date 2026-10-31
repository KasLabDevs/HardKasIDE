import { Server } from "lucide-react";
import { api } from "@/api/client";
import { Plugin } from "@/engine/engine";
import { copyText } from "@/utils/clipboard";
import { ServersPanel } from "@/panels/ServersPanel";
import { useEnv, type AccountInfo, type NodeOp, type NodeStatus } from "@/store/env";
import { useIde, userChoseTarget, type ExecutionTarget } from "@/store/ide";
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
      methods: ["refresh", "refreshNode", "refreshDocker", "refreshCli", "refreshAccounts", "startNode", "stopNode", "restartNode", "resetNode", "createAccount", "copyPrivateKey", "getPrivateKey", "fund", "startMiner", "stopMiner", "mineBurst"],
      events: ["nodeChanged", "accountsChanged", "minerChanged"]
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
    await Promise.all([this.refreshNode(true), this.refreshAccounts(), this.refreshCli()]);
    useEnv.getState().touch();
  }

  /** Which hardkas the server runs for this workspace; the status bar warns when it is not the tested version. */
  async refreshCli(): Promise<void> {
    try {
      const cli = await api.cli();
      useEnv.getState().setCli(cli);
      if (cli.version && cli.version !== cli.pinned) {
        this.console().warn(`HardKas CLI ${cli.version} (${cli.source}); this IDE was tested with ${cli.pinned}. Records and command output may differ.`);
      } else if (!cli.version) {
        this.console().warn(`The hardkas CLI did not answer --version (${cli.command}): ${cli.error ?? "unknown error"}`);
      }
    } catch {
      useEnv.getState().setCli(null);
    }
  }

  /** Is Docker there? Checked once per refresh; the Servers view explains what to do when it is not. */
  async refreshDocker(): Promise<void> {
    try {
      const sys = await api.system();
      useEnv.getState().setDocker(sys.docker);
      this.applyDockerFallback(sys.docker);
    } catch {
      useEnv.getState().setDocker(null);
    }
  }

  private notifiedFallback = false;

  /**
   * The default environment is the Docker local node. If Docker is missing or stopped and the user never
   * chose an environment themselves, start in the Simulator instead of a broken state, and say why once.
   * An explicit choice is never overridden.
   */
  private applyDockerFallback(docker: { installed: boolean; running: boolean }): void {
    const ide = useIde.getState();
    if (userChoseTarget() || ide.target !== "localnet" || (docker.installed && docker.running)) return;
    useIde.setState({ target: "simulator" });
    if (!this.notifiedFallback) {
      this.notifiedFallback = true;
      this.console().info(`${docker.installed ? "Docker is not running" : "Docker is not installed"}: using the Simulator for now. Start Docker and pick "Local node" to use a real rusty-kaspad.`);
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

  // ---- node operations: every one shows its steps (store.nodeOp) so nobody stares at stale balances ----

  private stepStopNode = (): OpStep => ({ label: "Stopping the node and its miner", run: async () => this.runCli(["localnet", "stop", "--toccata", "--json"], "Could not stop the node") });
  private stepStartNode = (): OpStep => ({ label: "Starting rusty-kaspad (Docker)", run: async () => this.runCli(["localnet", "start", "--toccata", "--json"], "Could not start the node") });
  private stepWaitReady = (): OpStep => ({ label: "Waiting for the node to answer on RPC", run: async (note) => this.waitUntilReady(note) });
  private stepLoadAccounts = (): OpStep => ({
    label: "Loading the dev accounts and their balances",
    run: async () => {
      await this.refreshAccounts();
    }
  });

  /** `localnet start --toccata` starts (or adopts) rusty-kaspad AND creates the dev accounts alice…erin. */
  async startNode(): Promise<void> {
    await this.runOp("start", "Starting the local node", [this.stepStartNode(), this.stepWaitReady(), this.stepLoadAccounts()], "The node is ready. Fund an account to mine its first KAS.");
  }

  /** `localnet stop` stops the node and its CPU miner (plain `node stop` would leave the miner running). */
  async stopNode(): Promise<void> {
    await this.runOp("stop", "Stopping the local node", [this.stepStopNode()], "The node is stopped. Transactions on the Local node will fail until it is started.");
  }

  async restartNode(): Promise<void> {
    await this.runOp("restart", "Restarting the local node", [this.stepStopNode(), this.stepStartNode(), this.stepWaitReady(), this.stepLoadAccounts()], "The node is back.");
  }

  /**
   * Wipes the local chain and starts over: stop node + miner, `node reset --yes` (removes all local chain
   * data), then `localnet start --toccata` (fresh node, dev accounts recreated, empty). Callers must have
   * asked the user to confirm: this is destructive.
   */
  async resetNode(): Promise<void> {
    await this.runOp(
      "reset",
      "Resetting the local node from scratch",
      [
        this.stepStopNode(),
        { label: "Wiping all local chain data", run: async () => this.runCli(["node", "reset", "--yes"], "node reset failed: the local chain was not wiped") },
        { ...this.stepStartNode(), label: "Starting a fresh node" },
        this.stepWaitReady(),
        { ...this.stepLoadAccounts(), label: "Recreating the dev accounts (empty)" }
      ],
      "Fresh empty chain. Fund an account to mine its first KAS."
    );
  }

  /** Runs a hardkas command through the console and throws with `failure` when it does not succeed. */
  private async runCli(args: string[], failure: string): Promise<void> {
    const run = await this.console().runHardkas(args);
    if (run.status !== "succeeded") throw new Error(`${failure} (exit ${run.exitCode}). See the Console for details.`);
  }

  /** Polls `localnet status` until the node answers RPC (up to ~2 minutes: first start pulls the image and mines). */
  private async waitUntilReady(note: (text: string) => void): Promise<void> {
    const deadline = Date.now() + 120_000;
    let tries = 0;
    for (;;) {
      const node = await this.refreshNode(true);
      if (node?.rpcReady) return;
      if (Date.now() > deadline) throw new Error("The node did not answer on RPC within 2 minutes. Check the Console and Docker.");
      tries += 1;
      note(`attempt ${tries}…`);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }

  /** Executes the steps in order, publishing progress; the Accounts/Servers/Deploy views lock while it runs. */
  private async runOp(kind: NodeOp["kind"], title: string, steps: OpStep[], next: string): Promise<void> {
    const env = useEnv.getState();
    if (env.nodeOp?.state === "running") return; // one operation at a time
    env.setNodeBusy(kind);
    env.setNodeOp({ kind, title, steps: steps.map((s) => ({ label: s.label, status: "pending" })), state: "running", startedAt: Date.now() });
    let failed: string | null = null;
    for (let i = 0; i < steps.length; i++) {
      useEnv.getState().patchNodeOp(i, { status: "running" });
      try {
        await steps[i].run((detail) => useEnv.getState().patchNodeOp(i, { detail }));
        useEnv.getState().patchNodeOp(i, { status: "done", detail: undefined });
      } catch (e) {
        failed = e instanceof Error ? e.message : String(e);
        useEnv.getState().patchNodeOp(i, { status: "error", detail: failed });
        this.console().error(failed);
        break;
      }
    }
    env.setNodeBusy(null);
    await this.refreshNode(true); // the real state after the operation, whatever happened
    useEnv.getState().patchNodeOp(null, undefined, failed ? { state: "error", error: failed } : { state: "done", next });
    if (failed) {
      await this.refreshAccounts();
    } else {
      this.console().info(`${title}: done. ${next}`);
      // Success notices fade on their own; errors stay until dismissed.
      setTimeout(() => {
        const op = useEnv.getState().nodeOp;
        if (op && op.state === "done" && op.kind === kind) useEnv.getState().setNodeOp(null);
      }, 6000);
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
   *   Simulator  → `simulator fund` (HardKas' in-memory faucet)
   *   Local node → `localnet fund --profile toccata-v2` (mines real simnet blocks to the account)
   *   Testnet    → no faucet from the IDE
   */
  async fund(name: string, amountKas: string): Promise<void> {
    const target = useIde.getState().target;
    if (target === "localnet") {
      await this.console().runHardkas(["localnet", "fund", name, "--amount", amountKas, "--profile", "toccata-v2", "--json"]);
    } else if (target === "simulator") {
      // `simulator fund` is the stable replacement for the deprecated `accounts fund`.
      await this.console().runHardkas(["simulator", "fund", name, "--amount", amountKas, "--json"]);
    } else {
      throw new Error("No faucet for the public testnet from the IDE; use a testnet faucet and send to the address.");
    }
    await this.refreshAccounts();
  }

  // ---- blocks: nothing confirms on simnet unless the CPU miner runs, and a miner running flat out floods the node ----

  /** Starts the existing miner container; it mines to whichever account HardKas last funded. */
  async startMiner(): Promise<void> {
    await this.minerOp("start", async () => {
      await api.node.miner("start");
    });
  }

  /** Stops the miner so the node can catch up ("route is full" in its log means it was falling behind). */
  async stopMiner(): Promise<void> {
    await this.minerOp("stop", async () => {
      await api.node.miner("stop");
    });
  }

  /**
   * Mines a short burst: `localnet fund <account> --amount 1` runs the miner until one more mature KAS reaches
   * the account, then stops it. Enough blocks for pending transactions to confirm, without flooding the node.
   */
  async mineBurst(account: string): Promise<void> {
    await this.minerOp("burst", async () => {
      await this.runCli(["localnet", "fund", account, "--amount", "1", "--profile", "toccata-v2", "--json"], "Mining burst failed");
      await this.refreshAccounts();
    });
  }

  private async minerOp(kind: "start" | "stop" | "burst", run: () => Promise<void>): Promise<void> {
    const env = useEnv.getState();
    if (env.minerBusy) return;
    env.setMinerBusy(kind);
    env.setError(null);
    let failed: string | null = null;
    try {
      await run();
    } catch (e) {
      failed = e instanceof Error ? e.message : String(e);
      this.console().error(failed);
      throw new Error(failed);
    } finally {
      useEnv.getState().setMinerBusy(null);
      // refreshNode clears the error on success, so the miner's failure is set afterwards to stay visible.
      const node = await this.refreshNode(true);
      if (failed) useEnv.getState().setError(failed);
      this.emit("minerChanged", node?.miner ?? null);
    }
  }

  /**
   * Copies the raw hex private key to the clipboard without rendering it.
   * Works for both accounts.real.json and HardKas dev keystores (.hardkas/dev-accounts).
   * Format is raw 64 hex characters, directly importable into KasWare.
   */
  async copyPrivateKey(name: string): Promise<boolean> {
    const key = await this.getPrivateKey(name);
    if (!key) return false;
    await copyText(key);
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

/** One stage of a node operation: `run` may report short progress notes through `note`. */
interface OpStep {
  label: string;
  run: (note: (text: string) => void) => Promise<void>;
}

/** Reads `hardkas localnet status --json` (either of its two shapes) into the IDE's NodeStatus. */
export function parseNodeStatus(raw: Record<string, unknown>): NodeStatus {
  const container = (raw.container ?? {}) as Record<string, unknown>;
  const rpc = (raw.rpc ?? {}) as Record<string, unknown>;
  const node = (raw.node ?? {}) as Record<string, unknown>;
  const identity = (raw.identity ?? {}) as Record<string, unknown>;
  const observed = (identity.observed ?? {}) as Record<string, unknown>;
  const server = (observed.server ?? {}) as Record<string, unknown>;
  const expected = (identity.expected ?? {}) as Record<string, unknown>;
  const miner = (raw.miner ?? {}) as Record<string, unknown>;

  // `localnet status` has two shapes: a full one (container/rpc/ports) and, when the node answers, a short
  // one where `node.ready` is true and there is no `running` flag. A node that answers RPC is running,
  // unless the CLI also saw that the container is not: then something else holds the port (seen with a
  // test suite's mock node on 18210) and the answers are not the HardKas node's.
  const observedContainer = (observed.container ?? {}) as Record<string, unknown>;
  const containerRunning = (container.running ?? observedContainer.running) as boolean | undefined;
  const rpcAnswers = Boolean(rpc.ready ?? node.rpcReady ?? node.ready);
  const foreign = rpcAnswers && containerRunning === false;
  const rpcReady = rpcAnswers && !foreign;
  const running = rpcReady || Boolean(containerRunning ?? node.running);
  const rpcUrlSeen = (rpc.url as string | undefined) ?? (node.rpcUrl as string | undefined) ?? "ws://127.0.0.1:18210";
  const containerSeen = (container.name as string | undefined) ?? (observedContainer.name as string | undefined) ?? (expected.containerName as string | undefined) ?? "the node container";

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
    status: foreign ? "FOREIGN RPC" : String(raw.status ?? (rpcReady ? "READY" : running ? "STARTING" : "STOPPED")),
    running,
    rpcReady,
    containerName: (container.name as string | undefined) ?? (observedContainer.name as string | undefined) ?? (node.containerName as string | undefined) ?? (expected.containerName as string | undefined),
    image: (container.image as string | undefined) ?? (node.image as string | undefined) ?? (expected.image as string | undefined),
    network: (node.network as string | undefined) ?? (node.networkId as string | undefined) ?? (expected.network as string | undefined) ?? "simnet",
    rpcUrl: (rpc.url as string | undefined) ?? (node.rpcUrl as string | undefined),
    ports,
    serverVersion: (server.serverVersion as string | undefined) ?? (node.serverVersion as string | undefined) ?? (expected.serverVersion as string | undefined),
    isSynced: (server.isSynced as boolean | undefined) ?? (node.isSynced as boolean | undefined),
    virtualDaaScore: (server.virtualDaaScore as string | undefined) ?? (node.virtualDaaScore as string | undefined),
    // `miner.exists === false` means no container at all (HardKas creates it on the first fund).
    miner: miner && typeof miner.running === "boolean" && miner.exists !== false ? { running: Boolean(miner.running), status: String(miner.status ?? "") } : undefined,
    lastError: foreign
      ? `Something answers on ${rpcUrlSeen}, but ${containerSeen} is not running: another process holds the port, and its answers are not this node's. Stop it, then start the node.`
      : ((rpc.lastError as string | null | undefined) ?? (node.lastError as string | null | undefined) ?? null),
    checkedAt: identity.checkedAt as string | undefined,
    raw: { ...raw, transports }
  };
}
