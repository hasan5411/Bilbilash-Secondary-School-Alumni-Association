import { listUsersByStatus, promoteToAdmin, demoteAdmin, setUserStatus, countByRole, deleteUser, getUserDetail as getUserDetailService } from '../services/userService.js';
import { audit } from '../services/statsService.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { parsePositiveId } from '../utils/validate.js';
import { computeProfileCompletion } from '../utils/profileCompletion.js';

export const listPending = asyncHandler(async (req, res) => {
  const users = await listUsersByStatus(['pending']);
  res.json({ success: true, data: { users } });
});

export const listAll = asyncHandler(async (req, res) => {
  const users = await listUsersByStatus(['pending', 'approved', 'rejected', 'inactive']);
  const byRole = await countByRole();
  res.json({ success: true, data: { users, by_role: byRole } });
});

/**
 * Admin/Authority: complete information for ONE user (Member Information page).
 * Credentials are stripped here — password_hash/token_version never leave the API.
 */
export const getMemberDetail = asyncHandler(async (req, res) => {
  const id = parsePositiveId(req.params.id, 'user id');
  const user = await getUserDetailService(id);
  // Strip credentials; normalize role_name -> role to match publicUser() field naming.
  const { password_hash, token_version, role_name, ...safeUser } = user;
  // Completion is computed from THIS member's own saved row (never the caller's),
  // under the existing ADMIN+ gate — no new permission is granted by including it.
  res.json({ success: true, data: { user: { ...safeUser, role: role_name, profile_completion: computeProfileCompletion(user) } } });
});

export const approveUser = asyncHandler(async (req, res) => {
  const id = parsePositiveId(req.params.id, 'user id');
  const result = await setUserStatus(req.user, id, 'approve');
  audit(req.user.user_id, 'APPROVE_MEMBER', 'users', id, { by_role: req.user.role_name });
  res.json({ success: true, message: 'Member approved', data: result });
});

export const rejectUser = asyncHandler(async (req, res) => {
  const id = parsePositiveId(req.params.id, 'user id');
  const result = await setUserStatus(req.user, id, 'reject');
  audit(req.user.user_id, 'REJECT_MEMBER', 'users', id, { by_role: req.user.role_name });
  res.json({ success: true, message: 'Member rejected', data: result });
});

export const deactivateUser = asyncHandler(async (req, res) => {
  const id = parsePositiveId(req.params.id, 'user id');
  const result = await setUserStatus(req.user, id, 'deactivate');
  audit(req.user.user_id, 'DEACTIVATE_USER', 'users', id, { by_role: req.user.role_name });
  res.json({ success: true, message: 'User deactivated', data: result });
});

export const removeUser = asyncHandler(async (req, res) => {
  const id = parsePositiveId(req.params.id, 'user id');
  // deleteUser() writes the rich 'user_deleted' audit entry INSIDE its
  // transaction (snapshots + delete are atomic), so no separate audit here.
  const result = await deleteUser(req.user, id);
  const kept = result.attribution_rates_preserved > 0
    ? ` ${result.attribution_rates_preserved} contribution-rate attribution record(s) kept with the setter's identity.`
    : '';
  res.json({ success: true, message: `User deleted.${kept}`, data: result });
});

export const promote = asyncHandler(async (req, res) => {
  const id = parsePositiveId(req.params.id, 'user id');
  const result = await promoteToAdmin(req.user, id);
  audit(req.user.user_id, 'PROMOTE_ADMIN', 'users', id, {});
  res.json({ success: true, message: 'User promoted to Admin', data: result });
});

export const demote = asyncHandler(async (req, res) => {
  const id = parsePositiveId(req.params.id, 'user id');
  const result = await demoteAdmin(req.user, id);
  audit(req.user.user_id, 'DEMOTE_ADMIN', 'users', id, {});
  res.json({ success: true, message: 'Admin demoted to Member', data: result });
});
