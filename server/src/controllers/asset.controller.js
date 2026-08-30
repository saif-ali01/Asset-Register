import { z } from 'zod';
import mongoose from 'mongoose';
import { Asset, ASSET_CONDITIONS, ASSET_STATUSES, DEPRECIATION_METHODS } from '../models/Asset.js';
import { Assignment } from '../models/Assignment.js';
import { Maintenance } from '../models/Maintenance.js';
import { AuditLog } from '../models/AuditLog.js';
import { Category } from '../models/Lookup.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { recordAudit } from '../utils/audit.js';
import { escapeRegex, meta, parsePagination, parseSort } from '../utils/query.js';

const objectId = z.string().refine((v) => mongoose.isValidObjectId(v), 'Not a valid id');
const optionalId = objectId.optional().or(z.literal('')).transform((v) => (v === '' ? undefined : v));
const optionalDate = z.coerce.date().optional().or(z.literal('')).transform((v) => (v === '' ? undefined : v));

export const assetBodySchema = z.object({
  tag: z.string().max(40).optional(),
  name: z.string().min(2, 'Name is too short').max(400),
  description: z.string().max(2000).optional(),
  category: optionalId,
  brand: z.string().max(120).optional(),
  model: z.string().max(120).optional(),
  serialNumber: z.string().max(120).optional(),
  status: z.enum(ASSET_STATUSES).optional(),
  condition: z.enum(ASSET_CONDITIONS).optional(),
  site: optionalId,
  department: optionalId,
  subCategory: z.string().max(120).optional(),
  entity: z.string().max(60).optional(),
  vendor: optionalId,
  purchaseDate: optionalDate,
  purchaseCost: z.coerce.number().min(0).optional(),
  currency: z.string().length(3).optional(),
  invoiceNumber: z.string().max(80).optional(),
  poNumber: z.string().max(80).optional(),
  warrantyExpiry: optionalDate,
  amcExpiry: optionalDate,
  insuranceExpiry: optionalDate,
  depreciationMethod: z.enum(DEPRECIATION_METHODS).optional(),
  usefulLifeMonths: z.coerce.number().min(0).max(1200).optional(),
  salvageValue: z.coerce.number().min(0).optional(),
  quantity: z.coerce.number().min(0).optional(),
  unit: z.string().max(24).optional(),
  notes: z.string().max(4000).optional(),
  labels: z.array(z.string().max(40)).max(25).optional(),
  imageUrl: z.string().max(600).optional(),
  customFields: z.record(z.string()).optional(),
});

const POPULATE = [
  { path: 'category', select: 'name code' },
  { path: 'department', select: 'name' },
  { path: 'vendor', select: 'name code' },
  { path: 'assignedTo', select: 'name email department avatarUrl' },
  { path: 'site', select: 'name city kind', populate: { path: 'handler', select: 'name email avatarUrl' } },
];

/** Sequential tag like AST-000042, derived from the highest existing number. */
export async function nextAssetTag(prefix = 'AST') {
  const last = await Asset.findOne({ tagKey: new RegExp(`^${prefix}-\\d+$`) })
    .sort({ tagKey: -1 }).select('tag').lean();
  const n = last ? Number(last.tag.split('-')[1]) + 1 : 1;
  return `${prefix}-${String(n).padStart(6, '0')}`;
}

function buildAssetFilter(req) {
  const q = req.query;
  const filter = { isArchived: q.archived === 'true' };

  if (req.isSelfScoped) filter.assignedTo = req.user._id;
  else if (q.assignedTo === 'me') filter.assignedTo = req.user._id;
  else if (q.assignedTo === 'unassigned') filter.assignedTo = { $exists: false };
  else if (q.assignedTo && mongoose.isValidObjectId(q.assignedTo)) filter.assignedTo = q.assignedTo;

  if (q.status) filter.status = { $in: String(q.status).split(',') };
  if (q.condition) filter.condition = { $in: String(q.condition).split(',') };
  if (q.category && mongoose.isValidObjectId(q.category)) filter.category = q.category;
  if (q.site && mongoose.isValidObjectId(q.site)) filter.site = q.site;
  if (q.department && mongoose.isValidObjectId(q.department)) filter.department = q.department;
  if (q.vendor && mongoose.isValidObjectId(q.vendor)) filter.vendor = q.vendor;
  if (q.entity) filter.entity = { $in: String(q.entity).split(',') };
  if (q.brand) filter.brand = q.brand;
  if (q.label) filter.labels = q.label;

  if (q.warranty === 'expired') filter.warrantyExpiry = { $lt: new Date() };
  if (q.warranty === 'expiring') {
    filter.warrantyExpiry = { $gte: new Date(), $lte: new Date(Date.now() + 30 * 86400000) };
  }
  if (q.minCost || q.maxCost) {
    filter.purchaseCost = {};
    if (q.minCost) filter.purchaseCost.$gte = Number(q.minCost);
    if (q.maxCost) filter.purchaseCost.$lte = Number(q.maxCost);
  }
  if (q.search) {
    const rx = new RegExp(escapeRegex(String(q.search).trim()), 'i');
    filter.$or = [
      { tag: rx }, { name: rx }, { serialNumber: rx }, { brand: rx },
      { model: rx }, { invoiceNumber: rx }, { assignedToLabel: rx },
    ];
  }
  return filter;
}

export const listAssets = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query);
  const sort = parseSort(req.query.sort, '-createdAt');
  const filter = buildAssetFilter(req);

  const [items, total] = await Promise.all([
    Asset.find(filter).populate(POPULATE).sort(sort).skip(skip).limit(limit).lean({ virtuals: true }),
    Asset.countDocuments(filter),
  ]);
  res.json({ items, meta: meta({ page, limit, total }) });
});

export const getAsset = asyncHandler(async (req, res) => {
  const asset = await Asset.findById(req.params.id).populate(POPULATE);
  if (!asset || (asset.isArchived && req.query.archived !== 'true')) throw ApiError.notFound('Asset not found');
  if (req.isSelfScoped && String(asset.assignedTo?._id) !== String(req.user._id)) {
    throw ApiError.forbidden('You can only view assets signed out to you');
  }

  const [custody, maintenance, history] = await Promise.all([
    Assignment.find({ asset: asset._id })
      .populate('assignedTo assignedBy checkedInBy', 'name email avatarUrl')
      .sort({ checkedOutAt: -1 }).limit(50).lean(),
    Maintenance.find({ asset: asset._id }).populate('vendor technician', 'name').sort({ createdAt: -1 }).limit(50).lean(),
    AuditLog.find({ entity: 'Asset', entityId: asset._id }).sort({ at: -1 }).limit(100).lean(),
  ]);

  res.json({ asset: asset.toJSON(), custody, maintenance, history });
});

export const createAsset = asyncHandler(async (req, res) => {
  const payload = { ...req.body };
  if (!payload.tag) payload.tag = await nextAssetTag();

  // Tags are compared case-insensitively, so VkCPC079 and VKCPC079 collide.
  // Checking first means a clear field error instead of a raw index violation.
  const clash = await Asset.findOne({ tagKey: payload.tag.trim().toUpperCase() })
    .select('tag name isArchived').lean();
  if (clash) {
    throw ApiError.conflict(
      `Asset tag ${clash.tag} already exists${clash.isArchived ? ' (archived)' : ''}: ${clash.name}`,
      { tag: 'Already in use' }
    );
  }
  if (payload.category && !payload.usefulLifeMonths) {
    const cat = await Category.findById(payload.category).select('defaultUsefulLifeMonths').lean();
    if (cat?.defaultUsefulLifeMonths) payload.usefulLifeMonths = cat.defaultUsefulLifeMonths;
  }
  payload.createdBy = req.user._id;
  payload.updatedBy = req.user._id;

  const asset = await Asset.create(payload);
  await recordAudit(req, {
    action: 'asset.created', entity: 'Asset', entityId: asset._id, entityLabel: `${asset.tag} · ${asset.name}`,
    after: asset.toObject(),
  });
  res.status(201).json(await asset.populate(POPULATE));
});

export const updateAsset = asyncHandler(async (req, res) => {
  const asset = await Asset.findById(req.params.id);
  if (!asset) throw ApiError.notFound('Asset not found');

  if (req.body.tag) {
    const nextKey = req.body.tag.trim().toUpperCase();
    if (nextKey !== asset.tagKey) {
      const clash = await Asset.findOne({ tagKey: nextKey, _id: { $ne: asset._id } })
        .select('tag name').lean();
      if (clash) {
        throw ApiError.conflict(
          `Asset tag ${clash.tag} is already used by ${clash.name}`,
          { tag: 'Already in use' }
        );
      }
    }
  }

  const before = asset.toObject();
  Object.assign(asset, req.body, { updatedBy: req.user._id });
  await asset.save();

  await recordAudit(req, {
    action: 'asset.updated', entity: 'Asset', entityId: asset._id, entityLabel: `${asset.tag} · ${asset.name}`,
    before, after: asset.toObject(),
  });
  res.json(await asset.populate(POPULATE));
});

/** Default delete is a soft archive; ?hard=true removes the row for good. */
export const deleteAsset = asyncHandler(async (req, res) => {
  const asset = await Asset.findById(req.params.id);
  if (!asset) throw ApiError.notFound('Asset not found');

  if (req.query.hard === 'true') {
    if (req.user.role !== 'super_admin') throw ApiError.forbidden('Only a super admin can permanently delete an asset');
    await asset.deleteOne();
    await recordAudit(req, {
      action: 'asset.deleted', entity: 'Asset', entityId: asset._id,
      entityLabel: `${asset.tag} · ${asset.name}`, before: asset.toObject(),
    });
    return res.json({ message: `${asset.tag} deleted permanently` });
  }

  asset.isArchived = true;
  asset.updatedBy = req.user._id;
  await asset.save();
  await recordAudit(req, {
    action: 'asset.archived', entity: 'Asset', entityId: asset._id, entityLabel: `${asset.tag} · ${asset.name}`,
  });
  res.json({ message: `${asset.tag} archived`, asset });
});

export const restoreAsset = asyncHandler(async (req, res) => {
  const asset = await Asset.findByIdAndUpdate(req.params.id, { isArchived: false }, { new: true });
  if (!asset) throw ApiError.notFound('Asset not found');
  await recordAudit(req, { action: 'asset.restored', entity: 'Asset', entityId: asset._id, entityLabel: asset.tag });
  res.json(asset);
});

export const bulkUpdateSchema = z.object({
  ids: z.array(objectId).min(1, 'Select at least one asset').max(500),
  patch: z.object({
    status: z.enum(ASSET_STATUSES).optional(),
    condition: z.enum(ASSET_CONDITIONS).optional(),
    site: optionalId,
    category: optionalId,
    department: optionalId,
    addLabels: z.array(z.string().max(40)).optional(),
  }).refine((v) => Object.keys(v).length > 0, 'Nothing to change'),
});

export const bulkUpdate = asyncHandler(async (req, res) => {
  const { ids, patch } = req.body;
  const { addLabels, ...set } = patch;
  const update = { $set: { ...set, updatedBy: req.user._id } };
  if (addLabels?.length) update.$addToSet = { labels: { $each: addLabels } };

  const result = await Asset.updateMany({ _id: { $in: ids } }, update);
  await recordAudit(req, {
    action: 'asset.bulk_updated', entity: 'Asset', entityLabel: `${result.modifiedCount} assets`,
    changes: Object.entries(patch).map(([field, to]) => ({ field, label: field, from: null, to: String(to) })),
    meta: { ids },
  });
  res.json({ message: `Updated ${result.modifiedCount} asset(s)`, modified: result.modifiedCount });
});
