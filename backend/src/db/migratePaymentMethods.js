import { query, withTransaction } from './pool.js';

/**
 * migratePaymentMethods.js — extend the payments.payment_method constraint with
 * the 'bank' manual method (existing databases only).
 *
 * WHY: payments.payment_method is guarded by ck_payments_method. Fresh installs
 * get the full list from database/schema.postgresql.sql; a database created
 * before the bank-transfer method existed keeps the old CHECK and would reject
 * every 'bank' row. This migration recreates ONLY that constraint.
 *
 * Safety:
 *  - METADATA ONLY: no row is inserted, updated or deleted, and no column,
 *    index or table is dropped.
 *  - ATOMIC: the DROP and the ADD run inside ONE transaction on ONE dedicated
 *    connection (withTransaction: BEGIN → statements → COMMIT). Any error
 *    issues ROLLBACK, so the table is never left without the constraint.
 *    PostgreSQL DDL is transactional, so a failed attempt leaves the old
 *    constraint exactly as it was.
 *  - NON-DESTRUCTIVE: the allowed set is a strict superset of the previous one
 *    ('test','bkash','nagad','rocket' → + 'bank'), so every existing row still
 *    passes validation and keeps its value. All other constraints on payments
 *    (uq_payments_txn, ck_payments_type, ck_payments_purpose,
 *    ck_payments_status, the three foreign keys) are untouched.
 *  - Idempotent: safe to run any number of times; the allowed set is derived
 *    from the current schema file value below.
 *
 * Usage: cd backend && npm run migrate:payment-methods
 */
export const PAYMENT_METHODS = ['test', 'bkash', 'nagad', 'rocket', 'bank'];
const LIST_SQL = PAYMENT_METHODS.map((m) => `'${m}'`).join(',');

export async function migratePaymentMethods() {
  const [table] = await query(
    `SELECT COUNT(*) AS n FROM information_schema.tables
      WHERE table_schema = current_schema() AND table_name = 'payments'`
  );
  if (Number(table.n) === 0) {
    return { skipped: true, reason: 'payments table does not exist — run npm run init-db first' };
  }

  // One dedicated connection, one transaction: both ALTERs commit together or
  // not at all. withTransaction sends BEGIN, COMMITs on success and ROLLBACKs
  // if either statement throws (e.g. lock timeout, lost connection).
  await withTransaction(async (conn) => {
    await conn.query('ALTER TABLE payments DROP CONSTRAINT IF EXISTS ck_payments_method');
    await conn.query(
      `ALTER TABLE payments ADD CONSTRAINT ck_payments_method CHECK (payment_method IN (${LIST_SQL}))`
    );
  });

  // Read-only confirmation, after the commit.
  const rows = await query(
    `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = 'ck_payments_method'`
  );
  return { skipped: false, constraint: rows[0]?.def || null, methods: PAYMENT_METHODS };
}

const isMain = process.argv[1] && /migratePaymentMethods\.js$/.test(process.argv[1].replace(/\\/g, '/'));
if (isMain) {
  migratePaymentMethods()
    .then((result) => {
      if (result.skipped) {
        console.log(`[migrate:payment-methods] skipped — ${result.reason}`);
        return;
      }
      console.log(`[migrate:payment-methods] constraint is now: ${result.constraint}`);
      console.log(`[migrate:payment-methods] allowed methods: ${result.methods.join(', ')}`);
    })
    .catch((err) => {
      console.error('[migrate:payment-methods] FAILED (rolled back, no change applied):', err.code || '', err.message);
      process.exit(1);
    })
    .finally(() => {
      // pool.js keeps sockets open; exit explicitly so the script terminates.
      setTimeout(() => process.exit(0), 50);
    });
}
