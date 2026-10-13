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
