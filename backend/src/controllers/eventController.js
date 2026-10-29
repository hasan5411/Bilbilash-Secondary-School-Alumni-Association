import { listEvents, getEvent, createEvent, updateEvent, cancelEvent, deleteEvent, registerForEvent, cancelRegistration, listMyRegistrations, listEventRegistrations } from '../services/eventService.js';
import { audit } from '../services/statsService.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { validate, parsePositiveId } from '../utils/validate.js';

export const list = asyncHandler(async (req, res) => {
  const events = await listEvents(req.user || null);
  res.json({ success: true, data: { events } });
});

export const getOne = asyncHandler(async (req, res) => {
  const event = await getEvent(parsePositiveId(req.params.id, 'event id'));
  res.json({ success: true, data: { event } });
});

export const create = asyncHandler(async (req, res) => {
  const data = validate(req.body, {
    title: { type: 'string', required: true, max: 150 },
    description: { type: 'string', max: 3000 },
    location: { type: 'string', max: 150 },
    event_date: { type: 'date', required: true },
    start_time: { type: 'time' },
    end_time: { type: 'time' },
    capacity: { type: 'int', min: 1, max: 100000, default: 100 },
  });
  const result = await createEvent(req.user, data);
  res.status(201).json({ success: true, message: 'Event created', data: result });
});

export const update = asyncHandler(async (req, res) => {
  const id = parsePositiveId(req.params.id, 'event id');
  const data = validate(req.body, {
    title: { type: 'string', required: true, max: 150 },
    description: { type: 'string', max: 3000 },
    location: { type: 'string', max: 150 },
    event_date: { type: 'date', required: true },
    start_time: { type: 'time' },
    end_time: { type: 'time' },
    capacity: { type: 'int', min: 1, max: 100000, default: 100 },
    status: { type: 'enum', values: ['draft', 'published', 'cancelled', 'completed'] },
  });
  const result = await updateEvent(req.user, id, data);
  res.json({ success: true, message: 'Event updated', data: result });
});

export const cancel = asyncHandler(async (req, res) => {
  const id = parsePositiveId(req.params.id, 'event id');
  const result = await cancelEvent(req.user, id);
  res.json({ success: true, message: 'Event cancelled', data: result });
});

export const remove = asyncHandler(async (req, res) => {
  const id = parsePositiveId(req.params.id, 'event id');
  const result = await deleteEvent(id);
  audit(req.user.user_id, 'DELETE_EVENT', 'events', id, { by_role: req.user.role_name });
  res.json({ success: true, message: 'Event deleted', data: result });
});

export const register = asyncHandler(async (req, res) => {
  const id = parsePositiveId(req.params.id, 'event id');
  const result = await registerForEvent(req.user, id);
  res.status(201).json({ success: true, message: 'Registered for event', data: result });
});

export const unregister = asyncHandler(async (req, res) => {
  const id = parsePositiveId(req.params.id, 'event id');
  const result = await cancelRegistration(req.user, id);
  res.json({ success: true, message: 'Registration cancelled', data: result });
});

/** ADMIN/AUTHORITY only (see route). One event's registrant list. */
export const registrations = asyncHandler(async (req, res) => {
  const id = parsePositiveId(req.params.id, 'event id');
  const result = await listEventRegistrations(id);
  res.json({ success: true, data: result });
});

export const myRegistrations = asyncHandler(async (req, res) => {
  const regs = await listMyRegistrations(req.user.user_id);
  res.json({ success: true, data: { registrations: regs } });
});
