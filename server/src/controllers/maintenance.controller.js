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
  billNumber: z.string().max(80).optional(),
  vendor: objectId.optional(),
  technician: objectId.optional(),
  downtimeHours: z.coerce.number().min(0).optional(),
  resolution: z.string().max(2000).optional(),
  /** Editable directly so a mis-typed date can be corrected after the fact. */
  startedAt: z.coerce.date().optional(),
  completedAt: z.coerce.date().optional(),
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
  /**
   * The holder is deliberately left attached. A repair is a temporary change
   * of state, not a change of custody — the person is still accountable for
   * the machine, and the open custody record stays open to say so.
   *
   * An earlier version cleared the holder here while leaving that custody
   * record open, which is exactly what produced assets reading "Available"
   * in the header while the Custody tab still said someone was holding them.
   */
  await asset.save();
  return true;
}

/**
 * Puts the asset back to exactly what it was before this job took it.
 *
 * "Exactly" matters: a checked-out asset returns to its custodian, a leased
 * one returns to leased, an available one to available. Guessing "available"
 * for everything silently ended people's custody and lost the lease state.
 */
async function returnFromRepair(asset, job) {
  if (!job.assetStatusChanged) return false;
  if (asset.status !== 'under_repair') return false;

  asset.status = job.previousAssetStatus || 'available';

  // If the holder went missing while the job was open (older data, or a
  // manual edit), fall back rather than restoring a checked-out asset that
  // names nobody — that is the very inconsistency this path exists to avoid.
  if (asset.status === 'checked_out' && !asset.assignedTo && !asset.assignedToLabel) {
    asset.status = 'available';
  }

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
