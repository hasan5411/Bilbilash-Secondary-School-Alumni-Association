import pg from 'pg';
import { env } from '../config/env.js';

/**
 * PostgreSQL connection pool (migrated from mysql2 for Supabase compatibility).
 *
 * This module keeps the exact API surface the services were written against:
 *   query(sql, params)      → SELECT-like statements return a rows array;
 *                             INSERT/UPDATE/DELETE/DDL return a mysql2-style
 *                             ResultSetHeader { insertId, affectedRows, rowCount }
 *   queryOne(sql, params)   → rows[0] || null
 *   withTransaction(fn)     → fn(conn) where conn.query(sql, params) resolves
 *                             to [rowsOrHeader, undefined] (mysql2 tuple shape)
 *
 * INSERTs that need the new primary-key value must end with RETURNING <pk>;
 * insertId is then the first column of the returned row.
 *
 * Compatibility notes (behavior identical to the old mysql2 pool):
 *  - `?` placeholders are translated to $1..$n (string literals protected);
 *  - DATE / DATETIME / TIME come back as 'YYYY-MM-DD' / 'YYYY-MM-DD HH:MM:SS'
 *    / 'HH:MM:SS' strings (mysql2 `dateStrings: true` behavior);
 *  - BIGINT (int8) counters/ids come back as JS numbers;
 *  - DECIMAL/NUMERIC amounts stay strings (same as mysql2).
 */

// ── Type parsers: restore mysql2-compatible value shapes ────────────────────
// int8 (BIGINT) → number (ids/counts in this app are far below 2^53)
pg.types.setTypeParser(20, (v) => (v === null ? null : Number(v)));
// DATE → 'YYYY-MM-DD' (raw text; mysql2 dateStrings)
pg.types.setTypeParser(1082, (v) => v);
// TIME → 'HH:MM:SS' (raw text; mysql2 dateStrings)
pg.types.setTypeParser(1083, (v) => v);
// TIMESTAMP (no tz, our schema's choice) → 'YYYY-MM-DD HH:MM:SS',
// dropping any fractional seconds to match MySQL DATETIME exactly.
pg.types.setTypeParser(1114, (v) => (v === null ? null : v.slice(0, 19)));
// TIMESTAMPTZ (if ever used) → same shape, offset stripped.
pg.types.setTypeParser(1184, (v) => (v === null ? null : v.slice(0, 19)));

// ── `?` → `$n` translator (only when parameters are present) ────────────────
// Walks the SQL, skipping single-quoted string literals ('' = escaped quote)
// and double-quoted identifiers ("" = escaped quote), so a literal '?' inside
// text never becomes a placeholder.
export function toPostgres(sql) {
  let out = '';
  let n = 0;
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    if (inSingle) {
      out += ch;
      if (ch === "'") {
        if (sql[i + 1] === "'") { out += sql[++i]; continue; }
        inSingle = false;
      }
      continue;
    }
    if (inDouble) {
      out += ch;
      if (ch === '"') {
        if (sql[i + 1] === '"') { out += sql[++i]; continue; }
        inDouble = false;
      }
      continue;
    }
    if (ch === "'") { inSingle = true; out += ch; continue; }
    if (ch === '"') { inDouble = true; out += ch; continue; }
    if (ch === '?') { out += `$${++n}`; continue; }
    out += ch;
  }
  return out;
}

// ── Result adapter: mysql2-compatible return shapes ────────────────────────
function isRowProducing(command) {
  return command === 'SELECT' || command === 'WITH' || command === 'VALUES' || command === 'SHOW' || command === 'EXPLAIN';
}

function adapt(command, res) {
  if (isRowProducing(command)) return res.rows;
  // INSERT ... RETURNING / UPDATE / DELETE / DDL → ResultSetHeader-like object
  const first = res.rows && res.rows[0];
  return {
    insertId: first ? Object.values(first)[0] : 0,
    affectedRows: res.rowCount ?? 0,
    rowCount: res.rowCount ?? 0,
    rows: res.rows ?? [],
  };
}

function commandOf(sql) {
  const m = /^\s*(?:\/\*[\s\S]*?\*\/\s*)*([a-zA-Z]+)/.exec(sql);
  return m ? m[1].toUpperCase() : '';
}

// ── Pool construction ──────────────────────────────────────────────────────
/** The exact node-pg connection options for the configured database
 *  (DATABASE_URL with TLS, or individual DB_* vars). Exported so init-db and
 *  the test harness connect identically to the application pool. */
export function dbConnectionConfig() {
  if (env.db.connectionString) {
    return {
      connectionString: env.db.connectionString,
      // Supabase pooler / managed PG require TLS. `sslmode=require` accepts
      // the server certificate without CA pinning (standard for Supabase).
      ...(env.db.ssl ? { ssl: { rejectUnauthorized: false } } : {}),
    };
  }
  return {
    host: env.db.host,
    port: env.db.port,
    user: env.db.user,
    password: env.db.password,
    database: env.db.database,
    ...(env.db.ssl ? { ssl: { rejectUnauthorized: false } } : {}),
  };
}

const poolConfig = {
  ...dbConnectionConfig(),
  waitForConnections: true,
  connectionLimit: 10,
  // Prepared statements off: safe with Supabase's pgbouncer (transaction
  // mode) and harmless locally.
  prepare: false,
};

export const pool = new pg.Pool(poolConfig);

/** Run a statement and adapt the result. Multi-statement text is allowed
 *  (DDL batches) when no parameters are passed — PostgreSQL simple protocol. */
async function run(client, sql, params) {
  const hasParams = Array.isArray(params) && params.length > 0;
  const text = hasParams ? toPostgres(sql) : sql;
  const res = await client.query(text, hasParams ? params : undefined);
  return adapt(res.command || commandOf(sql), res);
}

export async function query(sql, params = []) {
  return run(pool, sql, params);
}

export async function queryOne(sql, params = []) {
  const rows = await query(sql, params);
  return rows[0] || null;
}

/** mysql2-style transaction helper. fn receives a connection whose query()
 *  resolves to [rowsOrHeader, undefined] — the same tuple shape services
 *  destructure (`const [res] = await conn.query(...)`). */
export async function withTransaction(fn) {
  const client = await pool.connect();
  const conn = {
    query: async (sql, params = []) => [await run(client, sql, params), undefined],
  };
  try {
    await client.query('BEGIN');
    const result = await fn(conn);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch { /* connection already broken */ }
    throw err;
  } finally {
    client.release();
  }
}

/** Graceful shutdown (used by tests and SIGTERM handling). */
export async function closePool() {
  await pool.end();
}
