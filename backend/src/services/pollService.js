import { query, queryOne, withTransaction } from '../db/pool.js';
import { badRequest, conflict, notFound } from '../utils/errors.js';
import { notifyCommunity, NOTIFICATION_TYPES } from './notificationService.js';

export async function listPolls(user) {
  const isAdmin = user && (user.role_name === 'ADMIN' || user.role_name === 'AUTHORITY');
  const polls = isAdmin
    ? await query(`SELECT p.*, u.first_name, u.last_name FROM polls p JOIN users u ON u.user_id = p.created_by ORDER BY p.created_at DESC LIMIT 100`)
    : await query(`SELECT p.*, u.first_name, u.last_name FROM polls p JOIN users u ON u.user_id = p.created_by WHERE p.status = 'open' ORDER BY p.created_at DESC LIMIT 100`);

  for (const poll of polls) {
    poll.options = await query(
      `SELECT o.option_id, o.option_text,
              (SELECT COUNT(*) FROM poll_votes v WHERE v.option_id = o.option_id) AS votes
         FROM poll_options o WHERE o.poll_id = ? ORDER BY o.position, o.option_id`,
      [poll.poll_id]
    );
    if (user) {
      const mine = await queryOne(`SELECT option_id FROM poll_votes WHERE poll_id = ? AND user_id = ? LIMIT 1`, [poll.poll_id, user.user_id]);
      poll.my_vote_option_id = mine ? mine.option_id : null;
    }
  }
  return polls;
}

export async function createPoll(user, data) {
  const result = await withTransaction(async (conn) => {
    const [res] = await conn.query(`INSERT INTO polls (created_by, question, status) VALUES (?, ?, 'open') RETURNING poll_id`, [user.user_id, data.question]);
    const pollId = res.insertId;
    const options = data.options.filter(Boolean).slice(0, 10);
    if (options.length < 2) {
      const err = new Error('A poll needs at least 2 options');
      err.status = 422;
      throw err;
    }
    let pos = 0;
    for (const text of options) {
      await conn.query(`INSERT INTO poll_options (poll_id, option_text, position) VALUES (?, ?, ?)`, [pollId, text, pos++]);
    }
    return { poll_id: pollId, status: 'open' };
  });
  // Polls open immediately — community stream after commit (creator excluded).
  await notifyCommunity({
    actorId: user.user_id,
    type: NOTIFICATION_TYPES.NEW_POLL,
    title: 'New community poll',
    message: `A new poll is open: "${data.question}".`,
    entityType: 'poll',
    entityId: result.poll_id,
  });
  return result;
}

/** ADMIN/AUTHORITY: hard-delete a poll. Options and votes cascade with it;
 * notifications that link to it are cleaned up best-effort. */
export async function deletePoll(pollId) {
  const row = await queryOne(`SELECT poll_id, question FROM polls WHERE poll_id = ? LIMIT 1`, [pollId]);
  if (!row) throw notFound('Poll not found');
  await query(`DELETE FROM polls WHERE poll_id = ?`, [pollId]);
  try {
    await query(`DELETE FROM notifications WHERE related_entity_type = 'poll' AND related_entity_id = ?`, [pollId]);
  } catch { /* best-effort */ }
  return { poll_id: pollId, deleted: true };
}

export async function closePoll(user, pollId) {
  const poll = await queryOne('SELECT created_by FROM polls WHERE poll_id = ? LIMIT 1', [pollId]);
  if (!poll) throw notFound('Poll not found');
  const isAdmin = user.role_name === 'ADMIN' || user.role_name === 'AUTHORITY';
  if (poll.created_by !== user.user_id && !isAdmin) {
    const err = new Error('Not allowed');
    err.status = 403;
    throw err;
  }
  await query(`UPDATE polls SET status = 'closed' WHERE poll_id = ?`, [pollId]);
  return { poll_id: pollId, status: 'closed' };
}

/** Vote once per poll per user — enforced by UNIQUE(poll_id, user_id) at DB level. */
export async function votePoll(user, pollId, optionId) {
  const poll = await queryOne(`SELECT status FROM polls WHERE poll_id = ? LIMIT 1`, [pollId]);
  if (!poll) throw notFound('Poll not found');
  if (poll.status !== 'open') throw badRequest('This poll is closed');
  const option = await queryOne(`SELECT option_id FROM poll_options WHERE option_id = ? AND poll_id = ? LIMIT 1`, [optionId, pollId]);
  if (!option) throw badRequest('Invalid option for this poll');
  try {
    await query(`INSERT INTO poll_votes (poll_id, option_id, user_id) VALUES (?, ?, ?)`, [pollId, optionId, user.user_id]);
  } catch (err) {
    if (err.code === '23505') throw conflict('You have already voted in this poll');
    throw err;
  }
  return { poll_id: pollId, option_id: optionId, voted: true };
}
