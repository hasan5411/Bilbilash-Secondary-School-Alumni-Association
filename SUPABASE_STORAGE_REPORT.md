# SUPABASE STORAGE INTEGRATION + PROFILE-AVATAR FIX — FINAL REPORT

Date: 2026-10-14 · Bilbilash Alumni Community Management System
(Frontend Vercel · Backend Render · DB Supabase PostgreSQL · Storage Supabase Storage)

---

## 1. Confirmed root cause of the profile-avatar bug

`frontend/src/utils/format.js` → `mediaUrl()` converted a stored bare filename into an
**origin-relative** URL: `/uploads/<file>`. In the deployed split stack the browser resolves
relative URLs against the FRONTEND origin (`*.vercel.app`), where `/uploads/…` does not exist
(uploads live on `*.onrender.com`) — so every locally-stored avatar404'd. The avatar markup is
`{profile_photo ? <img …> : <initials>}`, so once an upload was saved the initials branch was
gone while the `<img>` rendered blank/broken: *initials disappear, image never displays* — the
exact reported symptom. `api/client.js` already prefixed API calls with `VITE_API_BASE`; only
`mediaUrl()` missed it. No localhost strings were involved.

Secondary production factor: Render's disk is ephemeral — `backend/uploads/` is wiped on every
deploy, so even a correctly-pointed local URL dies on redeploy. Persistent object storage was
required regardless, which is why the Supabase buckets are the right destination.

## 2. Files changed and what each accomplishes

| File | Change |
|---|---|
| `frontend/src/utils/format.js` | `mediaUrl()` prefixes relative refs with `VITE_API_BASE` (same convention as `api/client.js`). Fixes avatar/gallery/screenshot rendering across the split deployment, including pre-existing local refs. |
| `frontend/src/components/Avatar.jsx` (new) | Shared avatar: initials stay visible until the image actually loads (`onLoad` reveals it); any failure (404, dead host, CORS) permanently restores initials — never a broken-image icon. Cached/fast images handled via `complete` re-check. |
| `frontend/src/pages/Profile.jsx`, `Directory.jsx`, `PublicProfile.jsx`, `admin/Members.jsx` | Inline `{photo ? <img> : initials}` blocks replaced with `Avatar` (identical sizing/typography per call site); Profile hint corrected to "max 1 MB". |
| `frontend/src/components/TeacherPhoto.jsx` | Same load-gate added (keeps its rectangular letter-tile design; letter shows until the photo loads / on failure). |
| `frontend/src/pages/Gallery.jsx` | `GalleryImage` fallback ("Image unavailable") on dead links; upload hint unchanged (3 MB). |
| `backend/src/config/env.js` | Storage driver selection: explicit `UPLOAD_STORAGE` → `cloudinary` (if `CLOUDINARY_URL`) → `supabase` (if `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`) → `local`. New `supabaseUrl`/`supabaseServiceKey`/`supabaseBase` (test-only override). |
| `backend/src/storage.js` | New Supabase driver (REST via fetch, no SDK): buckets `profile-images`/`gallery-images`, prefixes `members/`, `teachers/`, `gallery/`; constants `PROFILE_IMAGE_MAX_BYTES` (1 MB) / `GALLERY_IMAGE_MAX_BYTES` (3 MB) enforced for every driver; `persistUpload(file, {bucket, prefix, maxBytes})` rejects oversize 422 BEFORE any upload (and cleans the temp file); upstream failure → sanitized 502 (no silent success, no upstream body leaked); success stores the object's public URL and removes the temp file. `removeUpload()` shape-dispatches: Supabase public URLs are destroyed via `DELETE /storage/v1/object/<bucket>/<path>` with the service key (404 = already gone); poisoned refs can never escape `uploadDir` locally. |
| `backend/src/controllers/profileController.js` | Avatar upload → `profile-images/members/` (1 MB); a REPLACED avatar's old object is removed only after the DB save succeeds; a DB failure after upload rolls the new object back (no orphans). |
| `backend/src/controllers/galleryController.js` | Gallery upload → `gallery-images/gallery/` (3 MB); DB-failure rollback of the uploaded object. |
| `backend/src/controllers/teacherController.js` | Teacher photos → `profile-images/teachers/` (1 MB); replacement cleanup already existed and now also removes cloud objects. |
| `backend/src/db/migrateUploadsToSupabase.js` (new, `npm run migrate:uploads`) | Dry-run by default; `MIGRATE_UPLOADS=1` applies. Moves legacy bare-filename refs (profiles/teachers/gallery) to the right bucket/prefix and rewrites the columns; reports (never deletes) locally-missing files; payments out of scope. |
| `backend/tests/supabaseStorageTest.js` (new, `npm run supabase-test`) | 36 assertions (see §5). |
| `backend/package.json` | `supabase-test`, `migrate:uploads` scripts. |
| `backend/.env.example`, `GUIDE.md` (Section G + stack table + status), `CHANGELOG.md` | Documented env names, bucket settings, flows, and limits — no secret values. |

Payment screenshots intentionally unchanged: `persistUpload()` without a bucket falls back to
the legacy local filename, so payments behave exactly as before (documented limitation below).

## 3. How uploads work now

**Profile/teacher photo & gallery photo:** browser → multipart to the existing Express routes
(same auth: profile = own token; gallery = MEMBER; teachers = ADMIN/AUTHORITY) → multer (3 MB
transport cap) → magic-byte check (JPEG/PNG/GIF/WebP) → per-target size cap (1 MB profile/teacher,
3 MB gallery) → server uploads bytes to Supabase Storage REST with the service-role key at
`<bucket>/<prefix>/<timestamp>-<rand>.<ext>` → public URL stored in the SAME existing column
(`profiles.profile_photo`, `teachers.photo`, `gallery.image_path`) → returned by the same APIs →
frontend renders via `mediaUrl()` (absolute URL passes through). Deletion (gallery delete, teacher
replace/delete, avatar replace) removes the object by parsing its public URL. Nothing ever
authorizes the browser to write to Storage: public buckets would not help an attacker, because all
writes/deletes require the server-side key.

## 4. Manual configuration required (Supabase + Render)

1. **Buckets (already created — verify settings):** `profile-images` file-size limit **1 MB**;
   `gallery-images` **3 MB**. Set both to **Public** (Settings → Public bucket / public base role)
   so images are viewable without auth. MIME `Any` is acceptable: the backend independently
   validates magic bytes, MIME and extension; optionally restrict to
   `image/jpeg,image/png,image/webp,image/gif` to match the app.
2. **Render → Environment (names only; values never in chat/code/Git):**
   `SUPABASE_URL` = `https://<project-ref>.supabase.co` ·
   `SUPABASE_SERVICE_ROLE_KEY` = the service-role (secret) key from
   Supabase → Settings → API. These automatically switch the driver to `supabase`.
   Never set them on Vercel and never in any `VITE_` variable.
3. **Redeploy** the Render service after setting them (manual deploy or push).
4. Optional: run `npm run migrate:uploads` from the Render Shell as a dry run; on Render the local
   disk is already empty, so it will report the legacy files as not recoverable there.

## 5. Tests performed and actual results

| Check | Result |
|---|---|
| `npm run supabase-test` (new) | **36/36, exit 0** — driver vs local stub Storage server: correct bucket + prefix, service-key Bearer header, exact bytes, public-URL shape, temp cleanup, 1 MB rejection before upload, upstream 502 with temp kept, DELETE-by-public-URL (404 tolerated), key sanitization; **spawned backend with the supabase driver**: member avatar upload → `profile-images/members/…` ref persisted across fresh GET and directly fetchable; 1.2 MB photo → 422 "1 MB"; renamed non-image → 422; unauthenticated gallery upload → 401; member creating teachers → 403; teacher photo → `profile-images/teachers/…` via directory API; gallery submit → `gallery-images/gallery/…` ref, member delete 403, authority delete → 200 **and** the stub received the DELETE for exactly that object. |
| `npm run upload-test` (existing) | 28/28 — local + Cloudinary drivers unaffected. |
| Regression suites | smoke 172/0, contribution 117/0, profile 74/0, demo-e2e 54/0, authority-init 63/0 — all exit 0. |
| Frontend production build | `vite build` ✓ exit 0. |
| **Browser, real UI** (Vite dev + local backend, login as demo member) | Photo rendered cross-origin via the `VITE_API_BASE` prefix; canvas-generated PNG uploaded through the actual file input → "Profile updated" → image displayed (naturalWidth 32, opacity 1); **full page reload → still displayed**; dead URL injected into the DB → reload → **initials "KR" fallback, no broken-image icon**; ref restored → image again; console clean (only the intentional dead-URL test error). |
| Production endpoint | Live `GET /api/health` (read-only): HTTP 200, `database: connected` — unrelated to storage but confirms the deployed backend. |

## 6. Exact deployment steps

1. Push these commits (frontend + backend). Vercel rebuilds the frontend automatically —
   **no new frontend environment variable is needed** (`VITE_API_BASE` already set).
2. Supabase: make both buckets Public and confirm the size limits (§4.1).
3. Render → Environment: add `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` (§4.2) → redeploy.
4. Verify on the deployed app: Profile → upload a ≤1 MB JPG/PNG → "Profile updated" → the photo
   appears, remains after reload and after re-login; check the image request goes to
   `https://<ref>.supabase.co/storage/v1/object/public/profile-images/…` (not your Vercel domain).
   Gallery: upload → pending → admin approves → visible after refresh; admin delete removes the
   object (bucket browser shows it gone). Teachers: admin adds a photo → appears in the directory.
   Negative: >1 MB profile photo → 422 "Image must be 1 MB or smaller"; non-member upload → 401/403.
5. Optional legacy migration from a machine that still HAS the old `uploads/` files:
   `cd backend && npm run migrate:uploads` (dry run) then `MIGRATE_UPLOADS=1 npm run migrate:uploads`.
6. Rollback: Render → rollback to the previous deploy (code-only; DB refs added are inert) and
   Vercel → rollback. No destructive database or storage operation is part of this change; old
   local files are never deleted by the migration unless their row was successfully rewritten.

## 7. Limitations / not verified

- **A real Supabase project round-trip was NOT executed** (no credentials available to me): the
  driver's REST protocol is verified against a local stub speaking the identical API, and the full
  API matrix runs against a spawned backend — but the first real upload must be confirmed on the
  deployed stack per §6.4. If the service-role key is read-only or the buckets are private, uploads
  still succeed (service role bypasses policies) but public READ requires the buckets to be Public.
- Payment screenshots still use the ephemeral local disk (no bucket provisioned for them); a
  future `payment-screenshots` bucket would close that gap.
- GIF is still accepted (existing app behavior); bucket MIME may stay `Any` since the server
  enforces the allowlist.
- Existing production avatars stored as bare filenames point at files that Render has already
  wiped — those users see the initials fallback until they re-upload (nothing recoverable
  server-side); the fallback now renders gracefully instead of a broken avatar.
- Browser verification used the local dev stack; production CORS/CDN behavior is identical in
  shape (public bucket URLs are plain `<img>` GETs, no CORS needed).
