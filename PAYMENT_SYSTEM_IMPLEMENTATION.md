# PAYMENT SYSTEM IMPLEMENTATION

Date: 2026-09-30
Phase: **TEST / simulated payments only** (no real gateway — provider-agnostic design).

---

## 1. What was implemented

- **Registration-number member lookup** → verified member identity (name, reg no, SSC batch, phone) from the existing `users`/`profiles` tables. No manual re-entry of member data.
- **Monthly payment system**: server-computed month status (January → current month of the current year, from the **server clock**), paid months read from the database, due count/selection, per-month amount limited to **৳20 / ৳30 / ৳50 / ৳100** (server-enforced), total = months × amount.
- **Occasional payments**: purpose (Event Contribution / Donation / Help Fund / Emergency Fund / Other), free positive amount (server-validated), optional description, event reuse from the existing Events module.
- **TEST payment flow**: review → explicit "Confirm Test Payment" → provider charge → database transaction → SUCCESS → receipt + history. Opening a form never marks anything paid; nothing is recorded unless the confirm step completes.
- **My Payments**: own history only (ownership from the JWT, never the URL) + totals cards.
- **Admin → Payment Management**: all payments with search/filters (reg no, name, batch, phone/sender, type, purpose, status, date range) + pagination + per-member **Payment Summary** (monthly/occasional/total contributions + current-year monthly status + due count).

## 2. Existing files modified

| File | Change |
|---|---|
| `database/schema.sql` | UNIQUE key on `users.registration_number`; new `payments` + `monthly_payment_details` tables |
| `backend/src/db/initDb.js` | idempotent guarded `ALTER TABLE users ADD UNIQUE KEY uq_users_registration` (reports duplicate data instead of crashing) |
| `backend/src/app.js` | mount `/api/payments` (+ its import) |
| `backend/tests/smokeTest.js` | new section 13b (11 payment checks) |
| `frontend/src/App.jsx` | `/payments` + `/admin/payments` routes, navbar **Payments** link, admin Payments import |
| `frontend/src/pages/admin/Stats.jsx` | dashboard card "💳 Payment Management →" |
| `PROFILE_ADMIN_INFO_CHANGELOG.md` | reg-number uniqueness note resolved |

## 3. New files created

- `backend/src/services/paymentProvider.js` — provider abstraction (`getProvider()`), only `TestPaymentProvider` registered.
- `backend/src/services/paymentService.js` — lookup, monthly status, create (validation + transaction), history, admin list, summary.
- `backend/src/controllers/paymentController.js`, `backend/src/routes/paymentRoutes.js`.
- `frontend/src/pages/Payments.jsx` (member Pay Now + My Payments), `frontend/src/pages/admin/Payments.jsx` (management + summary modal).

## 4. Database changes

- `users.registration_number` is now **UNIQUE** (`uq_users_registration`). Three real users previously shared `1715646489`; duplicates were resolved (one stale duplicate account deleted via the audited admin API) before adding the index.
- `payments`: `payment_id` PK, `user_id` FK→users (CASCADE), `reg_number` snapshot (NOT the key), `payment_type` ENUM(monthly,occasional), `purpose` ENUM, `event_id` nullable FK→events, `amount` DECIMAL(10,2), `payment_method` ENUM(test) (extensible), `sender_number`, `transaction_id` UNIQUE, `payment_date`, `status` ENUM(pending,success,failed,cancelled,refunded), `description`, timestamps.
- `monthly_payment_details`: `id` PK, `payment_id` FK→payments (CASCADE), `user_id` FK, `payment_month` CHAR(7) `YYYY-MM`, `amount`, **UNIQUE(user_id, payment_month)** — duplicate monthly payment is impossible at the DB level.
- Setup: `cd backend && npm run init-db` (idempotent; safe on the existing database; no data destroyed).

## 5. API endpoints (all under `/api/payments`, all authenticated)

| Endpoint | Roles | Purpose |
|---|---|---|
| `GET /lookup/:regNumber` | any | resolve approved member by reg number (404 otherwise) |
| `GET /monthly-status?user_id=` | any (own) / ADMIN+ (others, 403 otherwise) | Jan→current-month status + due count |
| `POST /` | any (own reg no only; staff may pay for others) | record TEST payment (full server re-validation) |
| `GET /mine` | any | own history + totals |
| `GET /` | ADMIN/AUTHORITY (403 for MEMBER) | filtered + paginated list |
| `GET /summary/:userId` | ADMIN/AUTHORITY (403 for MEMBER) | per-member totals + monthly status |

Errors: 400 invalid input, 401 no token, 403 wrong role/owner, 404 member/payment not found, 409 duplicate month, 500 logged server-side (never raw DB errors).

## 6. Monthly payment logic

- Current year/month from `new Date()` **on the server** (`currentYM()`); months are normalized `YYYY-MM` keys, compared via absolute month index (year-transition safe: Dec→Jan works).
- Months listed: January of the current year → current month inclusive. **Future months are never due/selectable**; pre-January months are rejected in this phase.
- A month is PAID iff a `monthly_payment_details` row exists for that user+month. Payment = one `payments` row (amount = months × per-month) + one detail row per covered month, written in **one transaction**.
- Per-month amount must be exactly one of 20/30/50/100 (so a single monthly contribution can never exceed ৳100).

## 7. Occasional payment logic

- `purpose` must be in the fixed ENUM; `event_contribution` may reference a **published** event (existing `events` table — no duplication).
- Amount: finite, > 0, ≤ ৳1,000,000. Optional description (≤255). Same transaction/confirm flow as monthly.

## 8. Test payment flow

Payment form → Review → **TEST PAYMENT MODE banner** ("no real money will be transferred") → sender number (BD format `01[3-9]xxxxxxxx` validated server-side) → Confirm → `paymentProvider.charge()` (simulated) → transaction → receipt with Payment ID, reg no, member, type, purpose/covered months, amount, method **TEST PAYMENT**, transaction id `TEST-YYYYMMDD-<user>-<rand>`, status. Cancel/invalid input records nothing.

## 9. Roles and permissions

- MEMBER (and ADMIN/AUTHORITY) can pay for their **own** registration number only; staff may pay for others.
- `/payments` page: `RequireRole min="MEMBER"`; `/admin/payments`: `min="ADMIN"` (rank ≥ ADMIN ⇒ AUTHORITY included).
- Backend re-checks every rule (role, ownership, amounts, months, duplicates); the frontend is never trusted.

## 10. How to test locally

1. `cd backend && npm run init-db` once, then `npm run dev`; frontend `npm run dev`.
2. Login as a member → **Payments** → enter registration number → Find Member → pick due months + amount → Continue → Confirm Test Payment → receipt; **My Payments** shows the row and totals.
3. Try paying the same month again → 409 "Already paid".
4. Login as Admin/Authority → Admin → **Payment Management** → search/filter → **Summary** for a member (totals + monthly ✓/✗ + due count).
5. Automated: `cd backend && npm run smoke-test` (81 passing, includes section 13b) and `node tests/_tmp_verify_payments.mjs` (34 checks, temp script).

## 11. Known limitations

- Only current-year months are payable (future-year prepayment intentionally out of scope for this phase).
- Only `payment_method='test'` exists; `pending/failed/refunded` statuses are schema-ready but unused.
- Sender number is captured but unused by the test provider (real MFS gateways will use it).
- Payment records follow user deletion (CASCADE) — financial archiving can be added later if needed.

## 12. Adding a real gateway later

Only the provider layer changes: add e.g. `bkash: { label: 'bKash', async charge({...}) { …create payment, redirect/verify… } }` in `paymentProvider.js`, allow its method value in the `payments.payment_method` ENUM (one small ALTER), and record the row at the gateway's callback instead of inline. Monthly due calculation, tables, history, admin views, and authorization remain untouched.

## 13. Environment variables

No new ones. (A real gateway later would add e.g. `BKASH_APP_KEY` etc. — read via `backend/src/config/env.js` only, never hardcoded.)

## 14. Migration / setup commands

```
cd backend
npm run init-db   # idempotent: creates payment tables, adds UNIQUE registration_number index
npm run dev
```
