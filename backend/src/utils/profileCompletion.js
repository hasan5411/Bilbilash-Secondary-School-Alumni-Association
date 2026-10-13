/**
 * Profile Completion Percentage — the SINGLE source of truth for the calculation.
 *
 *   percentage = (completed completion-fields / total completion-fields) × 100
 *   rounded to a whole number, clamped to 0–100. Never stored in the database.
 *
 * ── Which fields? ─────────────────────────────────────────────────────────
 * The denominator is EXACTLY the set of inputs in the Profile Update form
 * (frontend Profile.jsx <form> + its server-side validation in
 * profileController.js) — percentage = filled-up form fields / total form
 * fields. This configuration is deliberately SEPARATE from registration
 * validation: registration still requires only its own fields (authController.js)
 * and nothing here makes an optional field mandatory for account creation.
 *
 * Included (all 14 form inputs):
 *
 *   first_name, last_name, phone, registration_number, ssc_batch,
 *   blood_group, active_donor, profession, institute, present_address,
 *   permanent_address, bio, facebook_url, profile_photo
 *
 * Deliberately excluded (each for a stated reason — never arbitrary):
 *
 *   - email, password_hash, OTPs, tokens, status, role, ids, timestamps:
 *     authentication / system-managed fields (email is shown read-only but is
 *     NOT an input of the update form).
 *   - contribution_start_month: set by admins, not by the member's profile form.
 *   - address: deprecated column, superseded by present_address/permanent_address.
 *
 * A field counts as completed only when its saved value is meaningfully
 * provided (null / undefined / '' / whitespace-only ⇒ incomplete) and still
 * satisfies that field's existing validation rule (type + max length + enum).
 * For profile_photo this means a SAVED photo reference in the database — an
 * unsaved file selection on the client never counts.
 */

/** The approved completion-field configuration. Frozen: one consistent definition. */
export const COMPLETION_FIELDS = Object.freeze([
  'first_name',
  'last_name',
  'phone',
  'registration_number',
  'ssc_batch',
  'blood_group',
  'active_donor',
  'profession',
  'institute',
  'present_address',
  'permanent_address',
  'bio',
  'facebook_url',
  'profile_photo',
]);

/** Back-compat alias (used by earlier call sites/tests). */
export const REQUIRED_PROFILE_FIELDS = COMPLETION_FIELDS;

/** Blood groups accepted by the existing enum validation (validate.js). */
const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];

/**
 * Per-field validity mirrors the EXISTING validation rules
 * (authController.js register + profileController.js update).
 * Types: 'string' (+max, +optionalPattern) | 'int' (+min/+max) | 'blood_group' | 'boolean'.
 */
const FIELD_RULES = Object.freeze({
  first_name: { type: 'string', max: 60 },
  last_name: { type: 'string', max: 60 },
  phone: { type: 'string', max: 20 },
  registration_number: { type: 'string', max: 50 },
  ssc_batch: { type: 'int', min: 1960, max: 2100 },
  blood_group: { type: 'blood_group' },
  active_donor: { type: 'boolean' },
  profession: { type: 'string', max: 120 },
  institute: { type: 'string', max: 120 },
  present_address: { type: 'string', max: 255 },
  permanent_address: { type: 'string', max: 255 },
  bio: { type: 'string', max: 500 },
  facebook_url: {
    type: 'string',
    max: 255,
    // Same rule as profileController: when present it must be a real
    // facebook.com / fb.com URL. (Non-matching ⇒ invalid ⇒ incomplete.)
    re: /^(https?:\/\/([a-z0-9-]+\.)+facebook\.com\/\S*|https?:\/\/(www\.)?fb\.com\/\S*)$/i,
  },
  profile_photo: { type: 'string', max: 255 }, // server-generated filename
});

/** True when a value is present AND valid per the field's existing rule. */
function isCompleted(value, field) {
  if (value === null || value === undefined) return false;
  const rule = FIELD_RULES[field];

  if (rule?.type === 'int') {
    const n = typeof value === 'number' ? value : Number(String(value).trim());
    if (!Number.isInteger(n)) return false;
    if (rule.min !== undefined && n < rule.min) return false;
    if (rule.max !== undefined && n > rule.max) return false;
    return true;
  }

  if (rule?.type === 'blood_group') return BLOOD_GROUPS.includes(value);

  if (rule?.type === 'boolean') {
    // Saved 0/1 (MySQL BOOLEAN) and the form's serialized values are valid;
    // null / '' / whitespace / anything else is incomplete.
    if (value === true || value === false || value === 0 || value === 1) return true;
    return ['true', 'false', '1', '0', 'yes', 'no'].includes(String(value).trim().toLowerCase());
  }

  if (typeof value !== 'string') return false; // descriptive fields are strings
  const trimmed = value.trim();
  if (trimmed === '') return false; // empty / whitespace-only ⇒ incomplete
  if (rule?.max && trimmed.length > rule.max) return false; // violates existing rule
  if (rule?.re && !rule.re.test(trimmed)) return false; // violates existing pattern
  return true;
}

/**
 * Compute the completion percentage for ONE profile row, using only that
 * row's own values (never another user's data).
 *
 * @param {object|null} profileRow saved profile values (users + profiles columns)
 * @param {string[]} [fields] completion-field configuration
 * @returns {number|null} whole percentage 0–100, or null when no fields are
 *   configured (safe: no division by zero, no misleading 100%)
 */
export function computeProfileCompletion(profileRow, fields = COMPLETION_FIELDS) {
  const total = Array.isArray(fields) ? fields.length : 0;
  if (total === 0) return null; // unavailable — represented as null, per project convention
  if (!profileRow) return 0;

  let completed = 0;
  for (const field of fields) {
    if (isCompleted(profileRow[field], field)) completed += 1;
  }
  const percent = Math.round((completed / total) * 100);
  return Math.max(0, Math.min(100, percent));
}
