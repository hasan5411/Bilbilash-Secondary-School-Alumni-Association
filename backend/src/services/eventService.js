import fs from 'node:fs';
import path from 'node:path';
import { query, queryOne, withTransaction } from '../db/pool.js';
import { badRequest, conflict, notFound } from '../utils/errors.js';
import { uploadDir } from '../config/env.js';
import { notify, notifyCommunity, NOTIFICATION_TYPES } from './notificationService.js';

export async function listEvents(user) {
  const isAdmin = user && (user.role_name === 'ADMIN' || user.role_name === 'AUTHORITY');
  const where = [];
  const params = [];
  if (!isAdmin) {
    where.push(`e.status = 'published'`);
  }
  const rows = await query(
    `SELECT e.*, u.first_name, u.last_name,
            (SELECT COUNT(*) FROM event_registrations er WHERE er.event_id = e.event_id) AS registration_count
       FROM events e JOIN users u ON u.user_id = e.created_by
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY e.event_date DESC LIMIT 200`,
    params
  );
  return rows;
}

export async function getEvent(eventId) {
  const ev = await queryOne(
    `SELECT e.*, u.first_name, u.last_name,
            (SELECT COUNT(*) FROM event_registrations er WHERE er.event_id = e.event_id) AS registration_count
       FROM events e JOIN users u ON u.user_id = e.created_by WHERE e.event_id = ? LIMIT 1`,
    [eventId]
  );
  if (!ev) throw notFound('Event not found');
  return ev;
}

export async function createEvent(user, data) {
  const res = await query(
    `INSERT INTO events (created_by, title, description, location, event_date, start_time, end_time, capacity, image, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'published')
     RETURNING event_id`,
    [user.user_id, data.title, data.description || null, data.location || null, data.event_date, data.start_time || null, data.end_time || null, data.capacity, data.image || null]
  );
  await notifyCommunity({
    actorId: user.user_id,
    type: NOTIFICATION_TYPES.NEW_EVENT,
    title: 'New event announced',
    message: `A new alumni event has been announced: "${data.title}" on ${data.event_date}.`,
    entityType: 'event',
    entityId: res.insertId,
  });
  return { event_id: res.insertId, status: 'published' };
}

/** ADMIN/AUTHORITY: hard-delete an event. Registrations cascade with it and
 * any event-linked payment keeps its row (event_id -> SET NULL); the uploaded
 * image file is removed best-effort. */
export async function deleteEvent(eventId) {
  const row = await queryOne(`SELECT event_id, title, image FROM events WHERE event_id = ? LIMIT 1`, [eventId]);
  if (!row) throw notFound('Event not found');
  await query(`DELETE FROM events WHERE event_id = ?`, [eventId]);
  try {
    await query(`DELETE FROM notifications WHERE related_entity_type = 'event' AND related_entity_id = ?`, [eventId]);
  } catch { /* best-effort */ }
  if (row.image) {
    try { fs.unlinkSync(path.join(uploadDir, row.image)); } catch { /* file may already be gone */ }
  }
  return { event_id: eventId, deleted: true };
}

export async function updateEvent(user, eventId, data) {
  const ev = await queryOne('SELECT created_by FROM events WHERE event_id = ? LIMIT 1', [eventId]);
  if (!ev) throw notFound('Event not found');
  const isAdmin = user.role_name === 'ADMIN' || user.role_name === 'AUTHORITY';
  if (ev.created_by !== user.user_id && !isAdmin) {
    const err = new Error('You can only edit your own events');
    err.status = 403;
    throw err;
  }
  await query(
    `UPDATE events SET title = ?, description = ?, location = ?, event_date = ?, start_time = ?, end_time = ?, capacity = ?, status = ? WHERE event_id = ?`,
    [data.title, data.description || null, data.location || null, data.event_date, data.start_time || null, data.end_time || null, data.capacity, data.status || 'published', eventId]
  );
  return { event_id: eventId };
}

export async function cancelEvent(user, eventId) {
  const ev = await queryOne('SELECT created_by FROM events WHERE event_id = ? LIMIT 1', [eventId]);
  if (!ev) throw notFound('Event not found');
  const isAdmin = user.role_name === 'ADMIN' || user.role_name === 'AUTHORITY';
  if (ev.created_by !== user.user_id && !isAdmin) {
    const err = new Error('You can only cancel your own events');
    err.status = 403;
    throw err;
  }
  await query(`UPDATE events SET status = 'cancelled' WHERE event_id = ?`, [eventId]);
  return { event_id: eventId, status: 'cancelled' };
}

/**
 * Register for an event. Capacity is enforced inside a transaction with a
 * FOR UPDATE lock on the event row; UNIQUE(event_id, user_id) prevents duplicates.
 */
export async function registerForEvent(user, eventId) {
  const ev = await withTransaction(async (conn) => {
    const [rows] = await conn.query('SELECT event_id, capacity, status, title FROM events WHERE event_id = ? FOR UPDATE', [eventId]);
    const ev = rows[0];
    if (!ev) throw notFound('Event not found');
    if (ev.status !== 'published') throw badRequest('This event is not open for registration');

    const [[{ cnt }]] = await conn.query('SELECT COUNT(*) AS cnt FROM event_registrations WHERE event_id = ?', [eventId]);
    if (cnt >= ev.capacity) throw conflict('Event is full');

    try {
      await conn.query(`INSERT INTO event_registrations (event_id, user_id) VALUES (?, ?)`, [eventId, user.user_id]);
    } catch (err) {
      if (err.code === '23505') throw conflict('You are already registered for this event');
      throw err;
    }
    return ev;
  });
  // Notify after commit (see userService.setUserStatus for why).
  await notify(user.user_id, 'Event registration confirmed', `You are registered for "${ev.title}".`, 'event', { entityType: 'event', entityId: eventId, actorId: user.user_id });
  return { event_id: eventId, registered: true };
}

export async function cancelRegistration(user, eventId) {
  const res = await query(`DELETE FROM event_registrations WHERE event_id = ? AND user_id = ?`, [eventId, user.user_id]);
  if (res.affectedRows === 0) throw notFound('You are not registered for this event');
  return { event_id: eventId, registered: false };
}

export async function listMyRegistrations(userId) {
  return query(
    `SELECT er.event_id, e.title, e.event_date, e.start_time, e.location, e.status
       FROM event_registrations er JOIN events e ON e.event_id = er.event_id
      WHERE er.user_id = ? ORDER BY e.event_date`,
    [userId]
  );
}
