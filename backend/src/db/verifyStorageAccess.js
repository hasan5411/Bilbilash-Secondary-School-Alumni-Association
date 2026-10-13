/**
 * verifyStorageAccess — prove (or disprove) PUBLIC read access to stored
 * images WITHOUT any credential. Prints statuses only; never constructs,
 * receives or prints a signed token or any key.
 *
 * Usage:
 *   cd backend && npm run storage:verify -- profile-images/members/<key>.jpg gallery-images/gallery/<key>.jpg
 *   cd backend && npm run storage:verify          (scan DB image refs instead)
 *
 * Interpretation:
 *   200            -> object is publicly readable; display will work.
 *   404 (not_found)-> either the object is gone OR THE BUCKET IS PRIVATE:
 *                    unauthenticated public reads on a private bucket also
 *                    return 404. If the Supabase dashboard shows the object,
 *                    flip the bucket to PUBLIC (bucket Settings → Public).
 * Needs only SUPABASE_URL (a non-secret identifier) — no service key.
 */
import { pool, query } from './pool.js';
import { env } from '../config/env.js';
import { normalizeStorageRef } from '../storage.js';

const COLUMNS = [
  ['profiles', 'profile_photo'], ['teachers', 'photo'],
  ['gallery', 'image_path'], ['payments', 'screenshot_path'],
];

function publicUrlFor(bucketPath) {
  const base = (env.storage.supabaseUrl || '').replace(/\/+$/, '');
  if (!base) return null;
  return `${base}/storage/v1/object/public/${String(bucketPath).replace(/^\/+/, '')}`;
}

/** Strip any query/token before printing — statuses and paths only. */
const redact = (u) => String(u).split('?')[0];

async function probe(label, url) {
  try {
    const res = await fetch(url);
    let code = '';
    if (!res.ok) {
      try { code = ` (${(await res.json()).error_code || ''})`; } catch { /* non-JSON */ }
    }
    console.log(`  ${res.ok ? '✅ 200' : `❌ ${res.status}`}${code}  ${label}  →  ${redact(url)}`);
    return res.ok;
  } catch (err) {
    console.log(`  ❌ network error  ${label}  →  ${redact(url)} (${err.message})`);
    return false;
  }
}

async function main() {
  const args = process.argv.slice(2).filter((a) => a !== '--');
  let ok = 0; let total = 0;

  if (args.length) {
    if (!env.storage.supabaseUrl) {
      console.error('[verify] SUPABASE_URL is required to build public URLs.');
      process.exit(1);
    }
    for (const arg of args) {
      total++;
      if (await probe(arg, publicUrlFor(arg))) ok++;
    }
  } else {
    // Scan the database for Supabase-shaped refs (normalized to public form).
    let refs = [];
    for (const [table, column] of COLUMNS) {
      const rows = await query(
        `SELECT ${column} AS ref FROM ${table}
          WHERE ${column} LIKE 'http%/storage/v1/object/%' LIMIT 20`
      );
      refs = refs.concat(rows.map((r) => ({ label: `${table}.${column}`, ref: String(normalizeStorageRef(r.ref)) })));
    }
    if (!refs.length) {
      console.log('[verify] No Supabase-shaped image refs found in the database yet.');
      process.exit(0);
    }
    if (!env.storage.supabaseUrl) {
      // Refs embed the project host themselves — no SUPABASE_URL needed here.
    }
    const seen = new Set();
    for (const { label, ref } of refs) {
      if (seen.has(ref)) continue;
      seen.add(ref);
      total++;
      if (await probe(label, ref)) ok++;
    }
  }

  console.log(`[verify] ${ok}/${total} publicly readable.`);
  if (ok < total) {
    console.log('[verify] Failures on PUBLIC endpoints while objects exist in the dashboard');
    console.log('[verify] mean the BUCKET IS PRIVATE: Supabase → Storage → the bucket →');
    console.log('[verify] Settings → enable “Public bucket”, then re-run this script.');
  }
  await pool.end();
  process.exit(ok === total ? 0 : 1);
}

main().catch(async (err) => {
  console.error('[verify] FAILED:', err.code || '', err.message);
  try { await pool.end(); } catch { /* ignore */ }
  process.exit(1);
});
