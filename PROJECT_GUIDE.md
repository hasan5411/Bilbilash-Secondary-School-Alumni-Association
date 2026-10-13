# BILBILASH ALUMNI COMMUNITY MANAGEMENT SYSTEM — PROJECT GUIDE

> Beginner-friendly explanation of what this project is and how it works.
> This file describes the ACTUAL current state. Last updated: 2026-09-29.

---

## 1. What The Project Is

A community platform for the **Bilbilash Secondary School Alumni Association**, running entirely on your own computer (localhost). Former students register, get approved by an administrator, and then use community features: alumni directory, job board with applications, vision/idea board, help requests, events with registration, noticeboard, notifications, polls, photo gallery, teacher directory, and blood-group ("Badhon") search.

No cloud service, no hosting, no payments, no GitHub required.

**Current state:** all code is written and both servers run; the database still needs to be created with `npm run init-db` (see `LOCAL_SETUP.md`).

---

## 2. Technology Stack

| Layer | Technology | Version used |
|-------|-----------|--------------|
| Frontend | React + Vite + Tailwind CSS (JavaScript) | React 19, Vite 7.3.6, Tailwind 4 |
| Frontend routing | react-router-dom | 7.x |
| Backend | Node.js + Express | Express 5, Node 24 |
| Database | MySQL | 8.0.46, localhost:3306 |
| DB driver | mysql2 (pool + prepared statements) | 3.24.x |
| Auth | jsonwebtoken (JWT) + bcryptjs | 9.x / 2.4.x |
| Uploads | multer (2.x) with MIME/extension whitelist | — |
| Other backend deps | cors, dotenv | — |

Dependencies were kept deliberately small; validation and rate-limit-free simplicity are hand-rolled where a library wasn't necessary.

---

## 3. Folder Structure

```
BILBILASH-ALUMNI/
├── backend/                     Express API (57 JS files)
│   ├── src/
│   │   ├── config/env.js        Loads backend/.env (authoritative) + validates
│   │   ├── db/pool.js           MySQL pool, query helpers, withTransaction
│   │   ├── db/initDb.js         Idempotent DB create + schema + Authority seed
│   │   ├── middleware/          auth (JWT+RBAC), errorHandler, upload
│   │   ├── utils/               errors, jwt, validate
│   │   ├── services/            Business logic + SQL (15 domains)
│   │   ├── controllers/         Request parsing → service → JSON response
│   │   ├── routes/              URL → middleware → controller wiring
│   │   ├── app.js               Express app assembly
│   │   └── server.js            HTTP listener
│   ├── tests/smokeTest.js       60+ end-to-end assertions
│   ├── uploads/                 Generated image files (git-ignored)
│   └── .env                     LOCAL SECRETS ONLY (git-ignored)
│
├── frontend/                    React app (29 source files)
│   ├── src/api/client.js        Central fetch wrapper (JWT, errors, 401 logout)
│   ├── src/context/AuthContext.jsx
│   ├── src/components/ui.jsx    Button, Card, Input, Badge, Alert, Spinner…
│   ├── src/pages/               Public, member, and admin pages
│   └── vite.config.js           Dev server + /api and /uploads proxy
│
├── database/schema.sql          18 tables + role seed (no database name inside — uses DB_NAME)
├── docs/                        Phase reports
├── PROJECT_STATUS.md            Progress source of truth (read first)
├── PROJECT_GUIDE.md             This file
├── LOCAL_SETUP.md               How to run + troubleshooting
├── CHANGELOG.md                 What changed
└── README.md                    Quick start
```

---

## 4. How The Backend Works

Every request follows one path:

```
Route → Middleware → Controller → Service → Database layer → MySQL
```

1. **Route** (`src/routes/*.js`) — declares the URL, which auth is needed (`authenticate`), and which role is allowed (`requireRole('ADMIN')`).
2. **Middleware**
   - `authenticate` verifies the JWT signature, then **re-reads the user and role from MySQL**. If a user was demoted or their password reset (which bumps `token_version`), old tokens stop working immediately.
   - `requireRole` compares the DB role against the route's minimum using the hierarchy VISITOR < MEMBER < ADMIN < AUTHORITY. Failures return 401 (not logged in) or 403 (wrong role).
   - `errorHandler` turns every failure into `{"success":false,"message":"…"}` and never exposes stack traces or database internals.
3. **Controller** — validates the request body (`validate(body, rules)`) and calls a service.
4. **Service** — the business rules: who may approve whom, the 3-Admin cap, capacity checks, duplicate prevention, notifications, audit entries.
5. **Database layer** (`db/pool.js`) — a connection pool with **parameterized queries only** (SQL injection is not possible), plus `withTransaction()` for multi-step operations.

Response shape is consistent everywhere:

```json
{ "success": true,  "data": { … } }
{ "success": false, "message": "human-readable error" }
```

Status codes: 200, 201, 400, 401, 403, 404, 409, 422, 500, and 503 when the database is unreachable.

### The 3-Admin rule (race-safe)
Promotion to Admin happens inside a transaction that locks the target row and takes `LOCK IN SHARE MODE` on the current Admin rows before counting them. Two simultaneous promotions therefore cannot produce a 4th Admin — the second sees a count of 3 and is rejected with 409.

---

## 5. How The Frontend Works

- **Vite** serves the app at http://localhost:5173 and proxies `/api` and `/uploads` to the backend on port 5000, so there are no CORS surprises in development.
- **`src/api/client.js`** is the single place that talks to the API: it attaches the JWT, unwraps `data`, converts failures into friendly errors, and logs the user out on 401.
- **AuthContext** keeps the logged-in user in React state + localStorage. This is only for showing/hiding UI — the backend independently verifies every request, so tampering with the stored role achieves nothing.
- **Router guards** (`RequireRole`) block pages the current role must not see; the backend would reject the underlying API calls anyway.
- Data pages implement **loading, error, empty, and success** states.
- Styling uses Tailwind 4 with the requested palette: green/teal brand, yellow accents, powder-blue surfaces, white cards.

---

## 6. How The Database Works

- MySQL database `bilbilash_alumni`, InnoDB, utf8mb4, **snake_case** table/column names (mapped to camelCase in JavaScript).
- Created and migrated by `cd backend && npm run init-db`, which is **idempotent** (`CREATE TABLE IF NOT EXISTS`, role upsert, Authority created only once).
- The database **name comes from `DB_NAME` in `backend/.env`** — `schema.sql` never creates or selects a database itself.
- Currently pointing at `bilbilash_alumni_v2`, because an older, incompatible `bilbilash_alumni` database from a previous project version already exists on this machine (6 user rows). That old data has been left untouched. See PROJECT_STATUS.md.
- Every table has an auto-increment primary key, foreign keys with explicit `ON DELETE` behavior, and `created_at`/`updated_at` timestamps. Searchable columns are indexed.

### 18 tables

| Group | Tables |
|-------|--------|
| Identity | `roles`, `users`, `profiles`, `password_resets` |
| Jobs | `jobs`, `job_applications` |
| Community | `visions`, `help_requests`, `events`, `event_registrations`, `notices`, `notifications` |
| Participation | `polls`, `poll_options`, `poll_votes` |
| Content | `gallery`, `teachers` |
| Oversight | `audit_logs` |

### Duplicate prevention enforced by the database
- `job_applications`: `UNIQUE(job_id, applicant_id)` — one application per job.
- `event_registrations`: `UNIQUE(event_id, user_id)` — one registration per event.
- `poll_votes`: `UNIQUE(poll_id, user_id)` — one vote per poll.
- `users.email`, `profiles.user_id`, `roles.role_name`: unique.

### Entity relationships

```
roles 1───N users 1───1 profiles
                ├──1─N jobs ─1─N job_applications N─1 users
                ├──1─N visions / help_requests / notices
                ├──1─N events ─1─N event_registrations N─1 users
                ├──1─N polls ─1─N poll_options ─1─N poll_votes N─1 users
                ├──1─N gallery (uploaded_by, moderated_by)
                ├──1─N teachers (created_by)
                ├──1─N notifications (recipient)
                ├──1─N audit_logs (actor)
                └──1─N password_resets
```

---

## 7. User Roles & Permissions

```
AUTHORITY  (seeded from .env — cannot be registered)
   ↓
ADMIN      (maximum 3)
   ↓
MEMBER     (approved alumni)
   ↓
VISITOR    (registered, awaiting approval)
```

| Capability | VISITOR | MEMBER | ADMIN | AUTHORITY |
|------------|:-------:|:------:|:-----:|:---------:|
| Browse public pages (notices, teachers, directory, events, blood search) | ✔ | ✔ | ✔ | ✔ |
| Log in with limited access | ✔ | ✔ | ✔ | ✔ |
| Update own profile + photo | ✔ | ✔ | ✔ | ✔ |
| View own notifications | ✔ | ✔ | ✔ | ✔ |
| Post jobs, apply, join events, submit ideas/help/gallery, vote | ✖ | ✔ | ✔ | ✔ |
| Approve/reject members, moderate jobs/ideas/gallery, publish notices, manage events/polls/teachers | ✖ | ✖ | ✔ | ✔ |
| Promote Member → Admin (max 3) / demote Admin | ✖ | ✖ | ✖ | ✔ |
| System dashboard + audit trail | ✖ | ✖ | stats | stats + audit |

Hard rules enforced server-side:
1. Registration always creates **VISITOR + pending**; a `role` field in the request body is ignored.
2. Only Authority promotes or demotes Admins; the 3-Admin cap is transaction-safe.
3. Admin cannot touch Authority accounts; nobody can create an Authority through the API.
4. Role changes take effect immediately, because the role is read from the database on every request.
5. You can only read/update your own profile, notifications, and applications (IDOR protection).

---

## 8. How Each Module Works

**Authentication** — Register (bcrypt-hashed password, pending VISITOR). Login returns a JWT valid for the configured lifetime. Forgot password generates a 6-digit OTP stored **bcrypt-hashed** with a 10-minute expiry and single-use enforcement; in this local build it is printed to the backend console (no email server). Resetting the password increments `token_version`, which instantly invalidates every existing token.

**Member management** — Admins/Authority approve or reject pending users (users are never deleted; rejection is a status). Approval promotes VISITOR → MEMBER and sends a notification. Every moderation action is written to `audit_logs`.

**Profile** — Users edit their own name, phone, SSC batch, blood group, profession, institute, address, and bio, and upload a photo. Uploads are validated three ways (MIME whitelist, extension check, magic-number sniff), capped at 3 MB, and stored under a generated filename — the original filename is never trusted.

**Directory** — Public search/filter over approved members by name, SSC batch, profession, institute, and blood group. Public fields only; email/phone/address are never returned by public endpoints.

**Jobs** — Members post jobs (status `pending`), admins moderate (`approved`/`rejected`/`closed`), approved jobs are listed to all logged-in users. Members apply once per job (DB-unique), cannot apply to their own post, and cannot apply after the deadline. Job owners and admins see application lists and can set application status; applicants are notified.

**Visions & Ideas** — Members submit ideas; admins mark them approved/rejected/implemented; the author is notified.

**Help Requests** — Members ask for help with category and urgency; admins (or the owner for closing) move them through open → in_progress → resolved → closed.

**Events** — Admins create events (date, times, location, capacity). Registration runs in a transaction that locks the event row: capacity is enforced, and `UNIQUE(event_id, user_id)` blocks duplicates. Members can cancel their own registration.

**Notices & Notifications** — Admins publish/archive notices (published notices are public). Notifications are created automatically on approvals, promotions, demotions, job moderation, application updates, event registration, and gallery moderation; users read/mark them individually or all at once, and can never touch another user's notification.

**Polls** — Admins create polls (2–10 options) and close them; members vote once, enforced by a unique key; results show live counts and percentages.

**Gallery** — Members upload photos (pending) and admins approve/reject them; only approved photos are listed for members.

**Teacher Directory** — Public list; admins add/remove teachers with an optional photo.

**Blood Group (Badhon)** — Public summary counts and search by blood group over approved members, returning name, batch, profession, and institute only. Contact details are deliberately excluded to protect privacy.

**Dashboard** — Every number (users, pending approvals, members, admins, jobs, events, ideas, help, notices, gallery) is a live SQL count. There are no hard-coded figures anywhere.

---

## 9. Important Files

| File | Why it matters |
|------|----------------|
| `PROJECT_STATUS.md` | Read first — real progress, what is tested, what is blocked |
| `backend/.env` | Your local secrets (MySQL password, JWT secret, Authority credentials) |
| `database/schema.sql` | The whole database definition |
| `backend/src/middleware/auth.js` | JWT verification + role enforcement |
| `backend/src/services/userService.js` | Approval flow and the race-safe 3-Admin cap |
| `backend/src/db/initDb.js` | Database creation, migration, Authority seeding |
| `backend/tests/smokeTest.js` | End-to-end verification of the security rules |
| `frontend/src/api/client.js` | The only place the frontend talks to the backend |
| `frontend/vite.config.js` | Dev ports and API proxy |

---

## 10. Common Problems & Solutions

Short version — the full list with diagnostics is in **LOCAL_SETUP.md → Troubleshooting**.

| Symptom | Cause | Fix |
|---------|-------|-----|
| `503 Database is unavailable` | Wrong/empty `DB_PASSWORD`, MySQL stopped, or DB not created | Fix `backend/.env`, start MySQL80, run `npm run init-db`, restart backend |
| `ER_BAD_DB_ERROR` | Database not created yet | `cd backend && npm run init-db` |
| `ER_ACCESS_DENIED_ERROR` | Wrong MySQL password | Correct `DB_PASSWORD` in `backend/.env` |
| `EADDRINUSE` on 5000/5173 | An older server is still running | `netstat -ano \| grep ":5000 "` then `taskkill //PID <pid> //F` |
| `pkill` doesn't stop the server | Git Bash cannot signal Windows processes | Use `taskkill //PID <pid> //F` |
| Backend logs `http://localhost:0` | Ambient `PORT=0` in the shell | Already fixed in `env.js`; keep `PORT=5000` in `.env` and restart |
| 401 in the app | Token expired/invalidated | Log in again |
| 403 in the app | Your DB role does not allow the action | Expected behavior; check your role in **My Account** |
| No OTP received | No email service in local mode | Read the OTP from the backend console / Forgot Password page |
| Upload rejected | Not an image, over 3 MB, or content mismatch | Use a genuine JPG/PNG/WEBP/GIF under 3 MB |

---

*Everything described here exists in the code. Database-backed flows are unverified until `npm run init-db` and `npm run smoke-test` are run — see PROJECT_STATUS.md / CHANGELOG.md for the precise test status.*
