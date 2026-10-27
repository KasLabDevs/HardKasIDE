import { serve } from "@hono/node-server";
import { createNodeWebSocket } from "@hono/node-ws";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { streamSSE } from "hono/streaming";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AssistantError, answerConfirm, kaspaDocs, loadConfig, providerDefaults, publicConfig, saveConfig, streamChat, streamAgent, type ChatRequest, type AgentRequest } from "./assistant.js";
import { debugSession } from "./debug.js";
import { listDevAccountNames, revealDevAccountKey } from "./devkeys.js";
import * as wsfs from "./fs.js";
import { FsError } from "./fs.js";
import * as cluster from "./cluster.js";
import { ClusterError } from "./cluster.js";
import * as store from "./store.js";
import { StoreError } from "./store.js";
import { cliInfo, createProject, getJob, listJobs, PROJECT_TEMPLATES, startJob, subscribe } from "./runner.js";
import { closeTerminal, defaultShell, listTerminals, openTerminal } from "./terminal.js";
import { examplesDir, fetchText, installNpmPlugin, listExamples, loadRegistry, pluginsRoot, readStatic, searchNpmPlugins } from "./plugins.js";
import { installVsx, readIndex, readVsxFile, searchVsx, setVsxEnabled, uninstallVsx } from "./vsx.js";
import { closeWorkspace, describeWorkspace, getRoot, listRecents, openWorkspace, readDevServerToken } from "./workspace.js";

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

function isLocalOrigin(origin: string | undefined): boolean {
  if (!origin) return false;
  try {
    const url = new URL(origin);
    return ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  } catch {
    return false;
  }
}

function localOnly(c: { req: { header(name: string): string | undefined } }): boolean {
  const secFetchSite = c.req.header("sec-fetch-site");
  if (secFetchSite === "cross-site") return false;

  const origin = c.req.header("origin");
  if (origin) return isLocalOrigin(origin);

  const referer = c.req.header("referer");
  if (referer) return isLocalOrigin(referer);

  const host = c.req.header("host");
  if (host) {
    try {
      const url = new URL(`http://${host}`);
      return ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    } catch {
      return false;
    }
  }

  // No Origin, Referer or Host at all: not a browser. Nothing local needs this, so refuse.
  return false;
}

app.use(
  "/api/*",
  cors({
    origin: (origin) => {
      if (!origin) return origin;
      return isLocalOrigin(origin) ? origin : "";
    },
    allowHeaders: ["Content-Type", "Authorization", "X-Hardkas-Request"],
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"]
  })
);

app.use("/api/*", async (c, next) => {
  const method = c.req.method.toUpperCase();
  if (["POST", "PUT", "DELETE", "PATCH"].includes(method)) {
    if (!localOnly(c)) {
      return c.json({ ok: false, code: "FORBIDDEN", message: "forbidden origin or host" }, 403);
    }
  }
  await next();
});

app.onError((error, c) => {
  if (error instanceof ClusterError) {
    return c.json({ ok: false, code: error.code, message: error.message }, error.status as 400);
  }
  if (error instanceof StoreError) {
    return c.json({ ok: false, code: error.code, message: error.message }, error.status as 400);
  }
  if (error instanceof FsError) {
    return c.json({ ok: false, code: error.code, message: error.message }, error.status as 400);
  }
  const message = error instanceof Error ? error.message : String(error);
  return c.json({ ok: false, code: "INTERNAL", message }, 500);
});

// ---------------------------------------------------------------- workspace

app.get("/api/workspace", async (c) => c.json({ ok: true, workspace: await describeWorkspace() }));

app.get("/api/workspace/recents", async (c) => c.json({ ok: true, recents: await listRecents(), home: os.homedir() }));

app.post("/api/workspace/open", async (c) => {
  const body = (await c.req.json()) as { path?: string };
  if (!body.path) return c.json({ ok: false, code: "BAD_REQUEST", message: "path is required" }, 400);
  const workspace = await openWorkspace(body.path);
  return c.json({ ok: true, workspace });
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
  return c.json({ ok: true, path: p, content: await wsfs.readFile(p) });
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
  await wsfs.writeFile(body.path, body.content);
  return c.json({ ok: true });
});

app.post("/api/fs/mkdir", async (c) => {
  const body = (await c.req.json()) as { path?: string };
  if (!body.path) return c.json({ ok: false, code: "BAD_REQUEST", message: "path is required" }, 400);
  await wsfs.mkdir(body.path);
  return c.json({ ok: true });
});

app.post("/api/fs/rename", async (c) => {
  const body = (await c.req.json()) as { from?: string; to?: string };
  if (!body.from || !body.to) return c.json({ ok: false, code: "BAD_REQUEST", message: "from and to are required" }, 400);
  await wsfs.rename(body.from, body.to);
  return c.json({ ok: true });
});

app.delete("/api/fs", async (c) => {
  const p = c.req.query("path");
  if (!p) return c.json({ ok: false, code: "BAD_REQUEST", message: "path is required" }, 400);
  await wsfs.remove(p);
  return c.json({ ok: true });
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
  const body = (await c.req.json()) as { args?: string[]; cwd?: string; command?: string };
  if (!Array.isArray(body.args)) return c.json({ ok: false, code: "BAD_REQUEST", message: "args[] is required" }, 400);
  const job = await startJob({ args: body.args, cwd: resolveSafeCwd(body.cwd), command: body.command });
  return c.json({ ok: true, job: summarize(job) });
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

app.get("/api/project/templates", (c) => c.json({ ok: true, templates: PROJECT_TEMPLATES, defaultParent: path.join(os.homedir(), "hardkas-projects") }));

app.post("/api/project/create", async (c) => {
  const body = (await c.req.json()) as { template?: string; name?: string; parentDir?: string; install?: boolean };
  if (!body.template || !body.name || !body.parentDir) {
    return c.json({ ok: false, code: "BAD_REQUEST", message: "template, name and parentDir are required" }, 400);
  }
  const { job, dest } = await createProject({ template: body.template, name: body.name, parentDir: body.parentDir, install: body.install });
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

// ---------------------------------------------------------------- external plugins

app.get("/api/plugins/fetch", async (c) => {
  const url = c.req.query("url");
  if (!url) return c.json({ ok: false, code: "BAD_REQUEST", message: "url is required" }, 400);
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

app.get("/api/plugins/examples/*", async (c) => {
  const rel = c.req.path.replace(/^\/api\/plugins\/examples\//, "");
  const file = await readStatic(examplesDir(), rel);
  if (!file) return c.text("not found", 404);
  return new Response(file.body, { headers: { "content-type": file.type, "cache-control": "no-cache" } });
});

app.get("/api/plugins/static/*", async (c) => {
  const rel = c.req.path.replace(/^\/api\/plugins\/static\//, "");
  const file = await readStatic(path.join(pluginsRoot(), "node_modules"), rel);
  if (!file) return c.text("not found", 404);
  return new Response(file.body, { headers: { "content-type": file.type, "cache-control": "no-cache" } });
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
  return new Response(file.body, { headers: { "content-type": file.type, "cache-control": "no-cache" } });
});

// ---------------------------------------------------------------- dev-server proxy

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

app.get("/api/devkeys", async (c) => c.json({ ok: true, names: await listDevAccountNames() }));

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
      const code = error instanceof AssistantError ? error.code : "INTERNAL";
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
      const code = error instanceof AssistantError ? error.code : "INTERNAL";
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

app.post("/api/debug/start", async (c) => {
  if (!localOnly(c)) return c.json({ ok: false, code: "FORBIDDEN", message: "forbidden origin" }, 403);
  const body = (await c.req.json().catch(() => ({}))) as Parameters<typeof debugSession.start>[0];
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

// ---------------------------------------------------------------- cluster of extra local nodes (Docker)

app.get("/api/cluster", async (c) => c.json({ ok: true, ...(await cluster.status()) }));

app.get("/api/cluster/logs", async (c) => c.json({ ok: true, text: await cluster.logs(String(c.req.query("name") ?? ""), Number(c.req.query("tail")) || 200) }));

app.post("/api/cluster/add", async (c) => {
  if (!localOnly(c)) return c.json({ ok: false, code: "FORBIDDEN", message: "forbidden origin" }, 403);
  const body = (await c.req.json().catch(() => ({}))) as { count?: number };
  return c.json({ ok: true, added: await cluster.addNodes(Number(body.count) || 1) });
});

app.post("/api/cluster/scale", async (c) => {
  if (!localOnly(c)) return c.json({ ok: false, code: "FORBIDDEN", message: "forbidden origin" }, 403);
  const body = (await c.req.json().catch(() => ({}))) as { replicas?: number };
  return c.json({ ok: true, ...(await cluster.scale(Number(body.replicas ?? 0))) });
});

app.post("/api/cluster/node", async (c) => {
  if (!localOnly(c)) return c.json({ ok: false, code: "FORBIDDEN", message: "forbidden origin" }, 403);
  const body = (await c.req.json().catch(() => ({}))) as { name?: string; action?: "start" | "stop" | "restart" | "remove" };
  if (!body.name || !body.action || !["start", "stop", "restart", "remove"].includes(body.action)) return c.json({ ok: false, code: "BAD_REQUEST", message: "name and action are required" }, 400);
  await cluster.nodeAction(body.name, body.action);
  return c.json({ ok: true });
});
// ---------------------------------------------------------------- query store (HardKAS's SQLite index), read-only

app.get("/api/store/health", async (c) => c.json({ ok: true, ...(await store.health()) }));

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
  const exists = await docker(["inspect", "-f", "{{.State.Running}}", MINER_CONTAINER]);
  if (!exists.ok) return c.json({ ok: false, code: "NO_MINER", message: `No miner container (${MINER_CONTAINER}) yet: fund an account once and HardKas creates it.` }, 404);
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

const serverInfo = () => ({ name: "hardkas-ide-server", port: PORT, devServer: DEV_SERVER, workspace: getRoot(), ui: UI_READY ? "served from this server" : "not built: run pnpm build, or use the Vite dev server at http://localhost:5173" });
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
  return new Response(file.body, { headers: { "content-type": file.type, "cache-control": "no-cache" } });
});

app.get("*", async (c) => {
  if (c.req.path.startsWith("/api/")) return c.json({ ok: false, code: "NOT_FOUND", message: `No route ${c.req.path}` }, 404);
  if (!UI_READY) return c.json(serverInfo());
  const rel = decodeURIComponent(c.req.path);
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

void main();
