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
import { pool, query } from './pool.js';
import { normalizeStorageRef } from '../storage.js';

const APPLY = process.env.NORMALIZE_STORAGE_REFS === '1';

const COLUMNS = [
  ['profiles', 'profile_photo', 'user_id'],
  ['teachers', 'photo', 'teacher_id'],
  ['gallery', 'image_path', 'gallery_id'],
  ['payments', 'screenshot_path', 'payment_id'],
];

const needsFix = (v) => typeof v === 'string' && /\/storage\/v1\/object\/(sign|authenticated)\//.test(v);

async function main() {
  console.log(`[normalize-refs] Mode: ${APPLY ? 'APPLY (NORMALIZE_STORAGE_REFS=1)' : 'DRY RUN (no changes)'}`);
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
  try { await pool.end(); } catch { /* ignore */ }
  process.exit(1);
});
