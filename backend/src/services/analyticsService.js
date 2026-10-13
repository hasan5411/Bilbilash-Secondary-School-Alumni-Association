import { query } from '../db/pool.js';
import { getMembersDueReport } from './contributionService.js';

/*
 * Analytics service — every number below is computed from live MySQL records.
 * There is no mock data and no hardcoded dataset anywhere in this file.
 *
 * Reused business rules (see paymentService.js / schema.sql):
 *  - PAID (monthly dues)  = rows in monthly_payment_details, which are written
 *    ONLY when a monthly payment is approved (payments.status='success').
 *    Pending / rejected / failed / refunded transactions are never counted.
 *  - DUE                  = for every approved + active account, each month of
 *    the CURRENT billing cycle (January → current month, server clock) that has
 *    neither a monthly_payment_details row nor a PENDING monthly payment.
 *    The monthly contribution is member-chosen (৳20/30/50/100), so a due month
 *    has no fixed price: we price it with the member's OWN last recorded
 *    contribution and report un-priceable month-slots separately instead of
 *    inventing a flat fee.
 *  - Donations / event contributions (payment_type='occasional') are reported
 *    SEPARATELY and never added to monthly dues.
 *  - Visibility mirrors the existing list endpoints: members see the same
 *    moderation states the rest of the app already shows them; ADMIN/AUTHORITY
 *    see everything. Aggregates only — no names, IDs, contacts, transaction IDs
 *    or descriptions ever leave this module.
 */

const pad = (n) => String(n).padStart(2, '0');
const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH_FULL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];

/** Same population standard as the Alumni Directory / blood search. */
const APPROVED_ACTIVE = `u.status = 'approved' AND u.is_active = 1`;

export const isStaffViewer = (viewer) => viewer?.role_name === 'ADMIN' || viewer?.role_name === 'AUTHORITY';

function currentCycle() {
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() + 1 };
}

export function monthLabel(key) {
  const [y, m] = String(key).split('-').map(Number);
  return `${MONTH_SHORT[(m || 1) - 1]} ${y}`;
}
export function fullMonthLabel(key) {
  const [y, m] = String(key).split('-').map(Number);
  return `${MONTH_FULL[(m || 1) - 1]} ${y}`;
}
/** 'YYYY-MM' keys ending at (and including) `endKey`, walking backwards. */
function lastMonthKeys(endKey, count) {
  const [ey, em] = endKey.split('-').map(Number);
  const out = [];
  const abs = ey * 12 + (em - 1);
  for (let i = count - 1; i >= 0; i--) {
    const a = abs - i;
    out.push(`${Math.floor(a / 12)}-${pad((a % 12) + 1)}`);
  }
  return out;
}
function allMonthKeysOf(year) {
  const cur = currentCycle();
  const upTo = year === cur.year ? cur.month : 12;
  const out = [];
  for (let m = 1; m <= upTo; m++) out.push(`${year}-${pad(m)}`);
  return out;
}

/** Years present anywhere in the data — used by the frontend year filter. */
async function fetchAvailableYears() {
  const rows = await query(`
    SELECT EXTRACT(YEAR FROM payment_date)::int AS y FROM payments WHERE payment_date IS NOT NULL
    UNION
    SELECT CAST(LEFT(payment_month, 4) AS INTEGER) FROM monthly_payment_details
    UNION
    SELECT EXTRACT(YEAR FROM created_at)::int FROM users
    ORDER BY y DESC`);
  const cur = currentCycle().year;
  const years = rows.map((r) => Number(r.y)).filter((y) => Number.isInteger(y) && y > 2000 && y < 2100);
  if (!years.includes(cur)) years.unshift(cur);
  return [...new Set(years)].sort((a, b) => b - a);
}

/**
 * Due for the current billing cycle.
 * Returns null when the requested scope is not the current cycle (the app only
 * ever bills January → current month of the CURRENT year, so a past year has no
 * defined outstanding balance).
 */

const round2 = (n) => Math.round(Number(n) * 100) / 100;

/** Shown next to the due figures so "unknown" is never mistaken for ৳0. */
const DUE_NOTE = 'Dues use each month\u2019s configured contribution rate and are settled oldest-first. '
  + 'Months without a configured rate are counted as "Rate Not Set" and are EXCLUDED from the money total; '
  + 'members whose contribution start is unknown are reported separately and never charged automatically.';

/** Standard A+/A-… order, 'Unknown' last (sorting in JS keeps ONLY_FULL_GROUP_BY happy). */
function sortBloodGroups(rows) {
  const idx = (bg) => { const i = BLOOD_GROUPS.indexOf(bg); return i === -1 ? BLOOD_GROUPS.length : i; };
  return [...rows].sort((a, b) => idx(a.blood_group) - idx(b.blood_group));
}

/* ------------------------------------------------------------------ */
/* 1. FINANCIAL                                                        */
/* ------------------------------------------------------------------ */
export async function getFinancialAnalytics({ year = null, month = null }, viewer) {
  const cur = currentCycle();
  const curYM = `${cur.year}-${pad(cur.month)}`;

  const mpdWhere = [], mpdParams = [], payWhere = [], payParams = [];
  if (year) { mpdWhere.push('LEFT(payment_month, 4) = ?'); mpdParams.push(String(year)); payWhere.push('EXTRACT(YEAR FROM payment_date) = ?'); payParams.push(year); }
  if (month) { mpdWhere.push('RIGHT(payment_month, 2) = ?'); mpdParams.push(pad(month)); payWhere.push('EXTRACT(MONTH FROM payment_date) = ?'); payParams.push(month); }
  const mpdSql = mpdWhere.length ? `WHERE ${mpdWhere.join(' AND ')}` : '';
  const paySql = payWhere.length ? `WHERE ${payWhere.join(' AND ')}` : '';

  const [monthlyRows, statusRows, purposeRows, dueReport, years] = await Promise.all([
    query(`SELECT payment_month AS month, COALESCE(SUM(amount), 0) AS amount, COUNT(*) AS count
             FROM monthly_payment_details ${mpdSql}
            GROUP BY payment_month ORDER BY payment_month`, mpdParams),
    query(`SELECT status, COUNT(*) AS count, COALESCE(SUM(amount), 0) AS amount
             FROM payments ${paySql} GROUP BY status`, payParams),
    query(`SELECT COALESCE(purpose, 'other') AS purpose, COUNT(*) AS count, COALESCE(SUM(amount), 0) AS amount
             FROM payments
            WHERE payment_type = 'occasional' AND status = 'success' ${paySql ? `AND ${paySql.slice(6)}` : ''}
            GROUP BY purpose ORDER BY amount DESC`, payParams),
    // THE authoritative due source (same service as Profile, Payments and the
    // member-wise report): rate-based, oldest-first, no invented prices.
    getMembersDueReport({ limit: 1000 }),
    fetchAvailableYears(),
  ]);

  const members = dueReport.members || [];
  const total_due = round2(members.reduce((a, m) => a + Number(m.total_due || 0), 0));
  const due_months = members.reduce((a, m) => a + Number(m.due_month_count || 0), 0);
  const rate_not_set_months = members.reduce((a, m) => a + (m.rate_not_set_months?.length || 0), 0);
  const start_unknown_members = members.filter((m) => m.start_unknown).length;
  const due_members = members.filter((m) => Number(m.due_month_count || 0) > 0).length;
  const extra_contributions = round2(members.reduce((a, m) => a + Number(m.total_extra || 0), 0));
  const pending_due = round2(members.reduce((a, m) => a + Number(m.pending_amount || 0), 0));

  // ---- trend keys ----
  const trendKeys = year
    ? allMonthKeysOf(year)
    : lastMonthKeys(curYM, 12);
  const trendMap = new Map(monthlyRows.map((r) => [r.month, r]));
  const dueByMonth = new Map((dueReport.totals?.by_month || []).map((r) => [r.month, r]));
  const monthly_trend = trendKeys.map((k) => ({
    month: k,
    label: monthLabel(k),
    paid: Number(trendMap.get(k)?.amount ?? 0),
    due: Number(dueByMonth.get(k)?.due_amount ?? 0),
    due_months: Number(dueByMonth.get(k)?.due_months ?? 0),
    rate_not_set_months: Number(dueByMonth.get(k)?.rate_not_set_months ?? 0),
  }));

  const statusOrder = ['success', 'pending', 'rejected', 'failed', 'cancelled', 'refunded'];
  const statusMap = new Map(statusRows.map((r) => [r.status, r]));
  const status_breakdown = statusOrder
    .filter((s) => statusMap.has(s))
    .map((s) => ({ status: s, count: Number(statusMap.get(s).count), amount: round2(statusMap.get(s).amount) }));

  const total_paid = round2(monthlyRows.reduce((a, r) => a + Number(r.amount), 0));
  const total_paid_entries = monthlyRows.reduce((a, r) => a + Number(r.count), 0);
  const successRow = statusMap.get('success');
  const category_breakdown = [];
  const occasionalTotal = purposeRows.reduce((a, r) => a + Number(r.amount), 0);
  category_breakdown.push({ category: 'Monthly dues', count: total_paid_entries, amount: total_paid, color: 'green' });
  for (const r of purposeRows) {
    category_breakdown.push({
      category: r.purpose === 'donation' ? 'Donations' : String(r.purpose).replace(/_/g, ' '),
      count: Number(r.count), amount: round2(r.amount), color: r.purpose === 'donation' ? 'amber' : 'blue',
    });
  }
  if (!purposeRows.length) category_breakdown.push({ category: 'Donations & other', count: 0, amount: 0, color: 'amber' });

  // Collection for the period the user is actually looking at.
  const periodKey = month
    ? `${year ?? cur.year}-${pad(month)}`
    : year && year !== cur.year
      ? [...monthlyRows].filter((r) => r.month.startsWith(`${year}-`)).pop()?.month ?? `${year}-${pad(12)}`
      : `${year ?? cur.year}-${pad(cur.month)}`;
  const period_amount = Number(trendMap.get(periodKey)?.amount ?? monthlyRows.find((r) => r.month === periodKey)?.amount ?? 0);

  const scopeLabel = month && year ? fullMonthLabel(periodKey)
    : year ? String(year)
      : 'All time';

  return {
    scope: {
      year, month, scope_label: scopeLabel,
      is_current_year: !year || year === cur.year,
      available_years: years,
      current_month_key: curYM,
      current_month_label: fullMonthLabel(curYM),
    },
    kpis: {
      total_paid,
      total_paid_basis: month || year ? `${scopeLabel} · billing period` : 'All time · billing period',
      total_due,
      due_months,
      rate_not_set_months,
      start_unknown_members,
      due_members,
      extra_contributions,
      pending_due,
      due_note: DUE_NOTE,
      period_collection: round2(period_amount),
      period_key: periodKey,
      period_label: fullMonthLabel(periodKey),
      successful_transactions: Number(successRow?.count ?? 0),
      donations_and_other: round2(occasionalTotal),
      pending_amount: round2(statusMap.get('pending')?.amount ?? 0),
      rejected_amount: round2((statusMap.get('rejected')?.amount ?? 0) + (statusMap.get('failed')?.amount ?? 0)),
    },
    monthly_trend,
    status_breakdown,
    category_breakdown,
    due_by_month: dueReport.totals?.by_month || [],
  };
}

/* ------------------------------------------------------------------ */
/* 2. ALUMNI                                                           */
/* ------------------------------------------------------------------ */
export async function getAlumniAnalytics({ year = null }, viewer) {
  const staff = isStaffViewer(viewer);
  const cur = currentCycle();

  const [totals, memberRole, batchRows, growthRows, profRows, years] = await Promise.all([
    query(`SELECT COUNT(*) AS total_registered,
                  COALESCE(SUM((status = 'approved')::int), 0) AS approved_accounts,
                  COALESCE(SUM((status = 'pending')::int), 0) AS pending_accounts
             FROM users WHERE is_active = 1`),
    query(`SELECT COUNT(*) AS approved_members FROM users u JOIN roles r ON r.role_id = u.role_id
            WHERE r.role_name = 'MEMBER' AND ${APPROVED_ACTIVE}`),
    query(`SELECT COALESCE(CAST(p.ssc_batch AS TEXT), 'Not specified') AS batch, COUNT(*) AS count
             FROM users u LEFT JOIN profiles p ON p.user_id = u.user_id
            WHERE ${APPROVED_ACTIVE}
            GROUP BY COALESCE(CAST(p.ssc_batch AS TEXT), 'Not specified')`),
    query(`SELECT TO_CHAR(created_at, 'YYYY-MM') AS month, COUNT(*) AS count FROM users GROUP BY month ORDER BY month`),
    query(`SELECT LOWER(TRIM(COALESCE(p.profession, ''))) AS k, MIN(TRIM(p.profession)) AS display, COUNT(*) AS count
             FROM users u LEFT JOIN profiles p ON p.user_id = u.user_id
            WHERE ${APPROVED_ACTIVE}
            GROUP BY LOWER(TRIM(COALESCE(p.profession, '')))`),
    fetchAvailableYears(),
  ]);

  const batches = batchRows
    .map((r) => ({ batch: r.batch, count: Number(r.count), sort: Number(r.batch) || null }))
    .sort((a, b) => (a.sort === null) - (b.sort === null) || (a.sort ?? 0) - (b.sort ?? 0));

  // Registrations: monthly + cumulative over ALL registrations, then windowed.
  let cumulative = 0;
  const fullGrowth = growthRows.map((r) => {
    cumulative += Number(r.count);
    return { month: r.month, new_registrations: Number(r.count), cumulative };
  });
  const firstMonth = fullGrowth[0]?.month || `${cur.year}-${pad(1)}`;
  const growthKeys = year ? allMonthKeysOf(year) : lastMonthKeys(`${cur.year}-${pad(cur.month)}`, Math.max(12, Math.min(36, fullGrowth.length)));
  const growthMap = new Map(fullGrowth.map((r) => [r.month, r]));
  let lastSeen = 0;
  const growth = growthKeys.map((k) => {
    const row = growthMap.get(k);
    if (row) lastSeen = row.cumulative;
    return {
      month: k,
      label: monthLabel(k),
      new_registrations: row?.new_registrations ?? 0,
      cumulative: row ? row.cumulative : lastSeen,
    };
  });

  const professions = profRows
    .map((r) => ({ profession: r.display || 'Not specified', count: Number(r.count) }))
    .sort((a, b) => b.count - a.count || a.profession.localeCompare(b.profession));

  return {
    scope: { year, available_years: years, first_registration_month: firstMonth },
    kpis: {
      total_registered: Number(totals[0]?.total_registered ?? 0),
      approved_members: Number(memberRole[0]?.approved_members ?? 0),
      active_accounts: Number(totals[0]?.approved_accounts ?? 0),
      // Registration status is admin-only elsewhere in the app (Approvals page).
      pending_registrations: staff ? Number(totals[0]?.pending_accounts ?? 0) : null,
      staff,
    },
    batches,
    growth,
    professions,
  };
}

/* ------------------------------------------------------------------ */
/* 3. BLOOD DONORS                                                     */
/* ------------------------------------------------------------------ */
export async function getDonorAnalytics() {
  const [summary, groups] = await Promise.all([
    query(`SELECT COUNT(*) AS profiles,
                  COALESCE(SUM(p.blood_group IS NOT NULL), 0) AS with_group,
                  COALESCE(SUM((p.active_donor = 1)::int), 0) AS active_donors,
                  COALESCE(SUM(((p.active_donor = 1) AND p.blood_group IS NOT NULL)::int), 0) AS active_with_group,
                  COALESCE(SUM((((p.active_donor = 0) OR p.active_donor IS NULL) AND p.blood_group IS NOT NULL)::int), 0) AS inactive_with_group
             FROM users u JOIN profiles p ON p.user_id = u.user_id
            WHERE ${APPROVED_ACTIVE}`),
    query(`SELECT COALESCE(p.blood_group, 'Unknown') AS blood_group, COUNT(*) AS count
             FROM users u JOIN profiles p ON p.user_id = u.user_id
            WHERE ${APPROVED_ACTIVE} AND p.active_donor = TRUE
            GROUP BY COALESCE(p.blood_group, 'Unknown')`),
  ]);

  const s = summary[0] || {};
  const withGroup = Number(s.with_group ?? 0);
  const activeWithGroup = Number(s.active_with_group ?? 0);
  return {
    kpis: {
      active_donors: Number(s.active_donors ?? 0),
      profiles_with_blood_group: withGroup,
      inactive_donors: Number(s.inactive_with_group ?? 0),
      eligible_profiles: Number(s.profiles ?? 0), // all approved+active members with a profile
      donor_percentage: withGroup ? Math.round((activeWithGroup / withGroup) * 1000) / 10 : 0,
      note: 'Active donors = profiles with active_donor = TRUE among approved, active members.',
    },
    blood_groups: sortBloodGroups(groups.map((g) => ({ blood_group: g.blood_group, count: Number(g.count) }))),
    active_vs_inactive: [
      { label: 'Active donors', count: activeWithGroup },
      { label: 'Not active', count: Number(s.inactive_with_group ?? 0) },
    ],
  };
}

/* ------------------------------------------------------------------ */
/* 4. HELP REQUESTS                                                    */
/* ------------------------------------------------------------------ */
export async function getHelpAnalytics({ year = null }, viewer) {
  const staff = isStaffViewer(viewer);
  const vis = staff ? '' : `h.status <> 'closed'`;
  const scope = year ? `EXTRACT(YEAR FROM h.created_at) = ${Number(year)}` : '';
  const where = [vis, scope].filter(Boolean).join(' AND ');
  const whereSql = where ? `WHERE ${where}` : '';

  const [byStatus, byUrgency, byCategory, bloodGroups, trendRows, years] = await Promise.all([
    query(`SELECT h.status, COUNT(*) AS count FROM help_requests h ${whereSql} GROUP BY h.status`),
    query(`SELECT h.urgency, COUNT(*) AS count FROM help_requests h ${whereSql} GROUP BY h.urgency`),
    query(`SELECT h.category, COUNT(*) AS count FROM help_requests h ${whereSql} GROUP BY h.category`),
    query(`SELECT COALESCE(h.blood_group, 'Unknown') AS blood_group, COUNT(*) AS count
             FROM help_requests h ${whereSql ? `${whereSql} AND` : 'WHERE'} h.category = 'blood'
            GROUP BY COALESCE(h.blood_group, 'Unknown')`),
    query(`SELECT TO_CHAR(h.created_at, 'YYYY-MM') AS month, COUNT(*) AS count FROM help_requests h GROUP BY month ORDER BY month`),
    fetchAvailableYears(),
  ]);

  const statuses = ['open', 'in_progress', 'resolved', 'closed'];
  const urgencies = ['emergency', 'high', 'medium', 'low'];
  const sMap = new Map(byStatus.map((r) => [r.status, Number(r.count)]));
  const uMap = new Map(byUrgency.map((r) => [r.urgency, Number(r.count)]));

  const trendKeys = year ? allMonthKeysOf(year) : lastMonthKeys(`${currentCycle().year}-${pad(currentCycle().month)}`, 12);
  const tMap = new Map(trendRows.map((r) => [r.month, Number(r.count)]));

  return {
    scope: { year, available_years: years, visibility: staff ? 'all' : 'excludes_closed' },
    kpis: {
      total: byStatus.reduce((a, r) => a + Number(r.count), 0),
      open: sMap.get('open') ?? 0,
      in_progress: sMap.get('in_progress') ?? 0,
      resolved: sMap.get('resolved') ?? 0,
      closed: sMap.get('closed') ?? 0,
      emergency: uMap.get('emergency') ?? 0,
      blood_requests: byCategory.find((r) => r.category === 'blood') ? Number(byCategory.find((r) => r.category === 'blood').count) : 0,
      staff,
    },
    statuses: statuses.map((s) => ({ status: s, count: sMap.get(s) ?? 0 })),
    urgencies: urgencies.map((u) => ({ urgency: u, count: uMap.get(u) ?? 0 })),
    categories: byCategory.map((r) => ({ category: r.category, count: Number(r.count) })).sort((a, b) => b.count - a.count),
    blood_groups: sortBloodGroups(bloodGroups.map((r) => ({ blood_group: r.blood_group, count: Number(r.count) }))),
    trend: trendKeys.map((k) => ({ month: k, label: monthLabel(k), count: tMap.get(k) ?? 0 })),
  };
}

/* ------------------------------------------------------------------ */
/* 5. COMMUNITY (jobs, visions, polls, events)                         */
/* ------------------------------------------------------------------ */
async function statusCounts(table, alias, visibleSql) {
  const cond = [visibleSql].filter(Boolean).join(' AND ');
  const rows = await query(
    `SELECT ${alias}.status, COUNT(*) AS count FROM ${table} ${alias} ${cond ? `WHERE ${cond}` : ''} GROUP BY ${alias}.status`
  );
  return rows.map((r) => ({ status: r.status, count: Number(r.count) }));
}

async function monthlyTrend(table, alias, visibleSql, year) {
  const conds = [visibleSql];
  if (year) conds.push(`EXTRACT(YEAR FROM ${alias}.created_at) = ${Number(year)}`);
  const cond = conds.filter(Boolean).join(' AND ');
  const rows = await query(
    `SELECT TO_CHAR(${alias}.created_at, 'YYYY-MM') AS month, COUNT(*) AS count
       FROM ${table} ${alias} ${cond ? `WHERE ${cond}` : ''} GROUP BY month ORDER BY month`
  );
  const cur = currentCycle();
  const keys = year ? allMonthKeysOf(year) : lastMonthKeys(`${cur.year}-${pad(cur.month)}`, 12);
  const map = new Map(rows.map((r) => [r.month, Number(r.count)]));
  return keys.map((k) => ({ month: k, label: monthLabel(k), count: map.get(k) ?? 0 }));
}

export async function getCommunityAnalytics({ year = null, poll_id = null }, viewer) {
  const staff = isStaffViewer(viewer);
  const jobVis = staff ? '' : `j.status = 'approved'`;
  const visionVis = staff ? '' : `v.status = 'approved'`;
  const eventVis = staff ? '' : `e.status = 'published'`;
  const pollVis = staff ? '' : `p.status = 'open'`;

  const [
    jobStatuses, jobTrend, jobApps, visionStatuses, visionTrend,
    eventCounts, eventRegs, eventTrend, pollList, voteTotal, years,
  ] = await Promise.all([
    statusCounts('jobs', 'j', jobVis),
    monthlyTrend('jobs', 'j', jobVis, year),
    query(`SELECT COUNT(*) AS count FROM job_applications a JOIN jobs j ON j.job_id = a.job_id
            ${jobVis ? `WHERE ${jobVis}` : ''}`),
    statusCounts('visions', 'v', visionVis),
    monthlyTrend('visions', 'v', visionVis, year),
    query(`SELECT COUNT(*) AS total,
                  COALESCE(SUM((e.event_date >= CURRENT_DATE)::int), 0) AS upcoming,
                  COALESCE(SUM((e.event_date < CURRENT_DATE)::int), 0) AS past
             FROM events e ${eventVis ? `WHERE ${eventVis}` : ''}`),
    query(`SELECT COUNT(*) AS count FROM event_registrations er JOIN events e ON e.event_id = er.event_id
            ${eventVis ? `WHERE ${eventVis}` : ''}`),
    monthlyTrend('events', 'e', eventVis, year),
    query(`SELECT p.poll_id, p.question, p.status, p.created_at,
                  (SELECT COUNT(*) FROM poll_votes v WHERE v.poll_id = p.poll_id) AS votes
             FROM polls p ${pollVis ? `WHERE ${pollVis}` : ''}
            ORDER BY p.created_at DESC LIMIT 100`),
    query(`SELECT COUNT(*) AS count FROM poll_votes v JOIN polls p ON p.poll_id = v.poll_id
            ${pollVis ? `WHERE ${pollVis}` : ''}`),
    fetchAvailableYears(),
  ]);

  // Selected poll (validated against the same visibility rule as the poll list).
  const polls = pollList.map((p) => ({
    poll_id: Number(p.poll_id), question: p.question, status: p.status, votes: Number(p.votes),
  }));
  let selected = polls.find((p) => Number(p.poll_id) === Number(poll_id)) || null;
  if (poll_id && !selected) {
    const err = new Error('Poll not found or not visible to you');
    err.status = 404;
    throw err;
  }
  if (!selected) selected = [...polls].sort((a, b) => b.votes - a.votes || b.poll_id - a.poll_id)[0] || null;

  let options = [];
  if (selected) {
    const rows = await query(
      `SELECT o.option_text, COUNT(v.vote_id) AS votes
         FROM poll_options o LEFT JOIN poll_votes v ON v.option_id = o.option_id
        WHERE o.poll_id = ?
        GROUP BY o.option_id, o.option_text, o.position
        ORDER BY o.position, o.option_id`,
      [selected.poll_id]
    );
    options = rows.map((r) => ({ option_text: r.option_text, votes: Number(r.votes) }));
    selected = { ...selected, total_votes: options.reduce((a, o) => a + o.votes, 0), options };
  }

  return {
    scope: { year, available_years: years, staff },
    jobs: {
      total: jobStatuses.reduce((a, r) => a + r.count, 0),
      applications: Number(jobApps[0]?.count ?? 0),
      statuses: jobStatuses,
      trend: jobTrend,
    },
    visions: {
      total: visionStatuses.reduce((a, r) => a + r.count, 0),
      statuses: visionStatuses,
      trend: visionTrend,
    },
    polls: {
      total: polls.length,
      total_votes: Number(voteTotal[0]?.count ?? 0),
      list: polls,
      selected,
    },
    events: {
      total: Number(eventCounts[0]?.total ?? 0),
      upcoming: Number(eventCounts[0]?.upcoming ?? 0),
      past: Number(eventCounts[0]?.past ?? 0),
      registrations: Number(eventRegs[0]?.count ?? 0),
      trend: eventTrend,
    },
  };
}
