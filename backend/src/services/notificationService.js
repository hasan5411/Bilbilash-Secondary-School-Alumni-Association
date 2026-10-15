import { query } from '../db/pool.js';

/**
 * Centralized notification service.
 *
 * Business services call notify()/notifyCommunity()/notifyModerators() — never
 * INSERT into notifications directly. Every function is best-effort: a failed
 * notification must NEVER break the primary business action (errors are logged
 * and swallowed). Notifications are created AFTER the business transaction has
 * committed (see userService.setUserStatus for the deadlock rationale).
 *
 * Recipient rules (master spec):
 *   - Community content (notice/event/job/vision/poll/help published) → ALL
 *     active approved members — MEMBER, ADMIN and AUTHORITY alike, because
 *     admins/authority are also members. The actor is never self-notified.
 *   - Approval-required content → moderators (ADMIN + AUTHORITY).
 *   - Review results → the submitting user.
 *
 * Duplicate prevention: when an entity reference is supplied, a recipient who
 * already received the SAME type for the SAME entity within DEDUPE_WINDOW_SEC
 * is skipped. The window (not a UNIQUE index) protects against double-fires
 * (double clicks, request retries) while still allowing legitimate later
 * events (e.g. a re-moderation days later).
 */
export const NOTIFICATION_TYPES = {
  // Community streams
  NEW_NOTICE: 'new_notice',
  NEW_JOB: 'new_job',
  NEW_EVENT: 'new_event',
  NEW_VISION: 'new_vision',
  NEW_HELP: 'new_help',
  NEW_POLL: 'new_poll',
  // Pending review (moderators)
  REGISTRATION_PENDING: 'registration_pending',
  PAYMENT_PENDING: 'payment_pending',
  JOB_PENDING: 'job_pending',
  VISION_PENDING: 'vision_pending',
  GALLERY_PENDING: 'gallery_pending',
  // Review results (submitter)
  REGISTRATION_APPROVED: 'registration_approved',
  REGISTRATION_REJECTED: 'registration_rejected',
  PAYMENT_APPROVED: 'payment_approved',
  PAYMENT_REJECTED: 'payment_rejected',
  JOB_APPROVED: 'job_approved',
  JOB_REJECTED: 'job_rejected',
  VISION_APPROVED: 'vision_approved',
  VISION_REJECTED: 'vision_rejected',
  VISION_IMPLEMENTED: 'vision_implemented',
  HELP_STATUS: 'help_status',
  GALLERY_APPROVED: 'gallery_approved',
  GALLERY_REJECTED: 'gallery_rejected',
  // Monthly contribution management
  CONTRIBUTION_SETUP: 'contribution_setup',
  CONTRIBUTION_UPDATED: 'contribution_updated',
};

/** Types used before the centralized system (kept valid for historical + compatibility call sites). */
const LEGACY_TYPES = new Set(['approval', 'job', 'application', 'event', 'notice', 'promotion', 'demotion', 'system']);

/** Legitimate types accepted by the DB ENUM (guards against typos silently truncating). */
const KNOWN_TYPES = new Set([...Object.values(NOTIFICATION_TYPES), ...LEGACY_TYPES]);

const DEDUPE_WINDOW_SEC = 90;
const INSERT_CHUNK = 200;

const clip = (v, max) => String(v ?? '').slice(0, max);

/** Resolve the recipient user_ids for community / moderator fan-out. */
async function resolveRecipients(kind, { actorId } = {}) {
  if (kind === 'community') {
    // MEMBER + ADMIN + AUTHORITY, active + approved. VISITORs are not yet part
    // of the community and cannot see member content.
    const rows = await query(
      `SELECT u.user_id FROM users u JOIN roles r ON r.role_id = u.role_id
        WHERE r.role_name IN ('MEMBER','ADMIN','AUTHORITY')
          AND u.status = 'approved' AND u.is_active = 1`,
      []
    );
    const ids = rows.map((r) => Number(r.user_id));
    return actorId ? ids.filter((id) => Number(actorId) !== id) : ids;
  }
  // moderators: ADMIN + AUTHORITY only.
  const rows = await query(
    `SELECT u.user_id FROM users u JOIN roles r ON r.role_id = u.role_id
      WHERE r.role_name IN ('ADMIN','AUTHORITY') AND u.status = 'approved' AND u.is_active = 1`,
    []
  );
  const ids = rows.map((r) => Number(r.user_id));
  return actorId ? ids.filter((id) => Number(actorId) !== id) : ids;
}

/** IDs that already received (type, entity) within the dedupe window. */
async function recentDuplicateRecipients({ type, entityType, entityId }) {
  if (!type || !entityType || entityId == null) return new Set();
  const rows = await query(
    `SELECT DISTINCT recipient_id FROM notifications
      WHERE type = ? AND related_entity_type = ? AND related_entity_id = ?
        AND created_at > NOW() - make_interval(secs => ${DEDUPE_WINDOW_SEC})`,
    [type, clip(entityType, 30), Number(entityId)]
  );
  return new Set(rows.map((r) => Number(r.recipient_id)));
}

async function insertRows(rows) {
  for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
    const chunk = rows.slice(i, i + INSERT_CHUNK);
    // Parameterised INSERT: the translator only rewrites `?` placeholders, so
    // build explicit placeholder groups instead of a VALUES-list shortcut.
    const placeholders = chunk.map(() => '(?, ?, ?, ?, ?, ?, ?)').join(', ');
    const values = chunk.flatMap((r) => [
      Number(r.recipientId), clip(r.title, 150), clip(r.message, 500), r.type,
      r.entityType ? clip(r.entityType, 30) : null,
      r.entityId != null ? Number(r.entityId) : null,
      r.actorId != null ? Number(r.actorId) : null,
    ]);
    await query(
      `INSERT INTO notifications
         (recipient_id, title, message, type, related_entity_type, related_entity_id, actor_user_id)
       VALUES ${placeholders}`,
      values
    );
  }
}

/**
 * Core fan-out. options: { type, title, message, entityType, entityId, actorId }.
 * Dedupe applies only when an entity reference is present. Never throws.
 */
async function fanOut(recipientIds, options) {
  try {
    const { type, title, message, entityType = null, entityId = null, actorId = null } = options || {};
    if (!recipientIds?.length) return { created: 0 };
    if (!KNOWN_TYPES.has(type)) throw new Error(`Unknown notification type: ${type}`);

    const dupes = await recentDuplicateRecipients({ type, entityType, entityId });
    const rows = recipientIds
      .filter((id) => !dupes.has(Number(id)))
      .map((recipientId) => ({ recipientId, title, message, type, entityType, entityId, actorId }));
    if (!rows.length) return { created: 0 };
    await insertRows(rows);
    return { created: rows.length };
  } catch (err) {
    console.error('[notify] failed:', err.code || '', err.message);
    return { created: 0 };
  }
}

/**
 * Notify a single user.
 * Backward-compatible signature: notify(recipientId, title, message, type).
 * Extended: notify(recipientId, title, message, type, { entityType, entityId, actorId }).
 */
export async function notify(recipientId, title, message, type = 'system', options = {}) {
  return fanOut([recipientId], { title, message, type, ...options });
}

/**
 * Notify all eligible active members (MEMBER + ADMIN + AUTHORITY).
 * The actor is never notified about their own publication.
 * Recipient resolution shares fanOut's never-throw guarantee so a notification
 * hiccup can never 500 the business action that triggered it.
 */
export async function notifyCommunity({ actorId = null, type, title, message, entityType = null, entityId = null }) {
  try {
    const recipients = await resolveRecipients('community', { actorId });
    return await fanOut(recipients, { type, title, message, entityType, entityId, actorId });
  } catch (err) {
    console.error('[notify] resolve(community) failed:', err.code || '', err.message);
    return { created: 0 };
  }
}

/** Notify moderators (ADMIN + AUTHORITY) about content awaiting review. The submitter (actor) is excluded. */
export async function notifyModerators({ actorId = null, type, title, message, entityType = null, entityId = null }) {
  try {
    const recipients = await resolveRecipients('moderators', { actorId });
    return await fanOut(recipients, { type, title, message, entityType, entityId, actorId });
  } catch (err) {
    console.error('[notify] resolve(moderators) failed:', err.code || '', err.message);
    return { created: 0 };
  }
}
