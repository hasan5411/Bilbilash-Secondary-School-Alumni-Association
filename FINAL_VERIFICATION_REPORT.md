# FINAL VERIFICATION REPORT — Bilbilash Alumni (PostgreSQL / Supabase-ready)

Date: 2026-10-13 · Scope: pre-push / pre-deployment review round
**Truthfulness rule applied throughout: "verified" means executed and observed on this machine.
Nothing is claimed as deployed — no cloud service has been deployed or connected.**

---

## 0. Deployment status (stated first, because it matters most)

| Service | Status |
|---|---|
| GitHub push | **NOT done** — repo + 3 local commits exist; push awaits explicit approval and your account |
| Render backend | **NOT deployed** — no Render service exists; `/api/health` verified only on the local backend (`localhost:5000`) |
| Vercel frontend | **NOT deployed** — no Vercel project exists; build verified locally only |
| Supabase | **NOT connected** — code path verified against a local PostgreSQL 17.10 (same engine family); awaits your staging project |
| Live URLs | **None exist.** Any document claiming otherwise is wrong. |

## 1. Test-script safety audit (item 1)

Every suite creates and deletes rows. **None may target a production database** — and this is
now enforced in code, not just documented: [pgTestClient.js](backend/tests/pgTestClient.js)
exits with a refusal message on any non-local database host unless `ALLOW_REMOTE_TESTS=1` is
set deliberately (verified: remote URL → refusal + exit 1; local → runs).

| Suite | Mutations | Cleanup | Empty-DB assumption | Local | Staging | Production |
|---|---|---|---|---|---|---|
| `smoke-test` | creates `smoke.%@example.com` users + `SMOKE-` content; promote/demote/delete flows | deletes own fixtures FK-safe; audit rows persist with NULLed actor | none — runs on any state | ✅ | ✅ | **forbidden** |
| `contribution-test` | `contrib.%@example.com` users; **direct DB INSERT**s of rates/payments/allocations | deletes own fixtures FK-safe | none | ✅ | ✅ | **forbidden** |
| `profile-test` | one `fix.*` user + photo file | removes fixture + its notifications + photo | none | ✅ | ✅ | **forbidden** |
| `upload-test` | one profile photo on demo.m001; one gallery item; direct DB read | deletes gallery item + file; photo replace is by-design | needs demo.m001 (run `seed-demo` first) | ✅ | ✅ | **forbidden** |
| `seed-demo` | **creates/approves up to 100 `demo.*@bilbilash.demo` members** via the real API | `--cleanup` removes only demo rows | idempotent, skips existing | ✅ | ✅ | **forbidden** |
| `demo-e2e` | **requires the seeded 100-member cohort** (fails fast, non-destructively if absent); creates payments (test + 30 manual), notices, polls, events, jobs, gallery items | removes its throwaway visitor + fixtures; demo-cohort payments remain as demo data | **assumes demo cohort present** — not an empty DB | ✅ | ✅ | **forbidden** |

`seed-demo` and `demo-e2e` are **local/staging demo tooling** and must never be run against
production (they would mint 100 real-looking approved members). `demo-e2e` check count varies
54–56 depending on prior demo-data state; `failed` is 0 in every recorded run.

## 2. Staging-vs-production Supabase (item 2)

GUIDE Section C now mandates a **separate disposable staging Supabase project** for all
verification: `npm run init-db` + all suites run against staging (`ALLOW_REMOTE_TESTS=1`
acknowledges the remote target), and the **production database is only ever written by the
deployed app, never by tests** (the guard hard-blocks the latter). Separate connection
strings: staging URI in local `backend/.env`, production URI only in Render's environment.

## 3. Upload implementation (item 3)

**Reviewed** all write/read/delete paths first: multer disk staging (`backend/src/middleware/upload.js`,
3 MB limit, extension+MIME filter), magic-byte sniffing in 3 controllers, DB stores a bare
filename, frontend builds `/uploads/<ref>` in 12 sites, 3 backend deletion sites,
static serving via `app.use('/uploads', express.static(...))`.
**Confirmed defect for production:** Render's disk is ephemeral — every deploy would delete
all uploads.

**Implemented:** [storage.js](backend/src/storage.js) — driver `local` (default, legacy behavior)
or `cloudinary` (signed REST via built-in fetch, **no new dependency**), selected by
`UPLOAD_STORAGE` / `CLOUDINARY_URL`. DB keeps the same reference columns (filename or absolute
URL); frontend resolves via `utils.mediaUrl()` (all 12 sites updated); deletion routes through
`removeUpload()` (basename-confinement prevents traversal from a poisoned DB value).

**Tested — `npm run upload-test`: 28/28 passed, exit 0:**
- upload → retrieval (bytes identical, image content-type) → magic-byte rejection (422) →
  3 MB oversize rejection (422) → unauthenticated 401 → member delete 403 → authority
  approve → delete → **file removed from disk** → retrieval 404.
- Cloudinary driver against a **local stub server speaking the same REST protocol**:
  multipart byte fidelity, timestamp+SHA-1 signature verified against the expected
  computation, secure_url handling, temp-file cleanup, destroy with extension-less
  public_id, and failure → HTTP 502 with the local temp file preserved (no silent success).
- **Limitation (stated, not hidden):** the cloudinary driver is protocol-verified against a
  stub, **not against a real Cloudinary account** — that requires your `CLOUDINARY_URL`
  and one real upload/retrieve round-trip on staging.

Regression after the wiring: **all suites re-run green** (below).

## 4. Git / secrets verification (item 4)

- Commits: `c24903a` (migration), `9d91917` (GUIDE+audit), plus this round's commit. No other history exists.
- Tracked files: 167 (before this round); **only `.env.example` templates tracked** (placeholders).
- `git check-ignore` confirms ignored: `backend/.env`, `.backups/**`, `backend/.pgdata/**`,
  `frontend/dist/**`, `backend/uploads/**`, `backend/reconciliation-report.json`, inner `.freebuff/`.
- Secret scans over tracked content: keys/tokens/AWS/OpenAI/GitHub patterns → **0 hits (exit 1)**;
  connection-string pattern → 1 hit, the `[PASSWORD]`/`YOUR_PROJECT` **placeholder in GUIDE.md** (documentation).
- `.backups/` untouched (original mtimes), never staged.

## 5. Inconsistencies resolved (item 5)

- **Render health check:** docs now say `/api/health` is verified **on the local backend** and
  configured as Render's health path; live verification is explicitly "after first deploy — not yet".
- **frontend/.env.example:** previously described as missing; now **created**
  (`VITE_API_BASE` placeholder + no-secrets warning), and the GUIDE structure matches.
- **No live-deployment claims anywhere**; GUIDE Section K and this report list only
  prepared / locally-verified / blocked-on-user.
- `demo-e2e` count discrepancy (54 vs 56) explained honestly as state-dependent, 0 failures.

## 6. Re-run results after this round's changes (item 6, exit codes captured via PIPESTATUS)

| Check | Result | Exit |
|---|---|---|
| `smoke-test` | 172 passed / 0 failed | 0 |
| `contribution-test` | 117 passed / 0 failed | 0 |
| `profile-test` | 74 passed / 0 failed | 0 |
| `upload-test` (new) | 28 passed / 0 failed | 0 |
| `demo-e2e` | 54 passed / 0 failed | 0 |
| guard-refusal (remote URL) | refused with message | 1 (expected) |
| frontend `npm run build` | success | 0 |
| `node --check` on all edited backend files | clean | 0 |
| `/api/health` (local) | `status: ok, database: connected` | — |

Files changed this round: `backend/src/storage.js` (new), `env.js`, 3 controllers, 3 services,
`tests/uploadStorageTest.js` (new), `tests/pgTestClient.js` (guard), `backend/package.json`
(`upload-test` script), 9 frontend files (`mediaUrl`), `frontend/.env.example` (new),
`GUIDE.md`, this report.

## 7. Remaining blockers (require your action/approval)

1. **Explicit approval + GitHub account** to push the 3 commits.
2. **Supabase staging project** → run `init-db` + suites against it (`ALLOW_REMOTE_TESTS=1`).
3. **Render + Vercel accounts** → create services per GUIDE Sections E/F; then verify the
   live `/api/health` and a real signed-in browser pass — only then is "deployed and tested" true.
4. **Cloudinary account** (or another object-storage choice) → set `CLOUDINARY_URL`, flip
   `UPLOAD_STORAGE=cloudinary`, verify one real upload/retrieve/delete round-trip.
5. Optional: Gmail App Password, payment wallet numbers.
6. Recommendation before public launch: rotate `JWT_SECRET` and the database password that
   currently live in the local `.env`.
