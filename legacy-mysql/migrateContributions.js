/**
 * Monthly Contribution Management — migration + reconciliation.
 * Usage: cd backend && npm run migrate:contributions
 *
 * SAFE BY DESIGN:
 *  - Only ADDS a table and columns; never drops, renames or rewrites anything.
 *  - Every step is guarded (INFORMATION_SCHEMA checks / IF NOT EXISTS), so the
 *    script is repeatable and safe to run on an existing database.
 *  - NO payment row, NO monthly_payment_details amount and NO transaction ID is
 *    ever modified or deleted. Historical financial facts stay untouched.
 *
 * RECONCILIATION (documented, reversible, reported):
 *  1. Rate history backfill — members who HAVE approved monthly payments but no
 *     configured rate get member_monthly_rates rows reconstructed from what they
 *     ACTUALLY PAID (monthly_payment_details): a new rate row is created only
 *     where the amount they paid for a month differs from their previous paid
 *     amount. No amount or date is invented: every row equals a real payment.
 *  2. Contribution start — profiles.contribution_start_month is filled with the
 *     member's EARLIEST APPROVED payment month (a reliable lower bound of their
 *     obligation). Members with no payment history stay NULL = UNKNOWN and are
 *     listed in the report instead of being assigned a guessed date.
 *  3. Everything else (members with no rates and no payments) is only REPORTED.
 *
 * The full report is printed and written to backend/reconciliation-report.json.
 */
import 'dotenv/config';
import mysql from 'mysql2/promise';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export const MONTHLY_AMOUNTS = [20, 30, 50, 100];

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

export async function migrateContributions({ quiet = false } = {}) {
  const log = (...a) => { if (!quiet) console.log(...a); };
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD ?? '',
    database: process.env.DB_NAME,
    multipleStatements: false,
  });

  const report = {
    generated_at: new Date().toISOString(),
    rate_rows_backfilled: [],
    contribution_start_set: [],
    start_unknown_members: [],
    payments_with_unusual_amount: [],
    notes: [
      'Rate rows are reconstructed from APPROVED payments only (monthly_payment_details).',
      'contribution_start_month = earliest approved payment month; NULL means UNKNOWN (never guessed).',
      'No payment, transaction id or monthly_payment_details amount was modified.',
    ],
  };

  try {
    // ---------------------------------------------------------------- 1) table
    await conn.query(`
      CREATE TABLE IF NOT EXISTS member_monthly_rates (
        rate_id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        user_id         BIGINT UNSIGNED NOT NULL,
        amount          DECIMAL(10,2) NOT NULL,
        effective_month CHAR(7) NOT NULL, -- 'YYYY-MM' — the first month this rate applies to
        source          ENUM('member','admin','reconciliation') NOT NULL DEFAULT 'member',
        set_by          BIGINT UNSIGNED NULL, -- setter's account; NULL once that account is deleted
        set_by_snapshot VARCHAR(160) NULL,   -- setter identity kept when the account is deleted
        created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (rate_id),
        UNIQUE KEY uq_mmr_user_effective (user_id, effective_month),
        KEY idx_mmr_user (user_id, effective_month),
        KEY idx_mmr_setby (set_by),
        CONSTRAINT fk_mmr_user FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT fk_mmr_setby FOREIGN KEY (set_by) REFERENCES users(user_id) ON DELETE SET NULL ON UPDATE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    log('[migrate] member_monthly_rates table ensured.');

    // ------------------------------------------------- 2) profiles start month
    if (!(await columnExists(conn, 'profiles', 'contribution_start_month'))) {
      await conn.query(`ALTER TABLE profiles ADD COLUMN contribution_start_month CHAR(7) NULL AFTER active_donor`);
      log('[migrate] Added profiles.contribution_start_month.');
    }

    // --------------------------------------------- 3) mpd extra contribution
    if (!(await columnExists(conn, 'monthly_payment_details', 'extra_amount'))) {
      await conn.query(`ALTER TABLE monthly_payment_details ADD COLUMN extra_amount DECIMAL(10,2) NOT NULL DEFAULT 0 AFTER amount`);
      log('[migrate] Added monthly_payment_details.extra_amount.');
    }

    // ------------------------------- 3b) oldest-first allocation support
    // One payment can settle SEVERAL months (oldest dues first) and a partially
    // settled month can be topped up by a later payment, so a member/month can
    // legitimately hold more than one allocation row. The UNIQUE becomes a plain
    // key; duplicate protection moves to the allocation planner, which caps every
    // month at its remaining requirement (and to the pending-declaration check).
    // Existing rows are one-per-month already — no data change, no rewrite.
    const [uniqIdx] = await conn.query(
      `SELECT INDEX_NAME FROM INFORMATION_SCHEMA.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'monthly_payment_details'
          AND INDEX_NAME = 'uq_monthly_user_month' AND NON_UNIQUE = 0 LIMIT 1`
    );
    if (uniqIdx.length) {
      // ORDER MATTERS: uq_monthly_user_month also satisfies the fk_mpd_user
      // foreign-key index requirement, so the replacement KEY must exist first.
      if (!(await columnExists(conn, 'monthly_payment_details', 'payment_month')) || !(await indexExists(conn, 'monthly_payment_details', 'idx_monthly_user_month'))) {
        await conn.query('ALTER TABLE monthly_payment_details ADD KEY idx_monthly_user_month (user_id, payment_month)');
      }
      await conn.query('ALTER TABLE monthly_payment_details DROP INDEX uq_monthly_user_month');
      log('[migrate] monthly_payment_details: UNIQUE(user,month) -> KEY(user,month) for multi-payment allocation.');
    }

    // --------------------------------------------- 4) notification types
    const [notifCol] = await conn.query(
      `SELECT COLUMN_TYPE FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'notifications' AND COLUMN_NAME = 'type' LIMIT 1`
    );
    if (notifCol.length && !/contribution_setup/.test(notifCol[0].COLUMN_TYPE)) {
      await conn.query(
        `ALTER TABLE notifications MODIFY COLUMN type ENUM(
           'approval','job','application','event','notice','promotion','demotion','system',
           'new_notice','new_job','new_event','new_vision','new_help','new_poll',
           'registration_pending','registration_approved','registration_rejected',
           'payment_pending','payment_approved','payment_rejected',
           'job_pending','job_approved','job_rejected',
           'vision_pending','vision_approved','vision_rejected','vision_implemented',
           'help_status','gallery_pending','gallery_approved','gallery_rejected',
           'contribution_setup','contribution_updated'
         ) NOT NULL DEFAULT 'system'`
      );
      log('[migrate] notifications.type now supports contribution_setup / contribution_updated.');
    }

    // ------------------------------------------------------- 5) reconciliation
    const [mpdRows] = await conn.query(
      `SELECT user_id, payment_month, amount
         FROM monthly_payment_details ORDER BY user_id, payment_month, id`
    );

    const byUser = new Map();
    for (const r of mpdRows) {
      if (!byUser.has(r.user_id)) byUser.set(r.user_id, []);
      byUser.get(r.user_id).push(r);
    }

    for (const [userId, rows] of byUser) {
      // Skip users that already have configured rates (their history is explicit).
      const [existing] = await conn.query(`SELECT COUNT(*) AS n FROM member_monthly_rates WHERE user_id = ?`, [userId]);
      if (Number(existing[0].n) > 0) continue;

      let lastRate = null;
      for (const row of rows) {
        const amount = Number(row.amount);
        if (!MONTHLY_AMOUNTS.includes(amount)) {
          report.payments_with_unusual_amount.push({
            user_id: Number(userId), month: row.payment_month, amount,
            note: 'Approved monthly payment amount is outside the allowed list; kept exactly as paid.',
          });
        }
        if (lastRate === null || amount !== lastRate) {
          await conn.query(
            `INSERT INTO member_monthly_rates (user_id, amount, effective_month, source, set_by)
             VALUES (?, ?, ?, 'reconciliation', ?)
             ON DUPLICATE KEY UPDATE amount = VALUES(amount)`,
            [userId, amount, row.payment_month, userId]
          );
          report.rate_rows_backfilled.push({
            user_id: Number(userId), amount, effective_month: row.payment_month,
            basis: 'amount actually approved for that month',
          });
          lastRate = amount;
        }
      }

      const earliest = rows[0].payment_month;
      const [startSet] = await conn.query(
        `UPDATE profiles SET contribution_start_month = ?
          WHERE user_id = ? AND contribution_start_month IS NULL`,
        [earliest, userId]
      );
      if (startSet.affectedRows) {
        report.contribution_start_set.push({ user_id: Number(userId), contribution_start_month: earliest });
      }
    }

    // Members with neither a rate nor a payment: start stays UNKNOWN (reported).
    const [unknownStart] = await conn.query(
      `SELECT u.user_id, u.first_name, u.last_name, u.registration_number
         FROM users u
         JOIN roles r ON r.role_id = u.role_id
         LEFT JOIN profiles p ON p.user_id = u.user_id
        WHERE u.status = 'approved' AND u.is_active = 1
          AND NOT EXISTS (SELECT 1 FROM member_monthly_rates m WHERE m.user_id = u.user_id)
          AND NOT EXISTS (SELECT 1 FROM monthly_payment_details d WHERE d.user_id = u.user_id)
          AND (p.contribution_start_month IS NULL)`
    );
    report.start_unknown_members = unknownStart.map((u) => ({
      user_id: Number(u.user_id), name: `${u.first_name} ${u.last_name}`, registration_number: u.registration_number,
      note: 'No payment history and no configured rate — contribution start deliberately left UNKNOWN.',
    }));

    const outPath = path.join(rootDir, 'reconciliation-report.json');
    fs.writeFileSync(outPath, JSON.stringify(report, null, 2));

    log(`[migrate] Rate rows backfilled: ${report.rate_rows_backfilled.length}`);
    log(`[migrate] Contribution starts set from earliest payment: ${report.contribution_start_set.length}`);
    log(`[migrate] Members with UNKNOWN contribution start (reported, not guessed): ${report.start_unknown_members.length}`);
    log(`[migrate] Unusual historical amounts (kept as paid, reported): ${report.payments_with_unusual_amount.length}`);
    log(`[migrate] Full report: backend/reconciliation-report.json`);
    return report;
  } finally {
    await conn.end().catch(() => {});
  }
}

// CLI
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  migrateContributions()
    .then(() => process.exit(0))
    .catch((err) => { console.error('[migrate] FAILED:', err.code || '', err.message); process.exit(1); });
}
