import { z } from 'zod';
import { Category, Department, Site, Vendor } from '../models/Lookup.js';
import { Asset } from '../models/Asset.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { recordAudit } from '../utils/audit.js';
import { escapeRegex } from '../utils/query.js';

const MODELS = {
  categories: Category, departments: Department, sites: Site, vendors: Vendor,
};
const FIELD = {
  categories: 'category', departments: 'department', sites: 'site', vendors: 'vendor',
};
/** Collections whose _id is referenced by the field above, for the in-use check. */
const COLLECTION = {
  categories: 'categories', departments: 'departments', sites: 'sites', vendors: 'vendors',
};

export const lookupSchema = z.object({
  name: z.string().min(1, 'Name is required').max(140),
  code: z.string().max(24).optional(),
  description: z.string().max(600).optional(),
  isActive: z.boolean().optional(),
  // Category
  parent: z.string().optional(),
  defaultUsefulLifeMonths: z.coerce.number().min(0).max(1200).optional(),
  // Site
  city: z.string().max(120).optional(),
  state: z.string().max(120).optional(),
  country: z.string().max(120).optional(),
  building: z.string().max(120).optional(),
  floor: z.string().max(60).optional(),
  handler: z.string().optional(),
  kind: z.enum(['head_office', 'factory', 'warehouse', 'retail', 'office', 'other']).optional(),
  tagCodes: z.array(z.string().max(12)).optional(),
  // Vendor
  contactPerson: z.string().max(120).optional(),
  email: z.string().email().optional().or(z.literal('')),
  phone: z.string().max(40).optional(),
  gstin: z.string().max(24).optional(),
  address: z.string().max(400).optional(),
});

function resolve(req) {
  const Model = MODELS[req.params.resource];
  if (!Model) throw ApiError.notFound(`Unknown list "${req.params.resource}"`);
  return Model;
}

export const listLookups = asyncHandler(async (req, res) => {
  const Model = resolve(req);
  const filter = {};
  if (req.query.search) filter.name = new RegExp(escapeRegex(String(req.query.search)), 'i');
  if (req.query.active !== 'all') filter.isActive = true;

  const items = await Model.find(filter).sort('name')
    .populate({ path: 'handler', select: 'name email avatarUrl', strictPopulate: false })
    .lean();
  const counts = await Asset.aggregate([
    { $match: { isArchived: false } },
    { $group: { _id: `$${FIELD[req.params.resource]}`, count: { $sum: 1 } } },
  ]);
  const byId = Object.fromEntries(counts.map((c) => [String(c._id), c.count]));
  res.json({ items: items.map((i) => ({ ...i, assetCount: byId[String(i._id)] || 0 })) });
});

export const createLookup = asyncHandler(async (req, res) => {
  const Model = resolve(req);
  const doc = await Model.create({ ...req.body, createdBy: req.user._id });
  await recordAudit(req, {
    action: `${req.params.resource}.created`, entity: Model.modelName,
    entityId: doc._id, entityLabel: doc.name, after: doc.toObject(),
  });
  res.status(201).json(doc);
});

export const updateLookup = asyncHandler(async (req, res) => {
  const Model = resolve(req);
  const doc = await Model.findById(req.params.id);
  if (!doc) throw ApiError.notFound('Not found');
  const before = doc.toObject();
  Object.assign(doc, req.body);
  await doc.save();
  await recordAudit(req, {
    action: `${req.params.resource}.updated`, entity: Model.modelName,
    entityId: doc._id, entityLabel: doc.name, before, after: doc.toObject(),
  });
  res.json(doc);
});

/** Refuses to remove anything still referenced by an asset. */
export const deleteLookup = asyncHandler(async (req, res) => {
  const Model = resolve(req);
  const doc = await Model.findById(req.params.id);
  if (!doc) throw ApiError.notFound('Not found');

  const inUse = await Asset.countDocuments({ [FIELD[req.params.resource]]: doc._id });
  if (inUse > 0) {
    throw ApiError.conflict(`${doc.name} is used by ${inUse} asset(s). Reassign them first, or deactivate this entry instead.`);
  }
  await doc.deleteOne();
  await recordAudit(req, {
    action: `${req.params.resource}.deleted`, entity: Model.modelName,
    entityId: doc._id, entityLabel: doc.name,
  });
  res.json({ message: `${doc.name} removed` });
});
