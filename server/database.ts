import 'dotenv/config';
import { AsyncLocalStorage } from 'node:async_hooks';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { RequestHandler } from 'express';
import { neon } from '@neondatabase/serverless';

const schema = `PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;
  CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY, data TEXT NOT NULL, deleted INTEGER NOT NULL DEFAULT 0);
  CREATE TABLE IF NOT EXISTS topics (id TEXT PRIMARY KEY, data TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS event_links (task_id TEXT NOT NULL, calendar_id TEXT NOT NULL, event_id TEXT NOT NULL, PRIMARY KEY(task_id, calendar_id));
  CREATE TABLE IF NOT EXISTS sync_jobs (id TEXT PRIMARY KEY, task_id TEXT NOT NULL, calendar_id TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1, attempts INTEGER NOT NULL DEFAULT 0, next_at INTEGER NOT NULL DEFAULT 0, error TEXT);
  PRAGMA user_version = 1;`;
const tables = { tasks: ['id', 'data', 'deleted'], topics: ['id', 'data'], settings: ['key', 'value'], event_links: ['task_id', 'calendar_id', 'event_id'], sync_jobs: ['id', 'task_id', 'calendar_id', 'version', 'attempts', 'next_at', 'error'] } as const;
type Snapshot = Partial<Record<keyof typeof tables, Record<string, string | number | null>[]>>;
const cloud = Boolean(process.env.DATABASE_URL);
if (process.env.VERCEL && !cloud) throw new Error('DATABASE_URL is required on Vercel. Local files are not persistent.');
const file = cloud ? ':memory:' : process.env.DATABASE_PATH || './data/fokus.sqlite';
function openDatabase(filename: string) { const value = new DatabaseSync(filename); value.exec(schema); return value; }
if (file !== ':memory:') mkdirSync(dirname(resolve(file)), { recursive: true });
const local = openDatabase(file);
const context = new AsyncLocalStorage<DatabaseSync>();
export const currentDatabase = () => context.getStore() || local;
export const db: DatabaseSync = new Proxy(local, { get(_target, key) { const current = context.getStore() || local; const value = Reflect.get(current, key); return typeof value === 'function' ? value.bind(current) : value; } });
const sql = cloud ? neon(process.env.DATABASE_URL!) : null;
let initialized: Promise<void> | undefined;
async function initialize() {
  if (!sql) return;
  initialized ??= (async () => {
    await sql.query(`CREATE TABLE IF NOT EXISTS fokus_workspace (id TEXT PRIMARY KEY, revision BIGINT NOT NULL DEFAULT 0, payload JSONB NOT NULL DEFAULT '{}'::jsonb, updated_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
    await sql.query(`INSERT INTO fokus_workspace(id) VALUES ('mario') ON CONFLICT DO NOTHING`);
  })().catch(error => { initialized = undefined; throw error; });
  await initialized;
}
function restore(target: DatabaseSync, snapshot: Snapshot) {
  target.exec('BEGIN');
  for (const [table, columns] of Object.entries(tables)) {
    const insert = target.prepare(`INSERT INTO ${table}(${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')})`);
    for (const row of snapshot[table as keyof Snapshot] || []) insert.run(...columns.map(c => row[c] ?? null));
  }
  target.exec('COMMIT');
}
function dump(target: DatabaseSync): Snapshot {
  return Object.fromEntries(Object.keys(tables).map(table => [table, target.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()])) as Snapshot;
}

/** One compact aggregate is intentional: this is a single-person workspace.
 * Neon sees one read per authenticated request and one CAS write only if data
 * changed. No held connections, keepalive queries or per-task network round trips.
 * Each request has an isolated SQLite working copy; it is never the durable DB.
 */
export const workspaceMiddleware: RequestHandler = async (req, res, next) => {
  if (!sql) return next();
  let isolated: DatabaseSync | undefined;
  try {
    await initialize();
    const [row] = await sql.query(`SELECT revision,payload FROM fokus_workspace WHERE id='mario'`);
    const snapshot = row.payload as Snapshot;
    isolated = openDatabase(':memory:'); restore(isolated, snapshot);
    const original = JSON.stringify(dump(isolated));
    const target = isolated;
    const end = res.end.bind(res);
    let ending = false;
    // Express endpoints return compact JSON/redirects, never streamed responses.
    res.end = function (...args: unknown[]) {
      if (ending) return res;
      ending = true;
      const modified = JSON.stringify(dump(target));
      const persist = modified !== original && res.statusCode < 400;
      const commit = async () => {
        if (persist) {
          if (Buffer.byteLength(modified) > 5 * 1024 * 1024) throw new Error('Workspace zu groß. Bitte alte Aufgaben exportieren und aufräumen.');
          const updated = await sql.query(`UPDATE fokus_workspace SET payload=$1::jsonb,revision=revision+1,updated_at=now() WHERE id='mario' AND revision=$2 RETURNING revision`, [modified, String(row.revision)]);
          if (!updated.length) throw new Error('Zwischenzeitlich wurden Aufgaben in einem anderen Fenster geändert. Bitte erneut versuchen.');
        }
        target.close();
        (end as (...args: unknown[]) => unknown)(...args);
      };
      void commit().catch((error: unknown) => {
        try { target.close(); } catch { /* already closed */ }
        res.removeHeader('Content-Length'); res.removeHeader('Location'); res.removeHeader('Set-Cookie');
        res.statusCode = 409; res.setHeader('Content-Type', 'application/json; charset=utf-8');
        end(JSON.stringify({ error: error instanceof Error && /Workspace|Zwischenzeitlich/.test(error.message) ? error.message : 'Speichern fehlgeschlagen. Deine Änderung wurde nicht übernommen. Bitte erneut versuchen.' }));
      });
      return res;
    } as typeof res.end;
    context.run(target, next);
  } catch (error) { try { isolated?.close(); } catch { /* initialization failed */ } next(error); }
};
