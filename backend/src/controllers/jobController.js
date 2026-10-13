import { listJobs, getJob, createJob, updateOwnJob, closeOwnJob, moderateJob, deleteJob, applyToJob, listMyApplications, listApplicationsForJob, updateApplicationStatus } from '../services/jobService.js';
import { audit } from '../services/statsService.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { validate, parsePositiveId } from '../utils/validate.js';

export const list = asyncHandler(async (req, res) => {
  const jobs = await listJobs(req.query, req.user || null);
  res.json({ success: true, data: { jobs } });
});

export const getOne = asyncHandler(async (req, res) => {
  const job = await getJob(parsePositiveId(req.params.id, 'job id'));
  res.json({ success: true, data: { job } });
});

export const create = asyncHandler(async (req, res) => {
  const data = validate(req.body, {
    title: { type: 'string', required: true, max: 150 },
    company: { type: 'string', required: true, max: 120 },
    description: { type: 'string', required: true, max: 5000 },
    location: { type: 'string', max: 120 },
    employment_type: { type: 'enum', values: ['full-time', 'part-time', 'contract', 'internship', 'remote'], default: 'full-time' },
    salary: { type: 'string', max: 80 },
    application_info: { type: 'string', max: 255 },
    deadline: { type: 'date' },
  });
  const result = await createJob(req.user, data);
  res.status(201).json({ success: true, message: 'Job submitted for approval', data: result });
});

export const update = asyncHandler(async (req, res) => {
  const id = parsePositiveId(req.params.id, 'job id');
  const data = validate(req.body, {
    title: { type: 'string', required: true, max: 150 },
    company: { type: 'string', required: true, max: 120 },
    description: { type: 'string', required: true, max: 5000 },
    location: { type: 'string', max: 120 },
    employment_type: { type: 'enum', values: ['full-time', 'part-time', 'contract', 'internship', 'remote'], default: 'full-time' },
    salary: { type: 'string', max: 80 },
    application_info: { type: 'string', max: 255 },
    deadline: { type: 'date' },
  });
  const result = await updateOwnJob(req.user, id, data);
  res.json({ success: true, message: 'Job updated (re-submitted for approval)', data: result });
});

export const close = asyncHandler(async (req, res) => {
  const id = parsePositiveId(req.params.id, 'job id');
  const result = await closeOwnJob(req.user, id);
  res.json({ success: true, message: 'Job closed', data: result });
});

export const moderate = asyncHandler(async (req, res) => {
  const id = parsePositiveId(req.params.id, 'job id');
  const data = validate(req.body, { action: { type: 'enum', values: ['approve', 'reject', 'close'], required: true } });
  const result = await moderateJob(req.user, id, data.action);
  res.json({ success: true, message: `Job ${data.action}d`, data: result });
});

export const remove = asyncHandler(async (req, res) => {
  const id = parsePositiveId(req.params.id, 'job id');
  const result = await deleteJob(id);
  audit(req.user.user_id, 'DELETE_JOB', 'jobs', id, { by_role: req.user.role_name });
  res.json({ success: true, message: 'Job deleted', data: result });
});

export const apply = asyncHandler(async (req, res) => {
  const id = parsePositiveId(req.params.id, 'job id');
  const data = validate(req.body, {
    cover_message: { type: 'string', required: true, max: 1000 },
    portfolio_url: { type: 'string', max: 255 },
  });
  const result = await applyToJob(req.user, id, data);
  res.status(201).json({ success: true, message: 'Application submitted', data: result });
});

export const myApplications = asyncHandler(async (req, res) => {
  const apps = await listMyApplications(req.user.user_id);
  res.json({ success: true, data: { applications: apps } });
});

export const applicationsForJob = asyncHandler(async (req, res) => {
  const id = parsePositiveId(req.params.id, 'job id');
  const apps = await listApplicationsForJob(req.user, id);
  res.json({ success: true, data: { applications: apps } });
});

export const setApplicationStatus = asyncHandler(async (req, res) => {
  const id = parsePositiveId(req.params.appId, 'application id');
  const data = validate(req.body, { status: { type: 'enum', values: ['submitted', 'shortlisted', 'rejected', 'hired'], required: true } });
  const result = await updateApplicationStatus(req.user, id, data.status);
  res.json({ success: true, message: 'Application updated', data: result });
});
