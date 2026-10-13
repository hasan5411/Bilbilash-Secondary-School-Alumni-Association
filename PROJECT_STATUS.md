# BILBILASH ALUMNI COMMUNITY MANAGEMENT SYSTEM — PROJECT STATUS

> **SOURCE OF TRUTH FOR PROJECT PROGRESS.** Read this first in any new session.
> Last updated: 2026-09-29

## Current Phase

**FULL APPLICATION BUILD — COMPLETE AND VERIFIED**

Database created, backend and frontend running, automated test suite passing **65/65**, browser login verified end-to-end.

## Current Module

None in progress. The application is functional and ready for you to click through.

## Completed Work

| Area | Status |
|------|--------|
| Architecture & documentation | DONE |
| Database schema (18 tables) created + seeded | DONE |
| Backend API (15 domains, 57 files) | DONE |
| Frontend app (29 files, builds cleanly) | DONE |
| Automated test suite (65 assertions) | **DONE — 65 passed, 0 failed** |
| Browser verification (login + role-based UI + live data) | DONE |
| Remaining UI gaps (event/notice image uploads) | NOT IMPLEMENTED |

## Implemented Features

**Auth:** registration (always pending VISITOR), login (JWT + bcrypt), logout, `/me`, forgot-password (6-digit OTP, bcrypt-hashed, 10-min expiry, single-use), verify-OTP, reset-password (bumps `token_version`, killing old tokens), change-password.

**Roles & administration:** VISITOR → MEMBER (approval) → ADMIN (max 3, race-safe) → AUTHORITY (seeded from `.env`). Approve/reject/deactivate with audit logging; Authority-only promote/demote; audit trail endpoint.

**Profile:** view/update own profile, validated profile-photo upload (MIME + extension whitelist, magic-number sniff, 3 MB cap, generated filenames).

**Directory:** public search (name, SSC batch, profession, institute, blood group) and public profile view — approved members, public fields only.

**Jobs:** member posts with admin moderation, applications with duplicate prevention, owner/admin review, status updates with notifications.

**Events:** admin create/update/cancel, member registration with transactional capacity enforcement and duplicate prevention.

**Visions, Help requests, Notices, Notifications, Polls, Gallery, Teacher directory, Blood group (Badhon) search, Dashboard with live DB counts.**

## Tested Features — all verified by execution

Automated suite (`cd backend && npm run smoke-test`) — **65 assertions, 65 passed, 0 failed**:

- Health endpoint + real database connectivity
- Registration of 4 accounts, duplicate email → 409
- Pending VISITOR limits (cannot post jobs → 403); unauthenticated access → 401
- Authority login; pending list; approval promotes VISITOR → MEMBER
- **Admin cap: 3 promotions succeed, the 4th is rejected (409)**
- MEMBER cannot promote (403); ADMIN cannot promote (403); ADMIN cannot demote (403)
- Authority demotes an Admin → that user immediately loses admin access (403 on stats)
- Authority account cannot be modified
- Job moderation, duplicate application → 4xx, self-application → 4xx, non-owner MEMBER cannot read another user's applications (403), ADMIN can
- Event capacity of 1 enforced (2nd registrant → 409), duplicate registration → 409
- One vote per poll (duplicate → 409)
- Vision submission + moderation; help request + status change
- Gallery upload (real PNG multipart) + moderation; teacher add + public listing; notice publish + public listing
- Blood search works and leaks **no** contact details (verified by scanning the payload for `@`)
- Notification IDOR: cannot mark another user's notification read (403/404)
- Password reset: wrong OTP → 400, correct OTP → 200, OTP single-use → 4xx, login with new password → 200
- Old token invalid after password reset → 401

Browser verification (real Chromium, not simulated): the app renders, `/login` authenticates a real account through the API, redirects to the dashboard with the correct **ADMIN** badge, shows role-appropriate navigation, and displays data read from MySQL (notices, events, stats). Profile page shows the logged-in account's real database record.

Frontend production build: 51 modules transformed, no errors.

## Failed Tests

None outstanding. Six real failures were found and fixed during verification (see CHANGELOG): route-param crash, environment shadowing, database error leakage, a transaction deadlock, two result-destructuring bugs, and an undefined variable that blanked every logged-in page.

## Known Bugs

None confirmed open.

## Database Status

- MySQL 8.0.46, localhost:3306. Database **`bilbilash_alumni_v2`** created: **18 tables**, all 4 roles seeded, Authority account seeded (approved) — verified by querying the live database.
- `bilbilash_alumni_v2` was chosen because an **older `bilbilash_alumni` database already exists on this machine** from a previous project version (`students`, `job_posts`, `payments` tables, **6 user rows**). That data has been left **completely untouched** — nothing was dropped, renamed, or altered. Switching to the original name requires your decision (see Next Steps).
- `npm run init-db` is idempotent — verified by running it repeatedly with no duplication.

## Backend Status

RUNNING on http://localhost:5000, `database: connected`. Started in the background with `node src/server.js`. To stop it on Windows use `taskkill //PID <pid> //F` (`pkill` does not work).

## Frontend Status

RUNNING on http://localhost:5173 (Vite). Proxies `/api` and `/uploads` to the backend.

## Known Limitations

- Events and notices have no image-upload UI (schema columns exist; profile, gallery, and teacher photos do upload).
- The OTP reset code is printed to the backend console (no email service in local development).
- Rate limiting on auth endpoints is not implemented.
- The smoke suite deletes only its own `SMOKE-`/`smoke.*@example.com` fixtures — it never touches other data.

## Credentials (where to find them)

- Authority **login** (app): `AUTHORITY_EMAIL` / `AUTHORITY_PASSWORD` in `backend/.env`.
- MySQL **server** password: `DB_PASSWORD` in `backend/.env` — this is NOT an app login.
- To change the Authority login password: edit `AUTHORITY_PASSWORD` in `backend/.env`, then run `cd backend && npm run authority:set-password` (it hashes with bcrypt and invalidates old sessions).

## Next Steps

1. **Decide the database name.** Either keep `bilbilash_alumni_v2` (safe, works today), or let the new schema take over `bilbilash_alumni` — which requires dropping or renaming the old data first. Nothing is done until you say so.
2. Click through the app as Authority (credentials in `backend/.env`) and as a member.
3. Optional remaining work: event/notice image uploads, auth rate limiting, UI polish.

## Documentation Files

`PROJECT_GUIDE.md`, `LOCAL_SETUP.md`, `PROJECT_STATUS.md` (this file), `CHANGELOG.md`, `README.md` — all saved inside the project and describing actual behaviour.

## Security Rules In Effect

- Secrets only in `backend/.env` (git-ignored); none appear in documentation, logs, or API responses.
- Role is read from MySQL on every request — never from the JWT payload, localStorage, or request body.
- Database failures return a sanitized 503 instead of leaking driver internals.
