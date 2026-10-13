# BILBILASH ALUMNI — LOCAL SETUP GUIDE

> How to run this project on your own computer. Beginner-friendly.
> Real passwords, JWT secrets, and API keys are NEVER written in this file — they live only in `backend/.env`.
> Last updated: 2026-09-29

## 0. Status

Code is complete. The database still needs to be created (step 5). Both servers run on localhost.

| Component | Status |
|-----------|--------|
| Database schema (`database/schema.sql`) | ✅ Written (19 tables) |
| Database `bilbilash_alumni` | ❌ NOT CREATED — run step 5 |
| Backend (Express, port 5000) | ✅ Runs |
| Frontend (React + Vite, port 5173) | ✅ Runs, builds cleanly |
| Automated tests (`backend/tests/smokeTest.js`) | ⏳ Written, not yet run (needs the database) |

## 1. Required Software

| Software | Purpose | Status on this machine |
|----------|---------|------------------------|
| Node.js 20+ | Runs backend and build tools | ✅ v24.14.1 |
| npm | Installs dependencies | ✅ 11.11.0 |
| MySQL Server 8.x | Database | ✅ 8.0.46, port 3306 open |
| Modern browser | Using the app | ✅ |

Verify yourself:

```bash
node -v
npm -v
mysql --version
```

## 2. MySQL Setup

MySQL runs as a Windows service (usually starts with Windows).

- **Start/stop manually:** press `Win`, type **Services**, find **MySQL80**, right-click → Start/Restart.
- **Check it answers:** `mysql -u root -p` (enter your MySQL root password; type `exit` to leave).

Remember that password — it goes into `backend/.env` as `DB_PASSWORD`.

## 3. Environment Variables

The file **`backend/.env`** already exists locally and holds your secrets. A template lives at `backend/.env.example`.

| Variable | Meaning |
|----------|---------|
| `DB_HOST` | MySQL host (`localhost`) |
| `DB_PORT` | MySQL port (`3306`) |
| `DB_USER` | MySQL user (`root`) |
| `DB_PASSWORD` | **Your MySQL password — currently empty, you must set it** |
| `DB_NAME` | Database name — currently **`bilbilash_alumni_v2`** (see the note below) |
| `PORT` | Backend port (`5000`) |
| `JWT_SECRET` | Random string used to sign login tokens (already generated) |
| `JWT_EXPIRES_IN` | Token lifetime (`1d`) |
| `AUTHORITY_EMAIL` | Seeded Authority login email |
| `AUTHORITY_PASSWORD` | **The password you log in with as Authority** (change it any time — see the warning below) |

> ⚠️ **Two different passwords — do not mix them up:**
> - `DB_PASSWORD` = your **MySQL server** password (used by the backend to reach the database)
> - `AUTHORITY_PASSWORD` = the **app login** password for the Authority account (used on the login page)
>
> If you change `AUTHORITY_PASSWORD` in `.env`, apply it with `npm run authority:set-password`.

Rules: never commit `.env`, never paste its values into documentation or chat, never hard-code them in source.

Generate a new JWT secret if you ever need one:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

## 4. Install Dependencies

```bash
cd backend
npm install

cd ../frontend
npm install
```

## 5. Database Creation + Seed (migration)

> **Why `bilbilash_alumni_v2`?** An older `bilbilash_alumni` database from a previous project version already exists on this machine — it has different tables (`students`, `job_posts`, `payments`) and 6 user rows. To avoid destroying that data, this project was initialized into `bilbilash_alumni_v2` instead. Nothing in the old database was changed. If you want the documented name back, you must first decide what to do with the old data (see PROJECT_STATUS.md).

1. Open `backend/.env` and put your real MySQL password after `DB_PASSWORD=`.
2. Run:

```bash
cd backend
npm run init-db
```

This command is idempotent — it is safe to run repeatedly. It creates the database, applies all tables (no data is dropped), seeds the 4 roles, and seeds the single Authority account from `AUTHORITY_EMAIL` / `AUTHORITY_PASSWORD`. It never prints the password.

**Changing the Authority login password later:**

```bash
cd backend
npm run authority:set-password
```

It reads `AUTHORITY_EMAIL` / `AUTHORITY_PASSWORD` from `backend/.env`, bcrypt-hashes the password, updates (or creates) the Authority account, and bumps `token_version` so any old sessions are logged out. It never prints the password.

The individual steps inside it:

- `database/schema.sql` → all tables (migration)
- roles insert → VISITOR, MEMBER, ADMIN, AUTHORITY (seed)
- Authority account → created only if missing (seed)

Verified output looks like:

```
[init-db] Ensuring database exists...
[init-db] Applying schema (database/schema.sql)...
[init-db] Schema applied (idempotent).
[init-db] Authority account created for <email>.
[init-db] DONE.
```

## 6. Start the Backend

```bash
cd backend
npm run dev      # auto-restarts on file changes (node --watch)
# or
npm start        # plain start
```

Expected output:

```
[backend] BILBILASH Alumni API running at http://localhost:5000
```

## 7. Start the Frontend

In a second terminal:

```bash
cd frontend
npm run dev
```

Expected output: `Local: http://localhost:5173/`

## 8. Localhost URLs

| Service | URL | Notes |
|---------|-----|-------|
| Frontend | http://localhost:5173 | React app (Vite dev server) |
| Backend API | http://localhost:5000 | REST API, all routes under `/api` |
| Health check | http://localhost:5000/api/health | Shows `database: connected` when MySQL works |
| Uploaded files | http://localhost:5000/uploads/… | Served by the backend |
| MySQL | localhost:3306 | Database `bilbilash_alumni` |

If a port is busy, change `PORT` in `backend/.env` (backend) or `server.port` in `frontend/vite.config.js` (frontend), and update this document.

## 9. Testing Instructions

**Automated smoke test** (needs the database to exist first):

```bash
cd backend
npm run smoke-test
```

It creates throwaway users and checks: registration, pending-user limits, authority login, member approval, the maximum-3-Admins rule, immediate effect of demotion, job moderation, duplicate job applications, event capacity and duplicate registration, one-vote-per-poll, gallery/teacher/notice flows, blood search privacy, notification IDOR protection, the OTP password-reset flow, and token invalidation after reset. It prints `PASS`/`FAIL` per check and exits non-zero on failure.

Current result on this machine: **65 passed, 0 failed.**

It cleans up after itself: every fixture it creates carries a `SMOKE-` prefix (or a `smoke.*@example.com` email) and is deleted before and after the run, so repeated runs stay deterministic and the 3-Admin cap test remains meaningful. It never deletes other data.

**Manual checklist in the browser:**

1. Register a new account → you are a pending VISITOR and see "awaiting approval".
2. Log in as Authority (email/password from `backend/.env`) → Admin dashboard shows real counts.
3. Approve the new member under **Admin → Approvals** → they become MEMBER.
4. Log in as that member → post a job → approve it as admin → apply from another account.
5. Try to promote four members to Admin → the fourth is rejected (max 3).
6. Request a password reset → the OTP appears in the backend console (`Forgot password` page also shows it in dev).

**Build check** (frontend compiles):

```bash
cd frontend
npm run build
```

## 10. How to Stop the Servers

- Vite/backend in a terminal: `Ctrl + C`.
- If a server was started in the background (as during automated work), find and kill it on Windows:

```bash
netstat -ano | grep ":5000 " | grep LISTENING     # note the PID
taskkill //PID <pid> //F
```

`pkill` does **not** reliably stop Windows processes — use `taskkill`, or close the terminal.

## 11. Troubleshooting

### "Database is unavailable. Check the DB_* settings in backend/.env…" (HTTP 503)
- **Meaning:** the API cannot reach MySQL. The response is deliberately sanitized; the real reason is in the backend console.
- **Common causes:** `DB_PASSWORD` empty/wrong in `backend/.env`; MySQL service stopped; database not created yet.
- **Diagnose:** check the backend terminal for a line like `[error] ER_ACCESS_DENIED_ERROR`; run `mysql -u root -p` to test the password by hand.
- **Fix:** correct `DB_PASSWORD` in `backend/.env`, start the MySQL80 service, then run `npm run init-db` and restart the backend.
- **Verify:** `curl http://localhost:5000/api/health` shows `"database":"connected"`.

### `ER_ACCESS_DENIED_ERROR` (Access denied for user 'root'@'localhost')
- **Meaning:** MySQL rejected the credentials.
- **Fix:** put the exact MySQL root password in `backend/.env` (`DB_PASSWORD=`). Do not guess passwords for accounts you do not own.
- **Verify:** `mysql -u root -p` succeeds with that same password.

### `ER_BAD_DB_ERROR` (Unknown database 'bilbilash_alumni')
- **Meaning:** the database has not been created.
- **Fix:** `cd backend && npm run init-db`. Never create tables by hand; never use `DROP DATABASE`.

### A request hangs forever (no response, no error)
- **Meaning:** a database transaction is waiting on a lock held by another statement in the same operation.
- **Cause seen in this project:** inserting a notification inside an open transaction (the notification's foreign key needs a lock on the same user row the transaction holds).
- **Fix applied:** notifications are now sent **after** the transaction commits. Do not call `notify()` inside `withTransaction()` — see the comment in `backend/src/services/userService.js`.

### The browser shows a blank page but the console says "X is not defined"
- **Meaning:** the browser is running a stale JavaScript bundle after a code change.
- **Fix:** hard-reload the tab, or restart Vite (`taskkill //PID <vite pid> //F`, then `npm run dev`). Deleting `frontend/node_modules/.vite` forces a fresh transform cache.

### `[[{ value }]] = await query(...)` throws "is not iterable"
- **Meaning:** this project's `query()` helper resolves to the **row array** (or the INSERT result object) — not `[rows, fields]`. Only raw `conn.query()` inside a transaction returns `[rows, fields]`.
- **Fix:** use `const [{ alias }] = await query(...)` for pool queries; `const [[{ alias }]] = await conn.query(...)` inside `withTransaction`.

### Backend logs `http://localhost:0` or "port 0"
- **Meaning:** another program (the host shell) exported `PORT=0`, which used to shadow the `.env` value.
- **Fix:** already handled — `backend/src/config/env.js` now lets `backend/.env` override ambient variables. Ensure `PORT=5000` is in `backend/.env` and restart.

### `EADDRINUSE` (port 5000 or 5173 already in use)
- **Meaning:** an older server instance is still running.
- **Fix:** find and kill it with `netstat -ano | grep ":5000 " | grep LISTENING` + `taskkill //PID <pid> //F`, then start again.

### Server started in the background won't die with `pkill`
- **Meaning:** Git Bash can't signal native Windows processes.
- **Fix:** use `taskkill //PID <pid> //F` (find the PID with `netstat -ano`).

### `npm install` fails
- **Fix:** check your internet connection/proxy, delete `node_modules` and `package-lock.json` inside that folder, then run `npm install` again.

### "Invalid email or password" when logging in as Authority
- **Meaning:** the login page password is the **app** password (`AUTHORITY_PASSWORD`), not your MySQL password (`DB_PASSWORD`). These are different things.
- **Diagnose:** check the value of `AUTHORITY_PASSWORD` in `backend/.env` (open the file, do not print it).
- **Fix:** either log in with that value, or set the password you want in `backend/.env` and run `cd backend && npm run authority:set-password`.
- **Verify:** `curl -s http://localhost:5000/api/health` shows `database: connected`, and the login page redirects to the dashboard with the AUTHORITY badge.

### I was logged in, then suddenly got logged out
- **Meaning:** the account's `token_version` changed (for example `npm run authority:set-password`, or a password reset). All previously issued JWTs are invalidated on purpose.
- **Fix:** log in again.

### 401 Unauthorized in the app
- **Meaning:** the token is missing, expired, or was invalidated (password reset bumps `token_version`).
- **Fix:** log in again. This is expected behavior, not a bug.

### 403 Forbidden in the app
- **Meaning:** your role in the database does not allow that action (for example, a VISITOR trying to post a job, or an ADMIN trying to promote someone).
- **Fix:** nothing — this is intentional backend authorization. Check your role in **My Account**.

### Frontend shows "Cannot reach the server"
- **Meaning:** the backend is not running on port 5000.
- **Fix:** start it (`cd backend && npm run dev`) and refresh.

### Uploads fail
- **Meaning:** the image is larger than 3 MB, or is not JPG/PNG/WEBP/GIF, or the file content isn't a real image.
- **Fix:** use a smaller, genuine image file. Filenames are regenerated server-side, so the original name does not matter.

### Reset code (OTP) not received
- **Meaning:** this local build has no email service. The OTP is written to the backend console and returned in the API response for local development only.
- **Fix:** look at the terminal running the backend, or use the "Dev code" shown on the Forgot Password page.

### Nothing works after changing `backend/.env`
- **Fix:** restart the backend — `.env` is read once at startup.
