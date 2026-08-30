import { z } from 'zod';
import mongoose from 'mongoose';
import { Assignment } from '../models/Assignment.js';
import { Asset } from '../models/Asset.js';
import { User } from '../models/User.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { recordAudit } from '../utils/audit.js';
import { meta, parsePagination, parseSort } from '../utils/query.js';

const objectId = z.string().refine((v) => mongoose.isValidObjectId(v), 'Not a valid id');

export const checkoutSchema = z.object({
  asset: objectId,
  assignedTo: objectId,
  dueAt: z.coerce.date().optional(),
  conditionOut: z.string().max(60).optional(),
  siteOut: objectId.optional(),
  notesOut: z.string().max(1000).optional(),
});

export const checkinSchema = z.object({
  conditionIn: z.string().max(60).optional(),
  siteIn: objectId.optional(),
  notesIn: z.string().max(1000).optional(),
  status: z
    .enum(['available', 'under_repair', 'lost_missing', 'disposed', 'leased'])
    .default('available'),
});

/** Only an available asset can be signed out. */
const ASSIGNABLE = ['available'];

export const listAssignments = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query);
  const filter = {};
  if (req.isSelfScoped) filter.assignedTo = req.user._id;
  else if (req.query.assignedTo === 'me') filter.assignedTo = req.user._id;
  else if (req.query.assignedTo && mongoose.isValidObjectId(req.query.assignedTo)) filter.assignedTo = req.query.assignedTo;

  if (req.query.asset && mongoose.isValidObjectId(req.query.asset)) filter.asset = req.query.asset;
  if (req.query.state === 'open') filter.checkedInAt = { $exists: false };
  if (req.query.state === 'returned') filter.checkedInAt = { $exists: true };
  if (req.query.state === 'overdue') {
    filter.checkedInAt = { $exists: false };
    filter.dueAt = { $lt: new Date() };
  }

  const [items, total] = await Promise.all([
    Assignment.find(filter)
      .populate('asset', 'tag name status imageUrl')
      .populate('assignedTo assignedBy checkedInBy', 'name email department avatarUrl')
      .populate('siteOut siteIn', 'name')
      .sort(parseSort(req.query.sort, '-checkedOutAt')).skip(skip).limit(limit).lean({ virtuals: true }),
    Assignment.countDocuments(filter),
  ]);
  res.json({ items, meta: meta({ page, limit, total }) });
});

/** Sign an asset out to a person. Rejects anything already in someone's hands. */
export const checkout = asyncHandler(async (req, res) => {
  const { asset: assetId, assignedTo, dueAt, conditionOut, siteOut, notesOut } = req.body;

  const [asset, person] = await Promise.all([Asset.findById(assetId), User.findById(assignedTo)]);
  if (!asset) throw ApiError.notFound('Asset not found');
  if (!person || !person.isActive) throw ApiError.badRequest('That person is not an active user');
  if (asset.isArchived) throw ApiError.badRequest('Archived assets cannot be checked out');
  if (!ASSIGNABLE.includes(asset.status)) {
    throw ApiError.conflict(`${asset.tag} is ${asset.status.replace('_', ' ')} and cannot be checked out`);
  }

  const record = await Assignment.create({
    asset: asset._id, assignedTo: person._id, assignedBy: req.user._id,
    dueAt, conditionOut: conditionOut || asset.condition,
    siteOut: siteOut || asset.site, notesOut, status: 'open',
  });

  const before = asset.toObject();
  asset.status = 'checked_out';
  asset.assignedTo = person._id;
  asset.assignedToLabel = person.name;
  asset.assignedAt = new Date();
  asset.dueAt = dueAt;
  if (siteOut) asset.site = siteOut;
  asset.updatedBy = req.user._id;
  await asset.save();

  await recordAudit(req, {
    action: 'asset.checked_out', entity: 'Asset', entityId: asset._id,
    entityLabel: `${asset.tag} · ${asset.name}`, before, after: asset.toObject(),
    meta: { assignmentId: record._id, to: person.email, dueAt },
  });

  res.status(201).json(await record.populate([
    { path: 'asset', select: 'tag name status' },
    { path: 'assignedTo assignedBy', select: 'name email' },
  ]));
});

/** Take an asset back. Condition on return can send it straight to repair. */
export const checkin = asyncHandler(async (req, res) => {
  const record = await Assignment.findById(req.params.id);
  if (!record) throw ApiError.notFound('Assignment not found');
  if (record.checkedInAt) throw ApiError.conflict('This assignment was already closed');

  const asset = await Asset.findById(record.asset);
  if (!asset) throw ApiError.notFound('The asset for this assignment no longer exists');

  const { conditionIn, siteIn, notesIn, status } = req.body;
  record.checkedInAt = new Date();
  record.checkedInBy = req.user._id;
  record.conditionIn = conditionIn;
  record.siteIn = siteIn || asset.site;
  record.notesIn = notesIn;
  record.status = 'returned';
  await record.save();

  const before = asset.toObject();
  asset.status = status;
  asset.assignedTo = undefined;
  asset.assignedToLabel = undefined;
  asset.assignedAt = undefined;
  asset.dueAt = undefined;
  if (conditionIn) asset.condition = conditionIn;
  if (siteIn) asset.site = siteIn;
  asset.updatedBy = req.user._id;
  await asset.save();

  await recordAudit(req, {
    action: 'asset.checked_in', entity: 'Asset', entityId: asset._id,
    entityLabel: `${asset.tag} · ${asset.name}`, before, after: asset.toObject(),
    meta: { assignmentId: record._id, conditionIn, notesIn },
  });

  res.json(record);
});

/** Move an open assignment to a different person in one step. */
export const transferSchema = z.object({
  assignedTo: objectId,
  notes: z.string().max(1000).optional(),
  dueAt: z.coerce.date().optional(),
});

export const transfer = asyncHandler(async (req, res) => {
  const open = await Assignment.findById(req.params.id);
  if (!open || open.checkedInAt) throw ApiError.notFound('No open assignment to transfer');

  const [asset, person] = await Promise.all([Asset.findById(open.asset), User.findById(req.body.assignedTo)]);
  if (!person?.isActive) throw ApiError.badRequest('That person is not an active user');

  open.checkedInAt = new Date();
  open.checkedInBy = req.user._id;
  open.notesIn = req.body.notes || 'Transferred';
  open.status = 'returned';
  await open.save();

  const next = await Assignment.create({
    asset: asset._id, assignedTo: person._id, assignedBy: req.user._id,
    dueAt: req.body.dueAt, conditionOut: asset.condition, siteOut: asset.site,
    notesOut: req.body.notes || `Transferred from previous holder`, status: 'open',
  });

  const before = asset.toObject();
  asset.assignedTo = person._id;
  asset.assignedAt = new Date();
  asset.dueAt = req.body.dueAt;
  asset.status = 'checked_out';
  await asset.save();

  await recordAudit(req, {
    action: 'asset.transferred', entity: 'Asset', entityId: asset._id,
    entityLabel: `${asset.tag} · ${asset.name}`, before, after: asset.toObject(),
    meta: { to: person.email, assignmentId: next._id },
  });

  res.status(201).json(next);
});
