/**
 * pgTestClient — mysql2-shaped single connection for the legacy test scripts.
 *
 * The five test suites (smoke / contribution / profile-completion / demo-e2e /
 * seed-demo) were written against `mysql2/promise`: they call
 * `conn.query(sql, params)` and destructure `[rows, fields]`. This helper keeps
 * that exact shape while running on PostgreSQL:
 *   - SELECT-like statements → [rows, undefined]
 *   - INSERT/UPDATE/DELETE  → [{ insertId, affectedRows, rows }, undefined]
 *   - `?` placeholders are translated to $1..$n
 *   - DATE/DATETIME/TIME/int8 value shapes match mysql2 (importing pool.js
 *     installs the shared type parsers).
 *
 * Connection settings come from the exact same source as the application
 * (DATABASE_URL or DB_* via backend/.env) — tests always hit the same
 * database the server uses.
 */
import pg from 'pg';
import { URL } from 'node:url';
import { toPostgres } from '../src/db/pool.js'; // also installs shared type parsers
import { dbConnectionConfig } from '../src/db/pool.js';

/**
 * TEST-SAFETY GUARD: these suites CREATE users and DELETE rows (fixture
 * cleanup). They may only target LOCAL or DISPOSABLE STAGING databases —
 * never production. Any non-local host is refused unless the operator
 * explicitly confirms with ALLOW_REMOTE_TESTS=1.
 */
function assertTestTargetIsLocal() {
  if (process.env.ALLOW_REMOTE_TESTS === '1') return;
  const cfg = dbConnectionConfig();
  let host = cfg.host || '';
  if (cfg.connectionString) {
    try { host = new URL(cfg.connectionString).hostname; } catch { host = '(unparseable DATABASE_URL)'; }
  }
  const localHosts = ['localhost', '127.0.0.1', '::1', '[::1]'];
  if (!localHosts.includes(host)) {
    console.error(`[tests] REFUSING TO RUN: the configured database is REMOTE (${host}).`);
    console.error('[tests] Test suites create and delete rows — they may only target a LOCAL or');
    console.error('[tests] DISPOSABLE STAGING database. NEVER run them against production.');
    console.error('[tests] If this remote database is your disposable STAGING database, re-run with');
    console.error('[tests] ALLOW_REMOTE_TESTS=1 to confirm that intent.');
    process.exit(1);
  }
}

const isRowProducing = (cmd) => ['SELECT', 'WITH', 'VALUES', 'SHOW', 'EXPLAIN'].includes(cmd);

export async function openTestDb() {
  assertTestTargetIsLocal();
  const client = new pg.Client({ ...dbConnectionConfig(), prepare: false });
  await client.connect();
  return {
    async query(sql, params = []) {
      const hasParams = Array.isArray(params) && params.length > 0;
      const text = hasParams ? toPostgres(sql) : sql;
      const res = await client.query(text, hasParams ? params : undefined);
      const cmd = (res.command || '').toUpperCase();
      if (isRowProducing(cmd)) return [res.rows, undefined];
      const first = res.rows && res.rows[0];
      return [{
        insertId: first ? Object.values(first)[0] : 0,
        affectedRows: res.rowCount ?? 0,
        rowCount: res.rowCount ?? 0,
        rows: res.rows ?? [],
      }, undefined];
    },
    async end() { await client.end(); },
  };
}
