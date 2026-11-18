--
-- 2026-11-18_profile_education.sql
--
-- Additive, idempotent PostgreSQL migration for hosted Supabase.
-- Mirrors backend/src/db/migrateProfileEducation.js so it can be pasted
-- directly into the Supabase SQL Editor (no connection string needed).
--
-- SAFETY:
--   * never deletes or rewrites profile rows
--   * existing rows keep NULL for the two new optional fields
--   * safe to run repeatedly: every step checks the catalog first
--   * one transaction: any error rolls the whole script back
--
-- Adds:
--   profiles.college     VARCHAR(120)  -- college / polytechnic institute
--   profiles.university  VARCHAR(120)
--
-- The existing profiles.institute column keeps its meaning (current
-- company / institute) and is labelled "Institute / Company" in the UI.

BEGIN;

-- 0) Required table must exist.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                  WHERE table_schema = current_schema() AND table_name = 'profiles') THEN
    RAISE EXCEPTION 'profiles table is missing';
  END IF;
END $$;

-- 1) Columns (metadata only; existing rows stay NULL).
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS college VARCHAR(120);
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS university VARCHAR(120);

-- 2) Verification — fails the whole transaction if anything is missing.
DO $$
DECLARE col_count integer;
BEGIN
  SELECT COUNT(*) INTO col_count
    FROM information_schema.columns
   WHERE table_schema = current_schema()
     AND table_name = 'profiles'
     AND column_name IN ('college','university');
  IF col_count <> 2 THEN
    RAISE EXCEPTION 'Verification failed: expected 2 new columns, found %', col_count;
  END IF;
END $$;

COMMIT;
