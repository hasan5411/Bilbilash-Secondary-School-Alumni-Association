/**
 * Shared notification presentation helpers: type → icon + deep-link route,
 * and human-readable relative time. Used by the navbar bell and the
 * /notifications page so both always agree.
 *
 * Deep links use the app's ACTUAL routes (see App.jsx): there are no detail
 * pages for notices/visions/help/polls, so those go to their list pages.
 * Admin-targeted notifications go to the admin pages where the review
 * actually happens in this app (jobs are moderated in /admin/moderation;
 * visions/help/gallery are moderated inline on their member pages).
 */

const ICONS = {
  new_notice: '📢',
  new_job: '💼',
  new_event: '🎉',
  new_vision: '💡',
  new_help: '🤝',
  new_poll: '📊',
  registration_pending: '👤',
  registration_approved: '✅',
  registration_rejected: '❌',
  payment_pending: '💰',
  payment_approved: '✅',
  payment_rejected: '❌',
  job_pending: '💼',
  job_approved: '✅',
  job_rejected: '❌',
  vision_pending: '💡',
  vision_approved: '✅',
  vision_rejected: '❌',
  vision_implemented: '🛠️',
  help_status: '🤝',
  gallery_pending: '🖼️',
  gallery_approved: '✅',
  gallery_rejected: '❌',
  // Monthly contribution management (login setup reminder + rate changes).
  contribution_setup: '🧾',
  contribution_updated: '🧾',
  // Legacy types (existing rows / unchanged call sites).
  approval: '✅',
  job: '💼',
  application: '📋',
  event: '🎟️',
  notice: '📢',
  promotion: '⭐',
  demotion: '⬇️',
  system: '🔔',
};

export function notificationIcon(type) {
  return ICONS[type] || '🔔';
}

/** Route for a notification, or null when there is nowhere useful to go. */
export function notificationHref(n) {
  const entityPath = {
    job: (id) => `/jobs/${id}`,
    event: (id) => `/events/${id}`,
  };
  const byType = {
    new_notice: '/notices',
    new_job: n.related_entity_id ? `/jobs/${n.related_entity_id}` : '/jobs',
    new_event: n.related_entity_id ? `/events/${n.related_entity_id}` : '/events',
    new_vision: '/visions',
    new_help: '/help',
    new_poll: '/polls',
    registration_pending: '/admin/approvals',
    registration_approved: '/profile',
    payment_pending: '/admin/payments',
    payment_approved: '/payments',
    payment_rejected: '/payments',
    job_pending: '/admin/moderation',
    job_approved: '/jobs',
    job_rejected: '/jobs',
    vision_pending: '/visions',
    vision_approved: '/visions',
    vision_rejected: '/visions',
    vision_implemented: '/visions',
    help_status: '/help',
    gallery_pending: '/gallery',
    gallery_approved: '/gallery',
    gallery_rejected: '/gallery',
    // Contribution notices deep-link straight to the Profile contribution card.
    contribution_setup: '/profile#contribution',
    contribution_updated: '/profile#contribution',
    // Legacy
    approval: '/profile',
    job: '/jobs',
    application: '/my-applications',
    event: '/my-registrations',
    notice: '/notices',
    promotion: '/profile',
    demotion: '/profile',
  };
  if (byType[n.type]) return byType[n.type];
  const fn = entityPath[n.related_entity_type];
  return fn && n.related_entity_id ? fn(n.related_entity_id) : null;
}

/** YouTube-style relative time. DB stores real timestamps; never the string. */
export function relativeTime(dateStr) {
  if (!dateStr) return '';
  // Backend DATETIME arrives as 'YYYY-MM-DD HH:mm:ss' — normalize for Safari,
  // no timezone suffix (server + browser share the same wall clock).
  const then = new Date(String(dateStr).replace(' ', 'T'));
  const diffMs = Date.now() - then.getTime();
  if (Number.isNaN(then.getTime()) || diffMs < 0) return new Date(then).toLocaleString();

  const sec = Math.floor(diffMs / 1000);
  if (sec < 60) return 'Just now';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} minute${min === 1 ? '' : 's'} ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} hour${hr === 1 ? '' : 's'} ago`;
  const day = Math.floor(hr / 24);
  if (day === 1) return 'Yesterday';
  if (day < 7) return `${day} days ago`;
  return new Date(then).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

/** Header badge text: caps at 99+. */
export function badgeText(count) {
  return count > 99 ? '99+' : String(count);
}

/**
 * Fired after any read/unread/delete action anywhere in the app so the navbar
 * bell can re-sync its badge immediately (instead of waiting for its 30s poll).
 */
export const NOTIF_CHANGED_EVENT = 'bilbilash:notif-changed';
export function emitNotifChanged() {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(NOTIF_CHANGED_EVENT));
}
