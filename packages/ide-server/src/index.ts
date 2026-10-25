import { serve } from "@hono/node-server";
import { createNodeWebSocket } from "@hono/node-ws";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { streamSSE } from "hono/streaming";
import os from "node:os";
import path from "node:path";
import * as wsfs from "./fs.js";
import { FsError } from "./fs.js";
import { createProject, getJob, listJobs, PROJECT_TEMPLATES, startJob, subscribe } from "./runner.js";
import { closeTerminal, defaultShell, listTerminals, openTerminal } from "./terminal.js";
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

app.use(
  "/api/*",
  cors({
    origin: (origin) => {
      if (!origin) return origin;
      try {
        const url = new URL(origin);
        return ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ? origin : "";
      } catch {
        return "";
      }
    },
    allowHeaders: ["Content-Type", "Authorization", "X-Hardkas-Request"],
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"]
  })
);

app.onError((error, c) => {
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

app.post("/api/run", async (c) => {
  const body = (await c.req.json()) as { args?: string[]; cwd?: string; command?: string };
  if (!Array.isArray(body.args)) return c.json({ ok: false, code: "BAD_REQUEST", message: "args[] is required" }, 400);
  const job = await startJob({ args: body.args, cwd: body.cwd, command: body.command });
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
    const cols = Number(c.req.query("cols") ?? 100) || 100;
    const rows = Number(c.req.query("rows") ?? 30) || 30;
    const cwd = c.req.query("cwd") || undefined;
    let session: ReturnType<typeof openTerminal> | null = null;
    return {
      onOpen(_event, ws) {
        try {
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
        else if (msg.type === "resize" && msg.cols && msg.rows) session.pty.resize(msg.cols, msg.rows);
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

app.get("/", (c) =>
  c.json({ name: "hardkas-ide-server", port: PORT, devServer: DEV_SERVER, workspace: getRoot(), hint: "Open the IDE at http://localhost:5173" })
);

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
