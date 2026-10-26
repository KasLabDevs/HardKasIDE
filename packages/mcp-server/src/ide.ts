/** Thin client for the HardKas IDE server (http://127.0.0.1:7421): files, hardkas jobs, workspace. */

export const IDE_URL = (process.env.HARDKAS_IDE_URL ?? "http://127.0.0.1:7421").replace(/\/$/, "");

export class IdeError extends Error {
  constructor(
    message: string,
    readonly code = "IDE_ERROR"
  ) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${IDE_URL}${path}`, {
      method,
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
  } catch {
    throw new IdeError(`The HardKas IDE server is not reachable at ${IDE_URL}. Start it from the repo root with "pnpm dev:server" (or set HARDKAS_IDE_URL).`, "IDE_UNREACHABLE");
  }
  const json = (await res.json().catch(() => null)) as ({ ok?: boolean; code?: string; message?: string } & T) | null;
  if (!res.ok || !json || json.ok === false) {
    throw new IdeError(json?.message ?? `HTTP ${res.status} from ${path}`, json?.code ?? "IDE_ERROR");
  }
  return json;
}

export interface WorkspaceInfo {
  root: string | null;
  name?: string;
  hasConfig?: boolean;
  configFile?: string | null;
  hasHardkasDir?: boolean;
  hasDevServerToken?: boolean;
}

export interface TreeNode {
  name: string;
  path: string;
  type: "file" | "dir";
  children?: TreeNode[];
}

export const workspace = async (): Promise<WorkspaceInfo> => (await request<{ workspace: WorkspaceInfo }>("GET", "/api/workspace")).workspace;
export const openWorkspace = async (path: string): Promise<WorkspaceInfo> => (await request<{ workspace: WorkspaceInfo }>("POST", "/api/workspace/open", { path })).workspace;
export const tree = async (): Promise<TreeNode[]> => (await request<{ tree: TreeNode[] }>("GET", "/api/fs/tree")).tree;
export const readFile = async (path: string): Promise<string> => (await request<{ content: string }>("GET", `/api/fs/file?path=${encodeURIComponent(path)}`)).content;
export const writeFile = async (path: string, content: string): Promise<void> => void (await request("PUT", "/api/fs/file", { path, content }));
export const findFiles = async (dir: string, suffix: string): Promise<string[]> =>
  (await request<{ files: string[] }>("GET", `/api/fs/find?dir=${encodeURIComponent(dir)}&suffix=${encodeURIComponent(suffix)}`)).files;
export const system = () => request<{ docker: { installed: boolean; running: boolean; serverVersion: string | null; error: string | null }; node: string }>("GET", "/api/system");

export interface JobResult {
  status: "succeeded" | "failed" | "running";
  exitCode: number | null;
  /** The CLI's JSON document (stdout) when it printed one. */
  result: unknown;
  stderr: string;
  stdout: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Runs `hardkas <args>` in the open workspace and waits for it to finish. */
export async function hardkas(args: string[], options: { timeoutMs?: number; command?: "hardkas" | "npx" } = {}): Promise<JobResult> {
  const started = await request<{ job: { id: string } }>("POST", "/api/run", { args, command: options.command });
  const deadline = Date.now() + (options.timeoutMs ?? 5 * 60_000);
  for (;;) {
    const { job } = await request<{ job: { status: JobResult["status"]; exitCode: number | null; result: unknown; stderr: string; stdout: string } }>("GET", `/api/jobs/${started.job.id}`);
    if (job.status !== "running") return { status: job.status, exitCode: job.exitCode, result: job.result, stderr: job.stderr, stdout: job.stdout };
    if (Date.now() > deadline) throw new IdeError(`hardkas ${args.join(" ")} did not finish in time`, "TIMEOUT");
    await sleep(400);
  }
}

export function flattenTree(nodes: TreeNode[], dir = "", out: string[] = []): string[] {
  for (const n of nodes) {
    if (dir && !(n.path === dir || n.path.startsWith(`${dir}/`))) {
      if (n.type === "dir" && n.children) flattenTree(n.children, dir, out);
      continue;
    }
    if (n.type === "file") out.push(n.path);
    else if (n.children) flattenTree(n.children, dir, out);
  }
  return out;
}
