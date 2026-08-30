import { z } from 'zod';
import mongoose from 'mongoose';
import { Maintenance, MAINTENANCE_STATUSES, MAINTENANCE_TYPES } from '../models/Maintenance.js';
import { Asset } from '../models/Asset.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { recordAudit } from '../utils/audit.js';
import { meta, parsePagination, parseSort } from '../utils/query.js';

const objectId = z.string().refine((v) => mongoose.isValidObjectId(v), 'Not a valid id');

export const maintenanceSchema = z.object({
  asset: objectId,
  type: z.enum(MAINTENANCE_TYPES).optional(),
  status: z.enum(MAINTENANCE_STATUSES).optional(),
  title: z.string().min(3, 'Give the job a title').max(200),
  description: z.string().max(2000).optional(),
  scheduledFor: z.coerce.date().optional(),
  cost: z.coerce.number().min(0).optional(),
  vendor: objectId.optional(),
  technician: objectId.optional(),
  downtimeHours: z.coerce.number().min(0).optional(),
  resolution: z.string().max(2000).optional(),
  /**
   * Opt-in. Scheduling a job never moves the asset; only starting work does,
   * and only when the caller says so. Booking next month's service should not
   * make a laptop that someone is using today read as "under repair".
   */
  updateAssetStatus: z.boolean().optional(),
});

/** Statuses from which it makes sense to pull an asset into the workshop. */
const CAN_GO_TO_REPAIR = ['available', 'checked_out', 'leased'];

export const listMaintenance = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query);
  const filter = {};
  if (req.query.asset && mongoose.isValidObjectId(req.query.asset)) filter.asset = req.query.asset;
  if (req.query.status) filter.status = { $in: String(req.query.status).split(',') };
  if (req.query.type) filter.type = req.query.type;

  const [items, total] = await Promise.all([
    Maintenance.find(filter)
      .populate('asset', 'tag name status')
      .populate('vendor', 'name').populate('technician', 'name email')
      .sort(parseSort(req.query.sort, '-createdAt')).skip(skip).limit(limit).lean(),
    Maintenance.countDocuments(filter),
  ]);
  res.json({ items, meta: meta({ page, limit, total }) });
});

/**
 * Moves an asset into the workshop, remembering where it came from. Returns
 * true when the asset was actually changed.
 */
async function sendToRepair(asset, job) {
  if (asset.status === 'under_repair') return false;
  if (!CAN_GO_TO_REPAIR.includes(asset.status)) return false;

  job.previousAssetStatus = asset.status;
  job.assetStatusChanged = true;
  asset.status = 'under_repair';
  // An asset in the workshop is not in anyone's hands.
  asset.assignedTo = undefined;
  asset.assignedToLabel = undefined;
  asset.assignedAt = undefined;
  asset.dueAt = undefined;
  await asset.save();
  return true;
}

/** Puts the asset back to whatever it was before this job took it. */
async function returnFromRepair(asset, job) {
  if (!job.assetStatusChanged) return false;
  if (asset.status !== 'under_repair') return false;

  // A job that took a checked-out asset returns it to stock, not to the
  // person — the custody record was closed when it went in.
  const restore = job.previousAssetStatus === 'checked_out'
    ? 'available'
    : job.previousAssetStatus || 'available';

  asset.status = restore;
  await asset.save();
  job.assetStatusChanged = false;
  return true;
}

export const createMaintenance = asyncHandler(async (req, res) => {
  const { updateAssetStatus, ...body } = req.body;
  const asset = await Asset.findById(body.asset);
  if (!asset) throw ApiError.notFound('Asset not found');

  const job = new Maintenance({ ...body, createdBy: req.user._id });

  // Only an explicitly in-progress job with the flag set touches the asset.
  // A scheduled job is a diary entry and nothing more.
  let moved = false;
  if (job.status === 'in_progress' && updateAssetStatus) {
    moved = await sendToRepair(asset, job);
    if (moved) job.startedAt = job.startedAt || new Date();
  }
  await job.save();

  await recordAudit(req, {
    action: 'maintenance.created', entity: 'Maintenance', entityId: job._id,
    entityLabel: `${asset.tag} · ${job.title}`, after: job.toObject(),
    meta: { assetId: asset._id, assetStatusChanged: moved },
  });

  res.status(201).json({
    ...job.toObject(),
    assetStatus: asset.status,
    assetStatusChanged: moved,
  });
});

export const updateMaintenance = asyncHandler(async (req, res) => {
  const { updateAssetStatus, ...body } = req.body;
  const job = await Maintenance.findById(req.params.id);
  if (!job) throw ApiError.notFound('Maintenance job not found');

  const asset = await Asset.findById(job.asset);
  const before = job.toObject();
  const nextStatus = body.status;

  Object.assign(job, body);

  let moved = false;
  let restored = false;

  if (asset) {
    if (nextStatus === 'in_progress') {
      if (!job.startedAt) job.startedAt = new Date();
      // Starting work is the moment the asset physically leaves its place, so
      // this is where the status change belongs — still opt-in.
      if (updateAssetStatus !== false) moved = await sendToRepair(asset, job);
    } else if (nextStatus === 'completed' || nextStatus === 'cancelled') {
      if (nextStatus === 'completed' && !job.completedAt) job.completedAt = new Date();
      restored = await returnFromRepair(asset, job);
    }
  }

  await job.save();

  await recordAudit(req, {
    action: 'maintenance.updated', entity: 'Maintenance', entityId: job._id,
    entityLabel: job.title, before, after: job.toObject(),
    meta: { assetStatusChanged: moved, assetStatusRestored: restored },
  });

  res.json({
    ...job.toObject(),
    assetStatus: asset?.status,
    assetStatusChanged: moved,
    assetStatusRestored: restored,
  });
});

export const deleteMaintenance = asyncHandler(async (req, res) => {
  const job = await Maintenance.findById(req.params.id);
  if (!job) throw ApiError.notFound('Maintenance job not found');

  // Removing a job that had pulled an asset in must not leave it stranded
  // in "under repair" with nothing explaining why.
  if (job.assetStatusChanged) {
    const asset = await Asset.findById(job.asset);
    if (asset) await returnFromRepair(asset, job);
  }

  await job.deleteOne();
  await recordAudit(req, {
    action: 'maintenance.deleted', entity: 'Maintenance', entityId: job._id,
    entityLabel: job.title, before: job.toObject(),
  });
  res.json({ message: 'Maintenance job removed' });
});
