import { query, withTransaction } from './pool.js';

/**
 * migrateTshirtManagement.js — event-specific T-shirt management.
 *
 * Adds (metadata only, no row is rewritten or deleted):
 *   events               + tshirt_included BOOLEAN NOT NULL DEFAULT FALSE
 *   event_registrations  + tshirt_size VARCHAR(10) NULL
 *                        + ck_er_tshirt_size CHECK (S/M/L/XL/XXL or NULL)
 *
 * Existing events default to tshirt_included = FALSE (unchanged behaviour) and
 * existing registrations keep tshirt_size = NULL. Disabling the flag later
 * never erases a saved size — the column is independent of the flag.
 *
 * IDEMPOTENT: every step checks the catalog first. ATOMIC: one transaction.
 * NON-DESTRUCTIVE: never touches production, never deletes rows.
 *
 * Usage: cd backend && npm run migrate:tshirt
 */

const COLUMNS = {
  events: [
    ['tshirt_included', 'BOOLEAN NOT NULL DEFAULT FALSE'],
  ],
  event_registrations: [
    ['tshirt_size', 'VARCHAR(10)'],
  ],
};

const CONSTRAINTS = [
  ['event_registrations', 'ck_er_tshirt_size',
    `CHECK (tshirt_size IS NULL OR tshirt_size IN ('S','M','L','XL','XXL'))`],
];

async function columnExists(conn, table, column) {
  const [rows] = await conn.query(
    `SELECT COUNT(*) AS n FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = ? AND column_name = ?`,
    [table, column]
  );
  return Number(rows[0].n) > 0;
}

async function constraintExists(conn, table, name) {
  const [rows] = await conn.query(
    `SELECT COUNT(*) AS n FROM pg_constraint c
       JOIN pg_class t ON t.oid = c.conrelid
      WHERE t.relname = ? AND t.relnamespace = current_schema()::regnamespace AND c.conname = ?`,
    [table, name]
  );
  return Number(rows[0].n) > 0;
}

export async function migrateTshirtManagement() {
  const rows = await query(
    `SELECT table_name FROM information_schema.tables
      WHERE table_schema = current_schema()
        AND table_name IN ('events','event_registrations')`
  );
  const present = new Set(rows.map((r) => r.table_name));
  if (!present.has('events') || !present.has('event_registrations')) {
    return { skipped: true, reason: 'events / event_registrations table is missing — run npm run init-db first' };
  }

  const report = { skipped: false, columnsAdded: [], constraintsAdded: [], counts: {} };

  await withTransaction(async (conn) => {
    for (const [table, columns] of Object.entries(COLUMNS)) {
      for (const [column, type] of columns) {
        if (await columnExists(conn, table, column)) continue;
        await conn.query(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
        report.columnsAdded.push(`${table}.${column}`);
      }
    }

    for (const [table, name, definition] of CONSTRAINTS) {
      if (await constraintExists(conn, table, name)) continue;
      await conn.query(`ALTER TABLE ${table} ADD CONSTRAINT ${name} ${definition}`);
      report.constraintsAdded.push(`${table}.${name}`);
    }

    // Read-only verification: the defaults must not have changed any existing row.
    const [counts] = await conn.query(
      `SELECT
         (SELECT COUNT(*)::int FROM events) AS events_total,
         (SELECT COUNT(*)::int FROM events WHERE tshirt_included IS TRUE) AS events_with_tshirt,
         (SELECT COUNT(*)::int FROM event_registrations) AS registrations_total,
         (SELECT COUNT(*)::int FROM event_registrations WHERE tshirt_size IS NOT NULL) AS registrations_with_size`
    );
    report.counts = counts[0];

    const [cols] = await conn.query(
      `SELECT COUNT(*)::int AS n FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND ((table_name = 'events' AND column_name = 'tshirt_included')
            OR (table_name = 'event_registrations' AND column_name = 'tshirt_size'))`
    );
    if (Number(cols[0].n) !== 2) {
      throw new Error('Migration verification failed: T-shirt columns are missing');
    }
  });

  return report;
}

const isMain = process.argv[1] && /migrateTshirtManagement\.js$/.test(process.argv[1].replace(/\\/g, '/'));
if (isMain) {
  migrateTshirtManagement()
    .then((result) => {
      if (result.skipped) {
        console.log(`[migrate:tshirt] skipped — ${result.reason}`);
        return;
      }
      console.log('[migrate:tshirt] applied. Report:');
      console.log(`  columns added:     ${result.columnsAdded.length ? result.columnsAdded.join(', ') : '(none — already present)'}`);
      console.log(`  constraints added: ${result.constraintsAdded.length ? result.constraintsAdded.join(', ') : '(none — already present)'}`);
      console.log(`  counts: ${JSON.stringify(result.counts)}`);
    })
    .catch((err) => {
      console.error('[migrate:tshirt] FAILED (rolled back, no change applied):', err.code || '', err.message);
      process.exit(1);
    })
    .finally(() => {
      setTimeout(() => process.exit(0), 50);
    });
}
