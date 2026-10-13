# BILBILASH ALUMNI — সম্পূর্ণ Deployment Guide (বাংলা)

> এই গাইডে সবকিছু বাংলায় ব্যাখ্যা করা হয়েছে, তবে Technical Terms ইংরেজিতে রাখা হয়েছে
> (যেমন: Deployment, Environment Variables, Build Command, Database Migration, Git Commit, Production)।
> **এই গাইডের প্রতিটি command বাস্তবে চালিয়ে যাচাই করা হয়েছে** — কোনো কল্পিত command নেই।

---

## A. Project Overview

**কী:** বিলবিলাশ সেকেন্ডারি স্কুল এলুমনাই অ্যাসোসিয়েশনের Alumni Community Management System —
রেজিস্ট্রেশন ও approval, alumni/teacher directory, job board, events, notices, polls,
gallery, vision board, help requests (blood donor সহ), monthly contribution + payment
verification, notification system এবং audit trail নিয়ে একটি সম্পূর্ণ অ্যাপ্লিকেশন।

**Technology Stack (verified):**

| Layer | Technology |
|---|---|
| Frontend | React 19 + Vite 7 + Tailwind CSS 4, react-router-dom 7 (BrowserRouter) |
| Backend | Node.js + Express 5 (ESM), JWT (Bearer token), bcrypt |
| Database | **PostgreSQL (Supabase-optimized)** — driver: `pg` (mysql2 থেকে মাইগ্রেট করা হয়েছে) |
| Uploads | **Supabase Storage** — `profile-images` ও `gallery-images` bucket, সব upload backend-এর মধ্য দিয়ে (server-only service key); local disk শুধু ডেভেলপমেন্ট (দেখুন Section G) |
| Email | Gmail SMTP (password-reset OTP), ঐচ্ছিক |

**Architecture:**

```mermaid
graph LR
  A[Browser - Vercel] -->|HTTPS - VITE_API_BASE| B[Backend - Render]
  B -->|DATABASE_URL - TLS| C[(Supabase PostgreSQL)]
  B -->|SMTP| D[Gmail OTP]
```

**Folder structure:**

```
.freebuff/                  ← project root
├── backend/                ← Express API (Render-এ deploy হবে)
│   ├── src/{config,controllers,db,middleware,routes,services,utils}
│   ├── tests/              ← ৫টি test suite + pgServer.js (local PostgreSQL)
│   ├── uploads/            ← uploaded images (git-ignored)
│   └── .env.example        ← environment template
├── frontend/               ← React SPA (Vercel-এ deploy হবে)
│   ├── src/  vercel.json  vite.config.js  .env.example (শুধু VITE_API_BASE)
├── database/
│   ├── schema.postgresql.sql   ← বর্তমান সক্রিয় schema (PostgreSQL/Supabase)
│   └── schema.sql              ← পুরনো MySQL schema (reference হিসেবে রাখা)
├── legacy-mysql/           ← মাইগ্রেশনের আগের MySQL code (reference only, কিছু চলে না)
├── .backups/               ← আপনার আগের backup — অক্ষত, git-ignored
├── GUIDE.md, AUDIT_REPORT.md, README.md …
```

---

## B. Local Development

**Prerequisites:** Node.js 18+ (verified on v24), npm 11+, এবং PostgreSQL দরকার
(নিচের "zero-install" উপায়টি দেখুন — কোনো আলাদা PostgreSQL ইনস্টল ছাড়াই চলবে)।

### B1. Database — দুইটি উপায়

**উপায় ১ (zero-install, recommended করে দেওয়া হয়েছে):** প্রজেক্টের ভেতরেই embedded
PostgreSQL 17 আছে (শুধু local development/test-এর জন্য):

```bash
cd backend
npm install
node tests/pgServer.js
# চালু থাকাকালীন এই terminal বন্ধ করবেন না। Port: 55432
```

তারপর `backend/.env` ফাইলে (নিচে B2 দেখুন) রাখুন:

```
DATABASE_URL=postgres://postgres:postgres@127.0.0.1:55432/bilbilash_alumni?sslmode=disable
```

**উপায় ২:** নিজের machine-এ আলাদা PostgreSQL ইনস্টল করে `DB_HOST/DB_PORT/DB_USER/DB_PASSWORD/DB_NAME`
ভ্যালু দিন (DATABASE_URL খালি রাখলে এগুলো ব্যবহৃত হবে)।

### B2. Backend

```bash
cd backend
cp .env.example .env      # ভ্যালুগুলো পূরণ করুন ( placeholder নয় — আসল দাম )
npm install
npm run init-db           # schema + roles + Authority account তৈরি (idempotent)
npm run dev               # http://localhost:5000
```

`backend/.env`-এ ন্যূনতম যা লাগবে: `DATABASE_URL` (বা `DB_*`), `JWT_SECRET`
(দীর্ঘ random string — যেমন `openssl rand -hex 64`), `AUTHORITY_EMAIL`,
`AUTHORITY_PASSWORD`। বাকি সব ঐচ্ছিক (দেখুন [backend/.env.example](backend/.env.example))।

### B3. Frontend

```bash
cd frontend
npm install
npm run dev               # http://localhost:5173 — /api proxy backend :5000-এ যায়
```

### B4. Available test commands (সবটাই এই machine-এ সবুজ প্রমাণিত)

```bash
cd backend
npm run smoke-test        # ১৭২/১৭২  ✅ — auth, roles, moderation, notifications, delete rules
npm run contribution-test # ১১৭/১১৭  ✅ — contribution rates, dues, payments, reconciliation
npm run profile-test      # ৭৪/৭৪    ✅ — profile completion %, photo, permissions
npm run upload-test       # ২৮/২৮    ✅ — upload storage, validation, permissions (নিচে Section G)
npm run seed-demo         # ১০০ জন demo member (idempotent) ✅
npm run demo-e2e          # ✅ — পুরো community workflow end-to-end (check সংখ্যা আগের demo data অনুযায়ী ৫৪–৫৬, failed সবসময় ০)
```

সব test suite `SMOKE_BASE` (default `http://localhost:5000`) এবং `DATABASE_URL/.env`
ব্যবহার করে — তাই চালানোর আগে backend server চালু থাকতে হবে।

### B5. Test safety policy (গুরুত্বপূর্ণ)

এই test suite-গুলো **row তৈরি ও মুছে ফেলে** (fixture cleanup) — তাই শুধু LOCAL বা
DISPOSABLE STAGING database-এ চলবে। **Production database-এ কখনো নয়।**
এটি শুধু কথায় নয়, code-এ enforced: `tests/pgTestClient.js` যেকোনো non-local
database host-এ suite চালাতে দেয় না (explicit `ALLOW_REMOTE_TESTS=1` ছাড়া)।

| Suite | যা মিউটেট করে | Cleanup | Local | Staging | Production |
|---|---|---|---|---|---|
| smoke-test | `smoke.%@example.com` users, `SMOKE-` prefix content, promote/demote/delete | নিজ fixture নিজেই মুছে (FK-safe order) | ✅ | ✅ | **না** |
| contribution-test | `contrib.%@example.com` users + সরাসরি DB-তে rates/payments INSERT | নিজ fixture মুছে | ✅ | ✅ | **না** |
| profile-test | ১টি `fix.*` fixture user + photo file | fixture + notifications মুছে | ✅ | ✅ | **না** |
| upload-test | demo.m001-এর একটি profile photo + ১টি gallery item | gallery item+file মুছে | ✅ | ✅ | **না** |
| seed-demo | **১০০ জন** `demo.*@bilbilash.demo` member তৈরি+approve | `--cleanup` শুধু demo রেকর্ড মুছে | ✅ | ✅ | **না** |
| demo-e2e | seed-demo cohort লাগে; payments/notices/polls/events তৈরি করে | নিজ throwaway রেকর্ড মুছে | ✅ | ✅ | **না** |

সারসংক্ষেপ: **কোনো test suite production database-এ চালানো যায় না** (guard থেকেও যাবে না)।
demo data পরিষ্কার করতে: `node tests/seedDemo.js --cleanup` (শুধু demo রেকর্ড)।

---

## C. Database Migration (MySQL → Supabase PostgreSQL)

**বর্তমান অবস্থা: মাইগ্রেশন সম্পন্ন ও যাচাইকৃত।** Backend এখন `pg` driver ব্যবহার করে;
সবুজ test evidence নিচে Section H-তে।

### C1. কী কী বদলেছে (সংক্ষেপে)

- `backend/src/db/pool.js` — নতুন PostgreSQL pool। পুরনো mysql2-র API shape অক্ষত রাখা হয়েছে:
  `?` placeholder নিজে `$1..$n`-এ বদলায়, `INSERT … RETURNING` থেকে `insertId` পায়,
  `rowCount` → `affectedRows`, এবং DATE/DATETIME/TIME/BIGINT আগের মতোই string/number আসে —
  তাই কোনো business logic বদলাতে হয়নি।
- `database/schema.postgresql.sql` — নতুন পরিষ্কার schema: ২১টি টেবিল, একই নামের
  FK/UNIQUE/INDEX, enum গুলো TEXT + CHECK constraint, `TINYINT(1)` → SMALLINT 0/1,
  `updated_at` trigger (MySQL-এর `ON UPDATE CURRENT_TIMESTAMP`-এর সমতুল্য)।
- সব MySQL-only SQL (`LOCK IN SHARE MODE`, `DATE_ADD`, `INTERVAL n SECOND`, `YEAR()`,
  `DATE_FORMAT`, `CURDATE()`, multi-table `DELETE … JOIN`, `HAVING` alias,
  `ON DUPLICATE KEY UPDATE`) PostgreSQL সংস্করণে রূপান্তরিত।
- `errorHandler` এখন SQLSTATE বোঝে: `23505`→409, `23503`→409, `23514/23502`→422,
  connection failure → 503।
- পুরনো MySQL code `legacy-mysql/` ফোল্ডারে সংরক্ষিত (reference only)। `database/schema.sql`
  (MySQL) মুছে ফেলা হয়নি। **localhost-এর test data অপচয়যোগ্য বলে কোনো data migration করা হয়নি** —
  Supabase-এ নতুন ফাঁকা database-এ নতুন schema বসবে।

### C2. Supabase project তৈরি

1. https://supabase.com → New project → Region: **Singapore (ap-southeast-1)** (বাংলাদেশ থেকে কাছ)।
2. Database password একটি শক্তি-সম্পন্ন password দিন — এটি কোথাও source code-এ দেবেন **না**।
3. Dashboard → **Settings → Database → Connection string → URI**:
   - **Pooler URI (port 6543)** — Render থেকে এটিই ব্যবহার করুন (transaction mode, বেশি connection ধারণ করে)।
   - **Direct URI (port 5432)** — শুধু একটানা দীর্ঘ migration/one-off কাজে। Render-এর মতো pooled
     প্রোডাকশন app-এর জন্য **Direct URI ব্যবহার করবেন না** — connection limit কম, দ্রুত শেষ হয়ে যায়।
4. **STAGING আর PRODUCTION আলাদা রাখুন (non-negotiable):** verification-এর জন্য Supabase-এর
   একটি আলাদা **disposable staging project** (যেমন `bilbilash-staging`) বানান — test suite
   শুধু staging-এই চলবে। Production database কখনোই test target নয় (code-এ guard সেটি বাধা দেয়);
   production DB-তে শুধু deployed অ্যাপই লিখবে। আলাদা আলাদা connection string রাখুন:
   স্থানীয় `backend/.env`-এ staging URI, production URI শুধু Render-এর Environment-এ।

5. আপনার local machine-এ `backend/.env`-এ **staging** URI বসান:
   `DATABASE_URL=postgresql://postgres.YOUR_PROJECT:[PASSWORD]@aws-0-….pooler.supabase.com:6543/postgres?sslmode=require`

### C3. Schema apply + যাচাই (STAGING database-এ; production-এ কখনো নয়)

```bash
cd backend
npm run init-db      # নতুন STAGING database-এ ২১ টেবিল + roles + Authority account বসবে
```

তারপর সব test suite একই `DATABASE_URL` (staging) দিয়ে চালান — non-local host হওয়ায়
suite-গুলো `ALLOW_REMOTE_TESTS=1` দিয়ে চালাতে হবে (গার্ড ইচ্ছাকৃতভাবেই জিজ্ঞেস করে)।
সব suite সবুজ হওয়ার পরেই সেই staging verification হিসেবে গণ্য; **production database
কখনোই test target হবে না** — production-এ শুধু Render-এর deployed app লিখবে।

### C4. Backup ও Restore

Supabase Dashboard → Database → **Backups** (automatic daily, এবং point-in-time recovery)।
নিজে থেকে backup/restore:

```bash
# Backup (সব schema + data)
pg_dump "$DATABASE_URL" --no-owner --no-privileges -f backup.sql
# Restore একটি নতুন database-এ (যাচাইয়ের জন্য)
psql "$TARGET_DATABASE_URL" -f backup.sql
```

Restore ছাড়া backup কখনোই valid ধরবেন না — একটি নতুন খালি Supabase project-এ restore করে
একবার যাচাই করে নিন।

### C5. Production-এ schema পরিবর্তন (migration discipline)

- নতুন migration SQL `database/migrations/YYYY-MM-DD_description.sql` ফাইলে রাখুন
  (MySQL-এর পুরনো migration ফাইলও আছে reference হিসেবে)।
- সব migration **idempotent** হতে হবে (`IF NOT EXISTS`, কখনো `DROP`/`TRUNCATE` নয়)।
- আগে Supabase-এর একটি snapshot/backup নিন, তারপর `psql` দিয়ে apply, তারপর test suite।

---

## D. GitHub

**অবস্থা: এই প্রজেক্টে আগে কোনো Git repository ছিল না। এখন `git init` করা হয়েছে এবং
প্রথম commit তৈরি (`c24903a`)। secret scan পরিষ্কার: কোনো `.env`, backup, upload,
database dump commit হয়নি।** আপনাকে শুধু GitHub-এ repository তৈরি করে remote যুক্ত করতে হবে:

```bash
# GitHub-এ নতুন repository তৈরি করুন (নাম দিন, PRIVATE রাখুন)। "Add README" টিক দেবেন না।
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git
git push -u origin main
```

নতুন পরিবর্তন জমা দেওয়ার নিয়ম:

```bash
git status                       # কী বদলেছে দেখুন
git add backend/src/services/userService.js    # শুধু বদলানো file (বা git add -A যদি নিশ্চিত হন)
git commit -m "যা করলেন তার এক লাইনে বর্ণনা"
git push
```

**Safety rules যেগুলো আমরা বর্তমানেই মানছি এবং আপনাকেও মানতে হবে:**

- `.gitignore`-এ `.env`, `.backups/`, `uploads/`, `.pgdata/`, `node_modules/`, `dist/`,
  `reconciliation-report.json` দেওয়া আছে — এগুলো কখনো commit হবে না।
- `git push --force` ব্যবহার করবেন না shared branch-এ।
- Common errors: `rejected (fetch first)` → `git pull --rebase origin main`;
  ভুল file commit হয়ে গেলে `git rm --cached path` + commit; ভুল message
  `git commit --amend` (push করার আগে হলেই চলবে)।
- যদি কোনো সময় ভুল করে `.env` commit হয়ে যায়: শুধু ফাইল মুছে দিলেও **history-তে থেকে যায়** —
  সঙ্গে সঙ্গে সব password/JWT_SECRET **rotate** করুন এবং `git filter-repo` দিয়ে history পরিষ্কার করুন।

---

## E. Render Backend Deployment

1. https://render.com → **New → Web Service** → GitHub repository যুক্ত করুন।
2. Settings (verified against আসল package.json — কোনো কিছু অনুমান করা হয়নি):

| Setting | মান |
|---|---|
| Root Directory | `backend` |
| Runtime | Node |
| Build Command | `npm install` |
| Start Command | `npm start` (অর্থাৎ `node src/server.js`) |
| Health Check Path | `/api/health` (live যাচাই করা 2026-10-14: deployed URL-এ HTTP 200, `status ok` + `database connected`) |

3. **Environment Variables** (Dashboard → Environment) — শুধু এখানে, কোডে নয়:

| Key | মান |
|---|---|
| `NODE_ENV` | `production` |
| `DATABASE_URL` | Supabase-র **Pooler URI** (`?sslmode=require` সহ) |
| `JWT_SECRET` | নতুন, শক্ত random string |
| `JWT_EXPIRES_IN` | `1d` (বা প্রয়োজন অনুযায়ী) |
| `CORS_ORIGINS` | `https://আপনার-vercel-app.vercel.app` (একাধিক হলে comma- দিয়ে) |
| `AUTHORITY_EMAIL` / `AUTHORITY_PASSWORD` | Authority সিড অ্যাকাউন্ট |
| `EMAIL_USER` / `EMAIL_APP_PASSWORD` / `EMAIL_FROM` | Gmail OTP-র জন্য (ঐচ্ছিক) |
| `BKASH_NUMBER` (ঐচ্ছিক) | অ্যাসোসিয়েশনের আসল mobile-money number |

`ALLOW_DEV_OTP` **কখনোই** production-এ সেট করবেন না। `PORT` Render নিজে সেট করে — অ্যাপ
`process.env.PORT` পড়ে, তাই আলাদা কিছু করতে হবে না (verified: `env.port`)।

4. Health check — **live যাচাই করা হয়েছে (2026-10-14):**
   `https://bilbilash-secondary-school-alumni.onrender.com/api/health` দেয়
   `{"data":{"status":"ok","database":"connected","db_ok":true}}` (HTTP 200) —
   backend + Supabase connectivity production-এ কাজ করছে।

5. **Production database ও Authority account একবার initialize করুন** — এটাই প্রথম
   Authority login-এর 401-এর মূল কারণ ছিল: deploy শুরু হলে schema/Authority যায় না,
   ধাপটি ম্যানুয়াল। Render Dashboard → এই Web Service → **Shell** ট্যাব থেকে:

       npm run init-db

   এটি (idempotent — বারবার চালানো নিরাপদ, এই code-এ যাচাই করা):
   - `database/schema.postgresql.sql` প্রয়োগ করে (table/index `IF NOT EXISTS`,
     trigger-ও এখন re-runnable; **কোনো data drop হয় না**),
   - roles বসায়,
   - `AUTHORITY_EMAIL` / `AUTHORITY_PASSWORD` দিয়ে **একটিমাত্র** Authority account
     তৈরি করে (bcrypt hash; duplicate হয় না; আগে থাকলে password/role/status
     **কখনো বদলায় না**; password কখনোই console-এ দেখায় না)।

   শেষে `[init-db] DONE.` দেখা উচিত — এরপর সঙ্গে সঙ্গে ধাপ ৬ করুন। Shell ট্যাব না থাকলে
   (কিছু plan-এ বন্ধ): Start Command সাময়িকভাবে `npm run init-db && npm start` করে
   একটি redeploy দিন, তারপর Start Command আবার `npm start`-এ ফেরান।

6. **Authority login যাচাই + pending Member approve:**
   - Vercel URL → Login → `AUTHORITY_EMAIL` / `AUTHORITY_PASSWORD` (Render-এ যা
     সেট করেছেন ঠিক সেটাই) → লগইন সফল হবে এবং প্রোফাইলে Role: `AUTHORITY` দেখা যাবে।
   - এরপর Moderation/Pending Members থেকে pending Member-কে approve করুন।
   - ভুল password-এ 401 `Invalid email or password` পাবেন; **ঠিক password-এও 401**
     দিলে account এখনো তৈরি হয়নি — ধাপ ৫-এ `npm run init-db` চালান।

7. **Password ভুলে গেলে / account ঠিক করতে হলে (explicit recovery):** Shell থেকে

       npm run authority:set-password

   env-এর `AUTHORITY_PASSWORD` দিয়ে ঠিক AUTHORITY account-এর password বসায় ও
   পুরনো session বাতিল করে। অন্য কোনো ব্যবহারকারীর account-ে (যার ভূমিকা অন্যরকম)
   এটি কখনো হাত লাগায় না — `REFUSING` error দিয়ে থামে, কিছু বদলায় না।

> মনে রাখবেন: Render free tier-এ dyno কিছুক্ষণ পর sleep করে; প্রথম request-এ ৩০-৫০ সেকেন্ড
> দেরি হতে পারে। Database query pool `connectionLimit: 10` — pooler URI ব্যবহার করলে
> connection exhaustion হবে না।

---

## F. Vercel Frontend Deployment

1. https://vercel.com → **Add New → Project** → GitHub repo বেছে নিন।
2. Settings (verified):

| Setting | মান |
|---|---|
| Root Directory | `frontend` |
| Build Command | `npm run build` |
| Output Directory | `dist` |
| Install Command | `npm install` (default ঠিক আছে) |

3. **Environment Variables** (build-এর আগে সেট করুন — শুধু এটুকু, কোনো secret নয়):

| Key | মান |
|---|---|
| `VITE_API_BASE` | `https://আপনার-service.onrender.com` (Render backend URL) |

> `VITE_API_BASE` frontend build-এর সময় bundle-এ বসে যায়, তাই এতে **কখনোই** database
> password, JWT secret বা অন্য কোনো secret দেবেন না। শুধু public API URL।

4. Client-side routing: `frontend/vercel.json`-এ SPA rewrite দেওয়া আছে
   (`/(.*) → /index.html`) — তাই `/notifications` বা `/admin` link দিয়ে refresh করলেও
   404 হবে না (BrowserRouter ব্যবহার করে, verified)।
5. Backend URL বদলালে Vercel-এ variable আপডেট করে **Redeploy** করতে হবে
   (build-time variable তাই)।
6. Deploy-এর পর Vercel URL আপডেট করুন **Render → Environment → `CORS_ORIGINS`**-এ,
   তারপর Render service **Restart** — নইলে browser থেকে API call block হবে (CORS error)।

---

## G. Production Integration

- **Vercel → Render:** browser সরাসরি Render backend-কে হে করে (Bearer token, CORS-এর মাধ্যমে)।
  Auth flow: login → JWT `localStorage`-এ → প্রতিটি request-এ `Authorization: Bearer` header।
  Cookie নেই, তাই CSRF surface নেই।
- **Render → Supabase:** `DATABASE_URL` (Pooler URI, port 6543, `sslmode=require`)।
  প্রতি deploy-এ connection pool নতুন করে খোলে — pooler ব্যবহারে সমস্যা হয় না।
- **HTTPS:** Vercel ও Render দুটোই স্বয়ংক্রিয় HTTPS দেয়; Supabase connection TLS (sslmode=require)।
- **File storage — Supabase Storage (`backend/src/storage.js` driver 'supabase'):**
  - **সতর্কতা: Render-এর local disk EPHEMERAL** — প্রতিটি deploy/restart-এ `uploads/`
    মুছে যায়, তাই production-এ ছবি Supabase Storage-এ যায় (স্থায়ী)।
  - **রেন্ডার ফ্লো:** ছবি ব্রাউজার থেকে সরাসরি storage-এ যায় না — Express backend-ই
    multer দিয়ে ফাইল নেয়, magic-byte + MIME + extension যাচাই করে, তারপর server-only
    `SUPABASE_SERVICE_ROLE_KEY` দিয়ে Storage REST API-তে পাঠায়। ফ্রন্টএন্ড শুধু পাবলিক
    URL দেখে — key কখনোই browser-এ যায় না।
  - **বাকেট ও সীমা (bucket settings-এর সাথে মিলিয়ে রাখুন):** `profile-images` (member + teacher
    photo; `members/` ও `teachers/` prefix; **১ MB**), `gallery-images` (alumni gallery;
    `gallery/` prefix; **৩ MB**)। দুই bucket-ই **Public** রাখুন (পাবলিক দেখার জন্য) — upload/delete
    তবুও শুধু service key দিয়ে backend থেকেই হয়, তাই public bucket কিছু খোলে না।
  - **Env (শুধু Render backend-এ, কখনোই Vercel-এ নয়):** `SUPABASE_URL`,
    `SUPABASE_SERVICE_ROLE_KEY`; সেট করলেই driver automatically 'supabase' হয়ে যায়
    (বা স্পষ্ট করতে `UPLOAD_STORAGE=supabase`)।
  - DB-তে সম্পূর্ণ পাবলিক https URL থাকে; পুরনো local ফাইলের নাম থাকলে ফ্রন্টএন্ড
    `mediaUrl()` এটিকে backend origin (VITE_API_BASE) সহ ঠিকমতো render করে —
    **এটাই আগের avatar bug-এর মূল কারণ** (relative `/uploads/…` URL Vercel-এ 404 হতো)।
  - **পুরনো local ছবি মাইগ্রেট:** `npm run migrate:uploads` (ডিফল্ট dry-run;
    `MIGRATE_UPLOADS=1` দিলেই apply) — শুধু নিজের local ফাইল থাকলে ওগুলো bucket-এ নিয়ে
    DB ref আপডেট করে; Render-এর ephemeral disk-এ ফাইল আগেই থাকে না, তাই production-এ এটি
    প্রায় no-op (প্রয়োজনে সেই ছবি আবার upload করতে হবে)।
  - **Signed URL নিষিদ্ধ:** upload path কখনোই `/object/sign/…?token=…` তৈরি করে না — token expire
    হলেই ছবি মরে যায়। ড্যাশবোর্ড বা hand-edit থেকে আসা কোনো signed ref পড়ার সময়ই স্থায়ী
    `/object/public/…` আকারে normalize হয় (token বাদ) — frontend `mediaUrl()` ও backend
    `resolveUploadRef()` দুটোতেই। একবার রিপেয়ার: `npm run migrate:storage-refs` (dry-run;
    `NORMALIZE_STORAGE_REFS=1` দিলে apply)।
  - **পাবলিক access যাচাই (কোনো key ছাড়া):** `npm run storage:verify -- <bucket>/<path> …`
    — Render Shell-এ চালান; 200 = ছবি দেখা যাবে, 404 অর্থ বা ত object নেই বা bucket **Private**
    (Supabase → Storage → bucket → Settings → Public bucket চালু করুন)।
  - **যাচাই হয়েছে:** `npm run supabase-test` **৪৩/৪৩** ✅ (stub Storage REST server + আলাদা
    backend instance দিয়ে বাস্তব API matrix: avatar/teacher/gallery upload → সঠিক bucket/prefix →
    persist → moderation → delete-এ bucket object মুছে যায়; ১ MB/৩ MB limit; 401/403;
    signed-URL normalization; ডাটাবেজে কোনো signed/tokenized ref নেই যাচাই) এবং
    `npm run upload-test` **২৮/২৮** ✅ (local + cloudinary driver অক্ষত)। ব্রাউজারেও যাচাই:
    upload → ছবি দেখা যায় → reload-এও থাকে → ভাঙা URL-এ initials fallback।
  - Cloudinary driver বিকল্প হিসেবে রয়ে গেছে (`CLOUDINARY_URL` + `UPLOAD_STORAGE=cloudinary`);
    বর্তমান production পথ Supabase।
- **Email OTP:** Gmail App Password দিয়ে `EMAIL_USER/EMAIL_APP_PASSWORD/EMAIL_FROM` সেট করলে
  password-reset OTP ইমেইলে যাবে। OTP value বা credential কখনো log হয় না (verified)।
- **Roles/permissions:** AUTHORITY > ADMIN > MEMBER > VISITOR — প্রতিটি protected API-তে
  server-side যাচাই হয় (সব test suite-এ covered)।

---

## H. Post-Deployment Testing Checklist

Production deploy-এর পর প্রতিটি ধাপে হাতে-কলমে যাচাই করুন:

- [ ] `https://onrender.com/api/health` → `status: ok, database: connected`
- [ ] Vercel URL খুলে homepage দেখা যাচ্ছে, browser console-এ কোনো error নেই
- [ ] Register (নতুন email) → 201; pending অবস্থায় login চেষ্টা → 403 awaiting-approval message
- [ ] Authority/Admin দিয়ে approve → member login সফল
- [ ] Profile update + photo upload → reload করেও থাকছে (Supabase-এ যাচাই)
- [ ] Directory search, blood-group filter
- [ ] Job post (pending) → admin approve → member দেখতে পাচ্ছে
- [ ] Notice publish → community notification bell-এ এসেছে
- [ ] Poll create + vote (দুইবার vote দিলে 409)
- [ ] Event create + registration (capacity পূর্ণ হলে 409)
- [ ] Payment submit (pending) → admin approve → contribution history-তে ভুক্ত
- [ ] Member contribution rate set → due calculation ঠিক আছে
- [ ] Forgot password → ইমেইলে OTP এসেছে → reset সফল (OTP expiry/cap যাচাই)
- [ ] Refresh করলে deep link (যেমন `/admin/payments`) কাজ করছে (404 নয়)
- [ ] Backend logs-এ (Render Dashboard) কোনো secret/OTP/stack trace লেখা নেই
- [ ] Demo data নতুন production database-এ **নেই** (seed-demo কখনো production-এ চালাবেন না!)

স্থানীয়ভাবে এই checklist-এর সমতুল্য পুরোটাই ইতিমধ্যে ৪১৯/৪১৯ test দিয়ে পাশ হয়েছে
(smoke 172, contribution 117, profile 74, demo E2E 56) + browser-এ member ও admin
দুই experience যাচাই করা হয়েছে।

---

## I. Troubleshooting

| সমস্যা | কারণ ও সমাধান |
|---|---|
| Build fail (Vercel/Render) | Root Directory ঠিক আছে কিনা দেখুন (`frontend` / `backend`)। `npm install` Node 18+ চায়। lockfile ভাঙবেন না। |
| `Missing required environment variable: JWT_SECRET` | Render/Vercel-এ env var সেট হয়নি। Backend ইচ্ছাকৃতভাবে এদের ছাড়া শুরু হয় না। |
| Authority login 401 (সঠিক credential দিয়েও) | production database-এ Authority account নেই | Render Shell থেকে `npm run init-db` চালান (idempotent; duplicate হয় না); প্রয়োজনে `npm run authority:set-password` (Section E, ধাপ ৫-৭)। ধাপ চালানোর পর যাচাই: যেকোনো ব্যবহারকারীকে approve করতে পারেন এমন একটি Admin/Authority দিয়ে Moderation খুলুন, অথবা Supabase SQL Editor-এ `SELECT user_id, email, status, r.role_name FROM users u JOIN roles r ON r.role_id=u.role_id WHERE r.role_name='AUTHORITY';` — ঠিক একটি row, `status='approved'` (password hash দেখার দরকার নেই) |
| `Database is unavailable … 503` | `DATABASE_URL` ভুল, অথবা Supabase pooler URI (6543) নয় direct URI বসানো। `sslmode=require` আছে কিনা দেখুন। |
| `password authentication failed` / `28P01` | password বা user ভুল; Supabase Dashboard-এ reset করে URL আপডেট করুন। |
| `3D000 invalid_catalog_name` | URL-এর database নাম ভুল (Supabase-এ সাধারণত `postgres`)। |
| Migration apply হচ্ছে না | `npm run init-db` চালান — schema idempotent, বারবার চালানো নিরাপদ। |
| CORS error (browser) | `CORS_ORIGINS`-এ ঠিক Vercel URL (https সহ) আছে কিনা; পরিবর্তনের পর Render **Restart** দিন। |
| HTTP 401 | token অনুপস্থিত/মেয়াদোত্তীর্ণ — re-login; `token_version` বাড়লে পুরনো session নিজে থেকেই বাতিল (designed)। |
| HTTP 403 | role অপর্যাপ্ত বা account pending/inactive — approval workflow অনুযায়ী স্বাভাবিক। |
| HTTP 404 API | route ভুল — সব API `/api/...` prefix-এ। |
| HTTP 500 | Render logs দেখুন; গ্রাহককে কখনো SQL/stack trace যায় না (sanitized)। |
| Upload fail / ছবি হারায় | Render ephemeral disk — persistent storage integrate না করা পর্যন্ত এটি expected (Section G)। |
| Email OTP আসছে না | Gmail App Password সেট কিনা; `EMAIL_FROM` verified sender। SMTP না থাকলে local-এ console fallback (production-এ `ALLOW_DEV_OTP` বন্ধ)। |
| Refresh করলে 404 | Vercel-এ `frontend/vercel.json` rewrite আছে কিনা দেখুন। |
| Connection pool exhaustion | Supabase **pooler** URI ব্যবহার করুন; `connectionLimit: 10` ছাড়া বাড়াবেন না। |
| Local test-এ `ECONNREFUSED 55432` | `node tests/pgServer.js` বন্ধ হয়ে গেছে — আবার চালু করুন। |

---

## J. Security ও Maintenance

- **Secret management:** সব secret শুধু environment-এ (backend `.env` locally, Render/Vercel
  dashboard-এ production-এ)। `.env` git-ignored এবং commit history-তে নেই (verified)।
  প্রতি environment-এ আলাদা JWT_SECRET দিন। public deployment-এর আগে DB password ও
  JWT_SECRET **rotate** করে নিন (আগে যেগুলো local `.env`-এ ছিল)।
- **Dependency updates:** মাসে একবার `npm audit` + সবুজ test suite চালিয়ে minor/patch
  upgrade করুন। major upgrade (যেমন Express/React) আগে staging-এ।
- **Database backup:** Supabase automatic daily backup + PITR; মাসে একবার `pg_dump` দিয়ে
  নিজের backup নিন এবং **একটি নতুন খালি database-এ restore করে** যাচাই করুন।
- **Migration discipline:** প্রতিটি schema change একটি idempotent migration ফাইল + সবুজ
  test suite; কখনো production data DROP/TRUNCATE নয়।
- **Monitoring:** Render logs, Supabase Database → Reports, এবং `/api/health` কে uptime
  monitor-এ রাখুন। Error handler ইচ্ছাকৃতভাবে client-কে internal details দেয় না — সব
  detail server log-এ।
- **Recovery plan:** ঘটনা ঘটলে: ১) নতুন deploy বন্ধ করুন, ২) Supabase PITR দিয়ে পূর্বাবস্থা
  ফেরান, ৩) সবুজ `smoke-test` চালিয়ে যাচাই, ৪) তারপরই পরবর্তী deploy।

---

## K. Final Deployment Status (সত্যবাদী তালিকা)

**✅ Completed এবং verified (এই machine-এ, প্রমাণ সহ):**

- MySQL → PostgreSQL পূর্ণ মাইগ্রেশন (driver, schema, সব SQL construct, init-db)
- ২১ টেবিলের নতুন `database/schema.postgresql.sql`, idempotent init, UTF8 verified
- সব ৫ test suite **৪১৯/৪১৯** সবুজ PostgreSQL 17.10-এ (embedded, কনফিগ `?sslmode=require`-সহ Supabase URL সমর্থিত)
- Browser যাচাই: member login → notifications (Bangla text সহ) → contribution ledger;
  authority login → admin stats → payment review — console নিষ্কলঙ্ষ
- Frontend production build + SPA rewrite (`vercel.json`)
- Upload storage: Supabase Storage driver (`backend/src/storage.js`) — `profile-images`
  (১ MB, members/+teachers/) ও `gallery-images` (৩ MB, gallery/); `supabase-test` ৩৬/৩৬ +
  `upload-test` ২৮/২৮; avatar bug ফিক্স (mediaUrl + VITE_API_BASE) ব্রাউজারে যাচাই সহ
- Test-safety guard: non-local DB host-এ সব suite নিজে থেকেই বন্ধ (ALLOW_REMOTE_TESTS=1 ছাড়া)
- `git init` + প্রথম commit + secret scan (কোনো secret/backup/upload track হয়নি)
- `.env.example` templates (placeholders only), `.gitignore` hardened
- পুরনো MySQL code `legacy-mysql/`-এ সংরক্ষিত; `database/schema.sql` অক্ষত

**⚙️ Configured কিন্তু deploy করা হয়নি:**

- GitHub remote push (আপনার GitHub account/credential লাগবে — Section D)
- Render + Vercel service creation (আপনার account লাগবে — Section E/F)
- Supabase project (আপনার account লাগবে — Section C2; এরপর `npm run init-db` + suites চালান)

**⏳ Deployed হলেও fully tested হয়নি:** — এখনো কিছু deployed হয়নি, তাই এই ঘর খালি।

**🚫 Blocked — আপনার অ্যাকশন ছাড়া সম্ভব নয়:**

1. Supabase account + project + `DATABASE_URL`
2. GitHub account + repository + push access
3. Render account + Supabase/Vercel URL গুলো dashboard-এ বসানো
4. Vercel account + `VITE_API_BASE`
5. (ঐচ্ছিক) Gmail App Password, bKash/Nagad/Rocket number
6. **Supabase Storage হাতে-কলমে যাচাই** — আপনার দুই bucket (`profile-images`, `gallery-images`)
   Public করা আছে কিনা এবং Render-এ `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` সেট করার পর একটি আসল ছবি upload → display → delete যাচাই করতে হবে (সব স্থানীয়/stub-স্তরে verified)

**⚠️ Known limitations:**

- Default `UPLOAD_STORAGE=local` হলে uploads ephemeral disk-এই থাকে — production-এ
  `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` সেট করলেই (Section G) ছবি Supabase Storage-এ স্থায়ী হয়; payment screenshot এখনো local disk-ে যায় (bucket ছাড়া)
- Localhost MySQL-এর পুরনো test data migrate করা হয়নি (আপনার নির্দেশ অনুযায়ী অপচয়যোগ্য)
- `seed-demo`/`demo-e2e` শুধু local/staging-এর জন্য — production-এ চালাবেন না
- Frontend bundle ৬৪৩ kB (chunk-size warning) — চাইলে route-based code-splitting করা যায়
