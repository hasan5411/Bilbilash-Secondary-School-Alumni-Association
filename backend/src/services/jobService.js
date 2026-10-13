import { query, queryOne, withTransaction } from '../db/pool.js';
import { badRequest, forbidden, notFound } from '../utils/errors.js';
import { notify, notifyCommunity, notifyModerators, NOTIFICATION_TYPES } from './notificationService.js';

/** List jobs. Non-admins only see approved + open (not closed). Admins see all. */
export async function listJobs(filters = {}, user) {
  const where = [];
  const params = [];
  const isAdmin = user && (user.role_name === 'ADMIN' || user.role_name === 'AUTHORITY');

  if (!isAdmin) {
    where.push(`j.status = 'approved'`);
    if (user) where.push(`(j.deadline IS NULL OR j.deadline >= CURRENT_DATE)`);
    if (filters.mine) {
      where.push('j.posted_by = ?');
      params.push(user.user_id);
    }
  } else if (filters.status) {
    where.push('j.status = ?');
    params.push(filters.status);
  }
  if (filters.search) {
    where.push('(j.title LIKE ? OR j.company LIKE ?)');
    params.push(`%${filters.search}%`, `%${filters.search}%`);
  }

  const rows = await query(
    `SELECT j.*, u.first_name, u.last_name,
            (SELECT COUNT(*) FROM job_applications a WHERE a.job_id = j.job_id) AS application_count
       FROM jobs j JOIN users u ON u.user_id = j.posted_by
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY j.created_at DESC LIMIT 200`,
    params
  );
  return rows;
}

/** ADMIN/AUTHORITY: hard-delete a job post. Applications (job_applications)
 * cascade with it; notifications that link to it are cleaned up best-effort. */
export async function deleteJob(jobId) {
  const row = await queryOne(`SELECT job_id, title FROM jobs WHERE job_id = ? LIMIT 1`, [jobId]);
  if (!row) throw notFound('Job not found');
  await query(`DELETE FROM jobs WHERE job_id = ?`, [jobId]);
  try {
    await query(`DELETE FROM notifications WHERE related_entity_type = 'job' AND related_entity_id = ?`, [jobId]);
  } catch { /* best-effort */ }
  return { job_id: jobId, deleted: true };
}

export async function getJob(jobId) {
  const job = await queryOne(
    `SELECT j.*, u.first_name, u.last_name FROM jobs j JOIN users u ON u.user_id = j.posted_by WHERE j.job_id = ? LIMIT 1`,
    [jobId]
  );
  if (!job) throw notFound('Job not found');
  return job;
}

export async function createJob(user, data) {
  // query() resolves to the INSERT result object (not [result, fields]).
  const res = await query(
    `INSERT INTO jobs (posted_by, title, company, description, location, employment_type, salary, application_info, deadline, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')
     RETURNING job_id`,
    [user.user_id, data.title, data.company, data.description, data.location || null, data.employment_type, data.salary || null, data.application_info || null, data.deadline || null]
  );
  // Moderators review the submission; the poster gets nothing here (their own
  // submission status is visible on the jobs page).
  await notifyModerators({
    actorId: user.user_id,
    type: NOTIFICATION_TYPES.JOB_PENDING,
    title: 'New job submission',
    message: `${user.first_name} ${user.last_name} submitted a job post: "${data.title}".`,
    entityType: 'job',
    entityId: res.insertId,
  });
  return { job_id: res.insertId, status: 'pending' };
}

export async function updateOwnJob(user, jobId, data) {
  const priorStatus = await withTransaction(async (conn) => {
    const [rows] = await conn.query('SELECT posted_by, status FROM jobs WHERE job_id = ? FOR UPDATE', [jobId]);
    const job = rows[0];
    if (!job) throw notFound('Job not found');
    if (job.posted_by !== user.user_id) throw forbidden('You can only edit your own job posts');
    if (job.status === 'closed') throw badRequest('Closed jobs cannot be edited');
    await conn.query(
      `UPDATE jobs SET title = ?, company = ?, description = ?, location = ?, employment_type = ?, salary = ?, application_info = ?, deadline = ?, status = 'pending'
       WHERE job_id = ?`,
      [data.title, data.company, data.description, data.location || null, data.employment_type, data.salary || null, data.application_info || null, data.deadline || null, jobId]
    );
    return job.status;
  });
  // An edit sends the job back to review. Re-alert moderators, but only when
  // the job actually LEFT the pending state (editing a still-pending post
  // repeatedly must not spam them).
  if (priorStatus !== 'pending') {
    await notifyModerators({
      actorId: user.user_id,
      type: NOTIFICATION_TYPES.JOB_PENDING,
      title: 'Job re-submitted for review',
      message: `${user.first_name} ${user.last_name} edited their job post: "${data.title}". It needs re-approval.`,
      entityType: 'job',
      entityId: jobId,
    });
  }
  return { job_id: jobId, status: 'pending' };
}

export async function closeOwnJob(user, jobId) {
  return withTransaction(async (conn) => {
    const [rows] = await conn.query('SELECT posted_by FROM jobs WHERE job_id = ? FOR UPDATE', [jobId]);
    const job = rows[0];
    if (!job) throw notFound('Job not found');
    if (job.posted_by !== user.user_id) throw forbidden('You can only close your own job posts');
    await conn.query(`UPDATE jobs SET status = 'closed' WHERE job_id = ?`, [jobId]);
    return { job_id: jobId, status: 'closed' };
  });
}

/** Admin/Authority moderation. */
export async function moderateJob(actor, jobId, action) {
  const map = { approve: 'approved', reject: 'rejected', close: 'closed' };
  const status = map[action];
  if (!status) throw badRequest('Unknown action');
  const job = await getJob(jobId);
  await query(`UPDATE jobs SET status = ? WHERE job_id = ?`, [status, jobId]);
  if (action === 'approve') {
    await notify(job.posted_by, 'Job published', `Your job post "${job.title}" was approved and is now visible to the community.`, NOTIFICATION_TYPES.JOB_APPROVED, { entityType: 'job', entityId: jobId, actorId: actor.user_id });
    // Community stream: every eligible member (admins/authority included) —
    // except the poster, who just got their personal result notification.
    await notifyCommunity({
      actorId: job.posted_by,
      type: NOTIFICATION_TYPES.NEW_JOB,
      title: 'New job opportunity',
      message: `A new job "${job.title}" at ${job.company} has been posted by ${job.first_name} ${job.last_name}.`,
      entityType: 'job',
      entityId: jobId,
    });
  } else if (action === 'reject') {
    await notify(job.posted_by, 'Job rejected', `Your job post "${job.title}" was not approved.`, NOTIFICATION_TYPES.JOB_REJECTED, { entityType: 'job', entityId: jobId, actorId: actor.user_id });
  }
  return { job_id: jobId, status };
}

/** Apply to a job. DB UNIQUE(job_id, applicant_id) prevents duplicates even in races. */
export async function applyToJob(user, jobId, data) {
  const job = await getJob(jobId);
  if (job.status !== 'approved') throw badRequest('This job is not open for applications');
  if (job.deadline && new Date(job.deadline) < new Date(new Date().toDateString())) {
    throw badRequest('The application deadline has passed');
  }
  if (job.posted_by === user.user_id) throw badRequest('You cannot apply to your own job post');
  try {
    const res = await query(
      `INSERT INTO job_applications (job_id, applicant_id, cover_message, portfolio_url) VALUES (?, ?, ?, ?)
       RETURNING application_id`,
      [jobId, user.user_id, data.cover_message, data.portfolio_url || null]
    );
    return { application_id: res.insertId, status: 'submitted' };
  } catch (err) {
    if (err.code === '23505') throw badRequest('You have already applied to this job');
    throw err;
  }
}

export async function listMyApplications(userId) {
  return query(
    `SELECT a.*, j.title, j.company FROM job_applications a JOIN jobs j ON j.job_id = a.job_id
      WHERE a.applicant_id = ? ORDER BY a.created_at DESC`,
    [userId]
  );
}

export async function listApplicationsForJob(user, jobId) {
  const job = await getJob(jobId);
  const isOwnerOrAdmin = job.posted_by === user.user_id || user.role_name === 'ADMIN' || user.role_name === 'AUTHORITY';
  if (!isOwnerOrAdmin) throw forbidden('Only the job poster or an admin can view applications');
  return query(
    `SELECT a.application_id, a.cover_message, a.portfolio_url, a.status, a.created_at,
            u.user_id, u.first_name, u.last_name, u.email
       FROM job_applications a JOIN users u ON u.user_id = a.applicant_id
      WHERE a.job_id = ? ORDER BY a.created_at DESC`,
    [jobId]
  );
}

export async function updateApplicationStatus(actor, applicationId, status) {
  if (!['submitted', 'shortlisted', 'rejected', 'hired'].includes(status)) throw badRequest('Unknown status');
  const app = await withTransaction(async (conn) => {
    const [rows] = await conn.query(
      `SELECT a.application_id, a.applicant_id, j.posted_by, j.title FROM job_applications a JOIN jobs j ON j.job_id = a.job_id WHERE a.application_id = ? FOR UPDATE`,
      [applicationId]
    );
    const app = rows[0];
    if (!app) throw notFound('Application not found');
    if (app.posted_by !== actor.user_id && actor.role_name !== 'ADMIN' && actor.role_name !== 'AUTHORITY') {
      throw forbidden('Not allowed');
    }
    await conn.query('UPDATE job_applications SET status = ? WHERE application_id = ?', [status, applicationId]);
    return app;
  });
  // Notify after commit (see userService.setUserStatus for why).
  await notify(app.applicant_id, 'Application update', `Your application for "${app.title}" is now: ${status}.`, 'application', { entityType: 'application', entityId: applicationId, actorId: actor.user_id });
  return { application_id: applicationId, status };
}
