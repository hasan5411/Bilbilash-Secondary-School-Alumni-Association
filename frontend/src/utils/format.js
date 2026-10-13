// Number / date formatting helpers for the Bilbilash UI.
// Currency is Bangladeshi Taka (৳) everywhere money is shown.

const nf = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });

/** ৳1,234 or ৳1,234.50 — no trailing ".00" noise, exact decimals preserved. */
export function formatBDT(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '৳—';
  return `৳${nf.format(n)}`;
}

/** Plain grouped number: 1,234 */
export function formatNumber(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return nf.format(n);
}

/** Compact axis label for money: ৳1.2k / ৳30k / ৳1.2M */
export function formatBDTAxis(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '';
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `৳${nf.format(Math.round((n / 1_000_000) * 100) / 100)}M`;
  if (abs >= 1_000) return `৳${nf.format(Math.round((n / 1_000) * 10) / 10)}k`;
  return `৳${nf.format(n)}`;
}

/** 22.5% — one decimal, 0 for empty denominators. */
export function formatPercent(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '0%';
  return `${Math.round(n * 10) / 10}%`;
}

// Backend origin for split deployments (frontend on Vercel, API on Render).
// Same convention as api/client.js: empty = same-origin (dev proxy / single-service).
const API_BASE = import.meta.env.VITE_API_BASE || '';

/**
 * Stored upload reference -> URL the <img> can load.
 * Cloud drivers (supabase/cloudinary) store an absolute https URL (complete,
 * cross-origin-safe). The local driver stores a bare filename served by the
 * backend at /uploads/… — that path MUST be prefixed with the backend origin,
 * or the browser requests it from the frontend host (Vercel) where it does
 * not exist. This was the profile-avatar bug: initials vanished on upload
 * while the image silently 404'd on the wrong origin.
 */
export function mediaUrl(ref) {
  if (!ref) return null;
  const s = String(ref);
  if (!/^https?:\/\//i.test(s)) return `${API_BASE}/uploads/${s}`;
  // Supabase Storage ref: signed URLs (`/object/sign/…?token=…`) EXPIRE, which
  // breaks every avatar/gallery image after the token lifetime. Both buckets
  // are public, so rewrite any sign/authenticated ref (and drop its token) to
  // the stable public form. Non-Storage URLs pass through untouched.
  const m = /^(https?:\/\/[^?#]+\/storage\/v1\/object\/)(?:sign|public|authenticated)\/([^?#]+)[?#]?.*$/.exec(s);
  if (m) return `${m[1]}public/${m[2]}`;
  return s;
}
