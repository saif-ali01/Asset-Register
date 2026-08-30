import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { RefreshToken } from '../models/RefreshToken.js';

export const REFRESH_COOKIE = 'at_refresh';

export function signAccessToken(user) {
  return jwt.sign(
    { sub: String(user._id), role: user.role, name: user.name },
    env.accessSecret,
    { expiresIn: env.accessTtl }
  );
}

export function verifyAccessToken(token) {
  return jwt.verify(token, env.accessSecret);
}

const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');

export async function issueRefreshToken(user, req) {
  const raw = crypto.randomBytes(48).toString('hex');
  const expiresAt = new Date(Date.now() + env.refreshTtlDays * 86400000);
  await RefreshToken.create({
    user: user._id,
    tokenHash: hash(raw),
    expiresAt,
    ip: req?.ip,
    userAgent: req?.get('user-agent'),
  });
  return { raw, expiresAt };
}

export async function rotateRefreshToken(raw, req) {
  const existing = await RefreshToken.findOne({ tokenHash: hash(raw) });
  if (!existing || existing.revokedAt || existing.expiresAt < new Date()) return null;
  const next = await issueRefreshToken({ _id: existing.user }, req);
  existing.revokedAt = new Date();
  existing.replacedBy = hash(next.raw);
  await existing.save();
  return { userId: existing.user, ...next };
}

export async function revokeRefreshToken(raw) {
  if (!raw) return;
  await RefreshToken.updateOne(
    { tokenHash: hash(raw), revokedAt: { $exists: false } },
    { revokedAt: new Date() }
  );
}

export async function revokeAllForUser(userId) {
  await RefreshToken.updateMany(
    { user: userId, revokedAt: { $exists: false } },
    { revokedAt: new Date() }
  );
}

export function setRefreshCookie(res, raw, expiresAt) {
  res.cookie(REFRESH_COOKIE, raw, {
    httpOnly: true,
    secure: env.isProd,
    /**
     * 'strict' blocks the cookie on every cross-site request, including the
     * background /auth/refresh call itself whenever the client and API are
     * on different domains (e.g. a Vercel + Render split). The refresh cookie
     * would then never actually reach the server, so every refresh attempt
     * failed and users were bounced to login roughly when their access token
     * expired — regardless of the 30-day REFRESH_TOKEN_TTL_DAYS setting,
     * which never got a chance to apply. 'none' (paired with secure: true,
     * which browsers require alongside it) is the setting a genuinely
     * cross-domain deployment needs. Same-origin setups (client and API
     * served from one domain) can use 'strict' safely instead.
     */
    sameSite: env.isProd ? 'none' : 'lax',
    expires: expiresAt,
    path: '/api/auth',
  });
}

export function clearRefreshCookie(res) {
  res.clearCookie(REFRESH_COOKIE, { path: '/api/auth' });
}
