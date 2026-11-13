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

export interface SearchMatchLine {
  line: number;
  column: number;
  matchLength: number;
  lineText: string;
  matchText: string;
}

export interface SearchFileResult {
  path: string;
  matches: SearchMatchLine[];
}

export interface WorkspaceSearchOptions {
  query: string;
  caseSensitive?: boolean;
  regex?: boolean;
  wholeWord?: boolean;
  filePatterns?: string;
  scopeDir?: string;
  includeFiles?: string[];
  maxResults?: number;
}

export interface WorkspaceSearchResponse {
  query: string;
  files: SearchFileResult[];
  totalMatches: number;
  totalFiles: number;
  truncated: boolean;
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

export interface FrontendStackOption {
  id: string;
  label: string;
  language: string;
  framework: string;
  description: string;
}

/** Assistant settings as the browser sees them: the API key itself never leaves the server. */
export interface AssistantConfigView {
  provider: "opencode" | "anthropic" | "openai";
  baseUrl: string;
  model: string;
  docs: "off" | "core" | "full";
  maxTokens: number;
  hasKey: boolean;
  keyHint: string;
  /** The user agreed that prompts and the files the agent reads go to OpenCode's hosted models. */
  opencodeConsent?: boolean;
}

/** Which `hardkas` the server runs and whether it is the version this IDE was tested with. */
export interface CliInfo {
  version: string | null;
  pinned: string;
  source: "project" | "env" | "repo" | "npx";
  command: string;
  error: string | null;
}

export interface CliCatalogArgument {
  name: string;
  description: string;
  required: boolean;
  variadic: boolean;
  defaultValue?: unknown;
  choices?: string[];
}

export interface CliCatalogOption {
  flags: string;
  long: string | null;
  short: string | null;
  attribute: string | null;
  description: string;
  takesValue: boolean;
  valueOptional: boolean;
  variadic: boolean;
  mandatory: boolean;
  negate: boolean;
  defaultValue?: unknown;
  choices?: string[];
}

export interface CliCatalogCommand {
  name: string;
  path: string[];
  aliases: string[];
  description: string;
  summary: string;
  hidden: boolean;
  arguments: CliCatalogArgument[];
  options: CliCatalogOption[];
  commands: CliCatalogCommand[];
}

export interface CliCatalog {
  ok: boolean;
  version: string | null;
  globalOptions: CliCatalogOption[];
  commands: CliCatalogCommand[];
  error?: string;
}

export interface IdeUpdateInfo {
  currentVersion: string;
  latestVersion: string | null;
  hasUpdate: boolean;
  releaseName: string | null;
  releaseUrl: string;
  downloadUrl: string | null;
  publishedAt: string | null;
  notes: string | null;
  error: string | null;
}

export interface CliUpdateInfo {
  runtimeVersion: string | null;
  runtimeSource: "project" | "env" | "repo" | "npx";
  projectVersion: string | null;
  pinnedVersion: string;
  npmLatest: string | null;
  npmNext: string | null;
  targetVersion: string;
  hasUpdate: boolean;
  reason: "project-behind" | "npm-newer" | "mismatch" | "missing" | null;
  updateCommand: string;
  error: string | null;
}

export interface UpdateReport {
  checkedAt: string;
  ide: IdeUpdateInfo;
  cli: CliUpdateInfo;
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
    remove: (path: string) => request<{ ok: true }>(`/api/fs?path=${encodeURIComponent(path)}`, { method: "DELETE" }),
    search: (body: WorkspaceSearchOptions) =>
      request<WorkspaceSearchResponse>("/api/fs/search", { method: "POST", body: JSON.stringify(body) }),
    replace: (body: WorkspaceSearchOptions & { replacement: string; targetFiles?: string[] }) =>
      request<{ replacedFiles: number; replacedMatches: number }>("/api/fs/replace", { method: "POST", body: JSON.stringify(body) })
  },
  devkeys: {
    /** Aliases with a keystore in .hardkas/dev-accounts (alice…erin). */
    list: () => request<{ names: string[] }>("/api/devkeys").then((r) => r.names),
    /** Known public simnet addresses for .hardkas/dev-accounts and simnet real accounts (no private keys read). */
    addresses: () => request<{ addresses?: Record<string, string> }>("/api/devkeys").then((r) => r.addresses ?? {}),
    /** Decrypts a simnet dev keystore (fixed HardKas dev password) and returns its raw hex private key. */
    reveal: (name: string) =>
      request<{ name: string; address: string; network: string; privateKey: string }>("/api/devkeys/reveal", {
        method: "POST",
        body: JSON.stringify({ name }),
        cache: "no-store"
      })
  },
  jobs: {
    run: (args: string[], options?: { cwd?: string; command?: string; wait?: boolean }) =>
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
    templates: () => request<{ templates: ProjectTemplate[]; frontends?: FrontendStackOption[]; defaultParent: string }>("/api/project/templates"),
    create: (body: {
      template?: string;
      name: string;
      parentDir: string;
      install?: boolean;
      frontend?: string;
      starterContract?: {
        kind: "none" | "silver-basic" | "covenant-1-n" | "covenant-1-1" | "covenant-escrow" | "covenant-timelock";
        className?: string;
        fanout?: number;
      };
    }) => request<{ job: JobSummary; dest: string }>("/api/project/create", { method: "POST", body: JSON.stringify(body) })
  },
  store: {
    lineage: () =>
      request<{
        artifacts: Array<{
          artifactId: string;
          contentHash?: string;
          schema: string;
          kind?: string;
          mode?: string;
          networkId?: string;
          txId?: string;
          createdAt?: string;
          path?: string;
          integrityStatus?: string;
          parentArtifactId?: string;
          flowId?: string;
        }>;
        edges: Array<{ id: string; source: string; target: string }>;
        source: "store" | "disk";
      }>("/api/store/lineage")
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
  assistant: {
    config: () => request<{ config: AssistantConfigView; defaults: Record<"opencode" | "anthropic" | "openai", { baseUrl: string; model: string }> }>("/api/assistant/config"),
    saveConfig: (patch: Partial<AssistantConfigView> & { apiKey?: string; clearKey?: boolean }) =>
      request<{ config: AssistantConfigView }>("/api/assistant/config", { method: "PUT", body: JSON.stringify(patch) }).then((r) => r.config),
    docs: (mode: "off" | "core" | "full") =>
      request<{ mode: string; chars: number; approxTokens: number; fetchedAt: number | null; stale: boolean; source: string }>(`/api/assistant/docs?mode=${mode}`),
    /** Streams a chat answer; resolves when it ends. Events: meta, delta, error, done. */
    chat: async (
      body: { messages: Array<{ role: "user" | "assistant"; content: string }>; context?: unknown },
      signal: AbortSignal,
      onEvent: (event: string, data: Record<string, unknown>) => void
    ): Promise<void> => {
      const res = await fetch("/api/assistant/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal });
      if (!res.ok || !res.body) throw new IdeApiError("HTTP_ERROR", `Assistant request failed (${res.status})`, res.status);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let idx: number;
        while ((idx = buffer.search(/\r?\n\r?\n/)) >= 0) {
          const block = buffer.slice(0, idx);
          buffer = buffer.slice(idx).replace(/^\r?\n\r?\n/, "");
          let event = "message";
          const data: string[] = [];
          for (const line of block.split(/\r?\n/)) {
            if (line.startsWith("event:")) event = line.slice(6).trim();
            else if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
          }
          if (data.length === 0) continue;
          try {
            onEvent(event, JSON.parse(data.join("\n")) as Record<string, unknown>);
          } catch {
            // ignore malformed event
          }
        }
      }
    },
    /** Answers a "confirm" event of the running agent: run the proposed terminal command (once, or for the rest of the run) or decline it. */
    agentConfirm: (id: string, approved: boolean, allForRun = false) =>
      request<{ ok: true }>("/api/assistant/agent/confirm", { method: "POST", body: JSON.stringify({ id, approved, allForRun }) }),
    /** Streams an autonomous agent run; resolves when it ends. Events: step, thought, confirm, done, error. */
    agent: async (
      body: { goal: string; context?: unknown },
      signal: AbortSignal,
      onEvent: (event: string, data: Record<string, unknown>) => void
    ): Promise<void> => {
      const res = await fetch("/api/assistant/agent", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal });
      if (!res.ok || !res.body) throw new IdeApiError("HTTP_ERROR", `Agent request failed (${res.status})`, res.status);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let idx: number;
        while ((idx = buffer.search(/\r?\n\r?\n/)) >= 0) {
          const block = buffer.slice(0, idx);
          buffer = buffer.slice(idx).replace(/^\r?\n\r?\n/, "");
          let event = "message";
          const data: string[] = [];
          for (const line of block.split(/\r?\n/)) {
            if (line.startsWith("event:")) event = line.slice(6).trim();
            else if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
          }
          if (data.length === 0) continue;
          try {
            onEvent(event, JSON.parse(data.join("\n")) as Record<string, unknown>);
          } catch {
            // ignore malformed event
          }
        }
      }
    }
  },
  system: () =>
    request<{ docker: { installed: boolean; running: boolean; clientVersion: string | null; serverVersion: string | null; error: string | null }; node: string; platform: string }>("/api/system"),
  /** The hardkas binary the server runs for the open workspace, and its version against the one the IDE was tested with. */
  cli: Object.assign(
    (refresh = false) => request<{ cli: CliInfo }>(`/api/cli${refresh ? "?refresh=1" : ""}`).then((r) => r.cli),
    {
      catalog: () => request<CliCatalog>("/api/cli/catalog")
    }
  ),
  /** Checks IDE GitHub releases and workspace HardKas CLI version alignment. */
  updates: (refresh = false) =>
    request<{ updates: UpdateReport }>(
      `/api/updates?appVersion=${encodeURIComponent(__APP_VERSION__)}${refresh ? "&refresh=1" : ""}`
    ).then((r) => r.updates),
  node: {
    /** Blocks the local CPU miner found, its state, and how often the node refused its blocks ("route is full"). */
    blocks: (limit = 30) =>
      request<{ exists: boolean; running: boolean; perSecond: number; windowBlocks: number; routeFull: number; blocks: Array<{ hash: string; at: string }> }>(`/api/node/blocks?limit=${limit}`),
    /** Starts or stops the existing miner container (HardKas creates it on the first fund). */
    miner: (action: "start" | "stop") => request<{ running: boolean }>("/api/node/miner", { method: "POST", body: JSON.stringify({ action }) }),
    /** Removes the local Docker node + miner containers and wipes `.hardkas/node-data`, `.hardkas/localnet`, and dev accounts. */
    reset: () => request<{ ok: true; wiped: string[]; containersRemoved: boolean }>("/api/node/reset", { method: "POST" })
  },
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
  /** Probes whether the HardKas dev-server (:7420) is listening without causing proxy 502s. */
  devStatus: () => request<{ available: boolean; url: string }>("/api/dev/status"),
  /** Raw call to the HardKas dev-server through the proxy, e.g. dev("/accounts"). */
  dev: async <T = unknown>(path: string, init?: RequestInit): Promise<T> => {
    const status = await request<{ available: boolean; url: string }>("/api/dev/status");
    if (!status.available) {
      throw new IdeApiError("DEV_SERVER_UNREACHABLE", `HardKas dev-server is not running at ${status.url}. Start it with "hardkas dev" in the project folder.`, 503);
    }
    return request<T>(`/api/dev${path}`, init);
  },
  silver: {
    /** Non-polluting inline compile check via temporary `--out` path. */
    check: (body: { filePath: string; content?: string; constructorArgs?: string }) =>
      request<{
        check: {
          ok: boolean;
          code?: string;
          message: string;
          contracts?: unknown[];
          raw?: unknown;
        };
      }>("/api/silver/check", { method: "POST", body: JSON.stringify(body) }).then((r) => r.check)
  }
};
