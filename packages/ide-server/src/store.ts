import { promises as fs, existsSync } from "node:fs";
import path from "node:path";
import { Worker } from "node:worker_threads";
import { getRoot } from "./workspace.js";

/**
 * Read-only window onto HardKAS's SQLite query store (`.hardkas/store.db`): artifacts, events, lineage edges and workflow
 * traces. HardKAS writes it (hardkas query store sync / rebuild, run through the CLI); the IDE only reads, so browsing is
 * instant and can be filtered and paged freely. Uses node:sqlite (Node 22.5+; unflagged since 22.13).
 */

export class StoreError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string
  ) {
    super(message);
  }
}

type Db = { prepare(sql: string): { all(...p: unknown[]): any[]; get(...p: unknown[]): any }; close(): void };

function storePath(): string {
  const root = getRoot();
  if (!root) throw new StoreError(409, "NO_WORKSPACE", "No workspace is open");
  return path.join(root, ".hardkas", "store.db");
}

async function open(): Promise<Db> {
  const file = storePath();
  if (!existsSync(file)) throw new StoreError(404, "NO_STORE", "This project has no query store yet. Build it with: hardkas query store rebuild");
  let sqlite: { DatabaseSync: new (f: string, o?: { readOnly?: boolean }) => Db };
  try {
    sqlite = (await import("node:sqlite")) as unknown as typeof sqlite;
  } catch {
    throw new StoreError(501, "SQLITE_UNAVAILABLE", "This Node version has no built-in SQLite (needs Node 22.13 or newer).");
  }
  return new sqlite.DatabaseSync(file, { readOnly: true });
}

async function withDb<T>(fn: (db: Db) => T): Promise<T> {
  const db = await open();
  try {
    return fn(db);
  } finally {
    db.close();
  }
}

const num = (v: unknown) => (typeof v === "bigint" ? Number(v) : Number(v ?? 0));

// ------------------------------------------------------------------ health

async function artifactFiles(dir: string): Promise<{ count: number; newestMs: number }> {
  let count = 0;
  let newestMs = 0;
  const walk = async (d: string) => {
    let entries;
    try {
      entries = await fs.readdir(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) await walk(p);
      else if (e.name.endsWith(".json")) {
        count++;
        const st = await fs.stat(p).catch(() => null);
        if (st && st.mtimeMs > newestMs) newestMs = st.mtimeMs;
      }
    }
  };
  await walk(dir);
  return { count, newestMs };
}

export async function health() {
  const root = getRoot();
  if (!root) throw new StoreError(409, "NO_WORKSPACE", "No workspace is open");
  const file = storePath();
  if (!existsSync(file)) return { exists: false, path: file };
  const [st, wal] = await Promise.all([fs.stat(file), fs.stat(`${file}-wal`).catch(() => null)]);
  const disk = await artifactFiles(path.join(root, ".hardkas", "artifacts"));
  const ledger = await fs.stat(path.join(root, "events.jsonl")).catch(() => null);
  const data = await withDb((db) => {
    const count = (t: string) => num(db.prepare(`select count(*) c from ${t}`).get()?.c);
    const group = (sql: string) => db.prepare(sql).all().map((r) => ({ name: String(r.name ?? "(none)"), count: num(r.n) }));
    return {
      counts: { artifacts: count("artifacts"), events: count("events"), lineageEdges: count("lineage_edges"), lineageClosure: count("lineage_closure"), traces: count("traces") },
      byKind: group("select schema as name, count(*) n from artifacts group by schema order by n desc"),
      byMode: group("select mode as name, count(*) n from artifacts group by mode order by n desc"),
      byNetwork: group("select network_id as name, count(*) n from artifacts group by network_id order by n desc"),
      eventsByDomain: group("select domain as name, count(*) n from events group by domain order by n desc"),
      tracesByStatus: group("select status as name, count(*) n from traces group by status order by n desc"),
      indexedAt: db.prepare("select max(indexed_at) a, min(indexed_at) b from artifacts").get(),
      newestArtifact: db.prepare("select max(created_at) a from artifacts").get()?.a ?? null,
      migrations: db.prepare("select version, name, applied_at from hardkas_migrations order by version").all().map((m) => ({ version: num(m.version), name: String(m.name), appliedAt: String(m.applied_at) })),
      metadata: Object.fromEntries(db.prepare("select key, value from metadata").all().map((m) => [String(m.key), String(m.value)]))
    };
  });
  const indexedMs = data.indexedAt?.a ? Date.parse(String(data.indexedAt.a)) : 0;
  const newestMs = Math.max(disk.newestMs, ledger?.mtimeMs ?? 0);
  return {
    exists: true,
    path: file,
    sizeBytes: st.size,
    walBytes: wal?.size ?? 0,
    ...data,
    indexedAt: data.indexedAt?.a ?? null,
    disk: { files: disk.count, newestMs: disk.newestMs, ledgerMs: ledger?.mtimeMs ?? null },
    // Files written after the last indexing: HardKAS's own check ("query store doctor") calls that stale too.
    stale: newestMs > indexedMs,
    staleSince: newestMs > indexedMs && indexedMs ? new Date(newestMs).toISOString() : null
  };
}

// ------------------------------------------------------------------ artifacts

export interface ArtifactQuery {
  schema?: string;
  mode?: string;
  network?: string;
  q?: string;
  limit?: number;
  offset?: number;
}

const ARTIFACT_COLS = "artifact_id, content_hash, schema, kind, mode, network_id, tx_id, created_at, file_path, indexed_at";

export async function artifacts(query: ArtifactQuery) {
  const where: string[] = [];
  const params: unknown[] = [];
  if (query.schema) (where.push("schema = ?"), params.push(query.schema));
  if (query.mode) (where.push("mode = ?"), params.push(query.mode));
  if (query.network) (where.push("network_id = ?"), params.push(query.network));
  if (query.q?.trim()) {
    const like = `%${query.q.trim().replace(/[%_]/g, (c) => `\\${c}`)}%`;
    where.push("(artifact_id like ? escape '\\' or content_hash like ? escape '\\' or tx_id like ? escape '\\' or file_path like ? escape '\\' or schema like ? escape '\\')");
    params.push(like, like, like, like, like);
  }
  const clause = where.length ? `where ${where.join(" and ")}` : "";
  const limit = Math.min(200, Math.max(1, query.limit ?? 50));
  const offset = Math.max(0, query.offset ?? 0);
  return withDb((db) => ({
    total: num(db.prepare(`select count(*) c from artifacts ${clause}`).get(...params)?.c),
    rows: db.prepare(`select ${ARTIFACT_COLS} from artifacts ${clause} order by created_at desc, artifact_id limit ? offset ?`).all(...params, limit, offset),
    limit,
    offset
  }));
}

interface LineageRef {
  artifact_id: string;
  schema: string | null;
  created_at: string | null;
  tx_id: string | null;
  depth: number;
}

export async function artifact(id: string) {
  return withDb((db) => {
    const row = db.prepare(`select ${ARTIFACT_COLS}, raw_json from artifacts where artifact_id = ? or content_hash = ? limit 1`).get(id, id);
    if (!row) throw new StoreError(404, "NOT_FOUND", `No artifact ${id.slice(0, 16)}… in the index`);
    const walk = (dir: "up" | "down"): LineageRef[] => {
      const [from, to] = dir === "up" ? ["child_artifact_id", "parent_artifact_id"] : ["parent_artifact_id", "child_artifact_id"];
      return db
        .prepare(
          `with recursive walk(id, depth) as (
             select ${to}, 1 from lineage_edges where ${from} = ?
             union
             select e.${to}, w.depth + 1 from lineage_edges e join walk w on e.${from} = w.id where w.depth < 25
           )
           select walk.id as artifact_id, a.schema, a.created_at, a.tx_id, min(walk.depth) as depth
           from walk left join artifacts a on a.artifact_id = walk.id group by walk.id order by depth, a.created_at limit 200`
        )
        .all(row.artifact_id)
        .map((r) => ({ artifact_id: String(r.artifact_id), schema: r.schema ?? null, created_at: r.created_at ?? null, tx_id: r.tx_id ?? null, depth: num(r.depth) }));
    };
    let json: unknown = null;
    try {
      json = JSON.parse(String(row.raw_json));
    } catch {
      json = null;
    }
    const { raw_json: _raw, ...meta } = row;
    return { artifact: meta, json, ancestors: walk("up"), descendants: walk("down") };
  });
}

// ------------------------------------------------------------------ transactions

function summarise(json: any): Record<string, unknown> {
  if (!json || typeof json !== "object") return {};
  const pick = (v: unknown) => (v === undefined || v === null ? undefined : v);
  const submit = json.submitResult as { accepted?: boolean; error?: string } | undefined;
  return {
    status: pick(json.status) ?? (submit ? (submit.accepted ? "accepted" : `rejected${submit.error ? `: ${submit.error}` : ""}`) : undefined),
    from: pick(json.from?.address ?? json.from?.accountName),
    to: pick(json.to?.address),
    amountSompi: pick(json.amountSompi),
    feeSompi: pick(json.feeSompi ?? json.fee?.feeSompi ?? json.estimatedFeeSompi),
    mass: pick(json.mass ?? json.estimatedMass),
    mode: pick(json.mode),
    workflowId: pick(json.workflowId),
    parent: pick(json.lineage?.parentArtifactId)
  };
}

export async function tx(txId: string) {
  return withDb((db) => {
    const like = `%${txId.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
    const rows = db
      .prepare(`select ${ARTIFACT_COLS}, raw_json from artifacts where tx_id = ? or raw_json like ? escape '\\' order by created_at, schema limit 60`)
      .all(txId, like);
    // The plan carries no tx id (it is what the transaction was built from), so pull in what the lineage says led here.
    const known = new Set(rows.map((r) => String(r.artifact_id)));
    const viaLineage = new Set<string>();
    const ancestors = db.prepare(
      `with recursive walk(id, depth) as (
         select parent_artifact_id, 1 from lineage_edges where child_artifact_id = ?
         union
         select e.parent_artifact_id, w.depth + 1 from lineage_edges e join walk w on e.child_artifact_id = w.id where w.depth < 8
       ) select distinct id from walk`
    );
    for (const r of [...rows]) {
      for (const a of ancestors.all(r.artifact_id)) {
        const id = String(a.id);
        if (known.has(id)) continue;
        const extra = db.prepare(`select ${ARTIFACT_COLS}, raw_json from artifacts where artifact_id = ?`).get(id);
        if (extra) {
          rows.push(extra);
          known.add(id);
          viaLineage.add(id);
        }
      }
    }
    rows.sort((a, b) => String(a.created_at ?? "").localeCompare(String(b.created_at ?? "")) || String(a.schema).localeCompare(String(b.schema)));
    const artifactsOut = rows.map((r) => {
      let json: unknown = null;
      try {
        json = JSON.parse(String(r.raw_json));
      } catch {
        json = null;
      }
      const { raw_json: _raw, ...meta } = r;
      return { ...meta, summary: summarise(json), viaLineage: viaLineage.has(String(r.artifact_id)) };
    });
    const events = db
      .prepare("select event_id, kind, domain, timestamp, workflow_id, artifact_id, network_id, source_subsystem from events where tx_id = ? order by timestamp, sequence_number limit 300")
      .all(txId);
    return { txId, artifacts: artifactsOut, events };
  });
}

/** Most recent transaction ids the index knows, for the picker. */
export async function recentTxIds(limit = 30): Promise<Array<{ txId: string; at: string; schema: string }>> {
  return withDb((db) =>
    db
      .prepare("select tx_id, max(created_at) at, schema from artifacts where tx_id is not null and tx_id != '' group by tx_id order by at desc limit ?")
      .all(limit)
      .map((r) => ({ txId: String(r.tx_id), at: String(r.at), schema: String(r.schema) }))
  );
}

// ------------------------------------------------------------------ schema and SQL

export async function schema() {
  return withDb((db) =>
    db
      .prepare("select name from sqlite_master where type in ('table','view') and name not like 'sqlite_%' order by name")
      .all()
      .map((t) => ({
        name: String(t.name),
        columns: db.prepare(`pragma table_info(${String(t.name)})`).all().map((c) => ({ name: String(c.name), type: String(c.type) })),
        rows: num(db.prepare(`select count(*) c from ${String(t.name)}`).get()?.c)
      }))
  );
}

const MAX_ROWS = 500;
const SQL_TIMEOUT_MS = 6000;

/** Only reads: one SELECT / WITH / EXPLAIN / VALUES statement, or a table_info pragma. */
export function checkReadOnlySql(sql: string): string {
  const cleaned = sql
    .replace(/--[^\n]*/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .trim()
    .replace(/;+\s*$/, "");
  if (!cleaned) throw new StoreError(400, "EMPTY_SQL", "Write a query first.");
  if (cleaned.includes(";")) throw new StoreError(400, "ONE_STATEMENT", "Run one statement at a time.");
  if (!/^(select|with|explain|values)\b/i.test(cleaned) && !/^pragma\s+(table_info|table_list|index_list|foreign_key_list)\b/i.test(cleaned)) {
    throw new StoreError(400, "READ_ONLY", "The SQL console only reads: use SELECT, WITH, EXPLAIN or PRAGMA table_info.");
  }
  if (/\b(attach|detach|load_extension|vacuum|insert|update|delete|drop|alter|create|replace\s+into)\b/i.test(cleaned)) {
    throw new StoreError(400, "READ_ONLY", "The SQL console only reads.");
  }
  return cleaned;
}

const WORKER_CODE = `
const { parentPort, workerData } = require("node:worker_threads");
try {
  const { DatabaseSync } = require("node:sqlite");
  const db = new DatabaseSync(workerData.file, { readOnly: true });
  const stmt = db.prepare(workerData.sql);
  const started = Date.now();
  const all = stmt.all();
  const rows = all.slice(0, workerData.max).map((r) => {
    const o = {};
    for (const [k, v] of Object.entries(r)) o[k] = typeof v === "bigint" ? String(v) : v instanceof Uint8Array ? "<blob " + v.length + " bytes>" : v;
    return o;
  });
  parentPort.postMessage({ ok: true, rows, total: all.length, ms: Date.now() - started });
  db.close();
} catch (e) {
  parentPort.postMessage({ ok: false, message: e && e.message ? e.message : String(e) });
}
`;

export async function runSql(sql: string): Promise<{ columns: string[]; rows: Array<Record<string, unknown>>; total: number; truncated: boolean; ms: number }> {
  const clean = checkReadOnlySql(sql);
  const file = storePath();
  if (!existsSync(file)) throw new StoreError(404, "NO_STORE", "This project has no query store yet. Build it with: hardkas query store rebuild");
  // A worker, so a runaway query (a cross join over 100k rows) can be cut off instead of freezing the server.
  const result = await new Promise<{ ok: boolean; rows?: Array<Record<string, unknown>>; total?: number; ms?: number; message?: string }>((resolve, reject) => {
    const worker = new Worker(WORKER_CODE, { eval: true, workerData: { file, sql: clean, max: MAX_ROWS } });
    const timer = setTimeout(() => {
      void worker.terminate();
      reject(new StoreError(408, "SQL_TIMEOUT", `The query took longer than ${SQL_TIMEOUT_MS / 1000} s and was stopped. Add a LIMIT or a WHERE.`));
    }, SQL_TIMEOUT_MS);
    worker.once("message", (m) => {
      clearTimeout(timer);
      void worker.terminate();
      resolve(m);
    });
    worker.once("error", (e) => {
      clearTimeout(timer);
      reject(new StoreError(500, "SQL_FAILED", e.message));
    });
  });
  if (!result.ok) throw new StoreError(400, "SQL_ERROR", result.message ?? "SQL error");
  const rows = result.rows ?? [];
  return { columns: rows.length ? Object.keys(rows[0]) : [], rows, total: result.total ?? rows.length, truncated: (result.total ?? 0) > rows.length, ms: result.ms ?? 0 };
}
