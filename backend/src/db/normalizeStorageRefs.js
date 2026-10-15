/**
 * normalizeStorageRefs — repair image references that point at EXPIRING
 * Supabase signed URLs (`/storage/v1/object/sign/…?token=…`) so every stored
 * ref is the stable public form (`/storage/v1/object/public/…`).
 *
 * Usage:  cd backend && npm run migrate:storage-refs             (DRY RUN)
 *         cd backend && NORMALIZE_STORAGE_REFS=1 npm run migrate:storage-refs
 *
 * WHY: signed URLs expire (default ~1 hour) and then every avatar/gallery/
 * teacher/screenshot image404s. Our upload code never stores signed URLs —
 * they can only arrive from outside (Supabase dashboard "Get URL" or hand-
 * edited rows). Both buckets are PUBLIC, so the public form is permanent and
 * needs no token.
 *
 * SAFETY
 *   - Shape-only rewrite: no storage API calls, no file I/O, no keys needed.
 *   - Only rows whose value actually changes are updated; NULLs, bare local
 *     filenames and non-Supabase URLs (e.g. Cloudinary) are untouched.
 *   - Tokens are never printed (changed rows are reported by table + id only).
 */
import { pool, query, dbConnectionConfig } from './pool.js';
import { normalizeStorageRef } from '../storage.js';

const APPLY = process.env.NORMALIZE_STORAGE_REFS === '1';

const LOCAL_HOSTS = ['localhost', '127.0.0.1', '::1', '[::1]'];

/**
 * Identify the database this run will touch — host, port and database NAME
 * only. Credentials (user, password, any token in the URI) are NEVER printed.
 */
function describeTarget() {
  const cfg = dbConnectionConfig();
  if (cfg.connectionString) {
    try {
      const u = new URL(cfg.connectionString);
      const host = u.hostname;
      return { host, port: u.port || '5432', database: (u.pathname || '/postgres').replace(/^\//, '') || 'postgres', local: LOCAL_HOSTS.includes(host) };
    } catch {
      return { host: '(unparseable DATABASE_URL)', port: '?', database: '?', local: false };
    }
  }
  return { host: cfg.host, port: String(cfg.port), database: cfg.database, local: LOCAL_HOSTS.includes(cfg.host) };
}

const COLUMNS = [
  ['profiles', 'profile_photo', 'user_id'],
  ['teachers', 'photo', 'teacher_id'],
  ['gallery', 'image_path', 'gallery_id'],
  ['payments', 'screenshot_path', 'payment_id'],
];

const needsFix = (v) => typeof v === 'string' && /\/storage\/v1\/object\/(sign|authenticated)\//.test(v);

async function main() {
  const target = describeTarget();
  console.log(`[normalize-refs] Target: database "${target.database}" at ${target.host}:${target.port} — ${target.local ? 'LOCAL' : 'REMOTE'}`);
  console.log(`[normalize-refs] Mode: ${APPLY ? 'APPLY (NORMALIZE_STORAGE_REFS=1)' : 'DRY RUN (no changes; read-only SELECTs only)'}`);

  // Safety rails: APPLY on anything non-local is a production change — require
  // an explicit second confirmation. Dry runs are read-only and allowed anywhere.
  if (APPLY && !target.local && process.env.ALLOW_REMOTE_MIGRATE !== '1') {
    console.error('[normalize-refs] REFUSING to APPLY on a REMOTE database without ALLOW_REMOTE_MIGRATE=1.');
    console.error('[normalize-refs] Review the dry run first: npm run migrate:storage-refs');
    process.exit(1);
  }
  if (!target.local) {
    console.log('[normalize-refs] REMOTE target — writes happen ONLY with NORMALIZE_STORAGE_REFS=1 AND ALLOW_REMOTE_MIGRATE=1.');
  }

  let fixed = 0; let scanned = 0;

  for (const [table, column, idColumn] of COLUMNS) {
    const rows = await query(
      `SELECT ${idColumn} AS id, ${column} AS ref FROM ${table}
        WHERE ${column} IS NOT NULL AND ${column} <> '' AND ${column} LIKE '%/storage/v1/object/%'`
    );
    scanned += rows.length;
    for (const row of rows) {
      if (!needsFix(row.ref)) continue;
      const next = String(normalizeStorageRef(row.ref));
      if (!APPLY) { fixed++; console.log(`  [would fix] ${table}.${column} id=${row.id}`); continue; }
      await query(`UPDATE ${table} SET ${column} = ? WHERE ${idColumn} = ?`, [next, row.id]);
      fixed++;
      console.log(`  [fixed] ${table}.${column} id=${row.id}`);
    }
  }

  console.log(`[normalize-refs] DONE. storage-shaped refs scanned=${scanned}, ${APPLY ? 'fixed' : 'would-fix'}=${fixed}`);
  await pool.end();
  process.exit(0);
}

main().catch(async (err) => {
  console.error('[normalize-refs] FAILED:', err.code || '', err.message);
  if (['ECONNREFUSED', 'ENOTFOUND', 'EHOSTUNREACH', 'ETIMEDOUT', '57P03'].includes(err.code)) {
    console.error('[normalize-refs] Database unreachable for THIS environment\'s DATABASE_URL.');
    console.error('[normalize-refs] - Production: run in Render → Shell (the service env has the production URI).');
    console.error('[normalize-refs] - Local dev: start the embedded DB (node tests/pgServer.js) or point DATABASE_URL elsewhere for this command.');
  }
  try { await pool.end(); } catch { /* ignore */ }
  process.exit(1);
});
