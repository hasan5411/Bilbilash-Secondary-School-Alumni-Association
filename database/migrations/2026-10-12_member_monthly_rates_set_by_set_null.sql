-- =====================================================================
-- Migration: member_monthly_rates.set_by  RESTRICT -> SET NULL
-- Date:     2026-10-12
-- Database: bilbilash_alumni_v2 (whatever DB_NAME the backend uses)
--
-- WHY: deleting an Alumni Member failed with MySQL error 1451 because
-- fk_mmr_setby (set_by -> users.user_id) was ON DELETE RESTRICT. Every rate
-- row — including rates a member set for themselves — blocked the deletion
-- of the account that set it.
--
-- DESIGN: the rate's OWNER stays user_id (unchanged, still CASCADE with the
-- member's account). The SETTER reference (set_by) becomes nullable and, when
-- that account is deleted, is released to NULL by the FK while the row itself
-- (amount, effective_month, source) survives untouched. The setter's identity
-- is copied into set_by_snapshot by deleteUser() inside the deletion
-- transaction BEFORE the user row is removed, so attribution is preserved as
-- an immutable text record — never fabricated, never silently discarded.
--
-- SAFETY:
--   * Forward migration is NON-DESTRUCTIVE: it adds one nullable column and
--     relaxes one FK. No row is updated or deleted, so no backup is strictly
--     required — but run SELECT COUNT(*) FROM member_monthly_rates before and
--     after to verify (the app's runner does this automatically).
--   * Does NOT disable FOREIGN_KEY_CHECKS.
--   * No ON DELETE CASCADE is introduced for financial/historical data.
--   * Idempotent: safe to re-run (the runner, npm run migrate:set-by, checks
--     column/FK state first; this SQL file can be applied once).
--
-- APPLY (via the project's migration runner — recommended):
--   cd backend && npm run migrate:set-by
-- APPLY (manually, on a DEVELOPMENT database first):
--   mysql -u <user> -p bilbilash_alumni_v2 < 2026-10-12_member_monthly_rates_set_by_set_null.sql
--
-- ROLLBACK plan (see ROLLBACK section at the bottom): restore the NOT NULL
-- column and the RESTRICT FK. NOTE: rollback is only valid while no set_by
-- value is NULL. If members have already been deleted, those rows' setter is
-- gone by design; either leave them (recommended) or set set_by to a sentinel
-- account before rolling back. Review with:
--   SELECT rate_id, user_id, set_by_snapshot FROM member_monthly_rates WHERE set_by IS NULL;
-- =====================================================================

-- ---------------------------------------------------------------- UP --

-- 1) Snapshot column for the setter's identity (captured at deletion time).
--    VARCHAR(160) fits 'First Last <email@example.com> (user_id 123456)'.
ALTER TABLE member_monthly_rates
  ADD COLUMN set_by_snapshot VARCHAR(160) NULL AFTER set_by;

-- 2) set_by becomes nullable: NULL means "the setter's account was deleted;
--    their identity is in set_by_snapshot".
ALTER TABLE member_monthly_rates
  MODIFY set_by BIGINT UNSIGNED NULL;

-- 3) Index for the FK (required by InnoDB when the FK is re-created).
--    (Existing databases may already have one created implicitly.)
ALTER TABLE member_monthly_rates
  ADD KEY idx_mmr_setby (set_by);

-- 4) Replace the FK: releases the pointer on user deletion instead of
--    blocking it. Amounts, effective months and owners are untouched.
ALTER TABLE member_monthly_rates
  DROP FOREIGN KEY fk_mmr_setby;

ALTER TABLE member_monthly_rates
  ADD CONSTRAINT fk_mmr_setby
  FOREIGN KEY (set_by) REFERENCES users(user_id)
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Verify (run manually; counts must match pre-migration counts):
--   SELECT COUNT(*) FROM member_monthly_rates;                -- unchanged
--   SELECT DELETE_RULE FROM information_schema.REFERENTIAL_CONSTRAINTS
--    WHERE CONSTRAINT_SCHEMA = DATABASE() AND CONSTRAINT_NAME = 'fk_mmr_setby';  -- SET NULL

-- ---------------------------------------------------------- ROLLBACK --
-- Run ONLY if every set_by value is non-NULL (see query above).
-- Restores the original schema exactly. No data is modified.

-- ALTER TABLE member_monthly_rates DROP FOREIGN KEY fk_mmr_setby;
-- ALTER TABLE member_monthly_rates DROP KEY idx_mmr_setby;
-- UPDATE member_monthly_rates SET set_by = user_id WHERE set_by IS NULL; -- ONLY if policy allows re-attribution; otherwise keep the row and skip this file's rollback
-- ALTER TABLE member_monthly_rates MODIFY set_by BIGINT UNSIGNED NOT NULL;
-- ALTER TABLE member_monthly_rates DROP COLUMN set_by_snapshot;
-- ALTER TABLE member_monthly_rates
--   ADD CONSTRAINT fk_mmr_setby
--   FOREIGN KEY (set_by) REFERENCES users(user_id)
--   ON DELETE RESTRICT ON UPDATE CASCADE;
