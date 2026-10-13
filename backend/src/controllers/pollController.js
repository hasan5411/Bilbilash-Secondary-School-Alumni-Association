import { listPolls, createPoll, closePoll, deletePoll, votePoll } from '../services/pollService.js';
import { audit } from '../services/statsService.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { validate, parsePositiveId } from '../utils/validate.js';

export const list = asyncHandler(async (req, res) => {
  const polls = await listPolls(req.user || null);
  res.json({ success: true, data: { polls } });
});

export const create = asyncHandler(async (req, res) => {
  const data = validate(req.body, {
    question: { type: 'string', required: true, max: 255 },
    options: { type: 'string', required: true, max: 1000 },
  });
  const opts = data.options.split('|').map((s) => s.trim()).filter(Boolean);
  const result = await createPoll(req.user, { question: data.question, options: opts });
  res.status(201).json({ success: true, message: 'Poll created', data: result });
});

export const close = asyncHandler(async (req, res) => {
  const id = parsePositiveId(req.params.id, 'poll id');
  const result = await closePoll(req.user, id);
  res.json({ success: true, message: 'Poll closed', data: result });
});

export const remove = asyncHandler(async (req, res) => {
  const id = parsePositiveId(req.params.id, 'poll id');
  const result = await deletePoll(id);
  audit(req.user.user_id, 'DELETE_POLL', 'polls', id, { by_role: req.user.role_name });
  res.json({ success: true, message: 'Poll deleted', data: result });
});

export const vote = asyncHandler(async (req, res) => {
  const id = parsePositiveId(req.params.id, 'poll id');
  const data = validate(req.body, { option_id: { type: 'int', required: true, min: 1 } });
  const result = await votePoll(req.user, id, data.option_id);
  res.status(201).json({ success: true, message: 'Vote recorded', data: result });
});
