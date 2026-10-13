import { listHelpRequests, createHelpRequest, updateHelpStatus, deleteHelpRequest } from '../services/helpService.js';
import { audit } from '../services/statsService.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { validate, parsePositiveId } from '../utils/validate.js';

export const list = asyncHandler(async (req, res) => {
  const requests = await listHelpRequests(req.user || null);
  res.json({ success: true, data: { requests } });
});

export const create = asyncHandler(async (req, res) => {
  const data = validate(req.body, {
    title: { type: 'string', required: true, max: 150 },
    description: { type: 'string', required: true, max: 3000 },
    category: { type: 'enum', values: ['career', 'education', 'medical', 'financial', 'blood', 'other'], default: 'other' },
    urgency: { type: 'enum', values: ['low', 'medium', 'high', 'emergency'], default: 'medium' },
    blood_group: { type: 'enum', values: ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'] },
    location: { type: 'string', max: 255 },
    required_date: { type: 'date' },
  });
  // Blood-specific fields are required only for blood requests; stripped otherwise.
  if (data.category === 'blood') {
    const missing = [];
    if (!data.blood_group) missing.push('blood_group is required for blood requests');
    if (!data.location) missing.push('location is required for blood requests');
    if (!data.required_date) missing.push('required_date is required for blood requests');
    if (missing.length) {
      const err = new Error(missing.join('; '));
      err.status = 422;
      throw err;
    }
  } else {
    delete data.blood_group;
    delete data.location;
    delete data.required_date;
  }
  const result = await createHelpRequest(req.user, data);
  res.status(201).json({ success: true, message: 'Help request submitted', data: result });
});

export const setStatus = asyncHandler(async (req, res) => {
  const id = parsePositiveId(req.params.id, 'help request id');
  const data = validate(req.body, { status: { type: 'enum', values: ['open', 'in_progress', 'resolved', 'closed'], required: true } });
  const result = await updateHelpStatus(id, data.status, req.user);
  res.json({ success: true, message: 'Status updated', data: result });
});

export const remove = asyncHandler(async (req, res) => {
  const id = parsePositiveId(req.params.id, 'help request id');
  const result = await deleteHelpRequest(id);
  audit(req.user.user_id, 'DELETE_HELP', 'help_requests', id, { by_role: req.user.role_name });
  res.json({ success: true, message: 'Help request deleted', data: result });
});
