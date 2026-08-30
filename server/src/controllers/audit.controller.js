import mongoose from 'mongoose';
import { AuditLog } from '../models/AuditLog.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { escapeRegex, meta, parsePagination } from '../utils/query.js';

export const listAudit = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query, { defaultLimit: 40 });
  const filter = {};

  if (req.query.entity) filter.entity = req.query.entity;
  if (req.query.entityId && mongoose.isValidObjectId(req.query.entityId)) filter.entityId = req.query.entityId;
  if (req.query.actor && mongoose.isValidObjectId(req.query.actor)) filter.actor = req.query.actor;
  if (req.query.action) filter.action = { $in: String(req.query.action).split(',') };
  if (req.query.search) {
    const rx = new RegExp(escapeRegex(String(req.query.search)), 'i');
    filter.$or = [{ entityLabel: rx }, { actorName: rx }, { action: rx }];
  }
  if (req.query.from || req.query.to) {
    filter.at = {};
    if (req.query.from) filter.at.$gte = new Date(req.query.from);
    if (req.query.to) filter.at.$lte = new Date(req.query.to);
  }

  const [items, total] = await Promise.all([
    AuditLog.find(filter).populate('actor', 'name email avatarUrl role')
      .sort({ at: -1 }).skip(skip).limit(limit).lean(),
    AuditLog.countDocuments(filter),
  ]);
  res.json({ items, meta: meta({ page, limit, total }) });
});

export const auditActions = asyncHandler(async (_req, res) => {
  const actions = await AuditLog.distinct('action');
  res.json({ actions: actions.sort() });
});
