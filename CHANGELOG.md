# CHANGELOG

All notable changes to the Bilbilash Alumni Community Management System.
Only changes that actually happened are recorded here.

---

## Phase 0 — Architecture — 2026-09-29

### Added
- `PROJECT_GUIDE.md`, `PROJECT_STATUS.md`, `LOCAL_SETUP.md`, `README.md`, `.gitignore`, `.env.example`.

### Database Changes
- None. No database was created in this phase.

### Testing
- Environment checks only: Node v24.14.1, npm 11.11.0, MySQL 8.0.46 (port 3306 open).

---

## Full Application Build — 2026-09-29

### Added
- `database/schema.sql` — 18 tables (roles, users, profiles, password_resets, jobs, job_applications, visions, help_requests, events, event_registrations, notices, notifications, polls, poll_options, poll_votes, gallery, teachers, audit_logs) with keys, foreign keys, unique constraints, indexes, and role seed.
- Backend: 57 files — config/env, MySQL pool + transactions, middleware (JWT auth reading role from DB, RBAC, error handler, uploads), 15 services, 15 controllers, 15 route files, `initDb` seeding script.
- Frontend: 29 files — React 19 + Vite 7 + Tailwind 4, auth context, API client, 17 pages covering public/member/admin flows.
- `backend/tests/smokeTest.js` — 65 end-to-end assertions.

### Changed
- `backend/src/config/env.js` — `backend/.env` now overrides ambient environment variables.
- `backend/src/middleware/errorHandler.js` — sanitized 503 for database failures.

### Fixed
- **Express 5 crash at boot:** `:id(\\d+)` route params are unsupported by path-to-regexp v8; removed from 10 route files.
- **Frontend build failure:** wrong relative imports in 6 admin pages.
- **Bug in `eventService.listEvents`:** malformed WHERE clause with unbound placeholders.
- **Database error leakage:** MySQL messages such as `Access denied for user 'root'@'localhost'` were reaching API clients; now replaced with a sanitized 503.
- **Undefined variable in `Navbar`:** `isMember` was used but never destructured — every logged-in user got a blank page. Found only through browser testing; API tests could not catch it.
- **Result-destructuring bugs:** `statsService.getOverview` and `jobService.createJob` treated the pool helper's return value as `[rows, fields]`, causing "not iterable" 500s on the dashboard and on job creation.
- **Transaction deadlock in notifications:** `notify()` ran on a separate pool connection *inside* an open transaction; the notification's foreign key needed a lock on the same `users` row the transaction held, so approvals/promotions/registrations hung forever. All notifications now fire **after commit** (users, events, applications).
- **`database/schema.sql` ignored `DB_NAME`:** the file contained its own `CREATE DATABASE`/`USE bilbilash_alumni`, so it always wrote into the old database regardless of configuration. The file no longer creates or selects a database — the init script does.

### Database Changes
- Created `bilbilash_alumni_v2` with 18 tables, 4 roles (VISITOR, MEMBER, ADMIN, AUTHORITY) and the Authority account seeded from `.env` (approved, bcrypt-hashed).
- `npm run init-db` verified idempotent.
- **An older, unrelated `bilbilash_alumni` database from a previous project version exists on this machine (6 user rows). It was left completely untouched** — no drops, renames, or modifications.
- Test fixtures are created and deleted by the smoke suite itself (`SMOKE-` prefix / `smoke.*@example.com` emails). 9 leftover fixture rows from interrupted runs were removed; only the Authority account remains.

### Testing
Executed and passing:
- `npm run smoke-test` → **65 passed, 0 failed** (auth, RBAC matrix, 3-admin cap, demotion taking effect immediately, IDOR, duplicate prevention, capacity limits, OTP reset, token invalidation).
- Browser: login as a real account through the UI → dashboard with correct ADMIN badge, role-appropriate navigation, and values read from MySQL.
- Frontend production build: 51 modules, no errors.
- `GET /api/health` → `database: connected`.
- Idempotency: `npm run init-db` re-run without duplicating roles or the Authority account.

### Known Issues
- Events and notices have no image-upload UI yet.
- No rate limiting on auth endpoints.
- The database-name decision (new `bilbilash_alumni_v2` vs. replacing the old `bilbilash_alumni`) is pending the developer's approval, because replacing it would destroy the old data.

---

## Production Authority Initialization Fix — 2026-10-14

### Root cause (confirmed by code + live production inspection)
- Production (Render + Supabase) had the schema and a working Member registration but no AUTHORITY account, so the first Authority login returned 401 `Invalid email or password`.
- The Authority account is created ONLY by the manual `npm run init-db` / `npm run authority:set-password` scripts — nothing in the Render deploy path (`npm start`) ever seeded it, and the deployment guide never told the operator to run `init-db` against the production database.
- Worse, on PostgreSQL `init-db` was not re-runnable at all: the second `CREATE TRIGGER` failed with `42710 already exists`, aborting the script BEFORE the Authority seed. Any attempt to run it against the already-created production schema could only fail.
- Render env vars were NOT the problem: `env.js` hard-requires `AUTHORITY_EMAIL`/`AUTHORITY_PASSWORD` at boot, and the live health endpoint answers 200 — so the server proves those variables exist.

### Changed
- `database/schema.postgresql.sql` — all 10 `updated_at` triggers are now `DROP TRIGGER IF EXISTS` + `CREATE TRIGGER` (objects only, never data) so the schema file and `npm run init-db` are genuinely re-runnable on an existing database.
- `backend/src/db/authoritySeed.js` (new) — shared Authority seed: role_id resolved from the `roles` table (never hardcoded), bcrypt cost 12 (same as login), `INSERT ... ON CONFLICT (email) DO NOTHING` (race-safe, duplicate-proof), create-only (an existing account's password/role/status are never modified), and a hard refusal when `AUTHORITY_EMAIL` belongs to a non-Authority account (closes the register-with-the-Authority-email privilege-escalation hole). All reporting is credential-free.
- `backend/src/db/initDb.js` — uses the shared seed; the old "align role/status on existing account" behavior (silent promotion) is removed; conflict now exits 1 with an actionable message.
- `backend/src/db/setAuthorityPassword.js` — uses the shared seed in explicit recovery mode: resets the password of the AUTHORITY-role account only, bumps `token_version`; refuses (exit 1, no writes) any account of another role.
- `GUIDE.md` — Section E now documents the one-time production init (`npm run init-db` via Render Shell), the recovery command, login verification, and a troubleshooting row for the Authority 401.

### Added
- `backend/tests/authorityInitTest.js` (`npm run authority-init-test`) — 63 assertions against the real scripts and the real API: init-db idempotency (run twice, no duplicate, hash untouched, password never printed), seed unit behavior (create/exists/concurrency/validation), the escalation guard (module + real script exit 1 with the member row untouched), login accept/reject (indistinguishable 401s, no enumeration, no hash/token leakage), pending-JWT blocking, the full approval RBAC matrix, recovery-script behavior, and no-credential-leak checks.

### Database changes
- None to existing data. A production run of `npm run init-db` applies missing objects idempotently and creates the single Authority account from Render's env vars.

### Testing
- `npm run authority-init-test` → **63 passed, 0 failed** (exit 0) vs local embedded PostgreSQL 17.
- Regression, all exit 0: smoke **172/0**, contribution **117/0**, profile **74/0**, demo-e2e **54/0**, upload **28/0**.
- Production `/api/health` read-only live check: `status ok, database connected, db_ok true` (HTTP 200). Production Authority login itself is verified only after the operator runs the documented one-time init step (see `AUTHORITY_INIT_FIX_REPORT.md`).
