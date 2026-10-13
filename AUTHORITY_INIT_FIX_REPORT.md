# AUTHORITY INITIALIZATION FIX — FINAL REPORT

Date: 2026-10-14 · Scope: missing initial Authority account + first-time Authority login 401
in the Bilbilash Alumni system (Render backend + Supabase PostgreSQL + Vercel frontend).

---

## 1. Root cause (confirmed by code inspection, not guesswork)

Two independent defects, both verified in the code and consistent with the observed production state:

1. **The Authority account is only ever created by MANUAL scripts.**
   The sole creation paths are `npm run init-db` (`backend/src/db/initDb.js`) and
   `npm run authority:set-password` (`backend/src/db/setAuthorityPassword.js`).
   Render starts the service with `npm start` → `node src/server.js`, which never seeds
   anything, and the deployment guide's production section (GUIDE.md §E) never instructed
   running `init-db` against the production database (it was documented only for local and
   staging databases). The production schema exists (Member registration works), but the
   seed step never ran there → `users` has no AUTHORITY row → `authService.login()` finds
   no user → **401 "Invalid email or password"**.

2. **`init-db` was not even re-runnable on PostgreSQL.**
   `database/schema.postgresql.sql` used bare `CREATE TRIGGER` (10 `updated_at` triggers).
   PostgreSQL has no `CREATE TRIGGER IF NOT EXISTS`; on a database where the schema already
   existed, the script failed with `42710 trigger ... already exists` **before reaching the
   Authority seed**. So on exactly the database state production is in, `npm run init-db`
   could only crash. (Caught by the new test suite: `init-db run #1 exits 0 — FAILED: 42710`.)

Explicitly ruled out:
- Wrong env-var names: `env.js` hard-requires `AUTHORITY_EMAIL`/`AUTHORITY_PASSWORD` at boot
  (`required()` → `process.exit(1)`); the live backend answers `/api/health` 200, which proves
  those variables exist on Render under exactly those names.
- Password-hash/verification inconsistency: seeding and login both use bcryptjs
  (cost 12 hash / `bcrypt.compare`), email normalized (trim+lowercase) on both sides.
- Role mapping: seeding reads `role_id` from the `roles` table by name (`AUTHORITY`), never a
  hardcoded id; login checks `status='approved'` + `is_active=1`, which the seed sets.
- Health/"database connected" was never the issue — it only proves connectivity.

## 2. Files changed (and why)

| File | Change |
|---|---|
| `database/schema.postgresql.sql` | All 10 `updated_at` triggers → `DROP TRIGGER IF EXISTS` + `CREATE TRIGGER` (objects only; no data dropped). Schema and `npm run init-db` are now genuinely re-runnable. |
| `backend/src/db/authoritySeed.js` **(new)** | Shared, race-safe, create-only Authority seed used by both scripts. |
| `backend/src/db/initDb.js` | Uses the shared seed (create-only). Removed the silent "align role/status" promotion of any existing account holding AUTHORITY_EMAIL; conflict → actionable error, exit 1. |
| `backend/src/db/setAuthorityPassword.js` | Explicit recovery via the shared seed: resets the password **only** of an account that holds the AUTHORITY role (bumps `token_version`); refuses any other role with exit 1 and zero writes. |
| `backend/tests/authorityInitTest.js` **(new)** | 63-assertion suite (script `npm run authority-init-test`). |
| `backend/package.json` | Added `authority-init-test` script. |
| `GUIDE.md` | §E: one-time production init via Render Shell, recovery command, login/approve verification, troubleshooting row for the Authority 401. |
| `CHANGELOG.md` | Entry for this fix. |

## 3. Database changes

- **No existing data is modified by the code change.** A production `npm run init-db` run:
  - applies missing schema objects idempotently (`IF NOT EXISTS` / `DROP IF EXISTS` triggers),
  - creates **one** AUTHORITY-role user from `AUTHORITY_EMAIL`/`AUTHORITY_PASSWORD`
    (bcrypt cost-12 hash, `status='approved'`, `is_active=1`, profile row),
  - never duplicates (unique `email` + `ON CONFLICT DO NOTHING`), never overwrites an
    existing account's password/role/status, never promotes a non-Authority account.
- No migration script is needed; no table, column, or constraint is added.

## 4. Security considerations

- Privilege escalation closed: a public registration using AUTHORITY_EMAIL stays a pending
  VISITOR; the seed and both real scripts **refuse** (`REFUSING`, exit 1) to promote or take
  over that account. Previously `init-db` silently flipped any such account to AUTHORITY+approved.
- No credential ever printed: scripts log only action + user_id + email; tests assert the
  password string never appears in script output or API error bodies.
- Login failures remain enumeration-safe (identical 401 body for unknown email vs wrong password,
  asserted in tests); pending members get 403 and no token; JWTs are re-validated against DB
  status on every request (stale-token pending account blocked, asserted).
- RBAC unchanged and re-verified: members cannot approve/promote; anonymous/garbage tokens get
  401; the Authority account itself cannot be modified through the API (403).
- Recovery (`authority:set-password`) is explicit, operator-run, invalidates old sessions, and
  hard-refuses any account that is not AUTHORITY.
- Init requires no new environment variables; no secret handling changed.

## 5. Tests performed and results (local embedded PostgreSQL 17, backend on :5000)

| Suite | Result |
|---|---|
| `npm run authority-init-test` (new) | **63 passed / 0 failed**, exit 0 — covers: role resolution from real schema; the REAL `init-db` run twice (exit 0, no duplicate, hash/token_version/role untouched, "already exists" reported, no password printed); seed create/exists/concurrency (parallel runs → exactly one created, one row); input validation; escalation guard at module AND real-script level (exit 1, member row byte-identical); login 200 with role AUTHORITY + `/api/auth/me`; wrong password 401; unknown email 401 with identical message; no hash/token in 401 bodies; pending login 403; stale JWT of pending account blocked; anonymous/garbage-token 401 on approve/promote; authority approves pending member (role→MEMBER, status→approved); member cannot audit/approve/promote (403); authority cannot be deactivated via API (403); real recovery script re-hashes same password + bumps token_version + refuses foreign accounts. |
| `npm run smoke-test` | 172 / 0, exit 0 |
| `npm run contribution-test` | 117 / 0, exit 0 |
| `npm run profile-test` | 74 / 0, exit 0 |
| `npm run demo-e2e` | 54 / 0, exit 0 |
| `npm run upload-test` | 28 / 0, exit 0 |
| Production `GET /api/health` (read-only) | HTTP 200 — `{"status":"ok","database":"connected","db_ok":true}` |

Test suites create/delete only their own `authoritytest.%@example.com` / `smoke.%@example.com`
fixtures and are guarded against ever targeting a non-local database.

## 6. Exact production deployment & verification steps (Render + Supabase)

1. **Deploy the code**: push these commits; Render rebuilds automatically (Root Directory
   `backend`, Build `npm install`, Start `npm start`). No start-command change is needed.
2. **Environment variables by name** (Render → Environment; values never entered in chat or code):
   `DATABASE_URL` (Supabase pooler URI with `sslmode=require`), `JWT_SECRET`, `JWT_EXPIRES_IN`,
   `CORS_ORIGINS` (exact Vercel URL), `AUTHORITY_EMAIL`, `AUTHORITY_PASSWORD`
   (≥ 8 chars), optional `EMAIL_*`, optional payment numbers. Never set `ALLOW_DEV_OTP` in production.
3. **One-time initialization** — Render → this service → **Shell** tab:
   `npm run init-db`
   Expected log: `[init-db] Schema applied (idempotent).` → `[init-db] Authority account created for <email> (user #N).` (or `already exists — no duplicate created, credentials untouched`) → `[init-db] DONE.`
   If the free plan has no Shell: temporarily set Start Command to `npm run init-db && npm start`,
   deploy, verify, then set it back to `npm start`.
4. **Verify the account exists without exposing the hash** — Supabase SQL Editor:
   `SELECT user_id, email, status, is_active, r.role_name FROM users u JOIN roles r ON r.role_id = u.role_id WHERE r.role_name = 'AUTHORITY';`
   Expect exactly **one** row, `status='approved'`, `is_active=1`. No `password_hash` in the SELECT.
5. **Test the Authority login** at the Vercel URL with `AUTHORITY_EMAIL`/`AUTHORITY_PASSWORD`
   → dashboard loads, profile shows Role `AUTHORITY`.
6. **Approve the pending Member**: Moderation / Pending Members → approve. The Member can then
   log in with role MEMBER.
7. **Password recovery (any time)**: update `AUTHORITY_PASSWORD` in Render → Shell →
   `npm run authority:set-password` → log in with the new password (old sessions invalidated).
8. **Rollback if verification fails**: Render → Deploys → Rollback to the previous deploy.
   The change is code-only; the only database effect of step 3 is one new AUTHORITY row —
   nothing was deleted or modified, so rolling back code is always safe. (No destructive
   database operation exists anywhere in this path.)

## 7. Remaining uncertainty / manual actions

- **Production login has NOT been tested by me and is NOT yet claimed fixed.** I have no access
  to your credentials or Render Shell, and I will not use them. Steps 3–6 above are the
  verification; they were fully verified locally (the same real scripts + real API, 63/63).
- If step 4 shows an AUTHORITY row that predates this fix but login still 401s, the password in
  Render's `AUTHORITY_PASSWORD` differs from the account's hash → run step 7 (recovery).
- If `init-db` ever exits 1 with `REFUSING`, `AUTHORITY_EMAIL` is held by a non-Authority
  account (e.g. someone registered with that address) — the script changed nothing; resolve by
  using a different `AUTHORITY_EMAIL` or removing that registration, then re-run.
- The test suites must never be run against production (they self-refuse without
  `ALLOW_REMOTE_TESTS=1`); all results above come from the local embedded PostgreSQL.
