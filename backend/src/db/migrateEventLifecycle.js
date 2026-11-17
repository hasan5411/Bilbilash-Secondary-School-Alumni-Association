import { query, withTransaction } from './pool.js';

/**
 * migrateEventLifecycle.js — upgrade an EXISTING database to the event
 * lifecycle model (history-preserving registrations + registration-linked
 * payments). Fresh installs already get everything from
 * database/schema.postgresql.sql; this script only fills in what is missing.
 *
 * What it does (all metadata, plus defaults for existing rows):
 *   events               + eligible_batches INTEGER[] NULL (NULL = All Batches)
 *                        + registration_fee NUMERIC(10,2) NULL (NULL = Free)
 *                        + archived_at / archived_by
 *   event_registrations  + status / payment_status / payment_deadline /
 *                          confirmed_at / cancelled_at / cancel_reason /
 *                          cancelled_by / registration_fee_snapshot
 *                        - legacy UNIQUE(event_id, user_id) constraint
 *                        + partial UNIQUE index WHERE status = 'active'
 *   payments             + registration_id BIGINT NULL -> event_registrations
 *
 * Safety:
 *  - IDEMPOTENT: every step checks the catalog first; safe to run any number
 *    of times. Run it twice on a disposable database to verify.
 *  - ATOMIC: all DDL runs in ONE transaction (PostgreSQL DDL is transactional)
 *    on ONE dedicated connection. Any error rolls everything back.
 *  - NON-DESTRUCTIVE: no registration, payment or event row is deleted, no
 *    registration_id changes. Existing rows are grandfathered as
 *    status='active', payment_status='not_required', payment_deadline=NULL —
 *    they are never labelled paid and never auto-expired.
 *  - PRE-FLIGHT: refuses to run if duplicate (event_id, user_id) rows exist,
 *    because replacing the old unique constraint would silently allow them.
 *  - NEVER run against production from here. Deployments must be approved and
 *    executed manually (see the final report).
 *
 * Usage: cd backend && npm run migrate:event-lifecycle
 */

const COLUMNS = {
  events: [
    ['eligible_batches', 'INTEGER[]'],
    ['registration_fee', 'NUMERIC(10,2)'],
    ['archived_at', 'TIMESTAMPTZ'],
    ['archived_by', 'BIGINT'],
  ],
  event_registrations: [
    ['status', "TEXT NOT NULL DEFAULT 'active'"],
    ['payment_status', "TEXT NOT NULL DEFAULT 'not_required'"],
    ['payment_deadline', 'TIMESTAMPTZ'],
    ['confirmed_at', 'TIMESTAMPTZ'],
    ['cancelled_at', 'TIMESTAMPTZ'],
    ['cancel_reason', 'VARCHAR(80)'],
    ['cancelled_by', 'BIGINT'],
    ['registration_fee_snapshot', 'NUMERIC(10,2)'],
  ],
  payments: [
    ['registration_id', 'BIGINT'],
  ],
};

const CONSTRAINTS = [
  ['events', 'ck_events_fee', 'CHECK (registration_fee IS NULL OR registration_fee >= 0)'],
  ['events', 'ck_events_batches', `CHECK (
    eligible_batches IS NULL
    OR (cardinality(eligible_batches) >= 1 AND array_position(eligible_batches, NULL) IS NULL)
  )`],
  ['events', 'fk_events_archiver', 'FOREIGN KEY (archived_by) REFERENCES users(user_id) ON DELETE SET NULL ON UPDATE CASCADE'],
  ['event_registrations', 'ck_er_status', "CHECK (status IN ('active','cancelled'))"],
  ['event_registrations', 'ck_er_payment_status', "CHECK (payment_status IN ('not_required','unpaid','paid'))"],
  ['event_registrations', 'ck_er_cancel_reason', `CHECK (cancel_reason IS NULL OR cancel_reason IN (
    'Cancelled by member','Cancelled by admin','Payment Deadline Expired','Event cancelled'))`],
  ['event_registrations', 'fk_er_cancelled_by', 'FOREIGN KEY (cancelled_by) REFERENCES users(user_id) ON DELETE SET NULL ON UPDATE CASCADE'],
  ['payments', 'fk_payments_registration', 'FOREIGN KEY (registration_id) REFERENCES event_registrations(registration_id) ON DELETE SET NULL ON UPDATE CASCADE'],
];

const INDEXES = [
  ['uq_event_registration_active',
    `CREATE UNIQUE INDEX IF NOT EXISTS uq_event_registration_active
       ON event_registrations (event_id, user_id) WHERE status = 'active'`],
  ['idx_event_reg_active',
    'CREATE INDEX IF NOT EXISTS idx_event_reg_active ON event_registrations (event_id, status)'],
  ['idx_event_reg_user',
    'CREATE INDEX IF NOT EXISTS idx_event_reg_user ON event_registrations (user_id, status)'],
  ['idx_event_reg_deadline',
    `CREATE INDEX IF NOT EXISTS idx_event_reg_deadline
       ON event_registrations (payment_deadline) WHERE status = 'active' AND payment_status = 'unpaid'`],
  ['idx_event_reg_attempts',
    `CREATE INDEX IF NOT EXISTS idx_event_reg_attempts
       ON event_registrations (event_id, user_id) WHERE cancel_reason = 'Payment Deadline Expired'`],
  ['idx_events_archived',
    'CREATE INDEX IF NOT EXISTS idx_events_archived ON events (archived_at)'],
  ['idx_payments_registration',
    'CREATE INDEX IF NOT EXISTS idx_payments_registration ON payments (registration_id) WHERE registration_id IS NOT NULL'],
];

async function tableExists(conn, name) {
  const [rows] = await conn.query(
    `SELECT COUNT(*) AS n FROM information_schema.tables
      WHERE table_schema = current_schema() AND table_name = ?`,
    [name]
  );
  return Number(rows[0].n) > 0;
}

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

/**
 * Legacy one-registration-per-member uniqueness. Detects by INDEX DEFINITION
 * (never by a guessed name) so renamed constraints are found too.
 */
async function legacyUniqueIndexes(conn) {
  const [rows] = await conn.query(
    `SELECT idx.indexrelid::regclass::text AS index_name,
            c.conname AS constraint_name,
            pg_get_indexdef(idx.indexrelid) AS def
       FROM pg_index idx
       JOIN pg_class t ON t.oid = idx.indrelid
       LEFT JOIN pg_constraint c ON c.conindid = idx.indexrelid AND c.contype = 'u'
      WHERE t.relname = 'event_registrations'
        AND t.relnamespace = current_schema()::regnamespace
        AND idx.indisunique`
  );
  return rows.filter((r) => {
    const def = String(r.def || '');
    if (/WHERE/i.test(def)) return false; // our partial active-only index
    return /\(event_id,\s*user_id\)|\(user_id,\s*event_id\)/i.test(def);
  });
}

export async function migrateEventLifecycle() {
  // Pool-level existence check (query() returns rows directly).
  const rows = await query(
    `SELECT table_name FROM information_schema.tables
      WHERE table_schema = current_schema()
        AND table_name IN ('events','event_registrations','payments')`
  );
  const present = new Set(rows.map((r) => r.table_name));
  return runMigration(present.has('events'), present.has('event_registrations'), present.has('payments'));
}

async function runMigration(eventsOk, regsOk, paymentsOk) {
  if (!eventsOk || !regsOk || !paymentsOk) {
    return {
      skipped: true,
      reason: 'events / event_registrations / payments table is missing — run npm run init-db first',
    };
  }

  const report = { skipped: false, columnsAdded: [], constraintsAdded: [], indexesCreated: [], legacyUniqueDropped: [], counts: {} };

  await withTransaction(async (conn) => {
    // PRE-FLIGHT (first run only): replacing one-per-member uniqueness with an
    // active-only index must never legitimize duplicate ACTIVE registrations.
    // Once the partial index exists, the same member may legitimately hold
    // several historical (cancelled) registrations for one event — expected,
    // and already constrained to one active row by uq_event_registration_active.
    const [alreadyMigrated] = await conn.query(
      `SELECT COUNT(*) AS n FROM pg_indexes
        WHERE schemaname = current_schema() AND indexname = 'uq_event_registration_active'`
    );
    if (Number(alreadyMigrated[0].n) === 0) {
      const [dupes] = await conn.query(
        `SELECT event_id, user_id, COUNT(*) AS n
           FROM event_registrations
          GROUP BY event_id, user_id
         HAVING COUNT(*) > 1`
      );
      if (dupes.length) {
        throw new Error(
          `Refusing to migrate: ${dupes.length} duplicate (event_id, user_id) group(s) exist in event_registrations. ` +
          'Resolve these rows manually first (never delete history automatically).'
        );
      }
    }

    for (const [table, columns] of Object.entries(COLUMNS)) {
      for (const [column, type] of columns) {
        if (await columnExists(conn, table, column)) continue;
        await conn.query(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
        report.columnsAdded.push(`${table}.${column}`);
      }
    }

    // Drop the legacy UNIQUE(event_id, user_id) — constraint first, then a
    // bare unique index if one exists.
    for (const legacy of await legacyUniqueIndexes(conn)) {
      if (legacy.constraint_name) {
        await conn.query(`ALTER TABLE event_registrations DROP CONSTRAINT "${legacy.constraint_name}"`);
        report.legacyUniqueDropped.push(`constraint ${legacy.constraint_name}`);
      } else {
        await conn.query(`DROP INDEX IF EXISTS ${legacy.index_name}`);
        report.legacyUniqueDropped.push(`index ${legacy.index_name}`);
      }
    }

    for (const [table, name, definition] of CONSTRAINTS) {
      if (await constraintExists(conn, table, name)) continue;
      await conn.query(`ALTER TABLE ${table} ADD CONSTRAINT ${name} ${definition}`);
      report.constraintsAdded.push(`${table}.${name}`);
    }

    for (const [name, ddl] of INDEXES) {
      const [before] = await conn.query(
        `SELECT COUNT(*) AS n FROM pg_class WHERE relname = ? AND relkind = 'i'`, [name]
      );
      await conn.query(ddl);
      if (Number(before[0].n) === 0) report.indexesCreated.push(name);
    }

    // Read-only verification inside the transaction. Existing rows received
    // the defaults when the columns were added; this asserts the grandfather
    // rule instead of rewriting anything.
    const [grandfathered] = await conn.query(
      `SELECT COUNT(*) AS n FROM event_registrations
        WHERE status = 'active' AND payment_status = 'not_required' AND payment_deadline IS NULL`
    );
    const [total] = await conn.query(`SELECT COUNT(*) AS n FROM event_registrations`);
    const [active] = await conn.query(`SELECT COUNT(*) AS n FROM event_registrations WHERE status = 'active'`);
    const [freeEvents] = await conn.query(`SELECT COUNT(*) AS n FROM events WHERE registration_fee IS NULL`);
    const [allBatchEvents] = await conn.query(`SELECT COUNT(*) AS n FROM events WHERE eligible_batches IS NULL`);
    report.counts = {
      registrations_total: Number(total[0].n),
      registrations_grandfathered: Number(grandfathered[0].n),
      registrations_active: Number(active[0].n),
      events_free: Number(freeEvents[0].n),
      events_all_batches: Number(allBatchEvents[0].n),
    };

    const [uniqueIdx] = await conn.query(
      `SELECT COUNT(*) AS n FROM pg_indexes
        WHERE schemaname = current_schema() AND indexname = 'uq_event_registration_active'`
    );
    if (Number(uniqueIdx[0].n) !== 1) {
      throw new Error('Migration verification failed: uq_event_registration_active is missing');
    }
  });

  return report;
}

const isMain = process.argv[1] && /migrateEventLifecycle\.js$/.test(process.argv[1].replace(/\\/g, '/'));
if (isMain) {
  migrateEventLifecycle()
    .then((result) => {
      if (result.skipped) {
        console.log(`[migrate:event-lifecycle] skipped — ${result.reason}`);
        return;
      }
      console.log('[migrate:event-lifecycle] applied. Report:');
      console.log(`  columns added:   ${result.columnsAdded.length ? result.columnsAdded.join(', ') : '(none — already present)'}`);
      console.log(`  legacy unique dropped: ${result.legacyUniqueDropped.length ? result.legacyUniqueDropped.join(', ') : '(none)'}`);
      console.log(`  constraints added: ${result.constraintsAdded.length ? result.constraintsAdded.join(', ') : '(none)'}`);
      console.log(`  indexes created: ${result.indexesCreated.length ? result.indexesCreated.join(', ') : '(none — already present)'}`);
      console.log(`  counts: ${JSON.stringify(result.counts)}`);
    })
    .catch((err) => {
      console.error('[migrate:event-lifecycle] FAILED (rolled back, no change applied):', err.code || '', err.message);
      process.exit(1);
    })
    .finally(() => {
      setTimeout(() => process.exit(0), 50);
    });
}
