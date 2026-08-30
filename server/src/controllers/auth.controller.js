import { z } from 'zod';
import { User } from '../models/User.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { effectivePermissions, ROLES } from '../config/permissions.js';
import { recordAudit } from '../utils/audit.js';
import {
  REFRESH_COOKIE, clearRefreshCookie, issueRefreshToken, revokeAllForUser,
  revokeRefreshToken, rotateRefreshToken, setRefreshCookie, signAccessToken,
} from '../utils/token.js';

const MAX_ATTEMPTS = 6;
const LOCK_MINUTES = 15;

export const passwordRule = z
  .string()
  .min(8, 'Use at least 8 characters')
  .regex(/[A-Za-z]/, 'Include a letter')
  .regex(/[0-9]/, 'Include a number');

export const registerSchema = z.object({
  name: z.string().min(2, 'Name is too short').max(120),
  email: z.string().email('Enter a valid email'),
  password: passwordRule,
  department: z.string().max(120).optional(),
  employeeId: z.string().max(60).optional(),
});

export const loginSchema = z.object({
  email: z.string().email('Enter a valid email'),
  password: z.string().min(1, 'Enter your password'),
});

const shape = (user) => ({
  user: user.toJSON(),
  permissions: effectivePermissions(user),
  roleInfo: ROLES[user.role],
});

/** First account to register becomes super admin; everyone after is an employee. */
export const register = asyncHandler(async (req, res) => {
  const { name, email, password, department, employeeId } = req.body;
  if (await User.exists({ email })) throw ApiError.conflict('That email is already registered', { email: 'Already registered' });

  const isFirstUser = (await User.estimatedDocumentCount()) === 0;
  const user = await User.create({
    name, email, password, department, employeeId,
    role: isFirstUser ? 'super_admin' : 'employee',
  });

  await recordAudit(req, {
    action: 'user.registered', entity: 'User', entityId: user._id, entityLabel: user.email,
    meta: { bootstrapped: isFirstUser },
  });

  const { raw, expiresAt } = await issueRefreshToken(user, req);
  setRefreshCookie(res, raw, expiresAt);
  res.status(201).json({ accessToken: signAccessToken(user), ...shape(user) });
});

export const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  const user = await User.findOne({ email }).select('+password');
  if (!user) throw ApiError.unauthorized('Email or password is incorrect');

  if (user.lockedUntil && user.lockedUntil > new Date()) {
    const mins = Math.ceil((user.lockedUntil - Date.now()) / 60000);
    throw new ApiError(429, `Too many attempts. Try again in ${mins} minute(s).`);
  }
  if (!user.isActive) throw ApiError.forbidden('This account is deactivated. Ask an admin to restore it.');

  if (!(await user.comparePassword(password))) {
    user.failedLoginAttempts = (user.failedLoginAttempts || 0) + 1;
    if (user.failedLoginAttempts >= MAX_ATTEMPTS) {
      user.lockedUntil = new Date(Date.now() + LOCK_MINUTES * 60000);
      user.failedLoginAttempts = 0;
    }
    await user.save();
    throw ApiError.unauthorized('Email or password is incorrect');
  }

  user.failedLoginAttempts = 0;
  user.lockedUntil = undefined;
  user.lastLoginAt = new Date();
  await user.save();

  req.user = user;
  await recordAudit(req, { action: 'auth.login', entity: 'User', entityId: user._id, entityLabel: user.email });

  const { raw, expiresAt } = await issueRefreshToken(user, req);
  setRefreshCookie(res, raw, expiresAt);
  res.json({ accessToken: signAccessToken(user), ...shape(user) });
});

export const refresh = asyncHandler(async (req, res) => {
  const raw = req.cookies?.[REFRESH_COOKIE];
  if (!raw) throw ApiError.unauthorized('Session expired');

  const rotated = await rotateRefreshToken(raw, req);
  if (!rotated) {
    clearRefreshCookie(res);
    throw ApiError.unauthorized('Session expired. Sign in again.');
  }
  const user = await User.findById(rotated.userId);
  if (!user || !user.isActive) {
    clearRefreshCookie(res);
    throw ApiError.unauthorized('This account is no longer active');
  }
  setRefreshCookie(res, rotated.raw, rotated.expiresAt);
  res.json({ accessToken: signAccessToken(user), ...shape(user) });
});

export const logout = asyncHandler(async (req, res) => {
  await revokeRefreshToken(req.cookies?.[REFRESH_COOKIE]);
  clearRefreshCookie(res);
  res.json({ message: 'Signed out' });
});

export const me = asyncHandler(async (req, res) => {
  res.json(shape(req.user));
});

export const updateMeSchema = z.object({
  name: z.string().min(2).max(120).optional(),
  phone: z.string().max(40).optional(),
  department: z.string().max(120).optional(),
  designation: z.string().max(120).optional(),
  avatarUrl: z.string().url().optional().or(z.literal('')),
  theme: z.enum(['light', 'dark', 'system']).optional(),
});

export const updateMe = asyncHandler(async (req, res) => {
  const before = req.user.toObject();
  Object.assign(req.user, req.body);
  await req.user.save();
  await recordAudit(req, {
    action: 'user.profile_updated', entity: 'User', entityId: req.user._id,
    entityLabel: req.user.email, before, after: req.user.toObject(),
  });
  res.json(shape(req.user));
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Enter your current password'),
  newPassword: passwordRule,
});

export const changePassword = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id).select('+password');
  if (!(await user.comparePassword(req.body.currentPassword))) {
    throw ApiError.badRequest('Current password is incorrect', { currentPassword: 'Incorrect' });
  }
  user.password = req.body.newPassword;
  user.mustChangePassword = false;
  await user.save();
  await revokeAllForUser(user._id);
  clearRefreshCookie(res);

  await recordAudit(req, { action: 'user.password_changed', entity: 'User', entityId: user._id, entityLabel: user.email });
  res.json({ message: 'Password changed. Sign in again on your other devices.' });
});
