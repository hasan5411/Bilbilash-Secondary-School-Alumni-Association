/**
 * seedDemo.js — reproducible DEMO member seed for the Bilbilash Alumni system.
 *
 * Safety guarantees:
 *  - Only ever touches records it owns: emails demo.*@bilbilash.demo and
 *    registration numbers DEMMO-### (see DEMO_REG_RE). Never modifies or
 *    deletes genuine user data.
 *  - Uses the REAL registration + approval API endpoints (no bypassed
 *    validation, real password hashing).
 *  - Idempotent: detects existing demo members and only creates the missing
 *    ones. Safe to rerun any number of times.
 *  - `node tests/seedDemo.js --cleanup` removes ONLY demo records (FK-safe).
 *
 * Usage:  cd backend && npm run seed-demo
 *         cd backend && node tests/seedDemo.js --cleanup
 */
import 'dotenv/config';
import { openTestDb } from './pgTestClient.js';

const BASE = process.env.SMOKE_BASE || 'http://localhost:5000';
const AUTHORITY_EMAIL = process.env.AUTHORITY_EMAIL;
const AUTHORITY_PASSWORD = process.env.AUTHORITY_PASSWORD;

export const DEMO_EMAIL_DOMAIN = 'bilbilash.demo';
export const DEMO_EMAIL_PREFIX = 'demo.';
export const DEMO_REG_PREFIX = 'DEMO-';
export const DEMO_PASSWORD = 'DemoPass123!'; // demo-only password, documented, not a secret
const DEMO_EMAIL_LIKE = `${DEMO_EMAIL_PREFIX}%@${DEMO_EMAIL_DOMAIN}`;
const TARGET_APPROVED = 100;

const FIRST = ['Rahim', 'Karim', 'Jamal', 'Hasan', 'Mizan', 'Shafiq', 'Anwar', 'Sohel', 'Rana', 'Masud',
  'Farida', 'Nasrin', 'Salma', 'Rehana', 'Ayesha', 'Shirin', 'Momena', 'Rokshana', 'Jesmin', 'Tahmina'];
const LAST = ['Ahmed', 'Hossain', 'Islam', 'Rahman', 'Chowdhury', 'Sarker', 'Miah', 'Sheikh', 'Bhuiyan', 'Talukder'];
const PROFESSIONS = ['Teacher', 'Engineer', 'Doctor', 'Businessman', 'Student', 'Government Service', 'Farmer', 'Lawyer'];
const BLOOD = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];
const INSTITUTES = ['Bilbilash High School', 'Bilbilash Secondary School', 'Bilbilash College'];

async function call(method, path, { token, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let json = null;
  try { json = await res.json(); } catch { /* ignore */ }
  return { status: res.status, json };
}

async function db() {
  return openTestDb();
}

const pad3 = (n) => String(n).padStart(3, '0');
export const demoEmail = (i) => `${DEMO_EMAIL_PREFIX}m${pad3(i)}@${DEMO_EMAIL_DOMAIN}`;
export const demoReg = (i) => `${DEMO_REG_PREFIX}M${pad3(i)}`;

function demoProfile(i) {
  return {
    first_name: FIRST[i % FIRST.length],
    last_name: LAST[(i * 3) % LAST.length],
    email: demoEmail(i),
    password: DEMO_PASSWORD,
    phone: `018${pad3(i % 100)}${String(400000 + i).slice(0, 6)}`, // fake but valid-shaped BD number
    registration_number: demoReg(i),
    ssc_batch: 1995 + (i % 21),
    blood_group: BLOOD[i % BLOOD.length],
    profession: PROFESSIONS[i % PROFESSIONS.length],
    institute: INSTITUTES[i % INSTITUTES.length],
    present_address: `Demo Village ${i}, Bilbilash`,
    permanent_address: `Demo Village ${i}, Bilbilash`,
  };
}

async function cleanup() {
  const conn = await db();
  const like = `${DEMO_EMAIL_PREFIX}%@${DEMO_EMAIL_DOMAIN}`;
  const targets = [
    ['DELETE FROM monthly_payment_details mpd USING users u WHERE u.user_id = mpd.user_id AND u.email LIKE ?', [like]],
    ['DELETE FROM payments pay USING users u WHERE u.user_id = pay.user_id AND u.email LIKE ?', [like]],
    ['DELETE FROM member_monthly_rates r USING users u WHERE u.user_id = r.user_id AND u.email LIKE ?', [like]],
    ['DELETE FROM notifications n USING users u WHERE u.user_id = n.recipient_id AND u.email LIKE ?', [like]],
    ['DELETE FROM help_requests h USING users u WHERE u.user_id = h.user_id AND u.email LIKE ?', [like]],
    ['DELETE FROM visions v USING users u WHERE u.user_id = v.user_id AND u.email LIKE ?', [like]],
    // jobs.user_id never existed — the owner column is jobs.posted_by.
    ['DELETE FROM jobs j USING users u WHERE u.user_id = j.posted_by AND u.email LIKE ?', [like]],
    ['DELETE FROM users WHERE email LIKE ?', [like]],
  ];
  let removed = 0;
  for (const [sql, params] of targets) {
    const [res] = await conn.query(sql, params);
    removed += res.affectedRows || 0;
  }
  await conn.end();
  console.log(`cleanup: removed ${removed} demo row(s)`);
}

async function main() {
  if (process.argv.includes('--cleanup')) { await cleanup(); return; }
  if (!AUTHORITY_PASSWORD) { console.error('AUTHORITY_PASSWORD missing — run from backend/ so .env loads.'); process.exit(1); }

  const conn = await db();
  // NOTE: `email` MUST be selected — the skip logic below matches on it.
  const [existing] = await conn.query(
    `SELECT user_id, email, status FROM users WHERE email LIKE ?`, [`${DEMO_EMAIL_LIKE}`]
  );
  await conn.end();
  const existingEmails = new Set(existing.map((u) => u.email));
  const approvedExisting = new Set(existing.filter((u) => u.status === 'approved').map((u) => u.user_id));
  console.log(`existing demo rows: ${existing.length} (approved: ${approvedExisting.size})`);

  // Authority token for approvals.
  const authLogin = await call('POST', '/api/auth/login', { body: { email: AUTHORITY_EMAIL, password: AUTHORITY_PASSWORD } });
  const authToken = authLogin.json?.data?.token;
  if (!authToken) { console.error('authority login failed'); process.exit(1); }

  let created = 0, approved = 0, skipped = 0, failed = 0;
  for (let i = 1; i <= TARGET_APPROVED; i++) {
    const email = demoEmail(i);
    if (existingEmails.has(email)) { skipped++; continue; }
    const reg = await call('POST', '/api/auth/register', { body: demoProfile(i) });
    if (reg.status === 409) { skipped++; continue; } // race-safe: already exists
    if (reg.status !== 201) { console.log(`  register ${email} -> ${reg.status} ${reg.json?.message || ''}`); failed++; continue; }
    created++;
    if (created % 20 === 0) console.log(`  … ${created} registered`);
  }

  // Approve cohort members (demo.mNNN) that are still pending. The deliberate
  // pending/rejected state fixtures (demo.pend*/demo.rej*) are NEVER touched.
  const COHORT_RE = new RegExp(`^${DEMO_EMAIL_PREFIX}m\\d{3}@${DEMO_EMAIL_DOMAIN.replaceAll('.', '\\.')}$`);
  const pend = await call('GET', '/api/users/pending?limit=200', { token: authToken });
  const pendingDemo = (pend.json?.data?.users || []).filter((u) => COHORT_RE.test(u.email || ''));
  for (const u of pendingDemo) {
    const ok = await call('PUT', `/api/users/${u.user_id}/approve`, { token: authToken });
    if (ok.status === 200) approved++; else { console.log(`  approve ${u.email} -> ${ok.status}`); failed++; }
  }

  // State-coverage fixtures: 2 PENDING (left unapproved) + 2 REJECTED.
  for (const [tag, i] of [['pend', 901], ['rej', 902]]) {
    const email = `${DEMO_EMAIL_PREFIX}${tag}${pad3(i)}@${DEMO_EMAIL_DOMAIN}`;
    if (existingEmails.has(email)) continue;
    const prof = demoProfile(0);
    prof.email = email;
    prof.registration_number = `${DEMO_REG_PREFIX}${tag.toUpperCase()}${pad3(i)}`;
    prof.first_name = tag === 'pend' ? 'DemoPending' : 'DemoRejected';
    const reg = await call('POST', '/api/auth/register', { body: prof });
    if (reg.status !== 201) { console.log(`  register ${email} -> ${reg.status}`); failed++; continue; }
    const list = await call('GET', '/api/users/pending?limit=200', { token: authToken });
    const found = (list.json?.data?.users || []).find((u) => u.email === email);
    if (found && tag === 'rej') {
      const r = await call('PUT', `/api/users/${found.user_id}/reject`, { token: authToken });
      if (r.status !== 200) { console.log(`  reject ${email} -> ${r.status}`); failed++; }
    }
    // 'pend' stays pending on purpose.
  }

  // Verify final counts through the API-independent DB view.
  const conn2 = await db();
  const [[cApproved]] = await conn2.query(
    `SELECT COUNT(*) n FROM users WHERE email LIKE ? AND status='approved' AND is_active=1`, [DEMO_EMAIL_LIKE]);
  const [[cPending]] = await conn2.query(
    `SELECT COUNT(*) n FROM users WHERE email LIKE 'demo.pend%@bilbilash.demo' AND status='pending'`);
  const [[cRejected]] = await conn2.query(
    `SELECT COUNT(*) n FROM users WHERE email LIKE 'demo.rej%@bilbilash.demo' AND status='rejected'`);
  await conn2.end();

  console.log(`\nSEED RESULT: created=${created} approved_now=${approved} skipped_existing=${skipped} failed=${failed}`);
  console.log(`verified in DB: approved+active=${cApproved.n} (target ${TARGET_APPROVED}), pending_case=${cPending.n}, rejected_case=${cRejected.n}`);
  // Do NOT force process.exit() here: on Windows, exiting while fetch's
  // keep-alive sockets are closing trips a libuv teardown assertion and
  // corrupts the exit code. Let the event loop drain naturally instead.
  process.exitCode = failed ? 1 : 0;
}

// Run only when executed directly (`node tests/seedDemo.js`), NOT when the
// module is imported by demoE2E.js for its exported demo-data constants.
const isDirectRun = process.argv[1] && import.meta.url === new URL(`file:///${process.argv[1].replace(/\\/g, '/')}`).href;
if (isDirectRun) main().catch((e) => { console.error('seed crashed:', e.message); process.exit(1); });
