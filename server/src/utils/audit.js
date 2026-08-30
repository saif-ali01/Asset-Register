import { AuditLog } from '../models/AuditLog.js';
import { buildDiff } from './diff.js';

/**
 * Records one history entry. Failures are logged, never thrown — a broken
 * audit write must not roll back the user's actual action.
 */
export async function recordAudit(req, { action, entity, entityId, entityLabel, before, after, changes, meta }) {
  try {
    await AuditLog.create({
      actor: req.user?._id,
      actorName: req.user?.name,
      actorRole: req.user?.role,
      action,
      entity,
      entityId,
      entityLabel,
      changes: changes ?? (before || after ? buildDiff(before, after) : []),
      meta,
      ip: req.ip,
      userAgent: req.get?.('user-agent'),
    });
  } catch (err) {
    console.error('Audit write failed:', err.message);
  }
}
