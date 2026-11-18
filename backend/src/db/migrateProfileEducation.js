import { query, withTransaction } from './pool.js';

/**
 * migrateProfileEducation.js — separate college / university on profiles.
 *
 * Adds (metadata only, no row is rewritten or deleted):
 *   profiles + college    VARCHAR(120) NULL
 *            + university VARCHAR(120) NULL
 *
 * `institute` keeps its meaning (current company / institute) and is relabelled
 * "Institute / Company" in the UI. The directory's institute search matches all
 * three columns. Existing rows keep NULL for the two new fields.
 *
 * IDEMPOTENT: every step checks the catalog first. ATOMIC: one transaction.
 *
 * Usage: cd backend && npm run migrate:profile-education
 */

const COLUMNS = [
  ['college', 'VARCHAR(120)'],
  ['university', 'VARCHAR(120)'],
];

async function columnExists(conn, table, column) {
  const [rows] = await conn.query(
    `SELECT COUNT(*) AS n FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = ? AND column_name = ?`,
    [table, column]
  );
  return Number(rows[0].n) > 0;
}

export async function migrateProfileEducation() {
  const rows = await query(
    `SELECT table_name FROM information_schema.tables
      WHERE table_schema = current_schema() AND table_name = 'profiles'`
  );
  if (rows.length === 0) {
    return { skipped: true, reason: 'profiles table is missing — run npm run init-db first' };
  }

  const report = { skipped: false, columnsAdded: [], counts: {} };

  await withTransaction(async (conn) => {
    for (const [column, type] of COLUMNS) {
      if (await columnExists(conn, 'profiles', column)) continue;
      await conn.query(`ALTER TABLE profiles ADD COLUMN ${column} ${type}`);
      report.columnsAdded.push(`profiles.${column}`);
    }

    const [counts] = await conn.query(
      `SELECT
         (SELECT COUNT(*)::int FROM profiles) AS profiles_total,
         (SELECT COUNT(*)::int FROM profiles WHERE college IS NOT NULL) AS with_college,
         (SELECT COUNT(*)::int FROM profiles WHERE university IS NOT NULL) AS with_university`
    );
    report.counts = counts[0];

    const [cols] = await conn.query(
      `SELECT COUNT(*)::int AS n FROM information_schema.columns
        WHERE table_schema = current_schema() AND table_name = 'profiles'
          AND column_name IN ('college','university')`
    );
    if (Number(cols[0].n) !== 2) {
      throw new Error('Migration verification failed: college/university columns are missing');
    }
  });

  return report;
}

const isMain = process.argv[1] && /migrateProfileEducation\.js$/.test(process.argv[1].replace(/\\/g, '/'));
if (isMain) {
  migrateProfileEducation()
    .then((result) => {
      if (result.skipped) {
        console.log(`[migrate:profile-education] skipped — ${result.reason}`);
        return;
      }
      console.log('[migrate:profile-education] applied. Report:');
      console.log(`  columns added: ${result.columnsAdded.length ? result.columnsAdded.join(', ') : '(none — already present)'}`);
      console.log(`  counts: ${JSON.stringify(result.counts)}`);
    })
    .catch((err) => {
      console.error('[migrate:profile-education] FAILED (rolled back, no change applied):', err.code || '', err.message);
      process.exit(1);
    })
    .finally(() => {
      setTimeout(() => process.exit(0), 50);
    });
}
