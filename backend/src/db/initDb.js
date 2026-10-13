import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { env, rootDir } from '../config/env.js';
import { dbConnectionConfig } from './pool.js';
import {
  ensureAuthorityAccount, describeAuthorityResult,
  authorityResultIsFailure, authorityResultNeedsWarning,
} from './authoritySeed.js';

/**
 * Idempotent PostgreSQL initializer (migrated from MySQL):
 *  1. When configured via individual DB_* vars (local development), connect to
 *     the maintenance database and create the target database if missing.
 *     With DATABASE_URL (Supabase / managed PG) the database already exists,
 *     so creation is skipped automatically.
 *  2. Run database/schema.postgresql.sql (CREATE TABLE IF NOT EXISTS + role seed).
 *  3. Seed the AUTHORITY account from env (never duplicates, never prints password).
 * Safe to run multiple times. Never drops or truncates anything.
 */

const SCHEMA_FILE = path.join(rootDir, '..', 'database', 'schema.postgresql.sql');

function baseConfig() {
  return dbConnectionConfig();
}

async function ensureDatabase() {
  // Managed connection strings (Supabase) point at an existing database.
  if (env.db.connectionString) {
    console.log('[init-db] Using DATABASE_URL — target database is assumed to exist (managed PostgreSQL).');
    return;
  }
  const admin = new pg.Client({ ...baseConfig(), database: 'postgres' });
  try {
    await admin.connect();
    const { rows } = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [env.db.database]);
    if (!rows.length) {
      // Identifier cannot be parameterized; the name comes from config, not user input.
      await admin.query(`CREATE DATABASE "${env.db.database.replace(/"/g, '""')}"`);
      console.log(`[init-db] Created database "${env.db.database}".`);
    } else {
      console.log(`[init-db] Database "${env.db.database}" already exists.`);
    }
  } finally {
    await admin.end();
  }
}

async function main() {
  await ensureDatabase();

  const client = new pg.Client(baseConfig());
  try {
    await client.connect();

    console.log('[init-db] Applying schema (database/schema.postgresql.sql)...');
    const schemaSql = fs.readFileSync(SCHEMA_FILE, 'utf8');
    await client.query(schemaSql); // multi-statement, idempotent
    console.log('[init-db] Schema applied (idempotent).');

    // ----- Authority seed (create-only, race-safe, never overwrites) -----
    const email = env.authorityEmail.trim().toLowerCase();
    const result = await ensureAuthorityAccount(client, {
      email,
      password: env.authorityPassword,
    });
    console.log(`[init-db] ${describeAuthorityResult(email, result)}`);
    if (authorityResultNeedsWarning(result)) {
      console.warn(
        `[init-db] WARNING: the Authority account cannot log in while status='${result.status}', is_active=${result.isActive}. ` +
        'If this is unintended, run: npm run authority:set-password (explicit recovery; only ever touches the AUTHORITY account).'
      );
    }
    if (authorityResultIsFailure(result)) {
      throw new Error(
        'AUTHORITY_EMAIL is taken by a non-Authority account — it was NOT modified or promoted. ' +
        'See the message above and resolve it manually, then re-run npm run init-db.'
      );
    }
    console.log('[init-db] DONE.');
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('[init-db] FAILED:', err.code || '', err.message);
  process.exit(1);
});
