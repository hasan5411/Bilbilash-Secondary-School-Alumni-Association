-- 2026-11-18_event_lifecycle_and_tshirt.sql
--
-- Additive, idempotent PostgreSQL migration for hosted Supabase.
-- Mirrors backend/src/db/migrateEventLifecycle.js and
-- backend/src/db/migrateTshirtManagement.js so it can be pasted directly into
-- the Supabase SQL Editor (no connection string needed).
--
-- SAFETY:
--   * never deletes or rewrites registration / payment / event rows
--   * existing rows are grandfathered: status='active',
--     payment_status='not_required', payment_deadline=NULL (never marked paid)
--   * refuses to run when duplicate (event_id, user_id) rows exist
--   * safe to run repeatedly: every step checks the catalog first
--   * one transaction: any error rolls the whole script back

BEGIN;

-- 0) Required tables must exist.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                  WHERE table_schema = current_schema() AND table_name = 'events')
     OR NOT EXISTS (SELECT 1 FROM information_schema.tables
                  WHERE table_schema = current_schema() AND table_name = 'event_registrations')
     OR NOT EXISTS (SELECT 1 FROM information_schema.tables
                  WHERE table_schema = current_schema() AND table_name = 'payments') THEN
    RAISE EXCEPTION 'events / event_registrations / payments table is missing';
  END IF;
END $$;

-- 1) Pre-flight (first run only): replacing one-per-member uniqueness with an
--    active-only index must never legitimise duplicate ACTIVE registrations.
--    Once the partial index exists, historical (cancelled) duplicates are
--    expected and already constrained to one active row per member/event.
DO $$
DECLARE dupes integer; already_migrated boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname = current_schema() AND indexname = 'uq_event_registration_active'
  ) INTO already_migrated;
  IF already_migrated THEN
    RETURN;
  END IF;

  SELECT COUNT(*) INTO dupes FROM (
    SELECT event_id, user_id
      FROM event_registrations
     GROUP BY event_id, user_id
    HAVING COUNT(*) > 1
  ) d;
  IF dupes > 0 THEN
    RAISE EXCEPTION 'Refusing to migrate: % duplicate (event_id, user_id) group(s) exist in event_registrations. Resolve these rows manually first (never delete history automatically).', dupes;
  END IF;
END $$;

-- 2) Columns (metadata only; existing rows get the safe defaults).
ALTER TABLE events ADD COLUMN IF NOT EXISTS eligible_batches INTEGER[];
ALTER TABLE events ADD COLUMN IF NOT EXISTS registration_fee NUMERIC(10,2);
ALTER TABLE events ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;
ALTER TABLE events ADD COLUMN IF NOT EXISTS archived_by BIGINT;
ALTER TABLE events ADD COLUMN IF NOT EXISTS tshirt_included BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE event_registrations ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';
ALTER TABLE event_registrations ADD COLUMN IF NOT EXISTS payment_status TEXT NOT NULL DEFAULT 'not_required';
ALTER TABLE event_registrations ADD COLUMN IF NOT EXISTS payment_deadline TIMESTAMPTZ;
ALTER TABLE event_registrations ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMPTZ;
ALTER TABLE event_registrations ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ;
ALTER TABLE event_registrations ADD COLUMN IF NOT EXISTS cancel_reason VARCHAR(80);
ALTER TABLE event_registrations ADD COLUMN IF NOT EXISTS cancelled_by BIGINT;
ALTER TABLE event_registrations ADD COLUMN IF NOT EXISTS registration_fee_snapshot NUMERIC(10,2);
ALTER TABLE event_registrations ADD COLUMN IF NOT EXISTS tshirt_size VARCHAR(10);

ALTER TABLE payments ADD COLUMN IF NOT EXISTS registration_id BIGINT;

-- 3) Drop the legacy UNIQUE(event_id, user_id), whether it is a table
--    constraint or a bare unique index. Detection is by index definition,
--    never by a guessed name; the new partial index is skipped.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT idx.indexrelid::regclass::text AS index_name,
           c.conname AS constraint_name,
           pg_get_indexdef(idx.indexrelid) AS def
      FROM pg_index idx
      JOIN pg_class t ON t.oid = idx.indrelid
      LEFT JOIN pg_constraint c ON c.conindid = idx.indexrelid AND c.contype = 'u'
     WHERE t.relname = 'event_registrations'
       AND t.relnamespace = current_schema()::regnamespace
       AND idx.indisunique
  LOOP
    CONTINUE WHEN r.def ILIKE '%WHERE%';
    CONTINUE WHEN r.def !~ '\(event_id,\s*user_id\)|\(user_id,\s*event_id\)';
    IF r.constraint_name IS NOT NULL THEN
      EXECUTE format('ALTER TABLE event_registrations DROP CONSTRAINT %I', r.constraint_name);
    ELSE
      EXECUTE format('DROP INDEX IF EXISTS %s', r.index_name);
    END IF;
  END LOOP;
END $$;

-- 4) Constraints (added only when absent).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid
                  WHERE t.relname = 'events' AND t.relnamespace = current_schema()::regnamespace
                    AND c.conname = 'ck_events_fee') THEN
    ALTER TABLE events ADD CONSTRAINT ck_events_fee
      CHECK (registration_fee IS NULL OR registration_fee >= 0);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid
                  WHERE t.relname = 'events' AND t.relnamespace = current_schema()::regnamespace
                    AND c.conname = 'ck_events_batches') THEN
    ALTER TABLE events ADD CONSTRAINT ck_events_batches CHECK (
      eligible_batches IS NULL
      OR (cardinality(eligible_batches) >= 1 AND array_position(eligible_batches, NULL) IS NULL)
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid
                  WHERE t.relname = 'events' AND t.relnamespace = current_schema()::regnamespace
                    AND c.conname = 'fk_events_archiver') THEN
    ALTER TABLE events ADD CONSTRAINT fk_events_archiver
      FOREIGN KEY (archived_by) REFERENCES users(user_id)
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid
                  WHERE t.relname = 'event_registrations' AND t.relnamespace = current_schema()::regnamespace
                    AND c.conname = 'ck_er_status') THEN
    ALTER TABLE event_registrations ADD CONSTRAINT ck_er_status
      CHECK (status IN ('active','cancelled'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid
                  WHERE t.relname = 'event_registrations' AND t.relnamespace = current_schema()::regnamespace
                    AND c.conname = 'ck_er_payment_status') THEN
    ALTER TABLE event_registrations ADD CONSTRAINT ck_er_payment_status
      CHECK (payment_status IN ('not_required','unpaid','paid'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid
                  WHERE t.relname = 'event_registrations' AND t.relnamespace = current_schema()::regnamespace
                    AND c.conname = 'ck_er_cancel_reason') THEN
    ALTER TABLE event_registrations ADD CONSTRAINT ck_er_cancel_reason CHECK (
      cancel_reason IS NULL OR cancel_reason IN (
        'Cancelled by member','Cancelled by admin','Payment Deadline Expired','Event cancelled')
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid
                  WHERE t.relname = 'event_registrations' AND t.relnamespace = current_schema()::regnamespace
                    AND c.conname = 'fk_er_cancelled_by') THEN
    ALTER TABLE event_registrations ADD CONSTRAINT fk_er_cancelled_by
      FOREIGN KEY (cancelled_by) REFERENCES users(user_id)
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid
                  WHERE t.relname = 'event_registrations' AND t.relnamespace = current_schema()::regnamespace
                    AND c.conname = 'ck_er_tshirt_size') THEN
    ALTER TABLE event_registrations ADD CONSTRAINT ck_er_tshirt_size
      CHECK (tshirt_size IS NULL OR tshirt_size IN ('S','M','L','XL','XXL'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid
                  WHERE t.relname = 'payments' AND t.relnamespace = current_schema()::regnamespace
                    AND c.conname = 'fk_payments_registration') THEN
    ALTER TABLE payments ADD CONSTRAINT fk_payments_registration
      FOREIGN KEY (registration_id) REFERENCES event_registrations(registration_id)
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- 5) Indexes (idempotent).
CREATE UNIQUE INDEX IF NOT EXISTS uq_event_registration_active
  ON event_registrations (event_id, user_id) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_event_reg_active
  ON event_registrations (event_id, status);
CREATE INDEX IF NOT EXISTS idx_event_reg_user
  ON event_registrations (user_id, status);
CREATE INDEX IF NOT EXISTS idx_event_reg_deadline
  ON event_registrations (payment_deadline)
  WHERE status = 'active' AND payment_status = 'unpaid';
CREATE INDEX IF NOT EXISTS idx_event_reg_attempts
  ON event_registrations (event_id, user_id)
  WHERE cancel_reason = 'Payment Deadline Expired';
CREATE INDEX IF NOT EXISTS idx_events_archived
  ON events (archived_at);
CREATE INDEX IF NOT EXISTS idx_payments_registration
  ON payments (registration_id) WHERE registration_id IS NOT NULL;

-- 6) Verification — fails the whole transaction if anything is missing.
DO $$
DECLARE col_count integer; uidx integer;
BEGIN
  SELECT COUNT(*) INTO col_count
    FROM information_schema.columns
   WHERE table_schema = current_schema()
     AND ((table_name = 'events' AND column_name IN
            ('eligible_batches','registration_fee','archived_at','archived_by','tshirt_included'))
       OR (table_name = 'event_registrations' AND column_name IN
            ('status','payment_status','payment_deadline','confirmed_at','cancelled_at',
             'cancel_reason','cancelled_by','registration_fee_snapshot','tshirt_size'))
       OR (table_name = 'payments' AND column_name = 'registration_id'));
  IF col_count <> 15 THEN
    RAISE EXCEPTION 'Verification failed: expected 15 new columns, found %', col_count;
  END IF;

  SELECT COUNT(*) INTO uidx FROM pg_indexes
   WHERE schemaname = current_schema() AND indexname = 'uq_event_registration_active';
  IF uidx <> 1 THEN
    RAISE EXCEPTION 'Verification failed: uq_event_registration_active is missing';
  END IF;
END $$;

COMMIT;
