# Forgot Password + Gmail OTP — Setup & Reference

How the password-reset flow works in the Bilbilash Alumni Community Management System, and how to configure real email delivery on localhost.

## Flow overview

```
Login page → "Forgot password?" → /forgot-password
  ↓ Enter registered email → POST /api/auth/forgot-password
  ↓ Backend: generic response (enumeration-safe), 60s resend cooldown
  ↓ 6-digit OTP generated (crypto.randomInt), stored as bcrypt hash in
    password_resets (5-minute expiry, single-use, 5-attempt cap)
  ↓ OTP emailed via Gmail SMTP (nodemailer)
User opens Gmail → copies code → /reset-password
  ↓ POST /api/auth/verify-otp  → code checked (expiry, attempts, reuse)
  ↓ New password + confirm → POST /api/auth/reset-password
  ↓ Backend re-validates OTP + match, bcrypt-hashes (cost 12) into
    users.password_hash, marks the OTP used, bumps users.token_version
    (all previous JWT sessions become invalid immediately)
  ↓ Login with the new password
```

## Environment variables (backend/.env)

```env
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

## Common SMTP errors

| Symptom | Cause / fix |
| --- | --- |
| `EAUTH` / "Invalid login" | Wrong App Password, or 2-Step Verification not enabled |
| `ESOCKET` / timeout | Network/firewall blocking port 587; try `EMAIL_PORT=465` (SSL) |
| "Daily user sending limit exceeded" | Gmail free-tier cap (~500/day) — wait or switch sender |
| Mail lands in Spam | Expected for app passwords; normal for local testing |
| "Could not send the reset email" | The API refuses to claim success on delivery failure — check the backend log |

## Security notes

- The OTP is stored only as a bcrypt hash; plaintext exists solely in the email body.
- 6 digits from `crypto.randomInt` (cryptographically secure), 5-minute expiry, single use, max 5 wrong attempts per code, 60-second resend cooldown (HTTP 409 when hit).
- Forgot-password responses are identical whether or not the account exists.
- The reset endpoint re-validates everything server-side; `confirm_password` must match.
- After a successful reset, `token_version` bumps — every existing session for that user is invalidated.
- No secrets, hashes, or OTP values are ever returned by the API (outside the explicit dev mode above).
