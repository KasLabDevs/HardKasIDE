import { execFile } from "node:child_process";

/**
 * Cluster of local nodes. HardKAS runs exactly one rusty-kaspad (the "HardKAS node", node 0); this module adds extra simnet
 * nodes next to it through Docker, peers them with it, and reports each one's chain (height, final block, tips, peers).
 *
 * Rules it keeps:
 *   - Only containers it created are ever changed: they carry the label hardkas-ide.cluster=extra and a fixed name pattern.
 *     The HardKAS node is only read (inspect, logs, JSON RPC), never started, stopped or reconnected.
 *   - Extra nodes sit on Docker's default network next to the HardKAS node, reach it by IP on the private p2p port, and
 *     publish only their JSON RPC on 127.0.0.1.
 *   - They hold no data of their own: they sync everything from their peers, so removing one loses nothing.
 */

export class ClusterError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string
  ) {
    super(message);
  }
}

const NODE0 = process.env.HARDKAS_NODE_CONTAINER ?? "hardkas-kaspad-toccata-v2";
const PREFIX = "hardkas-ide-n";
const LABEL = "hardkas-ide.cluster=extra";
const BASE_PORT = 28300;
const MAX_EXTRAS = 12;
const DEFAULT_IMAGE = "kaspanet/rusty-kaspad:v2.1.0@sha256:f85da74b9514584451f83a2cbea3aa93f700248302fe7e3e0ab17288f93c905b";
const NAME_RE = /^hardkas-ide-n(\d{1,2})$/;

interface Run {
  ok: boolean;
  out: string;
  err: string;
}

function docker(args: string[], timeout = 20_000): Promise<Run> {
  return new Promise((resolve) => {
    execFile("docker", args, { timeout, windowsHide: true, maxBuffer: 16 * 1024 * 1024 }, (error, stdout, stderr) => resolve({ ok: !error, out: String(stdout).trim(), err: String(stderr || (error ? error.message : "")).trim() }));
  });
}

/** One change at a time: two quick clicks on "add" must not pick the same name or port. */
let queue: Promise<unknown> = Promise.resolve();
function exclusive<T>(fn: () => Promise<T>): Promise<T> {
  const next = queue.then(fn, fn);
  queue = next.catch(() => undefined);
  return next;
}

// ------------------------------------------------------------------ JSON RPC (wRPC over WebSocket)

export interface NodeChain {
  daa: number;
  sink: string;
  tips: number;
  blocks: number;
  /** headers downloaded so far: a node that is joining downloads these first, then the blocks */
  headers: number;
  network: string;
  peers: Array<{ address: string; outbound: boolean }>;
  synced: boolean;
  version: string;
  mempool: number;
  difficulty: number;
}

/** Asks one node for its chain over the JSON wRPC it publishes. Resolves null when it does not answer in time. */
function rpcStatus(port: number, timeoutMs = 1800): Promise<NodeChain | null> {
  return new Promise((resolve) => {
    let done = false;
    let ws: WebSocket;
    const finish = (v: NodeChain | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try {
        ws?.close();
      } catch {
        // already closed
      }
      resolve(v);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    try {
      ws = new WebSocket(`ws://127.0.0.1:${port}`);
    } catch {
      return finish(null);
    }
    const got: Record<number, any> = {};
    const methods = ["getBlockDagInfo", "getConnectedPeerInfo", "getInfo"];
    ws.onerror = () => finish(null);
    ws.onopen = () => methods.forEach((method, i) => ws.send(JSON.stringify({ id: i + 1, method, params: {} })));
    ws.onmessage = (m) => {
      try {
        const msg = JSON.parse(String(m.data)) as { id?: number; params?: any };
        if (msg.id) got[msg.id] = msg.params;
      } catch {
        return;
      }
      if (got[1] && got[2] && got[3]) {
        const dag = got[1];
        finish({
          daa: Number(dag.virtualDaaScore ?? 0),
          sink: String(dag.sink ?? ""),
          tips: Array.isArray(dag.tipHashes) ? dag.tipHashes.length : 0,
          blocks: Number(dag.blockCount ?? 0),
          headers: Number(dag.headerCount ?? 0),
          network: String(dag.network ?? ""),
          difficulty: Number(dag.difficulty ?? 0),
          peers: (got[2].peerInfo ?? []).map((p: any) => ({ address: String(p.address ?? p.netAddress?.ip ?? "?"), outbound: Boolean(p.isOutbound) })),
          synced: Boolean(got[3].isSynced),
          version: String(got[3].serverVersion ?? ""),
          mempool: Number(got[3].mempoolSize ?? 0)
        });
      }
    };
  });
}

// ------------------------------------------------------------------ Docker

interface Inspected {
  name: string;
  state: string;
  status: string;
  image: string;
  ip: string | null;
  hostPort: number | null;
  startedAt: string | null;
  labels: Record<string, string>;
}

async function inspect(name: string): Promise<Inspected | null> {
  const r = await docker(["inspect", name]);
  if (!r.ok) return null;
  try {
    const c = (JSON.parse(r.out) as any[])[0];
    const nets = c.NetworkSettings?.Networks ?? {};
    const ip: string | null = nets.bridge?.IPAddress || c.NetworkSettings?.IPAddress || (Object.values(nets) as any[]).find((n) => n.IPAddress)?.IPAddress || null;
    const bind = c.NetworkSettings?.Ports?.["18210/tcp"]?.[0]?.HostPort;
    return {
      name: String(c.Name).replace(/^\//, ""),
      state: String(c.State?.Status ?? "unknown"),
      status: c.State?.Running ? "running" : String(c.State?.Status ?? "stopped"),
      image: String(c.Config?.Image ?? ""),
      ip,
      hostPort: bind ? Number(bind) : null,
      startedAt: c.State?.Running ? String(c.State?.StartedAt ?? "") : null,
      labels: c.Config?.Labels ?? {}
    };
  } catch {
    return null;
  }
}

export async function dockerAvailable(): Promise<boolean> {
  return (await docker(["version", "--format", "{{.Server.Version}}"], 8000)).ok;
}

let statsCache: { at: number; data: Record<string, { mem: string; cpu: string }> } = { at: 0, data: {} };
let statsRunning = false;
function refreshStats() {
  if (statsRunning || Date.now() - statsCache.at < 8000) return;
  statsRunning = true;
  void docker(["stats", "--no-stream", "--format", "{{.Name}}|{{.MemUsage}}|{{.CPUPerc}}"], 15_000).then((r) => {
    statsRunning = false;
    if (!r.ok) return;
    const data: Record<string, { mem: string; cpu: string }> = {};
    for (const line of r.out.split("\n")) {
      const [name, mem, cpu] = line.trim().split("|");
      if (name) data[name] = { mem: (mem ?? "").split(" / ")[0], cpu: cpu ?? "" };
    }
    statsCache = { at: Date.now(), data };
  });
}

// ------------------------------------------------------------------ status

export interface ClusterNode {
  name: string;
  index: number;
  role: "hardkas" | "extra";
  state: string;
  startedAt: string | null;
  rpcPort: number | null;
  ip: string | null;
  chain: NodeChain | null;
  mem?: string;
  cpu?: string;
  /** relative to the reference node: same final block = in sync */
  inSync: boolean | null;
  behind: number | null;
}

export async function status(): Promise<{ docker: boolean; image: string; nodes: ClusterNode[]; reference: string | null; max: number }> {
  if (!(await dockerAvailable())) return { docker: false, image: DEFAULT_IMAGE, nodes: [], reference: null, max: MAX_EXTRAS };
  refreshStats();
  const list = await docker(["ps", "-a", "--filter", `label=${LABEL}`, "--format", "{{.Names}}"]);
  const extraNames = list.out.split("\n").map((s) => s.trim()).filter((n) => NAME_RE.test(n));
  const [node0, ...extras] = await Promise.all([inspect(NODE0), ...extraNames.map((n) => inspect(n))]);

  const base = async (c: Inspected, index: number, role: "hardkas" | "extra"): Promise<ClusterNode> => {
    const rpcPort = c.hostPort ?? (role === "hardkas" ? 18210 : null);
    const chain = c.status === "running" && rpcPort ? await rpcStatus(rpcPort) : null;
    return { name: c.name, index, role, state: c.status, startedAt: c.startedAt, rpcPort, ip: c.ip, chain, mem: statsCache.data[c.name]?.mem, cpu: statsCache.data[c.name]?.cpu, inSync: null, behind: null };
  };
  const nodes: ClusterNode[] = [];
  if (node0) nodes.push(await base(node0, 0, "hardkas"));
  const extraNodes = await Promise.all(extras.filter((x): x is Inspected => !!x).map((c) => base(c, Number(NAME_RE.exec(c.name)![1]), "extra")));
  nodes.push(...extraNodes.sort((a, b) => a.index - b.index));

  // The reference is the HardKAS node when it answers, else whichever node is highest.
  const answering = nodes.filter((n) => n.chain);
  const ref = answering.find((n) => n.role === "hardkas") ?? [...answering].sort((a, b) => b.chain!.daa - a.chain!.daa)[0];
  for (const n of nodes) {
    if (!n.chain || !ref?.chain) continue;
    n.inSync = n.chain.sink === ref.chain.sink;
    n.behind = Math.max(0, ref.chain.daa - n.chain.daa);
  }
  return { docker: true, image: node0?.image || DEFAULT_IMAGE, nodes, reference: ref?.name ?? null, max: MAX_EXTRAS };
}

// ------------------------------------------------------------------ changes

async function currentImage(): Promise<string> {
  return (await inspect(NODE0))?.image || DEFAULT_IMAGE;
}

async function extraNames(): Promise<string[]> {
  const list = await docker(["ps", "-a", "--filter", `label=${LABEL}`, "--format", "{{.Names}}"]);
  return list.out.split("\n").map((s) => s.trim()).filter((n) => NAME_RE.test(n));
}

async function addOne(): Promise<string> {
  const names = await extraNames();
  if (names.length >= MAX_EXTRAS) throw new ClusterError(409, "TOO_MANY", `At most ${MAX_EXTRAS} extra nodes.`);
  const used = new Set(names.map((n) => Number(NAME_RE.exec(n)![1])));
  let index = 1;
  while (used.has(index)) index++;
  const name = `${PREFIX}${index}`;

  // Who to peer with: the HardKAS node first, then running extras (a few links are enough for a connected cluster).
  const peerIps: string[] = [];
  const n0 = await inspect(NODE0);
  if (n0?.status === "running" && n0.ip) peerIps.push(n0.ip);
  for (const n of names) {
    const c = await inspect(n);
    if (c?.status === "running" && c.ip && peerIps.length < 3) peerIps.push(c.ip);
  }
  const args = [
    "run", "-d", "--name", name,
    "--label", LABEL, "--label", `hardkas-ide.index=${index}`,
    "--memory", "3g", "--cpus", "1",
    "-p", `127.0.0.1:${BASE_PORT + index}:18210`,
    await currentImage(),
    "kaspad", "--yes", "--nologfiles", "--disable-upnp", "--utxoindex", "--simnet",
    "--rpclisten=0.0.0.0:16210", "--rpclisten-json=0.0.0.0:18210", "--enable-unsynced-mining",
    ...peerIps.map((ip) => `--addpeer=${ip}:16511`)
  ];
  const r = await docker(args, 120_000);
  if (!r.ok) throw new ClusterError(500, "DOCKER_RUN_FAILED", r.err.split("\n").slice(-2).join(" ") || "docker run failed");
  return name;
}

export function addNodes(count: number): Promise<string[]> {
  return exclusive(async () => {
    const out: string[] = [];
    for (let i = 0; i < Math.min(Math.max(1, count), MAX_EXTRAS); i++) out.push(await addOne());
    return out;
  });
}

async function mustBeOurs(name: string): Promise<void> {
  if (!NAME_RE.test(name)) throw new ClusterError(400, "NOT_A_CLUSTER_NODE", "Only nodes created by the IDE can be changed here.");
  const c = await inspect(name);
  if (!c || c.labels["hardkas-ide.cluster"] !== "extra") throw new ClusterError(404, "NOT_FOUND", `No cluster node ${name}.`);
}

export function nodeAction(name: string, action: "start" | "stop" | "restart" | "remove"): Promise<void> {
  return exclusive(async () => {
    await mustBeOurs(name);
    // Extra nodes keep no data of their own, so a short grace period before the kill is plenty.
    const r = action === "remove" ? await docker(["rm", "-f", name], 40_000) : await docker(action === "start" ? [action, name] : [action, "-t", "3", name], 60_000);
    if (!r.ok) throw new ClusterError(500, "DOCKER_FAILED", r.err.split("\n").slice(-2).join(" "));
  });
}

export function scale(replicas: number): Promise<{ added: string[]; removed: string[] }> {
  return exclusive(async () => {
    const target = Math.min(MAX_EXTRAS, Math.max(0, Math.floor(replicas)));
    const names = (await extraNames()).sort((a, b) => Number(NAME_RE.exec(a)![1]) - Number(NAME_RE.exec(b)![1]));
    const added: string[] = [];
    const removed: string[] = [];
    for (let i = names.length; i < target; i++) added.push(await addOne());
    for (const n of names.slice(target).reverse()) {
      await docker(["rm", "-f", n], 40_000);
      removed.push(n);
    }
    return { added, removed };
  });
}

export async function logs(name: string, tail = 200): Promise<string> {
  if (name !== NODE0 && !NAME_RE.test(name)) throw new ClusterError(400, "BAD_NAME", "Unknown node.");
  const r = await docker(["logs", "--tail", String(Math.min(1000, Math.max(10, tail))), name], 15_000);
  if (!r.ok && !r.out && !r.err) throw new ClusterError(404, "NOT_FOUND", `No logs for ${name}.`);
  // docker prints the container's stderr to ours: both are the node's log.
  return [r.out, r.err].filter(Boolean).join("\n");
}
