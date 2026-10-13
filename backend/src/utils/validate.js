const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];

/**
 * Lightweight validation helper (no extra dependencies).
 * rules: { field: 'required', other: { type: 'int', min, max }, third: 'optional-string' }
 * Throws ApiError(422) listing all problems. Unknown keys are stripped; values are trimmed.
 */
export function validate(body, rules) {
  const errors = [];
  const out = {};

  for (const [field, ruleDef] of Object.entries(rules)) {
    const rule = typeof ruleDef === 'string' ? { type: ruleDef } : ruleDef;
    let value = body?.[field];

    const isEmpty = value === undefined || value === null || (typeof value === 'string' && value.trim() === '');

    if (isEmpty) {
      if (rule.required) errors.push(`${field} is required`);
      else if (rule.default !== undefined) out[field] = rule.default;
      continue;
    }

    if (rule.type === 'string' || rule.type === undefined) {
      value = String(value).trim();
      if (rule.max && value.length > rule.max) errors.push(`${field} must be at most ${rule.max} characters`);
      if (rule.min && value.length < rule.min) errors.push(`${field} must be at least ${rule.min} characters`);
      if (rule.email && !EMAIL_RE.test(value)) errors.push(`${field} must be a valid email`);
      if (rule.pattern && !rule.pattern.re.test(value)) errors.push(rule.pattern.message || `${field} has an invalid format`);
      out[field] = value;
    } else if (rule.type === 'int') {
      const n = Number(value);
      if (!Number.isInteger(n)) errors.push(`${field} must be an integer`);
      else if (rule.min !== undefined && n < rule.min) errors.push(`${field} must be >= ${rule.min}`);
      else if (rule.max !== undefined && n > rule.max) errors.push(`${field} must be <= ${rule.max}`);
      else out[field] = n;
    } else if (rule.type === 'enum') {
      if (!rule.values.includes(value)) errors.push(`${field} must be one of: ${rule.values.join(', ')}`);
      else out[field] = value;
    } else if (rule.type === 'boolean') {
      // Accepts true/'true'/'1'/1 only; everything else invalid (booleans never 'empty').
      const isTrue = value === true || value === 1 || value === 'true' || value === '1';
      const isFalse = value === false || value === 0 || value === 'false' || value === '0';
      if (!isTrue && !isFalse) errors.push(`${field} must be true or false`);
      else out[field] = isTrue;
    } else if (rule.type === 'date') {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value))) errors.push(`${field} must be a date (YYYY-MM-DD)`);
      else out[field] = String(value);
    } else if (rule.type === 'time') {
      if (!/^\d{2}:\d{2}(:\d{2})?$/.test(String(value))) errors.push(`${field} must be a time (HH:MM)`);
      else out[field] = String(value).length === 5 ? `${value}:00` : String(value);
    } else {
      errors.push(`Unknown rule type for ${field}`);
    }
  }
  if (errors.length) {
    const err = new Error(errors.join('; '));
    err.status = 422;
    throw err;
  }
  return out;
}

export function parsePositiveId(value, name = 'id') {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) {
    const err = new Error(`Invalid ${name}`);
    err.status = 400;
    throw err;
  }
  return n;
}
