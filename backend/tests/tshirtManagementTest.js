/**
 * tshirtManagementTest.js — event-specific T-shirt management verification.
 *
 * Covers the master spec: event flag (create/default/edit), member selection
 * gating (approved vs pending vs rejected vs unregistered vs no-T-shirt),
 * size update, cross-member isolation, invalid sizes, admin viewer data,
 * print/participant data, disable-without-erasing, and re-enable.
 *
 * Runs ONLY against a local/disposable PostgreSQL (pgTestClient guard).
 * Fixtures are prefixed `tshirt.` / `TSHIRT-` and removed afterwards.
 *
 * Usage: cd backend && node tests/tshirtManagementTest.js   (npm run tshirt-test)
 */
import 'dotenv/config';
import http from 'node:http';
import bcrypt from 'bcryptjs';

const stamp = Date.now();
const EMAIL = (tag) => `tshirt.${tag}.${stamp}@example.com`;
const PASSWORD = 'Tshirt1!pass';
const REG = (tag) => `TSH-${stamp}-${tag}`;

let passed = 0;
let failed = 0;
const failures = [];

function check(name, ok, detail = '') {
  if (ok) { passed += 1; console.log(`  ✓ ${name}`); }
  else { failed += 1; failures.push(name); console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); }
}
const section = (t) => console.log(`\n── ${t} ${'─'.repeat(Math.max(0, 64 - t.length))}`);

function dhakaDate(offsetMs) {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Dhaka', year: 'numeric', month: '2-digit', day: '2-digit',
  });
  const p = Object.fromEntries(fmt.formatToParts(new Date(Date.now() + offsetMs)).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}
const DAY = 24 * 60 * 60 * 1000;

async function main() {
  const { openTestDb } = await import('./pgTestClient.js');
  const { createApp } = await import('../src/app.js');

  const server = http.createServer(createApp());
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const BASE = `http://127.0.0.1:${server.address().port}`;

  async function call(method, p, body, token) {
    const headers = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body !== undefined && body !== null) headers['Content-Type'] = 'application/json';
    const res = await fetch(`${BASE}${p}`, {
      method, headers,
      body: body === undefined || body === null ? undefined : JSON.stringify(body),
    });
    let json = null;
    try { json = await res.json(); } catch { /* non-JSON fine */ }
    return { status: res.status, json, message: json?.message || '' };
  }

  let conn;
  let txnSeq = 0;
  try {
    conn = await openTestDb();

    // ── Fixtures ──────────────────────────────────────────────────────────
    section('Setup: users and tokens');
    await conn.query(
      `INSERT INTO roles (role_name, description) VALUES
         ('VISITOR','x'),('MEMBER','x'),('ADMIN','x'),('AUTHORITY','x')
       ON CONFLICT DO NOTHING`
    );
    const hash = await bcrypt.hash(PASSWORD, 10);
    let userSeq = 0;
    const mkUser = async (tag, role, batch) => {
      userSeq += 1;
      const phone = `018${String(20000000 + userSeq).slice(0, 8)}`;
      const [res] = await conn.query(
        `INSERT INTO users (role_id, first_name, last_name, email, password_hash, phone, registration_number, status, is_active, token_version)
         SELECT role_id, ?, 'Shirt', ?, ?, ?, ?, 'approved', 1, 0
           FROM roles WHERE role_name = ? RETURNING user_id`,
        [tag, EMAIL(tag), hash, phone, REG(tag.toUpperCase()), role]
      );
      const id = Number(res.insertId);
      if (batch !== null) await conn.query(`INSERT INTO profiles (user_id, ssc_batch) VALUES (?, ?)`, [id, batch]);
      return id;
    };
    const ids = {
      admin: await mkUser('admin', 'ADMIN', 2020),
      m1: await mkUser('m1', 'MEMBER', 2020),
      m2: await mkUser('m2', 'MEMBER', 2021),
      m3: await mkUser('m3', 'MEMBER', 2022),
    };
    check('fixtures created', Object.values(ids).every((n) => n > 0), JSON.stringify(ids));

    const tok = {};
    for (const tag of Object.keys(ids)) {
      const r = await call('POST', '/api/auth/login', { email: EMAIL(tag), password: PASSWORD });
      tok[tag] = r.json?.data?.token || null;
      check(`login ${tag}`, Boolean(tok[tag]), `status ${r.status} ${r.message}`);
    }

    const eventBody = (label, extra = {}) => ({
      title: `TSHIRT-${label}-${stamp}`,
      event_date: extra.event_date || dhakaDate(20 * DAY),
      capacity: 50,
      location: 'Ground',
      ...extra,
    });
    const makeEvent = async (label, extra = {}) => {
      const r = await call('POST', '/api/events', eventBody(label, extra), tok.admin);
      check(`create event ${label}`, r.status === 201, `status ${r.status} ${r.message}`);
      return r.json?.data?.event_id;
    };
    const updateEvent = (id, extra = {}) => call('PUT', `/api/events/${id}`,
      eventBody('EDIT', { event_date: dhakaDate(20 * DAY), capacity: 50, ...extra }), tok.admin);
    const reg = (token, id) => call('POST', `/api/events/${id}/register`, {}, token);
    const select = (token, id, size) => call('PUT', `/api/events/${id}/tshirt-size`, { size }, token);
    const submit = (token, tag, amount, extra) => {
      txnSeq += 1;
      return call('POST', '/api/payments/manual', {
        registration_number: REG(tag),
        payment_type: 'occasional',
        payment_method: 'bkash',
        purpose: 'event_contribution',
        amount,
        transaction_id: `TSHIRTXN${stamp}${txnSeq}`,
        ...extra,
      }, token);
    };
    const review = (id, status) => call('PATCH', `/api/payments/${id}/review`, { status }, tok.admin);
    const mine = async (token, eventId) => {
      const r = await call('GET', '/api/events/mine/registrations', null, token);
      return (r.json?.data?.registrations || []).find((x) => Number(x.event_id) === Number(eventId));
    };
    const payAndApprove = async (token, tag, eventId, registrationId, amount = 100) => {
      const p = await submit(token, tag, amount, { event_id: eventId, registration_id: registrationId });
      check(`payment submitted for ${tag}`, p.status === 201, `status ${p.status} ${p.message}`);
      const a = await review(p.json?.data?.payment?.payment_id, 'success');
      check(`payment approved for ${tag}`, a.status === 200, `status ${a.status} ${a.message}`);
    };

    // ── A) Event configuration ────────────────────────────────────────────
    section('A) Event T-shirt configuration');
    const evYes = await makeEvent('YES', { tshirt_included: true, registration_fee: 100 });
    const evNo = await makeEvent('NO', { registration_fee: 100 }); // field omitted → false
    const adminEvents = (await call('GET', '/api/events', null, tok.admin)).json?.data?.events || [];
    const evYesRow = adminEvents.find((e) => Number(e.event_id) === Number(evYes));
    const evNoRow = adminEvents.find((e) => Number(e.event_id) === Number(evNo));
    check('event created with T-shirt Included = Yes', evYesRow?.tshirt_included === true, JSON.stringify(evYesRow?.tshirt_included));
    check('event created without the flag defaults to No', evNoRow?.tshirt_included === false, JSON.stringify(evNoRow?.tshirt_included));

    // ── B) Member selection gating ────────────────────────────────────────
    section('B) Member selection gating');
    const r1 = await reg(tok.m1, evYes);
    const reg1 = r1.json?.data?.registration_id;
    check('m1 registered on paid T-shirt event', r1.status === 201, `status ${r1.status} ${r1.message}`);
    const unpaidSelect = await select(tok.m1, evYes, 'M');
    check('unpaid member cannot select a size', unpaidSelect.status === 409,
      `status ${unpaidSelect.status} ${unpaidSelect.message}`);
    await payAndApprove(tok.m1, 'M1', evYes, reg1, 100);

    const unregistered = await select(tok.m2, evYes, 'L');
    check('unregistered member cannot select a size', unregistered.status === 404, `status ${unregistered.status}`);
    const invalid = await select(tok.m1, evYes, 'XXXL');
    check('invalid T-shirt size rejected', invalid.status === 422, `status ${invalid.status} ${invalid.message}`);

    const okSize = await select(tok.m1, evYes, 'M');
    check('member with approved payment can select a size', okSize.status === 200, `status ${okSize.status} ${okSize.message}`);
    check('saved size is returned to the member', (await mine(tok.m1, evYes))?.tshirt_size === 'M',
      JSON.stringify((await mine(tok.m1, evYes))?.tshirt_size));

    const updateSize = await select(tok.m1, evYes, 'L');
    check('member can update an existing size', updateSize.status === 200, `status ${updateSize.status}`);
    check('updated size persists', (await mine(tok.m1, evYes))?.tshirt_size === 'L');

    // Pending payment (never approved).
    const evPend = await makeEvent('PENDING', { tshirt_included: true, registration_fee: 100 });
    const rPend = await reg(tok.m2, evPend);
    check('pending-payment member cannot select a size',
      (await select(tok.m2, evPend, 'XL')).status === 409);

    // Rejected payment.
    const evRej = await makeEvent('REJECT', { tshirt_included: true, registration_fee: 100 });
    const rRej = await reg(tok.m3, evRej);
    const pRej = await submit(tok.m3, 'M3', 100, { event_id: evRej, registration_id: rRej.json?.data?.registration_id });
    check('rejection fixture payment submitted', pRej.status === 201, `status ${pRej.status} ${pRej.message}`);
    const rej = await review(pRej.json?.data?.payment?.payment_id, 'rejected');
    check('payment rejected', rej.status === 200, `status ${rej.status} ${rej.message}`);
    check('member with rejected payment cannot select a size',
      (await select(tok.m3, evRej, 'XL')).status === 409);

    // Free event: registration is confirmed without payment.
    const evFree = await makeEvent('FREE', { tshirt_included: true });
    const rFree = await reg(tok.m2, evFree);
    check('free-event registration created', rFree.status === 201, `status ${rFree.status} ${rFree.message}`);
    check('free confirmed member can select a size',
      (await select(tok.m2, evFree, 'S')).status === 200,
      JSON.stringify((await mine(tok.m2, evFree))?.tshirt_size));

    // Event without T-shirts.
    const rNo = await reg(tok.m1, evNo);
    check('registration on a non-T-shirt event works', rNo.status === 201, `status ${rNo.status} ${rNo.message}`);
    await payAndApprove(tok.m1, 'M1', evNo, rNo.json?.data?.registration_id, 100);
    const noFlag = await select(tok.m1, evNo, 'M');
    check('no-T-shirt event rejects size selection', noFlag.status === 400, `status ${noFlag.status} ${noFlag.message}`);

    // ── C) Cross-member isolation ─────────────────────────────────────────
    section('C) Cross-member isolation');
    const r2 = await reg(tok.m2, evYes);
    await payAndApprove(tok.m2, 'M2', evYes, r2.json?.data?.registration_id, 100);
    check('second member can select their own size', (await select(tok.m2, evYes, 'XL')).status === 200);
    check('first member\'s size is untouched', (await mine(tok.m1, evYes))?.tshirt_size === 'L',
      JSON.stringify((await mine(tok.m1, evYes))?.tshirt_size));
    check('second member\'s size is their own', (await mine(tok.m2, evYes))?.tshirt_size === 'XL');

    // ── D) Admin viewer + print data ──────────────────────────────────────
    section('D) Admin viewer and print data');
    // A third paid member who never picked a size → the viewer must expose NULL.
    const r3 = await reg(tok.m3, evYes);
    await payAndApprove(tok.m3, 'M3', evYes, r3.json?.data?.registration_id, 100);

    const viewer = await call('GET', `/api/events/${evYes}/registrations?view=active`, null, tok.admin);
    check('viewer reports the event T-shirt flag', viewer.json?.data?.event?.tshirt_included === true);
    const vRows = viewer.json?.data?.registrations || [];
    const v1 = vRows.find((x) => Number(x.user_id) === Number(ids.m1));
    const v2 = vRows.find((x) => Number(x.user_id) === Number(ids.m2));
    const v3 = vRows.find((x) => Number(x.user_id) === Number(ids.m3));
    check('admin sees member 1 size', v1?.tshirt_size === 'L', JSON.stringify(v1?.tshirt_size));
    check('admin sees member 2 size', v2?.tshirt_size === 'XL', JSON.stringify(v2?.tshirt_size));
    check('unselected size is NULL in the viewer data', v3?.tshirt_size === null, JSON.stringify(v3?.tshirt_size));

    const noViewer = await call('GET', `/api/events/${evNo}/registrations?view=active`, null, tok.admin);
    check('non-T-shirt event viewer flag is false', noViewer.json?.data?.event?.tshirt_included === false);
    check('non-T-shirt event rows have no size',
      (noViewer.json?.data?.registrations || []).every((x) => x.tshirt_size === null || x.tshirt_size === undefined));

    const print = await call('GET', `/api/events/${evYes}/participants`, null, tok.admin);
    check('print list carries the event T-shirt flag', print.json?.data?.event?.tshirt_included === true);
    const printSizes = (print.json?.data?.registrations || []).map((x) => x.tshirt_size).filter(Boolean).sort();
    check('print list carries saved sizes', printSizes.includes('L') && printSizes.includes('XL'), JSON.stringify(printSizes));

    check('member cannot open the admin viewer', (await call('GET', `/api/events/${evYes}/registrations`, null, tok.m1)).status === 403);

    // ── E) Edit / disable / re-enable ─────────────────────────────────────
    section('E) Edit, disable and re-enable');
    const memberEdit = await call('PUT', `/api/events/${evYes}`,
      eventBody('HACK', { tshirt_included: false, registration_fee: 100 }), tok.m1);
    check('member cannot edit the event', memberEdit.status === 403, `status ${memberEdit.status}`);

    const disable = await updateEvent(evYes, { tshirt_included: false, registration_fee: 100 });
    check('admin can disable T-shirts', disable.status === 200, `status ${disable.status} ${disable.message}`);
    const [[kept]] = await conn.query(
      `SELECT tshirt_size FROM event_registrations WHERE registration_id = ?`, [reg1]
    );
    check('disabling does not erase the saved size', kept?.tshirt_size === 'L', JSON.stringify(kept?.tshirt_size));
    check('selection blocked while disabled', (await select(tok.m1, evYes, 'S')).status === 400);
    const disabledViewer = await call('GET', `/api/events/${evYes}/registrations?view=active`, null, tok.admin);
    check('viewer flag now false', disabledViewer.json?.data?.event?.tshirt_included === false);
    check('saved size still returned to the admin', (disabledViewer.json?.data?.registrations || [])
      .find((x) => Number(x.user_id) === Number(ids.m1))?.tshirt_size === 'L');

    const reEnable = await updateEvent(evYes, { tshirt_included: true, registration_fee: 100 });
    check('admin can re-enable T-shirts', reEnable.status === 200, `status ${reEnable.status} ${reEnable.message}`);
    check('previously saved size is still available', (await mine(tok.m1, evYes))?.tshirt_size === 'L');
    check('member can update after re-enable', (await select(tok.m1, evYes, 'XXL')).status === 200);
    check('updated size after re-enable persists', (await mine(tok.m1, evYes))?.tshirt_size === 'XXL');

    const omit = await updateEvent(evYes, { registration_fee: 100 }); // flag omitted
    check('PUT without the flag keeps it enabled', omit.status === 200 && omit.json?.data?.tshirt_included === true,
      JSON.stringify(omit.json?.data?.tshirt_included));

    // ── F) Regression: lifecycle fields intact ────────────────────────────
    section('F) Existing registration/payment fields intact');
    const regRowAfter = (await mine(tok.m1, evYes));
    check('registration still active and paid', regRowAfter?.is_active === true && regRowAfter?.payment_status === 'paid',
      `${regRowAfter?.is_active}/${regRowAfter?.payment_status}`);
    check('approved amount unchanged', Number(regRowAfter?.approved_amount) === 100, String(regRowAfter?.approved_amount));
    const freeRow = await mine(tok.m2, evFree);
    check('free registration remains not_required', freeRow?.payment_status === 'not_required', freeRow?.payment_status);
  } finally {
    section('Cleanup (own fixtures only)');
    try {
      if (!conn) conn = await openTestDb();
      const [ev] = await conn.query(`DELETE FROM events WHERE title LIKE 'TSHIRT-%'`);
      const [us] = await conn.query(`DELETE FROM users WHERE email LIKE 'tshirt.%'`);
      check('removed own fixtures',
        (ev.affectedRows ?? 0) >= 5 && (us.affectedRows ?? 0) >= 4,
        `events=${ev.affectedRows} users=${us.affectedRows}`);
    } catch (err) {
      check('cleanup ran', false, err.code || err.message);
    } finally {
      if (conn) await conn.end().catch(() => {});
      server.close();
      const { closePool } = await import('../src/db/pool.js');
      await closePool().catch(() => {});
    }
  }

  console.log(`\ntshirtManagementTest: ${passed} passed, ${failed} failed`);
  if (failed) {
    console.error('Failures:', failures.join(' | '));
    process.exit(1);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error('tshirtManagementTest CRASHED:', err);
  process.exit(1);
});
