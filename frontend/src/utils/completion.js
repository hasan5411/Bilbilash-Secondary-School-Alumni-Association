/**
 * Profile Completion display rules — the ONLY place these thresholds live.
 *
 *   0%–49%   → Red    #DC2626  (49% is red)
 *   50%–84%  → Orange #F59E0B  (50% and 84% are orange)
 *   85%–100% → Green  #16A34A  (85% and 100% are green)
 *
 * The percentage itself is always computed server-side from saved profile
 * data (backend: src/utils/profileCompletion.js); this module only maps an
 * already-computed whole number to its color, so no second threshold system
 * can drift out of sync.
 */
export const COMPLETION_COLORS = Object.freeze({
  red: '#DC2626',
  orange: '#F59E0B',
  green: '#16A34A',
});

/** @param {number} percent whole percentage (0–100) @returns {string} hex color */
export function completionColor(percent) {
  const p = Number(percent);
  if (!Number.isFinite(p)) return COMPLETION_COLORS.red; // defensive: unknown → lowest band
  if (p >= 85) return COMPLETION_COLORS.green;
  if (p >= 50) return COMPLETION_COLORS.orange;
  return COMPLETION_COLORS.red;
}
