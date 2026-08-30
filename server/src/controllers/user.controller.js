import { z } from 'zod';
import { User } from '../models/User.js';
import { Asset } from '../models/Asset.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { recordAudit } from '../utils/audit.js';
import { escapeRegex, meta, parsePagination, parseSort } from '../utils/query.js';
import { PERMISSIONS, ROLES, ROLE_NAMES, effectivePermissions } from '../config/permissions.js';
import { canManageTarget } from '../middleware/auth.js';
import { revokeAllForUser } from '../utils/token.js';
import { passwordRule } from './auth.controller.js';

const permissionList = z.array(z.enum(Object.values(PERMISSIONS))).max(40);

export const createUserSchema = z.object({
  name: z.string().min(2).max(120),
  email: z.string().email('Enter a valid email'),
  password: passwordRule,
  role: z.enum(ROLE_NAMES),
  department: z.string().max(120).optional(),
  designation: z.string().max(120).optional(),
  employeeId: z.string().max(60).optional(),
  phone: z.string().max(40).optional(),
  extraPermissions: permissionList.optional(),
  deniedPermissions: permissionList.optional(),
  mustChangePassword: z.boolean().optional(),
});

export const updateUserSchema = createUserSchema.partial().omit({ password: true }).extend({
  isActive: z.boolean().optional(),
});

export const listUsers = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query);
  const filter = {};
  if (req.query.role) filter.role = { $in: String(req.query.role).split(',') };
  if (req.query.active === 'true') filter.isActive = true;
  if (req.query.active === 'false') filter.isActive = false;
  if (req.query.search) {
    const rx = new RegExp(escapeRegex(String(req.query.search)), 'i');
    filter.$or = [{ name: rx }, { email: rx }, { employeeId: rx }, { department: rx }];
  }

  const [items, total] = await Promise.all([
    User.find(filter).sort(parseSort(req.query.sort, 'name')).skip(skip).limit(limit).lean(),
    User.countDocuments(filter),
  ]);

  // Show how much hardware each person is holding — the number admins ask for first.
  const counts = await Asset.aggregate([
    { $match: { assignedTo: { $in: items.map((u) => u._id) } } },
    { $group: { _id: '$assignedTo', count: { $sum: 1 } } },
  ]);
  const byUser = Object.fromEntries(counts.map((c) => [String(c._id), c.count]));

  res.json({
    items: items.map((u) => ({
      ...u, assetCount: byUser[String(u._id)] || 0, permissions: effectivePermissions(u),
    })),
    meta: meta({ page, limit, total }),
  });
});

export const getUser = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) throw ApiError.notFound('User not found');
  const assets = await Asset.find({ assignedTo: user._id }).select('tag name status condition dueAt').lean();
  res.json({ user: user.toJSON(), permissions: effectivePermissions(user), assets });
});

export const createUser = asyncHandler(async (req, res) => {
  if (!canManageTarget(req.user, req.body.role)) {
    throw ApiError.forbidden(`You cannot create a ${req.body.role} account`);
  }
  if (await User.exists({ email: req.body.email })) {
    throw ApiError.conflict('That email is already registered', { email: 'Already registered' });
  }
  const user = await User.create({ ...req.body, createdBy: req.user._id });
  await recordAudit(req, {
    action: 'user.created', entity: 'User', entityId: user._id, entityLabel: user.email,
    changes: [{ field: 'role', label: 'Role', from: null, to: user.role }],
  });
  res.status(201).json(user);
});

export const updateUser = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) throw ApiError.notFound('User not found');
  if (!canManageTarget(req.user, user.role) && String(user._id) !== String(req.user._id)) {
    throw ApiError.forbidden('That account outranks yours');
  }
  if (req.body.role && !canManageTarget(req.user, req.body.role)) {
    throw ApiError.forbidden(`You cannot grant the ${req.body.role} role`);
  }
  if (String(user._id) === String(req.user._id) && req.body.role && req.body.role !== user.role) {
    throw ApiError.badRequest('You cannot change your own role');
  }

  const before = user.toObject();
  Object.assign(user, req.body);
  await user.save();

  // Role or status changes must not leave live sessions with stale rights.
  if (before.role !== user.role || before.isActive !== user.isActive) await revokeAllForUser(user._id);

  await recordAudit(req, {
    action: 'user.updated', entity: 'User', entityId: user._id, entityLabel: user.email,
    before, after: user.toObject(),
  });
  res.json(user);
});

export const resetPasswordSchema = z.object({ password: passwordRule, mustChangePassword: z.boolean().optional() });

export const resetUserPassword = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id).select('+password');
  if (!user) throw ApiError.notFound('User not found');
  if (!canManageTarget(req.user, user.role)) throw ApiError.forbidden('That account outranks yours');

  user.password = req.body.password;
  user.mustChangePassword = req.body.mustChangePassword ?? true;
  user.lockedUntil = undefined;
  user.failedLoginAttempts = 0;
  await user.save();
  await revokeAllForUser(user._id);

  await recordAudit(req, { action: 'user.password_reset', entity: 'User', entityId: user._id, entityLabel: user.email });
  res.json({ message: `Password reset for ${user.email}` });
});

/** Deactivate rather than delete, unless the account holds nothing and a super admin insists. */
export const deleteUser = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) throw ApiError.notFound('User not found');
  if (String(user._id) === String(req.user._id)) throw ApiError.badRequest('You cannot remove your own account');
  if (!canManageTarget(req.user, user.role)) throw ApiError.forbidden('That account outranks yours');

  const holding = await Asset.countDocuments({ assignedTo: user._id });
  if (holding > 0) {
    throw ApiError.conflict(`${user.name} still holds ${holding} asset(s). Check them in first.`);
  }

  if (req.query.hard === 'true' && req.user.role === 'super_admin') {
    await user.deleteOne();
    await revokeAllForUser(user._id);
    await recordAudit(req, { action: 'user.deleted', entity: 'User', entityId: user._id, entityLabel: user.email });
    return res.json({ message: `${user.email} deleted` });
  }

  user.isActive = false;
  await user.save();
  await revokeAllForUser(user._id);
  await recordAudit(req, { action: 'user.deactivated', entity: 'User', entityId: user._id, entityLabel: user.email });
  res.json({ message: `${user.email} deactivated`, user });
});

export const listRoles = asyncHandler(async (_req, res) => {
  res.json({
    roles: ROLE_NAMES.map((name) => ({ name, ...ROLES[name] })),
    permissions: Object.values(PERMISSIONS),
  });
});
