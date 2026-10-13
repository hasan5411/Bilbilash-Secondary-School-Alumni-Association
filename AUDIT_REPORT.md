# AUDIT REPORT — Bilbilash Alumni Community Management System

Date: 2026-10-13 · Scope: Phase 1 audit only (no files were modified for this audit)

---

## 1. Current technology stack (verified, not assumed)

| Layer | Actual implementation | Evidence |
|---|---|---|
| Frontend | React 19 + Vite 7 + Tailwind CSS 4, react-router-dom 7 (**BrowserRouter**) | `frontend/package.json`, `frontend/src/main.jsx` |
| Backend | Node.js 24 + **Express 5** (ESM), JWT (Bearer token in `Authorization` header, `localStorage`) | `backend/package.json`, `frontend/src/api/client.js` |
| Database | **MySQL 8.0.46 via `mysql2`** — NOT PostgreSQL | `backend/src/db/pool.js` (`mysql2/promise`), live connection test |
| Active database | `bilbilash_alumni_v2` — **21 tables, ~13,474 rows** (user confirms: disposable test data) | live query of `information_schema` |
| Uploads | Local filesystem `backend/uploads/` via multer (5 files, 5.3 MB) | `backend/src/middleware/upload.js` |
| Email | nodemailer SMTP, **optional** (console-OTP dev fallback when unset) | `backend/src/config/env.js` |
| Tests | 5 hand-rolled Node test scripts (no framework), all hitting `localhost:5000` + direct MySQL | `backend/tests/*.js` |
| Git | **Not a repository at all** (workspace root and project root both lack `.git`) | `git status` → fatal |
| Node/npm | v24.14.1 / 11.11.0 | CLI |

Project layout: monorepo with `backend/`, `frontend/`, `database/`, docs at root, agent workspace in `.freebuff/`, preserved backups in `.backups/` (5 dated snapshots — **untouched**).

## 2. What already works well (must be preserved)

- Clean layered architecture: routes → controllers → services → `db/pool.js`; central error handler that never leaks SQL/stack traces to clients (503 clamp for DB failures, 409 for dup-entry/FK-restrict).
- `env.js` is production-aware already: `PORT` from env, `CORS_ORIGINS` (comma-separated), optional `SERVE_FRONTEND_DIR` SPA mode, required `JWT_SECRET`/`AUTHORITY_*` fail-fast, payment-number validation.
- `/api/health` endpoint exists and degrades gracefully when the DB is down.
- Security basics: `x-powered-by` disabled, `trust proxy`, nosniff/X-Frame-Options/Referrer-Policy headers, bcrypt cost 12, multer filename randomization + magic-number sniffing + 3 MB limit, parameterized queries everywhere (no string concatenation of user input found).
- Auth design is split-deployment friendly: Bearer token (no cookies) → no CSRF surface, CORS-only.
- Business rules encoded in services: pending-visitor approval flow, contribution-rate history (`member_monthly_rates` with effective months, never rewriting history), payment verification workflow, audit trail, role hierarchy AUTHORITY > ADMIN > MEMBER > VISITOR with `token_version` invalidation.
- Idempotent MySQL schema + idempotent seeder; `init-db` creates DB + seeds roles + Authority account.
- `.gitignore` already excludes `.env`, `node_modules/`, `dist/`, `uploads/`, logs.

## 3. Deployment blockers (verified)

| # | Blocker | Impact | Fix planned |
|---|---|---|---|
| B1 | **MySQL driver + MySQL-only SQL** (`?` placeholders ×791, `insertId` ×25, `affectedRows` ×5, `YEAR()/MONTH()/DATE_ADD()` ×10, `ON DUPLICATE KEY` ×2, `FOR UPDATE` ×11, `TINYINT(1)`/`ENUM` columns) | Supabase is PostgreSQL — backend cannot connect at all | Full driver + dialect migration to `pg` (Phase 2) |
| B2 | **Local filesystem uploads** (`backend/uploads/`) | Render dynos are ephemeral — uploads vanish on every deploy | Phase 9: move to Supabase Storage (S3-compatible) or documented persistent option; credentials stay backend-side |
| B3 | **No `vercel.json` / SPA rewrite** | BrowserRouter deep links (`/notifications` refresh) 404 on Vercel | Add rewrite rule |
| B4 | **No git repository** | Cannot push to GitHub / trigger Vercel-Render deploys | `git init` + first commit (Phase 11) |
| B5 | **No `.env.example` matching production needs** (no `DATABASE_URL`, no `CORS_ORIGINS`, no `VITE_API_BASE` documented) | Misconfiguration risk on Render/Vercel | Phase 5 |
| B6 | **`override: true` dotenv** in `env.js` | On Render, platform env vars could be shadowed by a committed `.env` if one ever ships; also blocks 12-factor style config | Adjust load order: real env wins over file |
| B7 | Tests/scripts hardcode `localhost:5000` and use `mysql2` directly | Cannot verify PG migration without porting them | Port all 5 suites (Test B/C/E) |
| B8 | `emailService` dev fallback can return OTP in HTTP response when `ALLOW_DEV_OTP=1` | Must never be set in production | Document + keep guard |

## 4. Security & secret findings

- **Source scan clean**: no hardcoded passwords/keys/secrets in `backend/src` or `frontend/src` (verified by regex scan).
- **Real secrets exist only in `backend/.env`** (DB password, JWT_SECRET, AUTHORITY creds, SMTP). It is gitignored, but **the repo does not exist yet** — first commit must be made only after confirming `.env` is excluded (it is, via `.env` rule). Rotation recommendation: rotate `JWT_SECRET` and DB password before public deployment.
- `backend/reconciliation-report.json` (generated artifact, may contain payment test data) — not gitignored → will be excluded.
- `.backups/` (your preserved copies) — not gitignored → will be excluded so backups never enter history.
- SMTP credentials and OTP values are never logged by backend code (emailService reviewed); dev OTP echo is env-gated.

## 5. Data-migration risk assessment

Per your instruction, localhost MySQL records are **disposable test data — no data migration**. Remaining risks, addressed:

1. Schema fidelity: every table, FK, unique key, index, enum value, and default must be carried to PostgreSQL so business rules (history preservation, RESTRICT deletes, approval workflow) survive. → clean `schema.postgresql.sql` generated from the MySQL schema, field-for-field.
2. Behavioral fidelity: `mysql2` returns `DATETIME` as strings and `TINYINT(1)` as 0/1; `pg` returns JS Dates for timestamps and strings for int8 by default. → driver-level type parsers restore identical shapes so no service logic changes behavior.
3. Historical-record behavior: `ON DELETE RESTRICT` FKs, `member_monthly_rates`/`monthly_payment_details` history, and audit logs must keep working — covered by the existing 339-test corpus being ported and re-run against PostgreSQL.

## 6. Prioritized implementation plan

| Phase | Work | Risk | Verification |
|---|---|---|---|
| P2a | Install `pg`; local **embedded PostgreSQL** (test-only devDependency) so everything is verifiable on this machine before Supabase | low | server boots, psql-equivalent queries run |
| P2b | Rewrite `db/pool.js`: `?`→`$n` translator (string-literal safe), INSERT `RETURNING`→`insertId` adapter, `rowCount`→`affectedRows`, int8/DATE/DATETIME parsers, `withTransaction` shim, `DATABASE_URL` + SSL support | medium | unit probes + full suites |
| P2c | `database/schema.postgresql.sql` (identity keys, TEXT+CHECK for enums, SMALLINT for TINYINT(1) — a deliberate mapping that keeps all 28 `= 1` comparisons and JS `=== 1` checks working, `updated_at` trigger) | medium | init-db on empty PG, 21 tables |
| P2d | Port 13 service files' INSERTs to `RETURNING`, 10 MySQL-function sites, errorHandler PG codes (23505→409, 23503→409, 23514→422, conn failures→503), port initDb + 2 migrate scripts + setAuthorityPassword, port 5 test suites | **high** (largest change) | all suites green vs PostgreSQL |
| P3 | Retire MySQL-only leftovers **without deleting**: move `migrateContributions.js`, `migrateSetByRetention.js`, `tmp_*.mjs` to `legacy-mysql/` with a README; record in changelog | low | suites still green |
| P5 | `.env.example` (root+backend+frontend) with placeholders only; `dotenv` no longer overrides real env; `.gitignore` hardened (`.backups/`, `.freebuff/`, `reconciliation-report.json`, `legacy note`) | low | grep for secrets, build passes |
| P8 | `vercel.json` (SPA rewrite), `VITE_API_BASE` documented, Render settings verified against package.json (root dir `backend`, `npm start`) | low | `vite build` + preview |
| P9 | Uploads: implement Supabase Storage upload path (S3-compatible, credentials backend-only) — **needs your Supabase keys**; email OTP config documented | medium | real upload test post-deploy |
| P10 | Tests: baseline (done), backend, database, frontend build, integration (all suites + browser) | — | evidence per test |
| P11 | `git init`, secret scan (incl. history check post-init), initial commit, push guide (push needs your GitHub auth) | low | clean `git status`, scan clean |
| P12 | `GUIDE.md` in Bangla with English technical terms — every command verified by actual execution | low | commands re-run from guide |
| P13 | Final report: prepared vs locally-tested vs deployed vs blocked-on-user | — | — |

### Requires your action (cannot be done by me)
- Supabase project creation → connection string (`DATABASE_URL`) for the real Supabase database (local verification happens first on embedded PostgreSQL).
- GitHub repository + credentials for the push.
- Render + Vercel accounts; production env vars set in their dashboards; final `published` deploy authorization.

**Audit verdict: safe to proceed to Phase 2 (PostgreSQL migration), with all changes verified locally before anything touches an external service.**
