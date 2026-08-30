import { User } from '../models/User.js';
import { verifyAccessToken } from '../utils/token.js';
import { ApiError } from '../utils/ApiError.js';
import { effectivePermissions, SELF_SCOPED_ROLES } from '../config/permissions.js';
import { asyncHandler } from '../utils/asyncHandler.js';

export const authenticate = asyncHandler(async (req, _res, next) => {
  const header = req.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) throw ApiError.unauthorized();

  const payload = verifyAccessToken(token);
  const user = await User.findById(payload.sub);
  if (!user || !user.isActive) throw ApiError.unauthorized('This account is no longer active');

  req.user = user;
  req.permissions = effectivePermissions(user);
  req.isSelfScoped = SELF_SCOPED_ROLES.includes(user.role);
  next();
});

/** authorize('asset:update') — or authorize('a','b') for any-of. */
export const authorize = (...permissions) => (req, _res, next) => {
  if (!req.user) return next(ApiError.unauthorized());
  const ok = permissions.some((p) => req.permissions.includes(p));
  if (!ok) {
    return next(ApiError.forbidden(`Your role (${req.user.role}) cannot ${permissions.join(' or ')}`));
  }
  next();
};

/** Blocks non-super-admins from editing an account more privileged than theirs. */
export const RANK = { employee: 1, auditor: 2, technician: 3, manager: 4, admin: 5, super_admin: 6 };

export const canManageTarget = (actor, targetRole) =>
  actor.role === 'super_admin' || RANK[actor.role] > RANK[targetRole];
