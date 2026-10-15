# Forgot Password + OTP Email — Setup & Reference

How the password-reset flow works in the Bilbilash Alumni Community Management System, and how to configure real email delivery (HTTPS provider API in production, Gmail SMTP on localhost).

## Flow overview

```
Login page → "Forgot password?" → /forgot-password
  ↓ Enter registered email → POST /api/auth/forgot-password
  ↓ Backend: generic response (enumeration-safe), 60s resend cooldown
  ↓ 6-digit OTP generated (crypto.randomInt), stored as bcrypt hash in
    password_resets (5-minute expiry, single-use, 5-attempt cap)
  ↓ OTP emailed via the provider HTTPS API in production (Resend/Brevo/
    SendGrid on port 443) or Gmail SMTP locally (nodemailer)
User opens Gmail → copies code → /reset-password
  ↓ POST /api/auth/verify-otp  → code checked (expiry, attempts, reuse)
  ↓ New password + confirm → POST /api/auth/reset-password
  ↓ Backend re-validates OTP + match, bcrypt-hashes (cost 12) into
    users.password_hash, marks the OTP used, bumps users.token_version
    (all previous JWT sessions become invalid immediately)
  ↓ Login with the new password
```

## Environment variables (backend/.env — local; Render dashboard — production)

**Production (Render) — HTTPS API transport.** Render Free cannot send
outbound traffic on SMTP ports 25/465/587 (https://render.com/docs/free), so
production delivers through an email provider's REST API on port 443:

```env
EMAIL_PROVIDER=resend        # or: brevo | sendgrid
EMAIL_API_KEY=your_provider_api_key
EMAIL_FROM="Bilbilash Alumni <no-reply@yourdomain.com>"
```

- Pick ONE provider. The `EMAIL_FROM` address must be verified/confirmed in
  that provider's dashboard (Resend: add + verify a domain; Brevo: verify the
  sender; SendGrid: verified sender identity — note SendGrid's free access is
  a 60-day trial, Resend/Brevo free tiers are permanent).
- All three values go ONLY in the Render dashboard (Environment tab) and
  `backend/.env` — never in Vercel, never in code, never in Git.
- If `EMAIL_PROVIDER` is set but `EMAIL_API_KEY`/`EMAIL_FROM` is missing, the
  server logs a clear config error at send time and forgot-password answers
  an honest 400 (it never fakes success).

**Local development — SMTP transport (used only when `EMAIL_PROVIDER` is empty):**

```env
EMAIL_PROVIDER=
EMAIL_HOST=smtp.gmail.com
EMAIL_PORT=587
EMAIL_USER=your_address@gmail.com
EMAIL_APP_PASSWORD=your_16_char_app_password
EMAIL_FROM=your_address@gmail.com
ALLOW_DEV_OTP=1
```

- `EMAIL_USER` + `EMAIL_APP_PASSWORD` — when BOTH are set, real emails are sent. When empty, the app runs in local-dev mode: the OTP is printed only in the backend console.
- `ALLOW_DEV_OTP=1` — ONLY affects the no-SMTP local-dev mode: the OTP is also returned by the API so the dev UI can display it. Never enable in production. With SMTP configured, this flag is ignored and the OTP is never in any API response.
- Never put these values in frontend code. `.env` is server-side only.

## Creating a Gmail App Password

1. Enable 2-Step Verification on the Google account (https://myaccount.google.com/security).
2. Go to https://myaccount.google.com/apppasswords
3. Create an app password (e.g. name it "Bilbilash Alumni").
4. Copy the 16-character password into `EMAIL_APP_PASSWORD` in `backend/.env`.
5. Set `EMAIL_USER` (and optionally `EMAIL_FROM`) to the Gmail address.

Use the App Password, NEVER the normal Gmail login password.

## Running and testing locally

1. `cd backend && npm run init-db` (adds the `password_resets.attempts` column if missing; idempotent)
2. `cd backend && npm run dev` — starts on :5000
3. `cd frontend && npm run dev` — starts on :5173
4. Open http://localhost:5173/login → "Forgot password?"
5. Enter a registered email → **Send OTP**
   - SMTP configured: check the Gmail inbox (and Spam).
   - No SMTP: read the code from the backend console (and the page, in dev mode).
6. Continue → enter the code → **Verify OTP** (resend has a 60s countdown)
7. Enter + confirm the new password → **Reset password** → log in with it.

## Common delivery errors

| Symptom | Cause / fix |
| --- | --- |
| `ETIMEDOUT` / `ESOCKET connect ENETUNREACH …:465` from Render | Render Free **blocks outbound SMTP** (ports 25/465/587) — set `EMAIL_PROVIDER` + `EMAIL_API_KEY` + `EMAIL_FROM` instead (no SMTP port, IPv4, or timeout change can work) |
| `EAUTH` / "Invalid login" (local SMTP) | Wrong App Password, or 2-Step Verification not enabled |
| `ESOCKET` / timeout (local SMTP) | Network/firewall blocking port 587; try `EMAIL_PORT=465` (SSL) |
| Provider `http_401`/`http_403` | Wrong/expired `EMAIL_API_KEY`, or `EMAIL_FROM` not verified in the provider dashboard |
| Provider `http_429` | Provider rate limit — one automatic retry already ran; check the provider's usage page |
| "Could not send the reset email" | The API refuses to claim success on delivery failure — check the backend log for `[email]` lines |

Delivery-failure safety: a failed send **invalidates only the never-delivered
code** (marked used at insert-then-fail), so a code that already reached the
mailbox keeps working; the 60s resend cooldown still counts failed attempts.

## Security notes

- The OTP is stored only as a bcrypt hash; plaintext exists solely in the email body.
- 6 digits from `crypto.randomInt` (cryptographically secure), 5-minute expiry, single use, max 5 wrong attempts per code, 60-second resend cooldown (HTTP 409 when hit).
- Forgot-password responses are identical whether or not the account exists.
- The reset endpoint re-validates everything server-side; `confirm_password` must match.
- After a successful reset, `token_version` bumps — every existing session for that user is invalidated.
- No secrets, hashes, or OTP values are ever returned by the API (outside the explicit dev mode above).
