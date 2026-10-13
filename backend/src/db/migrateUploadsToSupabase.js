/**
 * migrateUploadsToSupabase — move legacy LOCAL upload references to Supabase Storage.
 *
 * Usage:  cd backend && npm run migrate:uploads          (DRY RUN — reports only)
 *         cd backend && MIGRATE_UPLOADS=1 npm run migrate:uploads   (APPLY)
 *
 * WHAT IT DOES
 *   Scans profiles.profile_photo, teachers.photo and gallery.image_path for
 *   legacy bare-filename references (local-disk driver era), uploads each
 *   existing local file to the correct Supabase bucket/prefix, and rewrites
 *   the column to the object's public URL.
 *
 * SAFETY
 *   - DRY RUN by default: without MIGRATE_UPLOADS=1 nothing is written.
 *   - Skips absolute https references (already cloud-hosted) and NULLs.
 *   - A locally missing file is reported and left untouched (on Render the
 *     ephemeral disk is usually already wiped — those refs simply cannot be
 *     recovered from the backend host; the original files must be re-uploaded
 *     by their owners if they matter).
 *   - Existing rows are only ever updated, never deleted; nothing else changes.
 *   - payments.screenshot_path is intentionally OUT OF SCOPE (no bucket was
 *     provisioned for payment evidence; those refs keep current behavior).
 *   - Requires SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (driver = supabase).
 *
 * The password/credentials are never printed; the script logs table + row id only.
 */
import fs from 'node:fs';
import path from 'node:path';
import { env, uploadDir } from '../config/env.js';
import { pool, query } from './pool.js';
import { persistUpload, STORAGE_BUCKETS, PROFILE_IMAGE_MAX_BYTES, GALLERY_IMAGE_MAX_BYTES } from '../storage.js';

const APPLY = process.env.MIGRATE_UPLOADS === '1';

const MIME_BY_EXT = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.webp': 'image/webp', '.gif': 'image/gif',
};

// [table, column, bucket, prefix, idColumn]
const TARGETS = [
  ['profiles', 'profile_photo', STORAGE_BUCKETS.profileImages, 'members', 'user_id'],
  ['teachers', 'photo', STORAGE_BUCKETS.profileImages, 'teachers', 'teacher_id'],
  ['gallery', 'image_path', STORAGE_BUCKETS.galleryImages, 'gallery', 'gallery_id'],
];

async function main() {
  if (env.storage.driver !== 'supabase') {
    console.error('[migrate] This script uploads to Supabase Storage. Set SUPABASE_URL and');
    console.error('[migrate] SUPABASE_SERVICE_ROLE_KEY (and UPLOAD_STORAGE=supabase if also CLOUDINARY_URL is set).');
    process.exit(1);
  }
  console.log(`[migrate] Mode: ${APPLY ? 'APPLY (MIGRATE_UPLOADS=1)' : 'DRY RUN (no changes; set MIGRATE_UPLOADS=1 to apply)'}`);

  let migrated = 0; let missing = 0; let skipped = 0;

  for (const [table, column, bucket, prefix, idColumn] of TARGETS) {
    const rows = await query(
      `SELECT ${idColumn} AS id, ${column} AS ref FROM ${table}
        WHERE ${column} IS NOT NULL AND ${column} <> '' ORDER BY ${idColumn}`
    );
    for (const row of rows) {
      const ref = String(row.ref);
      if (/^https?:\/\//i.test(ref)) { skipped++; continue; } // already cloud-hosted
      const ext = path.extname(ref).toLowerCase();
      const mimetype = MIME_BY_EXT[ext];
      const localPath = path.join(uploadDir, path.basename(ref)); // basename: no traversal
      if (!mimetype || !fs.existsSync(localPath)) {
        missing++;
        console.log(`  [skip] ${table}.${column} id=${row.id}: local file not recoverable (${ref})`);
        continue;
      }
      if (!APPLY) { migrated++; console.log(`  [would migrate] ${table}.${column} id=${row.id} -> ${bucket}/${prefix}/…`); continue; }

      const newRef = await persistUpload(
        { path: localPath, filename: path.basename(ref), mimetype },
        {
          bucket, prefix,
          maxBytes: bucket === STORAGE_BUCKETS.galleryImages ? GALLERY_IMAGE_MAX_BYTES : PROFILE_IMAGE_MAX_BYTES,
        }
      );
      // persistUpload removes the local source file on a successful upload, so
      // the file now lives only in the bucket — the DB row must point at it.
      await query(`UPDATE ${table} SET ${column} = ? WHERE ${idColumn} = ?`, [newRef, row.id]);
      migrated++;
      console.log(`  [migrated] ${table}.${column} id=${row.id}`);
    }
  }

  console.log(`[migrate] DONE. migrated=${migrated} missing-local=${missing} already-cloud=${skipped}`);
  await pool.end();
  process.exit(0);
}

main().catch(async (err) => {
  console.error('[migrate] FAILED:', err.code || '', err.message);
  try { await pool.end(); } catch { /* ignore */ }
  process.exit(1);
});
