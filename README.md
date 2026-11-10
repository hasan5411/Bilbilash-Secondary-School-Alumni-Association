<p align="center">
  <img src="frontend/src/assets/bilbilash-emblem.png" alt="Bilbilash Secondary School Alumni Association emblem" width="120">
</p>

# Bilbilash Secondary School Alumni Association

**Alumni Community Management System**

A full-stack web application that helps the Bilbilash Secondary School alumni community reconnect, organise its activities, and manage membership contributions. It combines a public-facing alumni directory with a member portal (jobs, events, polls, notices, gallery) and an administrative back office with a verified monthly-contribution ledger.

---

## Table of Contents

- [Overview](#overview)
- [Key Features](#key-features)
- [User Roles](#user-roles)
- [Technology Stack](#technology-stack)
- [Screenshots](#screenshots)
- [Project Architecture](#project-architecture)
- [Project Structure](#project-structure)
- [Installation and Setup](#installation-and-setup)
- [Environment Variables](#environment-variables)
- [Database Overview](#database-overview)
- [API Overview](#api-overview)
- [Testing](#testing)
- [Deployment](#deployment)
- [Future Improvements](#future-improvements)
- [License](#license)
- [Further Documentation](#further-documentation)

---

## Overview

Alumni communities usually run on scattered WhatsApp groups, spreadsheets, and informal treasurer records. This project replaces that with one system where:

- former students **register once** and are verified before gaining access;
- the association keeps a **single, accurate alumni directory** and teacher archive;
- **monthly contributions** are tracked per member with an auditable, rate-based ledger instead of manual notes;
- community activities — jobs, events, polls, notices, help requests, gallery — have a proper home;
- administrators get the reporting, moderation, and payment-verification tools they actually need.

**Intended users:** alumni members, the association's administrators, a super-admin (Authority) account, and the general public browsing the directory, teacher archive, and noticeboard.

The application is a decoupled SPA + REST API: a React single-page app talking to an Express API backed by PostgreSQL.

---

## Key Features

### Accounts and access
- Registration that always creates a **pending account** (self-assigned roles are ignored).
- JWT authentication; role, status, and session version are **re-read from the database on every request**, so approvals, demotions, and sign-outs take effect immediately.
- Admin/Authority **member approval workflow** (approve, reject, deactivate — accounts are never silently deleted).
- Password reset by **email OTP** (provider HTTPS API in production, SMTP for local development) plus in-app password change.
- **Notification centre** with per-user read state and moderator alerts (new registration, payment awaiting verification, etc.).
- Profile management with a **profile-completion score**.

### Community
- **Alumni directory** (public list, approved-member-only full profiles) with searching and filters.
- **Teacher directory** with photo uploads and an admin/authority CRUD screen (add, update, delete, replace photo).
- **Job board** with applications, applicant tracking, and moderation.
- **Events** with capacity limits, self-registration/cancellation, and an admin registrant list that can be printed / saved as PDF.
- **Vision board** (ideas with moderation), **help requests** with status workflow, and a **blood-donation search**.
- **Polls** with voting and close/manage controls.
- **Noticeboard** (public read) and a moderated **gallery**.
- **Analytics dashboard** with financial, alumni, donor, help, and community views (staff and member visibility differ).

### Monthly contributions and payments
- Append-only **monthly contribution rate history** (`member_monthly_rates`): a rate applies from its effective month until the next rate, so historic dues keep historic rates.
- Month-by-month **ledger and dues calculation** with oldest-first settlement, partial payments, extra contributions, and an explicit “rate not set” state instead of invented amounts.
- **Manual mobile-money and bank payments**: bKash, Nagad, Rocket, and bank transfer. Members send money themselves and submit a transaction/transfer reference (plus optional screenshot); the payment stays **pending** until an admin verifies it.
- Only approval writes `monthly_payment_details` — pending or rejected transactions never count as paid.
- Admin payment review, member payment history, allocation preview before paying, and an admin member-information view with payment-status colour coding and a printable sheet.

### Administration
- Dashboard statistics, pending approvals, user management, member information, payment review, and content moderation.
- Management screens for events, polls, notices, and teachers.
- **Audit log** (Authority-only endpoint) for sensitive actions.
- Optimistic **Admin cap of 100 active admins**; only the Authority account can promote or demote admins.

---

## User Roles

| Capability | VISITOR | MEMBER | ADMIN | AUTHORITY |
|---|---|---|---|---|
| Public pages (home, directory list, noticeboard, teacher archive, blood-donation search) | Yes | Yes | Yes | Yes |
| Sign in to the portal | No (pending accounts are blocked until approved) | Yes | Yes | Yes |
| Full member profiles, jobs, events, gallery, notifications | — | Yes | Yes | Yes |
| Visions, help requests, polls, payments, analytics | — | Yes | Yes | Yes |
| Approve / reject / deactivate members, moderate content | — | — | Yes | Yes |
| Manage events, polls, notices, teachers, review payments | — | — | Yes | Yes |
| Member information, payment & member summaries | — | — | Yes | Yes |
| Promote / demote admins, view audit log | — | — | — | Yes |

Notes verified in code:

- Roles are ranked `VISITOR < MEMBER < ADMIN < AUTHORITY`; a higher role implicitly has the lower role's permissions.
- Registration creates a **VISITOR** account with status `pending`. Such an account cannot sign in (`authenticate` rejects any non-approved status) until an admin approves it, which converts the role to **MEMBER**.
- The **AUTHORITY** account is seeded from `AUTHORITY_EMAIL` / `AUTHORITY_PASSWORD` and cannot be modified, deactivated, or deleted through the UI.

---

## Technology Stack

| Category | Technology |
|---|---|
| Frontend | React `^19.1` (SPA), React Router `^7.8`, Vite `^7.1` (`@vitejs/plugin-react` `^5`) |
| UI / Styling | Tailwind CSS `^4.1` via `@tailwindcss/vite`, custom design tokens in `frontend/src/index.css` |
| Charts | Chart.js `^4.5` with `react-chartjs-2` `^5.3` |
| Backend | Node.js (ES modules), Express `^5.1`, `cors` |
| Database | PostgreSQL (`pg` `^8.23`); Supabase in production, any local PostgreSQL for development |
| Authentication | JWT (`jsonwebtoken` `^9`) + password hashing (`bcryptjs` `^2.4`), server-side role/status reload per request |
| File uploads | `multer` `^2` with magic-byte validation; storage driver `local`, `supabase`, or `cloudinary` |
| Email (OTP) | `nodemailer` `^10` (SMTP, local) or an email provider HTTPS API (Resend / Brevo / SendGrid) |
| Testing | Node.js scripts (custom assertion harness) against a real PostgreSQL database; `embedded-postgres` for a local test server |
| Deployment | Frontend on Vercel (SPA rewrites), backend on Render, database + object storage on Supabase |

Versions reflect the ranges declared in `frontend/package.json` and `backend/package.json`.

---

## Screenshots

No application screenshots are committed to this repository yet.

Suggested additions (place files in a `docs/screenshots/` folder and reference them here):

| Screen | Description |
|---|---|
| `home.png` | Public landing page |
| `directory.png` | Alumni directory with search |
| `profile.png` | Member profile and contribution summary |
| `payments.png` | Payment method selection and verification status |
| `admin-payments.png` | Admin payment review queue |
| `analytics.png` | Analytics dashboard |

The only committed image assets are brand assets used by the UI: `frontend/src/assets/bilbilash-emblem.png`, `bilbilash-logo.png`, and `hero.jpg`.

---

## Project Architecture

The repository contains three independent layers:

- **Frontend (React SPA)** — Vite development server in development, static build on Vercel in production. API calls go to a base URL derived from `VITE_API_BASE` (empty means same origin, which the Vite dev proxy forwards to the backend).
- **Backend (Express API)** — stateless REST API on port 5000 by default. Authentication is a Bearer JWT; the middleware re-loads the user, role, and status from PostgreSQL on each request.
- **Database and storage** — PostgreSQL for all relational data, object storage (Supabase Storage) for uploaded images in production.

```mermaid
flowchart LR
  U["Browser (React SPA)"] -->|"HTTPS + Bearer JWT"| A["Express API"]
  A -->|"SQL over TLS"| D[("PostgreSQL")]
  A -->|"Service-role REST calls"| S["Supabase Storage"]
  A -->|"HTTPS API / SMTP"| E["Email provider"]
  subgraph Hosting
    V["Vercel - static frontend"] --> U
    R["Render - API service"] --> A
  end
```

The API is the only component that touches the database and the storage service-role key; the browser never receives database credentials or storage secrets.

---

## Project Structure

```text
.
├── backend/                  Express REST API
│   ├── src/
│   │   ├── config/           Environment loading and validation (env.js)
│   │   ├── controllers/      HTTP layer (validation, status codes)
│   │   ├── db/               Pool/transaction helpers, schema initializer, migrations
│   │   ├── middleware/       Authentication, roles, uploads, rate limits, errors
│   │   ├── routes/           One router per API module (mounted in app.js)
│   │   ├── services/         Business logic (payments, contributions, email, storage…)
│   │   ├── utils/            Validation, errors, JWT, helpers
│   │   ├── app.js            Express app factory (middleware + route mounting)
│   │   └── server.js         Process entry point
│   ├── tests/                Node.js test suites + local embedded PostgreSQL helper
│   ├── .env.example          Backend environment template
│   └── package.json
├── frontend/                 React SPA
│   ├── src/
│   │   ├── api/              Fetch client (adds JWT, normalizes errors)
│   │   ├── components/       Shared UI, avatars, notification bell, footer
│   │   ├── context/          Auth context (token, user, role)
│   │   ├── pages/            Route-level pages (admin pages in pages/admin)
│   │   ├── utils/            Formatting, media URLs, payment app links
│   │   ├── App.jsx           Router and role-guarded routes
│   │   └── index.css         Tailwind entry + design tokens + print styles
│   ├── vercel.json           SPA rewrite for client-side routing
│   ├── .env.example          Frontend environment template (VITE_API_BASE only)
│   └── package.json
├── database/
│   ├── schema.postgresql.sql Current PostgreSQL schema (idempotent)
│   └── schema.sql            Legacy MySQL schema (historical reference)
├── GUIDE.md                  Detailed operational guide (Bengali)
├── LOCAL_SETUP.md            Beginner local setup notes (partly historical)
└── README.md
```

`legacy-mysql/` and `schema.sql` are kept for traceability of the original MySQL implementation; the application itself runs on PostgreSQL.

---

## Installation and Setup

### 1. Prerequisites

| Requirement | Notes |
|---|---|
| Node.js 18+ | Developed and tested with Node.js 24 |
| npm | Ships with Node.js |
| PostgreSQL 14+ | A local server, or Supabase, or the bundled `embedded-postgres` helper |
| Git | To clone the repository |

### 2. Clone and install dependencies

```bash
git clone <repository-url>
cd <repository-folder>

cd backend
npm install

cd ../frontend
npm install
```

### 3. Configure the backend environment

```bash
cd backend
cp .env.example .env
```

Fill in at minimum:

- `JWT_SECRET` — a long random string
- `AUTHORITY_EMAIL` / `AUTHORITY_PASSWORD` — the seeded super-admin account
- Database connection: either `DATABASE_URL` **or** the `DB_*` variables

See [Environment Variables](#environment-variables) for the full list. Never commit `.env`.

### 4. Prepare the database

Option A — existing PostgreSQL server (set `DB_*` or `DATABASE_URL` first):

```bash
cd backend
npm run init-db
```

`init-db` is idempotent: it applies `database/schema.postgresql.sql`, seeds the role rows, and creates the single Authority account from your environment. It never drops or truncates data.

Option B — self-contained PostgreSQL for development and tests:

```bash
cd backend
node tests/pgServer.js        # keeps running on port 55432
# in another terminal, with DATABASE_URL pointing at it:
# postgres://postgres:postgres@127.0.0.1:55432/bilbilash_alumni?sslmode=disable
npm run init-db
```

### 5. Start the backend

```bash
cd backend
npm run dev        # node --watch src/server.js  → http://localhost:5000
```

Verify it is healthy: `GET http://localhost:5000/api/health` should report `database: "connected"`.

### 6. Start the frontend

```bash
cd frontend
npm run dev        # Vite dev server → http://localhost:5173
```

The Vite dev server proxies `/api` and `/uploads` to `http://localhost:5000` (see `frontend/vite.config.js`), so no `VITE_API_BASE` is needed locally. If the backend is not running, the proxy answers an explicit `503` with a readable message instead of an opaque error.

### 7. Local URLs

| Service | URL |
|---|---|
| Frontend | http://localhost:5173 |
| Backend API | http://localhost:5000 |
| Health check | http://localhost:5000/api/health |

Sign in with the `AUTHORITY_EMAIL` / `AUTHORITY_PASSWORD` from `backend/.env` to reach the admin area, then approve newly registered members.

### 8. Optional: demo data

```bash
cd backend
npm run seed-demo        # creates documented demo members through the real APIs
npm run seed-demo -- --cleanup
```

Demo records use the `demo.*@bilbilash.demo` email pattern and `DEMO-` registration prefix; the cleanup command removes only those rows.

---

## Environment Variables

### Backend (`backend/.env`)

| Variable | Purpose | Required |
|---|---|---|
| `DATABASE_URL` | Full PostgreSQL connection string (Supabase pooler URI in production, `sslmode=require`) | Yes, unless `DB_*` is used |
| `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` | Individual connection settings for a local PostgreSQL server | Only without `DATABASE_URL` |
| `DB_SSL` | Force TLS for `DB_*` connections (`true`) | No |
| `PORT` | API port (default `5000`; set automatically by Render) | No |
| `JWT_SECRET` | Secret used to sign JWTs (long random string) | Yes |
| `JWT_EXPIRES_IN` | Token lifetime (default `1d`) | No |
| `CORS_ORIGINS` | Comma-separated allowed browser origins, e.g. `https://your-app.vercel.app` | Recommended in production |
| `AUTHORITY_EMAIL` | Email of the seeded Authority account | Yes |
| `AUTHORITY_PASSWORD` | Password of the seeded Authority account | Yes |
| `EMAIL_PROVIDER` | `resend` \| `brevo` \| `sendgrid` — HTTPS email API for OTP delivery | No |
| `EMAIL_API_KEY` | API key for the selected email provider | With `EMAIL_PROVIDER` |
| `EMAIL_FROM` | Verified sender address | With `EMAIL_PROVIDER` |
| `EMAIL_HOST`, `EMAIL_PORT`, `EMAIL_USER`, `EMAIL_APP_PASSWORD` | SMTP transport used when no provider is configured (local development) | No |
| `ALLOW_DEV_OTP` | Development-only: include the reset OTP in the API response. Never enable in production | No |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Supabase Storage credentials (server-only secret) | For production uploads |
| `UPLOAD_STORAGE` | Explicit storage driver: `local` \| `supabase` \| `cloudinary` | No |
| `CLOUDINARY_URL` | Alternative upload driver (`cloudinary://key:secret@cloud`) | No |
| `BKASH_NUMBER`, `NAGAD_NUMBER`, `ROCKET_NUMBER` | Association's receiving mobile-wallet numbers (11 digits starting `01`) | Recommended for payments |
| `PAYMENT_BKASH_APP_URL`, `PAYMENT_NAGAD_APP_URL`, `PAYMENT_ROCKET_APP_URL` | Official app deep links, only if a provider ever publishes one (currently none) | No |
| `BANK_NAME`, `BANK_ACCOUNT_NAME`, `BANK_ACCOUNT_NUMBER` | Bank transfer account shown to members; bank transfers stay disabled until all three are set | No |
| `BANK_BRANCH_NAME`, `BANK_ROUTING_NUMBER`, `BANK_INSTRUCTIONS` | Optional additional bank details / note | No |
| `SERVE_FRONTEND_DIR` | Optional single-service mode: path to the built frontend (`../frontend/dist`) | No |

### Frontend (`frontend/.env`)

| Variable | Purpose | Required |
|---|---|---|
| `VITE_API_BASE` | Absolute backend origin for split deployments, e.g. `https://your-api.onrender.com`. Leave empty for same-origin/local proxy | Only for split deployments |

`VITE_*` values are embedded in the public bundle at build time — never place secrets there.

---

## Database Overview

PostgreSQL is the only supported database. The schema lives in `database/schema.postgresql.sql` and is applied by `npm run init-db`.

The schema contains 21 tables:

| Area | Tables |
|---|---|
| Identity | `roles`, `users`, `profiles`, `password_resets` |
| Community | `jobs`, `job_applications`, `visions`, `help_requests`, `events`, `event_registrations`, `notices`, `polls`, `poll_options`, `poll_votes`, `gallery`, `teachers` |
| Engagement | `notifications` |
| Finance | `payments`, `monthly_payment_details`, `member_monthly_rates` |
| Administration | `audit_logs` |

Key relationships (all foreign keys declared in the schema):

```mermaid
erDiagram
  ROLES ||--o{ USERS : assigns
  USERS ||--o| PROFILES : has
  USERS ||--o{ PAYMENTS : makes
  PAYMENTS ||--o{ MONTHLY_PAYMENT_DETAILS : settles
  USERS ||--o{ MONTHLY_RATES : "rate history"
  EVENTS ||--o{ EVENT_REGISTRATIONS : lists
  USERS ||--o{ EVENT_REGISTRATIONS : registers
  JOBS ||--o{ JOB_APPLICATIONS : receives
  POLLS ||--o{ POLL_OPTIONS : offers
  POLLS ||--o{ POLL_VOTES : collects
  USERS ||--o{ NOTIFICATIONS : receives
```

Design points worth knowing:

- `monthly_payment_details` is written **only** when a payment is approved, so a pending payment can never mark a month as paid.
- `member_monthly_rates` is append-only; each row is effective from `effective_month` until the next row, which keeps historical dues at their historical rates.
- `payments.transaction_id` is unique, preventing duplicate submissions.
- Connection handling is centralized in `backend/src/db/pool.js`: TLS is derived from the connection string, MySQL-style `?` placeholders are translated for PostgreSQL, and dates are returned as strings for stable API output.

---

## API Overview

Base path: `/api`. All responses use a `{ success, message?, data }` envelope. Except for the endpoints marked public, requests require `Authorization: Bearer <token>` from an approved account.

| Group | Mount | Purpose | Access |
|---|---|---|---|
| Health | `/api/health` | API and database status | Public |
| Auth | `/api/auth` | Register, login, logout, `me`, forgot-password → verify-otp → reset-password, change-password | Public / authenticated |
| Users | `/api/users` | Pending list, all users, approve/reject/deactivate, delete, promote/demote admin, audit log, member detail | Admin (promote/demote and audit: Authority) |
| Profile | `/api/profile` | Read and update own profile | Authenticated |
| Directory | `/api/directory` | Alumni listing and full profile | Listing public, profile approved-only |
| Jobs | `/api/jobs` | Post and manage jobs, apply, track applications, moderate | Signed-in members (moderate/delete: Admin) |
| Visions | `/api/visions` | Submit ideas, approve/reject | List public, submit Member, moderate Admin |
| Help requests | `/api/help` | Create, list, change status, delete | List public, create Member, status by owner (resolve/close) or Admin, delete Admin |
| Events | `/api/events` | List, details, register/unregister, create, cancel, registrant list | Signed-in members (register: Member; management & registrants: Admin) |
| Notices | `/api/notices` | Noticeboard read, create, archive, delete | Read public, manage Admin |
| Notifications | `/api/notifications` | List, unread count, mark read, delete | Authenticated |
| Polls | `/api/polls` | List, create, vote, close, delete | List public, vote Member, manage Admin |
| Gallery | `/api/gallery` | List, upload, approve/reject, delete | List public, upload Member, moderation Admin |
| Teachers | `/api/teachers` | Teacher archive CRUD | Read public, manage Admin |
| Blood | `/api/blood` | Donor summary and search | Public |
| Payments | `/api/payments` | Providers, manual submission, own history, monthly status, member summary, admin review | Approved members (review: Admin) |
| Contributions | `/api/contributions` | Own rate and ledger, allocation preview, member-wise due report, per-member rate/start | Approved members (reports & settings: Admin) |
| Stats | `/api/stats` | Dashboard overview counters | Admin |
| Analytics | `/api/analytics` | Financial, alumni, donor, help, community analytics | Approved members (staff see more) |

Uploaded images are served from `/uploads/<filename>` in development; in production they are absolute Supabase Storage URLs.

---

## Testing

The backend ships with Node.js test suites (no external test framework). Most suites start the Express app in-process and run against a real PostgreSQL database.

```bash
cd backend
npm run <script>
```

| Script | File | Area covered |
|---|---|---|
| `smoke-test` | `tests/smokeTest.js` | End-to-end API: auth, roles, approvals, modules, manual payments |
| `contribution-test` | `tests/contributionTest.js` | Contribution rates, ledger building, oldest-first allocation, HTTP flows |
| `payment-methods-test` | `tests/paymentMethodsTest.js` | Four payment methods, provider links, bank gating, review workflow |
| `event-reg-test` | `tests/eventRegViewerTest.js` | Event registrant list and authorization |
| `teacher-update-test` | `tests/teacherUpdateTest.js` | Teacher updates and photo replacement |
| `profile-test` | `tests/profileCompletionTest.js` | Profile completion rules |
| `otp-flow-test` | `tests/otpFlowTest.js` | Password-reset OTP lifecycle |
| `otp-delivery-test` | `tests/otpDeliveryTest.js` | OTP email provider/SMTP delivery paths |
| `upload-test` | `tests/uploadStorageTest.js` | Upload validation and storage drivers |
| `authority-init-test` | `tests/authorityInitTest.js` | Authority seeding and recovery |
| `supabase-test` | `tests/supabaseStorageTest.js` | Supabase Storage integration (needs Supabase credentials) |
| `demo-e2e` | `tests/demoE2E.js` | End-to-end flows on demo data |

Prerequisites and safety:

- A running backend on `http://localhost:5000` for the HTTP-based suites (`smoke-test`, `demo-e2e`), and a local PostgreSQL database configured in `backend/.env`.
- The test helper **refuses to run against a remote database** unless `ALLOW_REMOTE_TESTS=1` is set explicitly, because suites create and delete fixture rows.
- Suites clean up their own fixtures before and after running.

Frontend checks:

```bash
cd frontend
npm run build      # production build; also the only automated frontend check at present
```

The tests were not executed as part of writing this README (they create and delete database rows); run them locally against a disposable database.

---

## Deployment

The reference deployment is split: static frontend on Vercel, API on Render, database and object storage on Supabase. No deployment configuration is changed by this documentation.

### Frontend — Vercel

| Setting | Value |
|---|---|
| Root Directory | `frontend` |
| Install Command | `npm install` |
| Build Command | `npm run build` |
| Output Directory | `dist` |
| Environment Variable | `VITE_API_BASE=https://<your-service>.onrender.com` |

`frontend/vercel.json` rewrites all paths to `index.html`, so deep links such as `/admin` or `/notifications` survive a page refresh. Because `VITE_API_BASE` is captured at build time, changing the API URL requires a redeploy.

### Backend — Render

| Setting | Value |
|---|---|
| Root Directory | `backend` |
| Runtime | Node |
| Build Command | `npm install` |
| Start Command | `npm start` (`node src/server.js`) |
| Health Check Path | `/api/health` |

Set the environment variables from the [table above](#environment-variables) in the Render dashboard (database URL, JWT secret, Authority credentials, CORS origin, and optionally email/storage/payment configuration). The process listens on `process.env.PORT`.

After the first deploy, initialize the schema and Authority account once from the service shell:

```bash
npm run init-db
```

If a password change is needed later without touching other users, `npm run authority:set-password` updates only the Authority account and invalidates its old sessions.

### Database and storage — Supabase

- Use the **pooler connection string** for `DATABASE_URL` (typically port `6543` with `sslmode=require`); the backend derives TLS from the URL.
- Object storage uses two public buckets: `profile-images` (member avatars and teacher photos, 1 MB limit) and `gallery-images` (gallery photos, 3 MB limit). Uploads always pass through the backend with the server-only service-role key.
- The backend's local `uploads/` directory is ephemeral on Render; production images must be in object storage.

After a schema change, apply the migration scripts relevant to it (for example `npm run migrate:payment-methods` for the bank payment method) before or immediately after deploying the new code.

---

## Future Improvements

These are proposals, not implemented features:

- Replace manual payment submission with a provider checkout/verification integration (bKash Tokenized Checkout and equivalent gateways) behind the existing provider abstraction.
- Email or SMS reminders for outstanding monthly contributions.
- Server-side pagination and deeper filtering on large admin lists.
- Automated backup/restore drills and a documented disaster-recovery runbook.
- A CI workflow that runs the existing test suites and the production build on every pull request.
- Frontend component tests and end-to-end browser tests.
- Exportable reports (CSV/PDF) for the treasurer.

---

## License

This repository does not include a `LICENSE` file. No license has been granted yet; add one (for example MIT or Apache-2.0) if the project is to be distributed or reused.

---

## Further Documentation

| File | Contents |
|---|---|
| [GUIDE.md](GUIDE.md) | Detailed operational guide (Bengali): database migration, Render/Vercel deployment, storage, payments |
| [FORGOT_PASSWORD_SETUP.md](FORGOT_PASSWORD_SETUP.md) | Email/OTP configuration for password reset |
| [PROJECT_GUIDE.md](PROJECT_GUIDE.md) | Extended project walkthrough |
| [PROJECT_STATUS.md](PROJECT_STATUS.md), [CHANGELOG.md](CHANGELOG.md) | Project status notes and change history |
| [LOCAL_SETUP.md](LOCAL_SETUP.md) | Early beginner setup notes, written before the PostgreSQL migration — partly historical |
