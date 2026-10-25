/**
 * Client for the HardKas IDE server (packages/ide-server), reached through the
 * Vite proxy at /api. The dev-server (hardkas dev) is reached via /api/dev/*.
 */

export interface WorkspaceInfo {
  root: string | null;
  name: string | null;
  hasConfig: boolean;
  configFile: string | null;
  hasHardkasDir: boolean;
  hasDevServerToken: boolean;
}

export interface RecentEntry {
  path: string;
  name: string;
  openedAt: string;
}

export interface TreeNode {
  name: string;
  path: string;
  type: "file" | "dir";
  children?: TreeNode[];
}

export interface JobSummary {
  id: string;
  command: string;
  args: string[];
  cwd: string;
  status: "running" | "succeeded" | "failed";
  exitCode: number | null;
  startedAt: string;
  endedAt: string | null;
  result: unknown;
}

export interface JobDetail extends JobSummary {
  stdout: string;
  stderr: string;
}

export interface ProjectTemplate {
  id: string;
  label: string;
  description: string;
  command: "init" | "create";
}

export interface ApiError {
  ok: false;
  code: string;
  message: string;
}

export class IdeApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) }
  });
  const text = await response.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { ok: false, code: "BAD_JSON", message: text.slice(0, 200) };
  }
  if (!response.ok || (body && typeof body === "object" && (body as { ok?: boolean }).ok === false)) {
    const err = (body ?? {}) as Partial<ApiError>;
    throw new IdeApiError(err.code ?? "HTTP_ERROR", err.message ?? response.statusText, response.status);
  }
  return body as T;
}

export const api = {
  workspace: {
    get: () => request<{ workspace: WorkspaceInfo }>("/api/workspace").then((r) => r.workspace),
    recents: () => request<{ recents: RecentEntry[]; home: string }>("/api/workspace/recents"),
    open: (path: string) =>
      request<{ workspace: WorkspaceInfo }>("/api/workspace/open", { method: "POST", body: JSON.stringify({ path }) }).then((r) => r.workspace),
    close: () => request<{ ok: true }>("/api/workspace/close", { method: "POST" })
  },
  fs: {
    tree: () => request<{ root: string; tree: TreeNode[] }>("/api/fs/tree"),
    read: (path: string) => request<{ content: string }>(`/api/fs/file?path=${encodeURIComponent(path)}`).then((r) => r.content),
    /** Files under `dir` whose name ends with `suffix`, newest first. */
    find: (dir: string, suffix: string) =>
      request<{ files: string[] }>(`/api/fs/find?dir=${encodeURIComponent(dir)}&suffix=${encodeURIComponent(suffix)}`).then((r) => r.files),
    write: (path: string, content: string) => request<{ ok: true }>("/api/fs/file", { method: "PUT", body: JSON.stringify({ path, content }) }),
    mkdir: (path: string) => request<{ ok: true }>("/api/fs/mkdir", { method: "POST", body: JSON.stringify({ path }) }),
    rename: (from: string, to: string) => request<{ ok: true }>("/api/fs/rename", { method: "POST", body: JSON.stringify({ from, to }) }),
    remove: (path: string) => request<{ ok: true }>(`/api/fs?path=${encodeURIComponent(path)}`, { method: "DELETE" })
  },
  jobs: {
    run: (args: string[], options?: { cwd?: string; command?: string }) =>
      request<{ job: JobSummary }>("/api/run", { method: "POST", body: JSON.stringify({ args, ...options }) }).then((r) => r.job),
    get: (id: string) => request<{ job: JobDetail }>(`/api/jobs/${id}`).then((r) => r.job),
    list: () => request<{ jobs: JobSummary[] }>("/api/jobs").then((r) => r.jobs),
    /** Follows a job over SSE. Resolves with the final status/result when it ends. */
    follow: (
      id: string,
      onEvent: (type: "stdout" | "stderr" | "error", data: string) => void
    ): Promise<{ status: JobSummary["status"]; exitCode: number | null; result: unknown }> =>
      new Promise((resolve, reject) => {
        const source = new EventSource(`/api/jobs/${id}/stream`);
        for (const type of ["stdout", "stderr", "error"] as const) {
          source.addEventListener(type, (e) => onEvent(type, (e as MessageEvent).data as string));
        }
        source.addEventListener("done", (e) => {
          source.close();
          resolve(JSON.parse((e as MessageEvent).data as string));
        });
        source.onerror = () => {
          source.close();
          reject(new Error("job stream closed unexpectedly"));
        };
      })
  },
  project: {
    templates: () => request<{ templates: ProjectTemplate[]; defaultParent: string }>("/api/project/templates"),
    create: (body: { template: string; name: string; parentDir: string; install?: boolean }) =>
      request<{ job: JobSummary; dest: string }>("/api/project/create", { method: "POST", body: JSON.stringify(body) })
  },
  plugins: {
    /** Fetches a remote text/JSON document through ide-server (no CORS issues). */
    fetch: (url: string) => request<{ text: string }>(`/api/plugins/fetch?url=${encodeURIComponent(url)}`).then((r) => r.text),
    /** Installs an npm package under .hardkas/ide/plugins and returns its hardkasPlugin manifest. */
    npm: (pkg: string) =>
      request<{ manifest: Record<string, unknown>; package: string; version: string }>("/api/plugins/npm", { method: "POST", body: JSON.stringify({ package: pkg }) }),
    examples: () => request<{ examples: Array<{ name: string; manifestUrl: string }> }>("/api/plugins/examples").then((r) => r.examples),
    /** Registry entries and npm packages tagged hardkas-plugin matching the query. */
    search: (q: string) =>
      request<{
        registry: Array<{ name: string; displayName: string; description?: string; version?: string; author?: string; tags?: string[]; manifestUrl: string; homepage?: string }>;
        results: Array<{ name: string; version: string; description: string; author?: string; date?: string; links?: { npm?: string; homepage?: string } }>;
      }>(`/api/plugins/search?q=${encodeURIComponent(q)}`)
  },
  system: () =>
    request<{ docker: { installed: boolean; running: boolean; clientVersion: string | null; serverVersion: string | null; error: string | null }; node: string; platform: string }>("/api/system"),
  vsx: {
    search: (q: string, size = 24) => request<{ total: number; hits: import("@/store/vsx").VsxSearchHit[] }>(`/api/vsx/search?q=${encodeURIComponent(q)}&size=${size}`),
    installed: () => request<{ installed: import("@/store/vsx").InstalledVsx[] }>("/api/vsx/installed").then((r) => r.installed),
    install: (namespace: string, name: string, version?: string) =>
      request<{ extension: import("@/store/vsx").InstalledVsx }>("/api/vsx/install", { method: "POST", body: JSON.stringify({ namespace, name, version }) }).then((r) => r.extension),
    setEnabled: (id: string, enabled: boolean) => request<{ ok: true }>("/api/vsx/enable", { method: "POST", body: JSON.stringify({ id, enabled }) }),
    uninstall: (id: string) => request<{ ok: true }>(`/api/vsx/${encodeURIComponent(id)}`, { method: "DELETE" }),
    /** URL of a file inside an installed extension (theme json, grammar, snippets). */
    fileUrl: (id: string, relative: string) => `/api/vsx/file/${encodeURIComponent(id)}/${relative.split("/").map(encodeURIComponent).join("/")}`
  },
  /** Raw call to the HardKas dev-server through the proxy, e.g. dev("/accounts"). */
  dev: <T = unknown>(path: string, init?: RequestInit) => request<T>(`/api/dev${path}`, init)
};
