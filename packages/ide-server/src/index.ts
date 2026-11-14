import { serve } from "@hono/node-server";
import { createNodeWebSocket } from "@hono/node-ws";
import { Hono, type Context, type Next } from "hono";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import { streamSSE } from "hono/streaming";
import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AssistantError, answerConfirm, kaspaDocs, loadConfig, providerDefaults, publicConfig, saveConfig, streamChat, streamAgent, type ChatRequest, type AgentRequest } from "./assistant.js";
import { debugSession } from "./debug.js";
import { listDevAccountAddresses, listDevAccountNames, revealDevAccountKey } from "./devkeys.js";
import * as wsfs from "./fs.js";
import { FsError } from "./fs.js";
import * as store from "./store.js";
import { StoreError } from "./store.js";
import { getCliCatalog } from "./cliCatalog.js";
import { ensureHardkasConfig, FRONTEND_STACKS, type FrontendStackId, type StarterContractSpec } from "./frontendScaffold.js";
import { checkSilverSource, cliInfo, createProject, getJob, listJobs, PROJECT_TEMPLATES, startJob, subscribe, waitForJob } from "./runner.js";
import { checkUpdates } from "./updates.js";
import { closeTerminal, defaultShell, listTerminals, openTerminal } from "./terminal.js";
import { readIdeSettings, thirdPartyExtensionsEnabled, writeIdeSettings } from "./ideSettings.js";
import { currentView, runnerInfo, sendCommand, startSession, stopSession, type DebugCommand, type StartRequest } from "./silverDebug.js";
import { examplesDir, fetchText, installNpmPlugin, listExamples, loadRegistry, pluginsRoot, readStatic, searchNpmPlugins } from "./plugins.js";
import { installVsx, readIndex, readVsxFile, searchVsx, setVsxEnabled, uninstallVsx } from "./vsx.js";
import { closeWorkspace, describeWorkspace, getRoot, listRecents, openWorkspace, readDevServerToken, requireTrusted, trustFolder, WorkspaceError } from "./workspace.js";
import { allowedHostnames, checkRequest, ideOrigins, isAllowedHost, isPublicStatic, SANDBOX_CSP, type RequestFacts } from "./guard.js";
import { isHardkasMiner, LocalNodeError, resetWorkspaceChainState } from "./localNode.js";

/**
 * HardKas IDE server.
 *
 *   /api/workspace   which project is open, recents, open/close
 *   /api/fs/*        files inside the open project
 *   /api/run, /api/jobs   run `hardkas ... --json` and stream its output
 *   /api/project/*   templates and project creation (hardkas init / create)
 *   /api/dev/*       proxy to the HardKas dev-server (hardkas dev, :7420) with its bearer token
 */

const PORT = Number(process.env.HARDKAS_IDE_PORT ?? 7421);
// `hardkas dev` binds to "localhost", which on modern Node resolves to ::1 only, so use the name, not 127.0.0.1.
const DEV_SERVER = process.env.HARDKAS_DEV_SERVER ?? "http://localhost:7420";

const app = new Hono();
const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app });

// Running from src/*.ts (tsx, `pnpm dev`) means development: the UI then comes from the Vite server on :5173.
const DEV_MODE = fileURLToPath(import.meta.url).endsWith(".ts");
const ALLOWED_HOSTS = allowedHostnames();
const IDE_ORIGINS = ideOrigins(PORT, { dev: DEV_MODE });

function requestFacts(c: { req: { method: string; path: string; header(name: string): string | undefined } }): RequestFacts {
  return { method: c.req.method, path: c.req.path, host: c.req.header("host"), origin: c.req.header("origin"), secFetchSite: c.req.header("sec-fetch-site"), referer: c.req.header("referer") };
}

/** True when the request comes from the IDE page itself or from a local program (see `checkRequest`). */
function localOnly(c: { req: { method: string; path: string; header(name: string): string | undefined } }): boolean {
  return checkRequest(requestFacts(c), ALLOWED_HOSTS, IDE_ORIGINS).ok;
}

// Every request names a loopback Host (stops DNS rebinding, see guard.ts); every /api request also comes from the
// IDE page or a local program, whatever its method: a GET can read a file or start the CLI, and the terminal
// WebSocket is refused here, before the upgrade.
app.use("*", async (c, next) => {
  if (!isAllowedHost(c.req.header("host"), ALLOWED_HOSTS)) {
    return c.json({ ok: false, code: "FORBIDDEN_HOST", message: "the IDE server only answers on localhost, 127.0.0.1 or [::1]" }, 403);
  }
  await next();
});

app.use("/api/*", async (c, next) => {
  const verdict = checkRequest(requestFacts(c), ALLOWED_HOSTS, IDE_ORIGINS);
  if (!verdict.ok) return c.json({ ok: false, code: verdict.code, message: verdict.message }, verdict.status);
  await next();
});

app.use(
  "/api/*",
  cors({
    origin: (origin, c) => {
      if (!origin) return origin;
      if (isPublicStatic(c.req.path)) return "*";
      return IDE_ORIGINS.has(origin.toLowerCase()) ? origin : "";
    },
    allowHeaders: ["Content-Type", "X-Hardkas-Request", "X-Hardkas-Client"],
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"]
  })
);

// Bodies are JSON settings, file contents and goals: 16 MB is far above any of them and stops a request from
// filling the server's memory.
app.use("/api/*", bodyLimit({ maxSize: 16 * 1024 * 1024, onError: (c) => c.json({ ok: false, code: "BODY_TOO_LARGE", message: "request body over 16 MB" }, 413) }));

app.onError((error, c) => {
  if (error instanceof StoreError) {
    return c.json({ ok: false, code: error.code, message: error.message }, error.status as 400);
  }
  if (error instanceof FsError) {
    return c.json({ ok: false, code: error.code, message: error.message }, error.status as 400);
  }
  if (error instanceof WorkspaceError) {
    return c.json({ ok: false, code: error.code, message: error.message }, error.status as 400);
  }
  // A body that is not JSON is the caller's mistake, not the server's.
  if (error instanceof SyntaxError) {
    return c.json({ ok: false, code: "BAD_REQUEST", message: "the request body is not valid JSON" }, 400);
  }
  const message = error instanceof Error ? error.message : String(error);
  // File-system mistakes in the request (a folder read as a file, a path that does not exist) are not server faults.
  const fsCode = (error as NodeJS.ErrnoException | null)?.code;
  if (fsCode === "ENOENT") return c.json({ ok: false, code: "NOT_FOUND", message }, 404);
  if (fsCode === "EISDIR" || fsCode === "ENOTDIR" || fsCode === "ENOTEMPTY") return c.json({ ok: false, code: "BAD_PATH", message }, 400);
  if (fsCode === "EEXIST") return c.json({ ok: false, code: "ALREADY_EXISTS", message }, 409);
  return c.json({ ok: false, code: "INTERNAL", message }, 500);
});

// ---------------------------------------------------------------- workspace

app.get("/api/workspace", async (c) => c.json({ ok: true, workspace: await describeWorkspace() }));

app.get("/api/workspace/recents", async (c) => c.json({ ok: true, recents: await listRecents(), home: os.homedir() }));

/** Requests from the MCP server (and so from any AI agent using it) carry this header; the MCP server sets it. */
function fromAgent(c: { req: { header(name: string): string | undefined } }): boolean {
  return (c.req.header("x-hardkas-client") ?? "").toLowerCase() === "mcp";
}

function clientOf(c: { req: { header(name: string): string | undefined } }): wsfs.FsClient {
  return fromAgent(c) ? "agent" : "user";
}

app.post("/api/workspace/open", async (c) => {
  const body = (await c.req.json()) as { path?: string };
  if (!body.path) return c.json({ ok: false, code: "BAD_REQUEST", message: "path is required" }, 400);
  // An agent may only switch to an existing HardKas project; the user may open any folder (it opens untrusted).
  const workspace = await openWorkspace(body.path, { requireProject: fromAgent(c) });
  return c.json({ ok: true, workspace });
});

// Trusting a folder is the user's decision: never an agent's.
app.post("/api/workspace/trust", async (c) => {
  if (fromAgent(c)) return c.json({ ok: false, code: "FORBIDDEN", message: "only the user can trust a folder, in the IDE" }, 403);
  const root = getRoot();
  if (!root) return c.json({ ok: false, code: "NO_WORKSPACE", message: "No workspace is open" }, 409);
  await trustFolder(root);
  return c.json({ ok: true, workspace: await describeWorkspace() });
});

app.post("/api/workspace/close", (c) => {
  closeWorkspace();
  return c.json({ ok: true });
});

// ---------------------------------------------------------------- files

app.get("/api/fs/tree", async (c) => c.json({ ok: true, root: getRoot(), tree: await wsfs.readTree("") }));

app.get("/api/fs/file", async (c) => {
  const p = c.req.query("path");
  if (!p) return c.json({ ok: false, code: "BAD_REQUEST", message: "path is required" }, 400);
  return c.json({ ok: true, path: p, content: await wsfs.readFile(p, clientOf(c)) });
});

app.get("/api/fs/find", async (c) => {
  const dir = c.req.query("dir") ?? "";
  const suffix = c.req.query("suffix");
  if (!suffix) return c.json({ ok: false, code: "BAD_REQUEST", message: "suffix is required" }, 400);
  return c.json({ ok: true, files: await wsfs.findBySuffix(dir, suffix) });
});

app.put("/api/fs/file", async (c) => {
  const body = (await c.req.json()) as { path?: string; content?: string };
  if (!body.path || typeof body.content !== "string") {
    return c.json({ ok: false, code: "BAD_REQUEST", message: "path and content are required" }, 400);
  }
  await wsfs.writeFile(body.path, body.content, clientOf(c));
  return c.json({ ok: true });
});

app.post("/api/fs/mkdir", async (c) => {
  const body = (await c.req.json()) as { path?: string };
  if (!body.path) return c.json({ ok: false, code: "BAD_REQUEST", message: "path is required" }, 400);
  await wsfs.mkdir(body.path, clientOf(c));
  return c.json({ ok: true });
});

app.post("/api/fs/rename", async (c) => {
  const body = (await c.req.json()) as { from?: string; to?: string };
  if (!body.from || !body.to) return c.json({ ok: false, code: "BAD_REQUEST", message: "from and to are required" }, 400);
  await wsfs.rename(body.from, body.to, clientOf(c));
  return c.json({ ok: true });
});

app.delete("/api/fs", async (c) => {
  const p = c.req.query("path");
  if (!p) return c.json({ ok: false, code: "BAD_REQUEST", message: "path is required" }, 400);
  await wsfs.remove(p, clientOf(c));
  return c.json({ ok: true });
});

app.post("/api/fs/search", async (c) => {
  const body = (await c.req.json()) as wsfs.WorkspaceSearchOptions;
  if (typeof body.query !== "string") {
    return c.json({ ok: false, code: "BAD_REQUEST", message: "query is required" }, 400);
  }
  const res = await wsfs.searchWorkspace(body, clientOf(c));
  return c.json({ ok: true, ...res });
});

app.post("/api/fs/replace", async (c) => {
  const body = (await c.req.json()) as wsfs.WorkspaceSearchOptions & { replacement?: string; targetFiles?: string[] };
  if (typeof body.query !== "string" || typeof body.replacement !== "string") {
    return c.json({ ok: false, code: "BAD_REQUEST", message: "query and replacement are required" }, 400);
  }
  const res = await wsfs.replaceInWorkspace({ ...body, replacement: body.replacement }, clientOf(c));
  return c.json({ ok: true, ...res });
});

// ---------------------------------------------------------------- jobs

function resolveSafeCwd(cwd: string | undefined): string | undefined {
  const root = getRoot();
  if (!cwd) return root ?? undefined;
  if (!root) throw new FsError(409, "NO_WORKSPACE", "No workspace is open");
  const target = path.isAbsolute(cwd) ? path.resolve(cwd) : wsfs.resolveInRoot(cwd);
  const rel = path.relative(root, target);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new FsError(400, "OUTSIDE_WORKSPACE", `cwd escapes the workspace: ${cwd}`);
  }
  return target;
}

app.post("/api/run", async (c) => {
  const body = (await c.req.json()) as { args?: string[]; cwd?: string; command?: string; wait?: boolean };
  if (!Array.isArray(body.args)) return c.json({ ok: false, code: "BAD_REQUEST", message: "args[] is required" }, 400);
  const job = await startJob({ args: body.args, cwd: resolveSafeCwd(body.cwd), command: body.command });
  const finalJob = body.wait ? await waitForJob(job) : job;
  return c.json({ ok: true, job: summarize(finalJob) });
});

app.post("/api/silver/check", async (c) => {
  const body = (await c.req.json()) as { filePath?: string; content?: string; constructorArgs?: string; cwd?: string };
  if (!body.filePath || typeof body.filePath !== "string") {
    return c.json({ ok: false, code: "BAD_REQUEST", message: "filePath is required" }, 400);
  }
  const result = await checkSilverSource({
    cwd: resolveSafeCwd(body.cwd),
    filePath: body.filePath,
    content: typeof body.content === "string" ? body.content : undefined,
    constructorArgs: typeof body.constructorArgs === "string" ? body.constructorArgs : undefined
  });
  return c.json({ ok: true, check: result });
});

app.get("/api/jobs", (c) => c.json({ ok: true, jobs: listJobs().map(summarize) }));

app.get("/api/jobs/:id", (c) => {
  const job = getJob(c.req.param("id"));
  if (!job) return c.json({ ok: false, code: "NOT_FOUND", message: "job not found" }, 404);
  return c.json({ ok: true, job });
});

app.get("/api/jobs/:id/stream", (c) => {
  const job = getJob(c.req.param("id"));
  if (!job) return c.json({ ok: false, code: "NOT_FOUND", message: "job not found" }, 404);
  return streamSSE(c, async (stream) => {
    // Replay what already happened, then follow live events until exit.
    for (const event of job.events) {
      await stream.writeSSE({ event: event.type, data: event.data, id: event.at });
    }
    if (job.status !== "running") {
      await stream.writeSSE({ event: "done", data: JSON.stringify({ status: job.status, exitCode: job.exitCode, result: job.result }) });
      return;
    }
    await new Promise<void>((resolve) => {
      const unsubscribe = subscribe(
        job.id,
        (event) => {
          void stream.writeSSE({ event: event.type, data: event.data, id: event.at });
        },
        () => {
          void stream
            .writeSSE({ event: "done", data: JSON.stringify({ status: job.status, exitCode: job.exitCode, result: job.result }) })
            .finally(() => {
              unsubscribe();
              resolve();
            });
        }
      );
      stream.onAbort(() => {
        unsubscribe();
        resolve();
      });
    });
  });
});

function summarize(job: ReturnType<typeof listJobs>[number]) {
  const { events: _events, stdout: _stdout, stderr: _stderr, ...rest } = job;
  return rest;
}

// ---------------------------------------------------------------- projects

app.get("/api/project/templates", (c) =>
  c.json({ ok: true, templates: PROJECT_TEMPLATES, frontends: FRONTEND_STACKS, defaultParent: path.join(os.homedir(), "hardkas-projects") })
);

app.post("/api/project/create", async (c) => {
  const body = (await c.req.json()) as {
    template?: string;
    name?: string;
    parentDir?: string;
    install?: boolean;
    frontend?: FrontendStackId;
    starterContract?: StarterContractSpec;
  };
  if (!body.name || !body.parentDir) {
    return c.json({ ok: false, code: "BAD_REQUEST", message: "name and parentDir are required" }, 400);
  }
  const { job, dest } = await createProject({
    template: body.template ?? "init",
    name: body.name,
    parentDir: body.parentDir,
    install: body.install,
    frontend: body.frontend,
    starterContract: body.starterContract
  });
  return c.json({ ok: true, job: summarize(job), dest });
});

// ---------------------------------------------------------------- real terminals (PTY over WebSocket)

app.get("/api/terminal", (c) => c.json({ ok: true, shell: defaultShell().file, terminals: listTerminals() }));

app.get(
  "/api/terminal/ws",
  upgradeWebSocket((c) => {
    const allowedOrigin = localOnly(c);
    const cols = Math.min(Math.max(Number(c.req.query("cols") ?? 100) || 100, 10), 500);
    const rows = Math.min(Math.max(Number(c.req.query("rows") ?? 30) || 30, 5), 200);
    const rawCwd = c.req.query("cwd") || undefined;
    let session: ReturnType<typeof openTerminal> | null = null;
    return {
      onOpen(_event, ws) {
        if (!allowedOrigin) {
          ws.send("\r\n[ide-server] forbidden WebSocket origin\r\n");
          ws.close();
          return;
        }
        try {
          const cwd = resolveSafeCwd(rawCwd);
          session = openTerminal({ cwd, cols, rows });
        } catch (error) {
          ws.send(`\r\n[ide-server] could not start a shell: ${error instanceof Error ? error.message : String(error)}\r\n`);
          ws.close();
          return;
        }
        ws.send(`\x1b[2m[hardkas-ide] ${session.shell} in ${session.cwd}\x1b[0m\r\n`);
        session.pty.onData((data) => ws.send(data));
        session.pty.onExit(({ exitCode }) => {
          ws.send(`\r\n\x1b[2m[process exited with code ${exitCode}]\x1b[0m\r\n`);
          ws.close();
        });
      },
      onMessage(event) {
        if (!session) return;
        const text = typeof event.data === "string" ? event.data : "";
        let msg: { type?: string; data?: string; cols?: number; rows?: number };
        try {
          msg = JSON.parse(text) as typeof msg;
        } catch {
          session.pty.write(text);
          return;
        }
        if (msg.type === "input" && typeof msg.data === "string") session.pty.write(msg.data);
        else if (msg.type === "resize" && msg.cols && msg.rows) {
          const safeCols = Math.min(Math.max(Math.floor(msg.cols), 10), 500);
          const safeRows = Math.min(Math.max(Math.floor(msg.rows), 5), 200);
          session.pty.resize(safeCols, safeRows);
        }
      },
      onClose() {
        if (session) closeTerminal(session.id);
        session = null;
      },
      onError() {
        if (session) closeTerminal(session.id);
        session = null;
      }
    };
  })
);

// ---------------------------------------------------------------- IDE settings: third-party extensions

app.get("/api/settings", async (c) => c.json({ ok: true, settings: await readIdeSettings() }));

app.post("/api/settings", async (c) => {
  if (fromAgent(c)) return c.json({ ok: false, code: "FORBIDDEN", message: "an agent cannot change the IDE's settings" }, 403);
  const body = (await c.req.json().catch(() => null)) as { thirdPartyExtensions?: unknown } | null;
  if (!body || typeof body !== "object") return c.json({ ok: false, code: "BAD_REQUEST", message: "a JSON object is required" }, 400);
  return c.json({ ok: true, settings: await writeIdeSettings({ ...(typeof body.thirdPartyExtensions === "boolean" ? { thirdPartyExtensions: body.thirdPartyExtensions } : {}) }) });
});

// Open VSX extensions and npm / URL plugins run code nobody reviewed: off until the user turns them on in Extensions.
// The bundled example plugins are part of the IDE and stay available.
const EXTENSIONS_OFF = { ok: false, code: "EXTENSIONS_OFF", message: "Third-party extensions are turned off. Turn them on in the Extensions view if you need them." } as const;
async function extensionsGate(c: Context, next: Next) {
  if (await thirdPartyExtensionsEnabled()) return next();
  if (c.req.method === "GET" && c.req.path === "/api/vsx/installed") return c.json({ ok: true, installed: [] });
  return c.json(EXTENSIONS_OFF, 403);
}
app.use("/api/vsx/*", extensionsGate);
app.use("/api/plugins/npm", extensionsGate);
app.use("/api/plugins/search", extensionsGate);
app.use("/api/plugins/static/*", extensionsGate);

// ---------------------------------------------------------------- external plugins

app.get("/api/plugins/fetch", async (c) => {
  // The server fetches the URL it is given: only the IDE page may ask, never a cross-site request (blind SSRF).
  if (!localOnly(c)) return c.json({ ok: false, code: "FORBIDDEN", message: "forbidden origin" }, 403);
  const url = c.req.query("url");
  if (!url) return c.json({ ok: false, code: "BAD_REQUEST", message: "url is required" }, 400);
  // The bundled example manifests live on this server: read them from disk instead of fetching loopback.
  const example = /^\/api\/plugins\/examples\/(.+)$/.exec(new URL(url, "http://127.0.0.1").pathname);
  if (example && (url.startsWith("/") || ["localhost", "127.0.0.1", "[::1]"].includes(new URL(url).hostname))) {
    const file = await readStatic(examplesDir(), decodeURIComponent(example[1]));
    if (!file) return c.json({ ok: false, code: "NOT_FOUND", message: "no such example plugin file" }, 404);
    return c.json({ ok: true, text: file.body.toString("utf8") });
  }
  if (!(await thirdPartyExtensionsEnabled())) return c.json(EXTENSIONS_OFF, 403);
  return c.json({ ok: true, text: await fetchText(url) });
});

app.post("/api/plugins/npm", async (c) => {
  const body = (await c.req.json()) as { package?: string };
  if (!body.package) return c.json({ ok: false, code: "BAD_REQUEST", message: "package is required" }, 400);
  const res = await installNpmPlugin(body.package);
  return c.json({ ok: true, ...res });
});

app.get("/api/plugins/examples", async (c) => c.json({ ok: true, examples: await listExamples() }));

app.get("/api/plugins/search", async (c) => {
  const q = (c.req.query("q") ?? "").trim().toLowerCase();
  const words = q.split(/\s+/).filter(Boolean);
  const [registry, npm] = await Promise.all([
    loadRegistry(),
    searchNpmPlugins(q).catch(() => [])
  ]);
  const matches = (text: string) => words.every((w) => text.toLowerCase().includes(w));
  const fromRegistry = registry.filter((e) => matches(`${e.name} ${e.displayName} ${e.description ?? ""} ${(e.tags ?? []).join(" ")}`));
  return c.json({ ok: true, registry: fromRegistry, results: npm });
});

// Plugin pages, extension files and the workspace's dapp/ are served with a sandbox CSP: their scripts run on an
// opaque origin, so they cannot call the IDE API as the IDE (the API refuses `Origin: null`). They talk to the IDE
// only through the iframe plugin bridge (postMessage), which keeps its permission prompts.
function sandboxedFile(file: { body: Buffer; type: string }): Response {
  return new Response(new Uint8Array(file.body), {
    headers: { "content-type": file.type, "cache-control": "no-cache", "content-security-policy": SANDBOX_CSP, "x-content-type-options": "nosniff" }
  });
}

app.get("/api/plugins/examples/*", async (c) => {
  const rel = c.req.path.replace(/^\/api\/plugins\/examples\//, "");
  const file = await readStatic(examplesDir(), rel);
  if (!file) return c.text("not found", 404);
  return sandboxedFile(file);
});

app.get("/api/plugins/static/*", async (c) => {
  const rel = c.req.path.replace(/^\/api\/plugins\/static\//, "");
  const file = await readStatic(path.join(pluginsRoot(), "node_modules"), rel);
  if (!file) return c.text("not found", 404);
  return sandboxedFile(file);
});

// ---------------------------------------------------------------- VS Code extensions (Open VSX)

app.get("/api/vsx/search", async (c) => c.json({ ok: true, ...(await searchVsx(c.req.query("q") ?? "", Number(c.req.query("size") ?? 24) || 24)) }));

app.get("/api/vsx/installed", async (c) => c.json({ ok: true, installed: await readIndex() }));

app.post("/api/vsx/install", async (c) => {
  const body = (await c.req.json()) as { namespace?: string; name?: string; version?: string };
  if (!body.namespace || !body.name) return c.json({ ok: false, code: "BAD_REQUEST", message: "namespace and name are required" }, 400);
  return c.json({ ok: true, extension: await installVsx(body.namespace, body.name, body.version) });
});

app.post("/api/vsx/enable", async (c) => {
  const body = (await c.req.json()) as { id?: string; enabled?: boolean };
  if (!body.id) return c.json({ ok: false, code: "BAD_REQUEST", message: "id is required" }, 400);
  await setVsxEnabled(body.id, body.enabled !== false);
  return c.json({ ok: true });
});

app.delete("/api/vsx/:id", async (c) => {
  await uninstallVsx(c.req.param("id"));
  return c.json({ ok: true });
});

app.get("/api/vsx/file/:id/*", async (c) => {
  const id = c.req.param("id");
  const rel = c.req.path.replace(new RegExp(`^/api/vsx/file/${id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/`), "");
  const file = await readVsxFile(id, decodeURIComponent(rel));
  if (!file) return c.text("not found", 404);
  return sandboxedFile(file);
});

// ---------------------------------------------------------------- dev-server proxy

app.get("/api/dev/status", async (c) => {
  try {
    const token = await readDevServerToken();
    const headers: Record<string, string> = token ? { authorization: `Bearer ${token}` } : {};
    const res = await fetch(`${DEV_SERVER}/api/artifacts`, {
      headers,
      signal: AbortSignal.timeout(1200)
    }).catch(() => null);
    if (res && res.status < 500) {
      return c.json({ ok: true, available: true, url: DEV_SERVER });
    }
  } catch {
    // Dev-server is not running on DEV_SERVER.
  }
  return c.json({ ok: true, available: false, url: DEV_SERVER });
});

app.all("/api/dev/*", async (c) => {
  const suffix = c.req.path.replace(/^\/api\/dev/, "");
  const url = new URL(`${DEV_SERVER}/api${suffix}`);
  const incoming = new URL(c.req.url);
  url.search = incoming.search;

  const headers = new Headers();
  headers.set("X-Hardkas-Request", "true");
  const token = await readDevServerToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const contentType = c.req.header("content-type");
  if (contentType) headers.set("content-type", contentType);
  const accept = c.req.header("accept");
  if (accept) headers.set("accept", accept);

  const method = c.req.method;
  const body = method === "GET" || method === "HEAD" ? undefined : await c.req.arrayBuffer();
  let upstream: Response;
  try {
    upstream = await fetch(url, { method, headers, body });
  } catch (error) {
    return c.json(
      { ok: false, code: "DEV_SERVER_UNREACHABLE", message: `Could not reach ${DEV_SERVER}. Start it with "hardkas dev" in the project folder.`, detail: String(error) },
      502
    );
  }
  const responseHeaders = new Headers();
  for (const name of ["content-type", "cache-control", "x-hardkas-generation"]) {
    const value = upstream.headers.get(name);
    if (value) responseHeaders.set(name, value);
  }
  return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
});

// ---------------------------------------------------------------- simnet dev-account keys (KasWare import)

app.get("/api/devkeys", async (c) =>
  c.json({ ok: true, names: await listDevAccountNames(), addresses: await listDevAccountAddresses() })
);

app.post("/api/devkeys/reveal", async (c) => {
  // Private keys: only the IDE page itself (local origin, JSON body => CORS preflight) may ask.
  if (!localOnly(c)) return c.json({ ok: false, code: "FORBIDDEN", message: "forbidden origin" }, 403);
  if (!(c.req.header("content-type") ?? "").includes("application/json")) {
    return c.json({ ok: false, code: "BAD_REQUEST", message: "JSON body required" }, 400);
  }
  const body = (await c.req.json()) as { name?: string };
  if (!body.name) return c.json({ ok: false, code: "BAD_REQUEST", message: "name is required" }, 400);
  const key = await revealDevAccountKey(body.name);
  c.header("cache-control", "no-store");
  return c.json({ ok: true, ...key });
});

// ---------------------------------------------------------------- assistant (chat grounded in the Kaspa docs)

app.get("/api/assistant/config", async (c) => c.json({ ok: true, config: publicConfig(await loadConfig()), defaults: providerDefaults() }));

app.put("/api/assistant/config", async (c) => {
  if (!localOnly(c)) return c.json({ ok: false, code: "FORBIDDEN", message: "forbidden origin" }, 403);
  const body = (await c.req.json()) as Parameters<typeof saveConfig>[0];
  try {
    return c.json({ ok: true, config: publicConfig(await saveConfig(body)) });
  } catch (error) {
    return c.json({ ok: false, code: "BAD_REQUEST", message: error instanceof Error ? error.message : String(error) }, 400);
  }
});

app.get("/api/assistant/docs", async (c) => {
  const mode = (c.req.query("mode") ?? "core") as "off" | "core" | "full";
  try {
    const d = await kaspaDocs(mode);
    return c.json({ ok: true, mode, chars: d?.chars ?? 0, approxTokens: Math.round((d?.chars ?? 0) / 4), fetchedAt: d?.fetchedAt ?? null, stale: d?.stale ?? false, source: "https://docs.kaspa.org/llms.txt" });
  } catch (error) {
    return c.json({ ok: false, code: "DOCS_UNREACHABLE", message: error instanceof Error ? error.message : String(error) }, 502);
  }
});

app.post("/api/assistant/chat", async (c) => {
  if (!localOnly(c)) return c.json({ ok: false, code: "FORBIDDEN", message: "forbidden origin" }, 403);
  const body = (await c.req.json()) as ChatRequest;
  return streamSSE(c, async (stream) => {
    const ac = new AbortController();
    stream.onAbort(() => ac.abort());
    try {
      for await (const ev of streamChat(body, ac.signal)) {
        await stream.writeSSE({ event: ev.type, data: JSON.stringify(ev) });
      }
      await stream.writeSSE({ event: "done", data: "{}" });
    } catch (error) {
      if (ac.signal.aborted) return;
      const code = error instanceof AssistantError || error instanceof WorkspaceError ? error.code : "INTERNAL";
      await stream.writeSSE({ event: "error", data: JSON.stringify({ code, message: error instanceof Error ? error.message : String(error) }) });
    }
  });
});

app.post("/api/assistant/agent", async (c) => {
  if (!localOnly(c)) return c.json({ ok: false, code: "FORBIDDEN", message: "forbidden origin" }, 403);
  const body = (await c.req.json()) as AgentRequest;
  return streamSSE(c, async (stream) => {
    const ac = new AbortController();
    stream.onAbort(() => ac.abort());
    try {
      // streamAgent ends with its own "done" event (summary + ok); a second, empty one would wipe them in the UI.
      for await (const ev of streamAgent(body, ac.signal)) {
        await stream.writeSSE({ event: ev.type, data: JSON.stringify(ev) });
      }
    } catch (error) {
      if (ac.signal.aborted) return;
      const code = error instanceof AssistantError || error instanceof WorkspaceError ? error.code : "INTERNAL";
      await stream.writeSSE({ event: "error", data: JSON.stringify({ code, message: error instanceof Error ? error.message : String(error) }) });
    }
  });
});

// The IDE's answer to a "confirm" event of a running agent: approve (once or for the whole run) or decline.
app.post("/api/assistant/agent/confirm", async (c) => {
  if (!localOnly(c)) return c.json({ ok: false, code: "FORBIDDEN", message: "forbidden origin" }, 403);
  const body = (await c.req.json()) as { id?: string; approved?: boolean; allForRun?: boolean };
  if (typeof body.id !== "string" || typeof body.approved !== "boolean") {
    return c.json({ ok: false, code: "BAD_REQUEST", message: "id and approved are required" }, 400);
  }
  const found = answerConfirm(body.id, { approved: body.approved, allForRun: body.allForRun === true });
  if (!found) return c.json({ ok: false, code: "NOT_FOUND", message: "no command is waiting for that confirmation" }, 404);
  return c.json({ ok: true });
});

// ---------------------------------------------------------------- test debugger (vitest + Node inspector)

app.get("/api/debug/events", (c) =>
  streamSSE(c, async (stream) => {
    const send = (e: unknown) => stream.writeSSE({ event: "debug", data: JSON.stringify(e) });
    for (const e of debugSession.snapshot()) await send(e);
    const onEvent = (e: unknown) => void send(e);
    debugSession.on("event", onEvent);
    // A heartbeat lets the IDE notice a stream that died silently (a proxy or the server restarted) and reconnect.
    const beat = setInterval(() => void stream.writeSSE({ event: "ping", data: "" }).catch(() => undefined), 10_000);
    await new Promise<void>((resolve) => {
      stream.onAbort(() => {
        clearInterval(beat);
        debugSession.off("event", onEvent);
        resolve();
      });
    });
  })
);

// ---------------------------------------------------------------- SilverScript step debugger (cli-debugger)

app.get("/api/silver-debug/runner", async (c) => c.json({ ok: true, runner: await runnerInfo() }));

app.post("/api/silver-debug/approve", async (c) => {
  if (fromAgent(c)) return c.json({ ok: false, code: "FORBIDDEN", message: "an agent cannot approve a runner" }, 403);
  const body = (await c.req.json().catch(() => null)) as { sha256?: unknown } | null;
  const info = await runnerInfo();
  if (!info.available || !info.sha256) return c.json({ ok: false, code: "RUNNER_NOT_FOUND", message: info.message }, 409);
  // The page approves the build it was shown: a runner replaced meanwhile is not approved by that click.
  if (body?.sha256 !== info.sha256) return c.json({ ok: false, code: "RUNNER_CHANGED", message: "The runner changed since it was shown. Check it again." }, 409);
  await writeIdeSettings({ approvedSilverRunnerSha256: info.sha256 });
  return c.json({ ok: true, runner: await runnerInfo() });
});

app.get("/api/silver-debug", (c) => c.json({ ok: true, session: currentView() }));

app.post("/api/silver-debug/start", async (c) => {
  const body = (await c.req.json()) as StartRequest;
  return c.json({ ok: true, session: await startSession(body) });
});

app.post("/api/silver-debug/command", async (c) => {
  const body = (await c.req.json()) as { cmd?: DebugCommand; arg?: string | number };
  if (!body.cmd) return c.json({ ok: false, code: "BAD_REQUEST", message: "cmd is required" }, 400);
  return c.json({ ok: true, session: await sendCommand(body.cmd, body.arg) });
});

app.post("/api/silver-debug/stop", async (c) => c.json({ ok: true, session: await stopSession() }));

app.post("/api/debug/start", async (c) => {
  if (!localOnly(c)) return c.json({ ok: false, code: "FORBIDDEN", message: "forbidden origin" }, 403);
  const body = (await c.req.json().catch(() => ({}))) as Parameters<typeof debugSession.start>[0];
  // The debugger runs the project's tests: project code.
  await requireTrusted();
  try {
    await debugSession.start(body);
    return c.json({ ok: true });
  } catch (error) {
    return c.json({ ok: false, code: "DEBUG_START_FAILED", message: error instanceof Error ? error.message : String(error) }, 400);
  }
});

app.post("/api/debug/command", async (c) => {
  if (!localOnly(c)) return c.json({ ok: false, code: "FORBIDDEN", message: "forbidden origin" }, 403);
  const b = (await c.req.json()) as { cmd?: string; file?: string; lines?: number[]; objectId?: string; frameId?: string; expression?: string; state?: "none" | "uncaught" | "all" };
  try {
    switch (b.cmd) {
      case "setBreakpoints":
        await debugSession.setBreakpoints(String(b.file), b.lines ?? []);
        return c.json({ ok: true });
      case "resume":
        await debugSession.resume();
        return c.json({ ok: true });
      case "stepOver":
        await debugSession.stepOver();
        return c.json({ ok: true });
      case "stepInto":
        await debugSession.stepInto();
        return c.json({ ok: true });
      case "stepOut":
        await debugSession.stepOut();
        return c.json({ ok: true });
      case "pause":
        await debugSession.pause();
        return c.json({ ok: true });
      case "stop":
        await debugSession.stop();
        return c.json({ ok: true });
      case "setPauseOnExceptions":
        await debugSession.setPauseOnExceptions(b.state ?? "none");
        return c.json({ ok: true });
      case "properties":
        return c.json({ ok: true, variables: await debugSession.properties(String(b.objectId)) });
      case "evaluate":
        return c.json({ ok: true, result: await debugSession.evaluate(String(b.frameId), String(b.expression)) });
      default:
        return c.json({ ok: false, code: "BAD_REQUEST", message: `unknown command ${b.cmd}` }, 400);
    }
  } catch (error) {
    return c.json({ ok: false, code: "DEBUG_ERROR", message: error instanceof Error ? error.message : String(error) }, 400);
  }
});

// ---------------------------------------------------------------- query store (HardKAS's SQLite index), read-only

app.get("/api/store/health", async (c) => c.json({ ok: true, ...(await store.health()) }));

app.get("/api/store/lineage", async (c) => c.json({ ok: true, ...(await store.lineage()) }));

app.get("/api/store/artifacts", async (c) => {
  const q = c.req.query();
  return c.json({ ok: true, ...(await store.artifacts({ schema: q.schema, mode: q.mode, network: q.network, q: q.q, limit: Number(q.limit) || undefined, offset: Number(q.offset) || undefined })) });
});

app.get("/api/store/artifact", async (c) => {
  const id = c.req.query("id");
  if (!id) return c.json({ ok: false, code: "BAD_REQUEST", message: "id is required" }, 400);
  return c.json({ ok: true, ...(await store.artifact(id)) });
});

app.get("/api/store/tx", async (c) => {
  const id = c.req.query("id")?.trim();
  if (!id) return c.json({ ok: true, recent: await store.recentTxIds() });
  return c.json({ ok: true, ...(await store.tx(id)), recent: undefined });
});

app.get("/api/store/schema", async (c) => c.json({ ok: true, tables: await store.schema() }));

app.post("/api/store/sql", async (c) => {
  if (!localOnly(c)) return c.json({ ok: false, code: "FORBIDDEN", message: "forbidden origin" }, 403);
  const body = (await c.req.json().catch(() => ({}))) as { sql?: string };
  return c.json({ ok: true, ...(await store.runSql(String(body.sql ?? ""))) });
});
// ---------------------------------------------------------------- system checks (Docker, Node)

app.get("/api/system", async (c) => {
  const { execFile } = await import("node:child_process");
  const run = (cmd: string, args: string[]) =>
    new Promise<{ ok: boolean; out: string; err: string }>((resolve) => {
      execFile(cmd, args, { timeout: 8000, windowsHide: true }, (error, stdout, stderr) => resolve({ ok: !error, out: String(stdout).trim(), err: String(stderr || (error ? error.message : "")).trim() }));
    });
  const client = await run("docker", ["version", "--format", "{{.Client.Version}}"]);
  const server = client.ok ? await run("docker", ["version", "--format", "{{.Server.Version}}"]) : { ok: false, out: "", err: client.err };
  const installed = client.ok || !/not found|not recognized|ENOENT|no se reconoce/i.test(client.err);
  return c.json({
    ok: true,
    docker: {
      installed,
      running: server.ok && server.out.length > 0,
      clientVersion: client.ok ? client.out : null,
      serverVersion: server.ok ? server.out : null,
      error: server.ok ? null : server.err.split("\n")[0]?.slice(0, 200) || null
    },
    node: process.version,
    platform: process.platform
  });
});

// ---------------------------------------------------------------- the HardKas CLI the server runs

app.get("/api/cli", async (c) => c.json({ ok: true, cli: await cliInfo(getRoot() ?? process.cwd(), c.req.query("refresh") === "1") }));
app.get("/api/cli/catalog", async (c) => {
  // Reading the catalog loads the project's CLI package: only in a trusted folder.
  if (getRoot()) await requireTrusted();
  const catalog = await getCliCatalog(getRoot() ?? process.cwd());
  return c.json(catalog);
});
app.get("/api/updates", async (c) => {
  const updates = await checkUpdates({
    cwd: getRoot() ?? process.cwd(),
    currentIdeVersion: c.req.query("appVersion") || undefined,
    force: c.req.query("refresh") === "1"
  });
  return c.json({ ok: true, updates });
});

// ---------------------------------------------------------------- the local CPU miner (Explorer blocks, start/stop)

const MINER_CONTAINER = process.env.HARDKAS_MINER_CONTAINER ?? "hardkas-toccata-miner";

async function docker(args: string[], timeout = 10000): Promise<{ ok: boolean; out: string; err: string }> {
  const { execFile } = await import("node:child_process");
  return new Promise((resolve) => {
    execFile("docker", args, { timeout, windowsHide: true, maxBuffer: 32 * 1024 * 1024 }, (error, stdout, stderr) => resolve({ ok: !error, out: String(stdout), err: String(stderr) }));
  });
}

app.get("/api/node/blocks", async (c) => {
  const limit = Math.min(100, Math.max(1, Number(c.req.query("limit") ?? 25) || 25));
  const state = await docker(["inspect", "-f", "{{.State.Running}}", MINER_CONTAINER]);
  if (!state.ok) return c.json({ ok: true, exists: false, running: false, blocks: [], windowBlocks: 0, perSecond: 0, routeFull: 0 });
  const logs = await docker(["logs", "--timestamps", "--tail", "800", MINER_CONTAINER]);
  // docker logs writes the container's stderr to ours; the miner logs there. "Found a block: <hash>" (the hash can wrap to the next line).
  const text = `${logs.out}\n${logs.err}`;
  const found: Array<{ hash: string; at: string }> = [];
  for (const m of text.matchAll(/^(\d{4}-\d{2}-\d{2}T[\d:.]+Z)\s+\[[^\]]*\]\s*Found a block:\s*([0-9a-f]{64})/gm)) found.push({ at: m[1], hash: m[2] });
  const windowBlocks = found.length;
  let perSecond = 0;
  if (windowBlocks > 1) {
    const span = (Date.parse(found[windowBlocks - 1].at) - Date.parse(found[0].at)) / 1000;
    if (span > 0) perSecond = Number(((windowBlocks - 1) / span).toFixed(2));
  }
  // The node rejects blocks it cannot keep up with ("Block was not submitted: route is full"): a flat-out
  // CPU miner on simnet does this constantly, and transactions then take minutes to confirm.
  const routeFull = (text.match(/route is full/g) ?? []).length;
  return c.json({ ok: true, exists: true, running: state.out.trim() === "true", blocks: found.slice(-limit).reverse(), windowBlocks, perSecond, routeFull });
});

// Start or stop the existing miner container. HardKas creates it on the first `localnet fund` and stops it when
// funding ends; this just flips that container, so the node gets blocks (or stops being flooded) on demand.
app.post("/api/node/miner", async (c) => {
  if (!localOnly(c)) return c.json({ ok: false, code: "FORBIDDEN", message: "forbidden origin" }, 403);
  const body = (await c.req.json().catch(() => ({}))) as { action?: string };
  if (body.action !== "start" && body.action !== "stop") return c.json({ ok: false, code: "BAD_REQUEST", message: "action must be start or stop" }, 400);
  const exists = await docker(["inspect", "-f", "{{.Config.Image}}|{{.HostConfig.NetworkMode}}", MINER_CONTAINER]);
  if (!exists.ok) return c.json({ ok: false, code: "NO_MINER", message: `No miner container (${MINER_CONTAINER}) yet: fund an account once and HardKas creates it.` }, 404);
  // The miner is shared with every HardKas project on this machine: touch it only when it is HardKas' own
  // (kaspanet/cpuminer inside the node's network namespace), never another container that happens to have the name.
  const [image = "", networkMode = ""] = exists.out.trim().split("|");
  if (!isHardkasMiner({ image, networkMode })) {
    return c.json({ ok: false, code: "NOT_HARDKAS_MINER", message: `${MINER_CONTAINER} is not HardKas' CPU miner (image ${image || "unknown"}); nothing was changed.` }, 409);
  }
  // cpuminer does not exit on SIGTERM, so `docker stop` ends it with SIGKILL after the timeout: an exit code 137
  // on this container after a stop (here, or HardKas stopping it when `localnet fund` ends) is that, not a crash.
  const res = body.action === "start" ? await docker(["start", MINER_CONTAINER], 30000) : await docker(["stop", "-t", "2", MINER_CONTAINER], 30000);
  if (!res.ok) {
    const message = res.err.trim().split("\n")[0] || `docker ${body.action} failed`;
    // The miner shares the node container's network namespace. After the node is recreated (stop/start, reset)
    // the old miner points at a container that no longer exists and can never start again; `localnet fund`
    // creates a fresh one, so remove the stale container and say so.
    if (body.action === "start" && /network namespace|No such container/i.test(message)) {
      await docker(["rm", "-f", MINER_CONTAINER], 30000);
      return c.json({ ok: false, code: "STALE_MINER", message: "The miner container belonged to a previous node and has been removed. Mine a burst to create a new one." }, 409);
    }
    return c.json({ ok: false, code: "DOCKER_ERROR", message }, 500);
  }
  const after = await docker(["inspect", "-f", "{{.State.Running}}", MINER_CONTAINER]);
  return c.json({ ok: true, running: after.out.trim() === "true" });
});

// Prepares the open workspace for a fresh local chain. The node and miner containers are NOT touched here: the IDE's
// reset flow stops them with `hardkas localnet stop` and wipes the node with `hardkas node reset --yes`, so HardKas
// itself decides what belongs to its localnet (the containers are shared by every HardKas project on this machine).
// Account keys are moved to .hardkas/backups/reset-<time>/, never deleted: accounts.real.json can hold testnet keys.
app.post("/api/node/reset", async (c) => {
  if (!localOnly(c)) return c.json({ ok: false, code: "FORBIDDEN", message: "forbidden origin" }, 403);
  const root = getRoot();
  if (!root) return c.json({ ok: true, wiped: [], backedUp: [], moved: [], copied: [], backupDir: null, containersRemoved: false });
  await requireTrusted(root);
  await ensureHardkasConfig(root).catch(() => {});
  try {
    const result = await resetWorkspaceChainState(root);
    return c.json({ ok: true, ...result, containersRemoved: false });
  } catch (error) {
    if (error instanceof LocalNodeError) return c.json({ ok: false, code: error.code, message: error.message }, error.status as 409);
    throw error;
  }
});

// The IDE version, from this server's package.json (packages/ide-server, or stage/server in the desktop app). The
// desktop shell checks it before loading whatever listens on its port.
const IDE_VERSION: string = (() => {
  try {
    return (JSON.parse(readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "package.json"), "utf8")) as { version?: string }).version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
})();
const serverInfo = () => ({ name: "hardkas-ide-server", version: IDE_VERSION, port: PORT, devServer: DEV_SERVER, workspace: getRoot(), ui: UI_READY ? "served from this server" : "not built: run pnpm build, or use the Vite dev server at http://localhost:5173" });
app.get("/api/info", (c) => c.json(serverInfo()));

// ---------------------------------------------------------------- the IDE itself (production build)
// `pnpm build` produces apps/ide/dist; when it exists this server serves it, so one process is the whole IDE
// (this is what the desktop app starts). In development the Vite server on :5173 serves the UI instead.

const UI_DIR = path.resolve(process.env.HARDKAS_IDE_STATIC ?? path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "apps", "ide", "dist"));
const UI_READY = existsSync(path.join(UI_DIR, "index.html"));

app.get("/dapp", async (c) => c.redirect("/dapp/"));
app.get("/dapp/*", async (c) => {
  const root = getRoot();
  if (!root) return c.text("no workspace open", 404);
  let rel = c.req.path.replace(/^\/dapp\/?/, "");
  if (!rel) rel = "index.html";
  const dappDir = path.join(root, "dapp");
  const file = (await readStatic(dappDir, rel)) ?? (await readStatic(dappDir, "index.html"));
  if (!file) return c.text("not found in workspace dapp/", 404);
  return sandboxedFile(file);
});

app.get("*", async (c) => {
  if (c.req.path.startsWith("/api/")) return c.json({ ok: false, code: "NOT_FOUND", message: `No route ${c.req.path}` }, 404);
  if (!UI_READY) return c.json(serverInfo());
  let rel: string;
  try {
    rel = decodeURIComponent(c.req.path);
  } catch {
    return c.text("bad request", 400);
  }
  // Real files first; any other path is a client-side route and gets index.html.
  const file = (rel !== "/" ? await readStatic(UI_DIR, rel) : null) ?? (await readStatic(UI_DIR, "index.html"));
  if (!file) return c.text("not found", 404);
  const hashed = /\/assets\//.test(rel);
  return new Response(file.body, { headers: { "content-type": file.type, "cache-control": hashed ? "public, max-age=31536000, immutable" : "no-cache" } });
});

// ---------------------------------------------------------------- boot

async function main() {
  const argv = process.argv.slice(2);
  const wsIndex = argv.indexOf("--workspace");
  const initial = wsIndex >= 0 ? argv[wsIndex + 1] : process.env.HARDKAS_IDE_WORKSPACE;
  if (initial) {
    await openWorkspace(initial);
    console.error(`[ide-server] workspace: ${getRoot()}`);
  } else {
    console.error("[ide-server] no workspace open; pick one from the IDE Home screen");
  }
  const server = serve({ fetch: app.fetch, port: PORT, hostname: "127.0.0.1" }, (info) => {
    console.error(`[ide-server] listening on http://127.0.0.1:${info.port}  (dev-server proxy -> ${DEV_SERVER}, shell: ${defaultShell().file})`);
  });
  injectWebSocket(server);
}

// Tests import the app without opening a port (HARDKAS_IDE_NO_LISTEN=1) and call `app.request(...)`.
export { app };
if (process.env.HARDKAS_IDE_NO_LISTEN !== "1") void main();
