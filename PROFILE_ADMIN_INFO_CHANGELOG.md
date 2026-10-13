# PROFILE & ADMIN INFORMATION — CHANGELOG

Date: 2026-09-30
Scope: Member profile information display, optional Facebook profile link, Admin/Authority "Member Information" view, directory photo fix.

---

## 1. Files changed

### Database
- `database/schema.sql` — `profiles` table gained `facebook_url VARCHAR(255) NULL` (after `bio`).
- `backend/src/db/initDb.js` — idempotent INFORMATION_SCHEMA-guarded `ALTER TABLE profiles ADD COLUMN facebook_url VARCHAR(255) NULL` so **existing** databases get the column on the next `npm run init-db` (verified safe to re-run; does nothing when the column exists).

### Backend
- `backend/src/services/profileService.js` — `OWN_SELECT` and INSERT/UPDATE now include `facebook_url` (empty string saved as NULL).
- `backend/src/controllers/profileController.js` — `PUT /api/profile` accepts optional `facebook_url` (max 255) validated against a Facebook-host allow-list regex (`*.facebook.com/...` or `fb.com/...`, http/https). Non-Facebook URLs → 422.
- `backend/src/utils/validate.js` — `validate()` gained optional `pattern: { re, message }` rule (generic, reused only by facebook_url for now).
- `backend/src/services/userService.js` — `publicUser()`/`BASE_SELECT` expose `facebook_url`; new `getUserDetail(userId)` (single user, full profile join, credentials never selected into public shapes).
- `backend/src/controllers/userController.js` — new `getMemberDetail` (strips `password_hash`, `token_version`; normalizes `role_name` → `role`).
- `backend/src/routes/userRoutes.js` — new `GET /api/users/:id` with `requireRole('ADMIN')` (rank ≥ ADMIN ⇒ ADMIN **and** AUTHORITY pass). Declared after `/audit` so the audit route still matches exactly.
- `backend/src/services/directoryService.js` — public profile (`GET /api/directory/:id`) now also returns `phone`, `present_address`, `permanent_address`, `facebook_url` (needed by the member profile page).
- `backend/tests/smokeTest.js` — admin-limit section now adapts when the dev DB already contains real ADMIN accounts (counts free slots via `/api/stats/overview` instead of assuming zero).

### Frontend
- `frontend/src/pages/Profile.jsx` — Update Profile form: new optional **Facebook Profile Link** field (url input, prefilled from saved value, removable by clearing).
- `frontend/src/pages/PublicProfile.jsx` — profile card now shows **Phone**, **Present address**, **Permanent address** ("Not provided" when null) and a **Facebook** grid cell (bottom-right, next to Permanent address bottom-left) that links to the saved URL with `target="_blank" rel="noopener noreferrer"`. Cell hidden entirely when no URL is saved.
- `frontend/src/pages/admin/Members.jsx` — **NEW**: "Member Information" page — search box (name/email/batch/profession/institute), table (photo/initials, name, email, batch, profession, institute), **View Details** modal with complete info (photo, name, email, phone, registration number, batch, blood, profession, institute, both addresses, facebook, role/status/active badges, registration date, bio). No passwords/tokens; no delete/reset/role actions.
- `frontend/src/App.jsx` — route `/admin/members` wrapped in `RequireRole min="ADMIN"`.
- `frontend/src/pages/admin/Stats.jsx` — dashboard card link "📋 Member Information →".
- `frontend/src/pages/Directory.jsx` — directory cards now show the saved profile photo when present (falls back to initials).

## 2. Database changes
- One nullable column: `profiles.facebook_url VARCHAR(255) NULL`. No new tables, no data migration, nothing destroyed. `registration_number` remains on `users` (VARCHAR(50), editable on the profile page).

## 3. API changes
| Endpoint | Access | Change |
|---|---|---|
| `GET /api/profile` | authenticated self | now returns `facebook_url` |
| `PUT /api/profile` | authenticated self | accepts optional `facebook_url` (Facebook-host URL or empty → NULL) |
| `GET /api/directory/:id` | public | adds phone/both addresses/facebook_url for the profile page |
| `GET /api/users/:id` | ADMIN/AUTHORITY only (403 for MEMBER/VISITOR, 401 anonymous) | NEW — full member info, credentials stripped |

## 4. Facebook field behavior
- Optional; blank allowed; validated server-side (`https://(sub.)facebook.com/…` or `https://(www.)fb.com/…`), max 255.
- Saved on the existing `profiles` row; reloaded into Update Profile; removable (clearing the field stores NULL).
- Profile page shows a "Facebook" link **only** when set — never invents URLs.

## 5. Permissions
- `GET /api/users/:id` reuses `requireRole('ADMIN')` ⇒ MEMBER/VISITOR get **403** (verified), anonymous **401**, AUTHORITY & ADMIN **200**. No second auth system; roles always re-read from DB per request.

## 6. How to test locally
1. Backend: `cd backend && npm run dev` (needs `npm run init-db` once to add the column). Frontend: `cd frontend && npm run dev`.
2. Member: login → Profile → fill Facebook URL → Save → re-open (value persists) → public profile shows the Facebook link opening in a new tab.
3. Clear the Facebook field → Save → profile page hides the Facebook cell.
4. Admin/Authority → Admin → "Member Information" → search → View Details shows full info without any credential fields.
5. As MEMBER: `GET /api/users/1` with the member token must return 403.
6. Full API suite: `cd backend && npm run smoke-test` (69 passing) and the one-off feature verification (27 checks, removed after run).

## 7. Remaining issues / notes
- `users.registration_number` is not yet a UNIQUE index (payment system task will address uniqueness with a data check first).
- Old profile photos deleted in a past incident remain gone (dangling refs already cleaned previously).
- Smoke suite now tolerates pre-existing real ADMIN accounts in the dev DB (admin-cap tests become expectation-aware).
