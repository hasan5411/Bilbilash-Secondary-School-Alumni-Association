/**
 * Attribution-retention migration for member_monthly_rates.set_by.
 * Usage: cd backend && npm run migrate:set-by
 * SQL twin (with rollback plan): database/migrations/2026-10-12_member_monthly_rates_set_by_set_null.sql
 *
 * WHAT IT DOES (all steps guarded, idempotent, NON-DESTRUCTIVE):
 *  1. Adds member_monthly_rates.set_by_snapshot VARCHAR(160) NULL — the setter's
 *     identity text, written by deleteUser() before an account is removed.
 *  2. Makes member_monthly_rates.set_by nullable (NULL = setter account deleted).
 *  3. Ensures the idx_mmr_setby index exists (InnoDB FK requirement).
 *  4. Recreates fk_mmr_setby as ON DELETE SET NULL (was ON DELETE RESTRICT),
 *     so deleting an account releases the pointer while the rate row — its
 *     amount, effective month and OWNER (user_id) — survives untouched.
 *
 * NO row is updated or deleted. FOREIGN_KEY_CHECKS is never disabled.
 * Counts of member_monthly_rates and payments are printed before and after,
 * so recoverability/consistency can be verified at a glance. Safe to re-run.
 */
import 'dotenv/config';
import mysql from 'mysql2/promise';

async function columnExists(conn, table, column) {
  const [rows] = await conn.query(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1`,
    [table, column]
  );
  return rows.length > 0;
}

async function indexExists(conn, table, indexName) {
  const [rows] = await conn.query(
    `SELECT INDEX_NAME FROM INFORMATION_SCHEMA.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ? LIMIT 1`,
    [table, indexName]
  );
  return rows.length > 0;
}

export async function migrateSetByRetention({ quiet = false } = {}) {
  const log = (...a) => { if (!quiet) console.log(...a); };
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD ?? '',
    database: process.env.DB_NAME,
    multipleStatements: false,
  });

  try {
    const [[{ cnt: ratesBefore }]] = await conn.query('SELECT COUNT(*) AS cnt FROM member_monthly_rates');
    const [[{ cnt: paymentsBefore }]] = await conn.query('SELECT COUNT(*) AS cnt FROM payments');
    log(`[migrate:set-by] before: member_monthly_rates=${ratesBefore} rows, payments=${paymentsBefore} rows`);

    // Table missing entirely (fresh DB) — schema.sql/init-db creates it in the
    // new shape, nothing to do here.
    const [[tableRow]] = await conn.query(
      `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'member_monthly_rates' LIMIT 1`
    );
    if (!tableRow) {
      log('[migrate:set-by] member_monthly_rates does not exist yet — nothing to migrate.');
      return { migrated: false, rates: ratesBefore, payments: paymentsBefore };
    }

    // 1) snapshot column
    if (!(await columnExists(conn, 'member_monthly_rates', 'set_by_snapshot'))) {
      await conn.query('ALTER TABLE member_monthly_rates ADD COLUMN set_by_snapshot VARCHAR(160) NULL AFTER set_by');
      log('[migrate:set-by] added member_monthly_rates.set_by_snapshot.');
    }

    // 2) set_by nullable
    const [[col]] = await conn.query(
      `SELECT IS_NULLABLE FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'member_monthly_rates' AND COLUMN_NAME = 'set_by' LIMIT 1`
    );
    if (col && col.IS_NULLABLE === 'NO') {
      await conn.query('ALTER TABLE member_monthly_rates MODIFY set_by BIGINT UNSIGNED NULL');
      log('[migrate:set-by] member_monthly_rates.set_by is now NULLable.');
    }

    // 3) FK index
    if (!(await indexExists(conn, 'member_monthly_rates', 'idx_mmr_setby'))) {
      await conn.query('ALTER TABLE member_monthly_rates ADD KEY idx_mmr_setby (set_by)');
      log('[migrate:set-by] added KEY idx_mmr_setby.');
    }

    // 4) recreate the FK as ON DELETE SET NULL
    const [[fk]] = await conn.query(
      `SELECT DELETE_RULE FROM information_schema.REFERENTIAL_CONSTRAINTS
        WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'member_monthly_rates'
          AND CONSTRAINT_NAME = 'fk_mmr_setby' LIMIT 1`
    );
    if (!fk || fk.DELETE_RULE !== 'SET NULL') {
      await conn.query('ALTER TABLE member_monthly_rates DROP FOREIGN KEY fk_mmr_setby');
      await conn.query(
        `ALTER TABLE member_monthly_rates
           ADD CONSTRAINT fk_mmr_setby FOREIGN KEY (set_by) REFERENCES users(user_id)
           ON DELETE SET NULL ON UPDATE CASCADE`
      );
      log(`[migrate:set-by] fk_mmr_setby recreated: ${fk ? fk.DELETE_RULE : 'missing'} -> SET NULL.`);
    } else {
      log('[migrate:set-by] fk_mmr_setby already ON DELETE SET NULL.');
    }

    const [[{ cnt: ratesAfter }]] = await conn.query('SELECT COUNT(*) AS cnt FROM member_monthly_rates');
    const [[{ cnt: paymentsAfter }]] = await conn.query('SELECT COUNT(*) AS cnt FROM payments');
    const [[{ cnt: nullSet }]] = await conn.query('SELECT COUNT(*) AS cnt FROM member_monthly_rates WHERE set_by IS NULL');
    log(`[migrate:set-by] after:  member_monthly_rates=${ratesAfter} rows, payments=${paymentsAfter} rows`);
    log(`[migrate:set-by] rows with released setter (set_by IS NULL): ${nullSet}`);
    if (ratesAfter !== ratesBefore || paymentsAfter !== paymentsBefore) {
      throw new Error(`Row counts changed (${ratesBefore}->${ratesAfter}, ${paymentsBefore}->${paymentsAfter}) — this migration must never modify data.`);
    }
    log('[migrate:set-by] done. Data untouched (0 rows added/updated/deleted).');
    return { migrated: true, rates: ratesAfter, payments: paymentsAfter, null_set_by: nullSet };
  } finally {
    await conn.end().catch(() => {});
  }
}

// Run directly: node src/db/migrateSetByRetention.js
if (process.argv[1] && process.argv[1].endsWith('migrateSetByRetention.js')) {
  migrateSetByRetention()
    .then(() => process.exit(0))
    .catch((err) => { console.error('[migrate:set-by] FAILED:', err.message); process.exit(1); });
}
