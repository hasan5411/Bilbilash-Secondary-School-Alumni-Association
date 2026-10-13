import fs from 'node:fs';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import pg from 'pg';
import { env, rootDir } from '../config/env.js';
import { dbConnectionConfig } from './pool.js';

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

    // ----- Authority seed -----
    if (!env.authorityEmail || !env.authorityPassword) {
      throw new Error('AUTHORITY_EMAIL / AUTHORITY_PASSWORD missing in .env');
    }
    const email = env.authorityEmail.trim().toLowerCase();
    const { rows: roles } = await client.query(
      "SELECT role_id FROM roles WHERE role_name = 'AUTHORITY' LIMIT 1"
    );
    if (!roles.length) throw new Error('AUTHORITY role missing — schema seed failed');
    const authorityRoleId = roles[0].role_id;

    const { rows: existing } = await client.query(
      'SELECT user_id FROM users WHERE email = $1 LIMIT 1',
      [email]
    );
    if (existing.length) {
      // Idempotent: keep single Authority account, align role/status only.
      await client.query(
        "UPDATE users SET role_id = $1, status = 'approved', is_active = 1 WHERE user_id = $2 AND role_id <> $1",
        [authorityRoleId, existing[0].user_id]
      );
      console.log('[init-db] Authority account already exists — no duplicate created.');
    } else {
      const hash = await bcrypt.hash(env.authorityPassword, 12);
      const { rows } = await client.query(
        `INSERT INTO users (role_id, first_name, last_name, email, password_hash, status, is_active)
         VALUES ($1, 'Authority', 'System', $2, $3, 'approved', 1)
         RETURNING user_id`,
        [authorityRoleId, email, hash]
      );
      await client.query(
        `INSERT INTO profiles (user_id, bio) VALUES ($1, 'System authority account')`,
        [rows[0].user_id]
      );
      console.log(`[init-db] Authority account created for ${email}.`);
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
