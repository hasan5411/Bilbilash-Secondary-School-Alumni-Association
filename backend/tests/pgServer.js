/**
 * pgServer.js — local development/test PostgreSQL (embedded) for this project.
 *
 * WHY: the app now targets Supabase PostgreSQL, but verification must happen
 * locally BEFORE anything touches an external service. embedded-postgres ships
 * official PostgreSQL binaries inside node_modules (no system install, nothing
 * outside this folder changes).
 *
 * Usage:  node tests/pgServer.js     (runs until killed; port 55432)
 * Then:   DATABASE_URL=postgres://postgres:postgres@127.0.0.1:55432/bilbilash_alumni?sslmode=disable
 *
 * Data lives in backend/.pgdata (gitignored). Delete that folder to reset.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import EmbeddedPostgres from 'embedded-postgres';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', '.pgdata');
const PORT = Number(process.env.PGLOCAL_PORT || 55432);
const DB_NAME = process.env.PGLOCAL_DB || 'bilbilash_alumni';

const pg = new EmbeddedPostgres({
  databaseDir: DATA_DIR,
  user: 'postgres',
  password: 'postgres',
  port: PORT,
  persistent: true,
});

async function main() {
  if (!fs.existsSync(DATA_DIR)) {
    console.log('[pg-local] initialising cluster…');
    await pg.initialise();
  }
  console.log('[pg-local] starting…');
  await pg.start();
  try {
    await pg.createDatabase(DB_NAME);
    console.log(`[pg-local] created database "${DB_NAME}"`);
  } catch (err) {
    if (/already exists/i.test(String(err?.message))) {
      console.log(`[pg-local] database "${DB_NAME}" already exists`);
    } else {
      throw err;
    }
  }
  console.log(`[pg-local] PostgreSQL 17 ready at postgres://postgres:postgres@127.0.0.1:${PORT}/${DB_NAME}`);
  console.log('[pg-local] running — press Ctrl+C to stop (or kill this process).');
}

main().catch((err) => {
  console.error('[pg-local] FAILED:', err.message);
  process.exit(1);
});
