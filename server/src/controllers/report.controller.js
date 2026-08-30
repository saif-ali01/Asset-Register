import { z } from 'zod';
import mongoose from 'mongoose';
import XLSX from 'xlsx';
import { Asset } from '../models/Asset.js';
import { Assignment } from '../models/Assignment.js';
import { Maintenance } from '../models/Maintenance.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { recordAudit } from '../utils/audit.js';
import { ASSET_STATUSES, CLOSED_STATUSES } from '../config/reference.js';

/**
 * Reporting is deliberately built from an allow-list rather than accepting
 * raw aggregation stages. A report spec names dimensions and measures by key;
 * nothing the caller sends reaches Mongo as an operator, so a report cannot
 * be turned into an arbitrary query.
 */

/** Group-by fields. `ref` means the value needs resolving through a lookup. */
export const DIMENSIONS = {
  status: { label: 'Status', expr: '$status' },
  condition: { label: 'Condition', expr: '$condition' },
  entity: { label: 'Owning company', expr: '$entity' },
  brand: { label: 'Brand', expr: '$brand' },
  subCategory: { label: 'Sub category', expr: '$subCategory' },
  category: { label: 'Category', ref: 'categories', local: 'category', show: 'name' },
  department: { label: 'Department', ref: 'departments', local: 'department', show: 'name' },
  site: { label: 'Site', ref: 'sites', local: 'site', show: 'name' },
  city: { label: 'City', ref: 'sites', local: 'site', show: 'city' },
  handler: { label: 'Handler', ref: 'sites', local: 'site', show: 'handler', deep: 'users' },
  vendor: { label: 'Vendor', ref: 'vendors', local: 'vendor', show: 'name' },
  holder: { label: 'Current holder', ref: 'users', local: 'assignedTo', show: 'name' },
  purchaseYear: {
    label: 'Purchase year',
    expr: { $cond: [{ $ifNull: ['$purchaseDate', false] }, { $year: '$purchaseDate' }, null] },
  },
  addedMonth: {
    label: 'Month added',
    expr: { $dateToString: { format: '%Y-%m', date: '$createdAt' } },
  },
};

/** Aggregations available per group. */
export const MEASURES = {
  count: { label: 'Assets', expr: { $sum: 1 } },
  checkedOut: { label: 'Checked out', expr: { $sum: { $cond: [{ $eq: ['$status', 'checked_out'] }, 1, 0] } } },
  available: { label: 'Available', expr: { $sum: { $cond: [{ $eq: ['$status', 'available'] }, 1, 0] } } },
  underRepair: { label: 'Under repair', expr: { $sum: { $cond: [{ $eq: ['$status', 'under_repair'] }, 1, 0] } } },
  leased: { label: 'Leased', expr: { $sum: { $cond: [{ $eq: ['$status', 'leased'] }, 1, 0] } } },
  lostMissing: { label: 'Lost/Missing', expr: { $sum: { $cond: [{ $eq: ['$status', 'lost_missing'] }, 1, 0] } } },
  disposed: { label: 'Disposed', expr: { $sum: { $cond: [{ $eq: ['$status', 'disposed'] }, 1, 0] } } },
  closedOut: { label: 'Closed out', expr: { $sum: { $cond: [{ $in: ['$status', CLOSED_STATUSES] }, 1, 0] } } },
  purchaseValue: { label: 'Purchase value', expr: { $sum: { $ifNull: ['$purchaseCost', 0] } }, money: true },
  missingSerial: {
    label: 'No serial',
    expr: { $sum: { $cond: [{ $in: [{ $ifNull: ['$serialNumber', ''] }, ['', null]] }, 1, 0] } },
  },
  unlinkedHolder: {
    label: 'Holder not linked',
    expr: {
      $sum: {
        $cond: [
          { $and: [
            { $gt: [{ $strLenCP: { $ifNull: ['$assignedToLabel', ''] } }, 0] },
            { $not: [{ $ifNull: ['$assignedTo', false] }] },
          ] },
          1, 0,
        ],
      },
    },
  },
};

const objectId = z.string().refine((v) => mongoose.isValidObjectId(v), 'Not a valid id');

export const reportSpecSchema = z.object({
  /** Named prebuilt report, or omitted for a custom one. */
  preset: z.string().max(60).optional(),
  groupBy: z.array(z.enum(Object.keys(DIMENSIONS))).min(1).max(3).optional(),
  measures: z.array(z.enum(Object.keys(MEASURES))).min(1).max(8).optional(),
  filters: z.object({
    status: z.array(z.enum(ASSET_STATUSES)).optional(),
    category: objectId.optional(),
    department: objectId.optional(),
    site: objectId.optional(),
    vendor: objectId.optional(),
    entity: z.string().max(60).optional(),
    brand: z.string().max(120).optional(),
    archived: z.boolean().optional(),
    purchasedFrom: z.coerce.date().optional(),
    purchasedTo: z.coerce.date().optional(),
    addedFrom: z.coerce.date().optional(),
    addedTo: z.coerce.date().optional(),
  }).optional(),
  sort: z.object({
    by: z.string().max(40).optional(),
    dir: z.enum(['asc', 'desc']).optional(),
  }).optional(),
  limit: z.coerce.number().min(1).max(2000).optional(),
  /** Only used by the export route; zod would otherwise strip it. */
  format: z.enum(['xlsx', 'csv']).optional(),
});

/**
 * Prebuilt reports. Each is just a saved spec, so the custom builder and the
 * presets run through exactly the same code path — a preset can be opened in
 * the builder and adjusted rather than being a dead end.
 */
export const PRESETS = {
  by_site: {
    label: 'Assets by site',
    blurb: 'The register\u2019s own site pivot: every status, one row per site.',
    spec: {
      groupBy: ['site'],
      measures: ['count', 'available', 'checkedOut', 'underRepair', 'leased', 'disposed'],
      sort: { by: 'count', dir: 'desc' },
    },
  },
  by_handler: {
    label: 'Assets by handler',
    blurb: 'Who is responsible for what, via the sites they own.',
    spec: {
      groupBy: ['handler'],
      measures: ['count', 'available', 'checkedOut', 'underRepair'],
      sort: { by: 'count', dir: 'desc' },
    },
  },
  by_category: {
    label: 'Assets by category',
    blurb: 'Fleet composition, and how much of each type is out.',
    spec: {
      groupBy: ['category'],
      measures: ['count', 'checkedOut', 'available', 'missingSerial'],
      sort: { by: 'count', dir: 'desc' },
    },
  },
  by_department: {
    label: 'Assets by department',
    blurb: 'What each team holds, for internal cost allocation.',
    spec: {
      groupBy: ['department'],
      measures: ['count', 'checkedOut', 'purchaseValue'],
      sort: { by: 'count', dir: 'desc' },
    },
  },
  by_entity: {
    label: 'Assets by owning company',
    blurb: 'Split across group entities, read from the tag prefix.',
    spec: {
      groupBy: ['entity'],
      measures: ['count', 'checkedOut', 'disposed', 'purchaseValue'],
      sort: { by: 'count', dir: 'desc' },
    },
  },
  site_by_category: {
    label: 'Site by category',
    blurb: 'Two-level breakdown: what sits where, by type.',
    spec: {
      groupBy: ['site', 'category'],
      measures: ['count', 'checkedOut'],
      sort: { by: 'count', dir: 'desc' },
    },
  },
  closed_out: {
    label: 'Disposed, sold, donated and lost',
    blurb: 'The write-off register, grouped by how it left.',
    spec: {
      groupBy: ['status', 'category'],
      measures: ['count', 'purchaseValue'],
      filters: { status: CLOSED_STATUSES },
      sort: { by: 'count', dir: 'desc' },
    },
  },
  data_gaps: {
    label: 'Data completeness by site',
    blurb: 'Where the register is thin: missing serials and unlinked holders.',
    spec: {
      groupBy: ['site'],
      measures: ['count', 'missingSerial', 'unlinkedHolder'],
      sort: { by: 'missingSerial', dir: 'desc' },
    },
  },
  brand_mix: {
    label: 'Brand mix',
    blurb: 'Which manufacturers dominate, useful at renewal time.',
    spec: {
      groupBy: ['brand'],
      measures: ['count', 'checkedOut', 'underRepair'],
      sort: { by: 'count', dir: 'desc' },
      limit: 40,
    },
  },
};

/** Reports that read other collections and so are handled separately. */
export const SPECIAL_PRESETS = {
  custody_open: {
    label: 'Who holds what right now',
    blurb: 'Every open check-out, oldest first, with days held.',
  },
  custody_overdue: {
    label: 'Overdue returns',
    blurb: 'Past the due-back date and still out.',
  },
  maintenance_history: {
    label: 'Maintenance history and cost',
    blurb: 'Every job with its cost, downtime and who handled it.',
  },
};

function buildMatch(filters = {}) {
  const match = { isArchived: Boolean(filters.archived) };

  if (filters.status?.length) match.status = { $in: filters.status };
  if (filters.category) match.category = new mongoose.Types.ObjectId(filters.category);
  if (filters.department) match.department = new mongoose.Types.ObjectId(filters.department);
  if (filters.site) match.site = new mongoose.Types.ObjectId(filters.site);
  if (filters.vendor) match.vendor = new mongoose.Types.ObjectId(filters.vendor);
  if (filters.entity) match.entity = filters.entity;
  if (filters.brand) match.brand = filters.brand;

  if (filters.purchasedFrom || filters.purchasedTo) {
    match.purchaseDate = {};
    if (filters.purchasedFrom) match.purchaseDate.$gte = filters.purchasedFrom;
    if (filters.purchasedTo) match.purchaseDate.$lte = filters.purchasedTo;
  }
  if (filters.addedFrom || filters.addedTo) {
    match.createdAt = {};
    if (filters.addedFrom) match.createdAt.$gte = filters.addedFrom;
    if (filters.addedTo) match.createdAt.$lte = filters.addedTo;
  }
  return match;
}

/**
 * Turns a validated spec into an aggregation pipeline. Pure and exported so
 * the shape can be asserted in tests without a database.
 */
export function buildPipeline(spec) {
  const groupBy = spec.groupBy?.length ? spec.groupBy : ['status'];
  const measures = spec.measures?.length ? spec.measures : ['count'];
  const limit = spec.limit || 500;

  const pipeline = [{ $match: buildMatch(spec.filters) }];

  // Only join the collections the requested dimensions actually need.
  const needed = new Set();
  for (const key of groupBy) {
    const dim = DIMENSIONS[key];
    if (dim?.ref) needed.add(dim.ref);
    if (dim?.deep) needed.add(dim.deep);
  }

  if (needed.has('sites')) {
    pipeline.push(
      { $lookup: { from: 'sites', localField: 'site', foreignField: '_id', as: '_site' } },
      { $unwind: { path: '$_site', preserveNullAndEmptyArrays: true } }
    );
  }
  if (needed.has('users')) {
    pipeline.push(
      { $lookup: { from: 'users', localField: '_site.handler', foreignField: '_id', as: '_handler' } },
      { $unwind: { path: '$_handler', preserveNullAndEmptyArrays: true } }
    );
  }
  for (const [ref, local, alias] of [
    ['categories', 'category', '_category'],
    ['departments', 'department', '_department'],
    ['vendors', 'vendor', '_vendor'],
  ]) {
    if (needed.has(ref)) {
      pipeline.push(
        { $lookup: { from: ref, localField: local, foreignField: '_id', as: alias } },
        { $unwind: { path: `$${alias}`, preserveNullAndEmptyArrays: true } }
      );
    }
  }
  if (needed.has('users') === false && groupBy.includes('holder')) {
    pipeline.push(
      { $lookup: { from: 'users', localField: 'assignedTo', foreignField: '_id', as: '_holder' } },
      { $unwind: { path: '$_holder', preserveNullAndEmptyArrays: true } }
    );
  }

  const groupKey = {};
  for (const key of groupBy) {
    const dim = DIMENSIONS[key];
    if (key === 'handler') groupKey[key] = { $ifNull: ['$_handler.name', 'No handler'] };
    else if (key === 'holder') groupKey[key] = { $ifNull: ['$_holder.name', 'Nobody'] };
    else if (key === 'city') groupKey[key] = { $ifNull: ['$_site.city', 'No city'] };
    else if (key === 'site') groupKey[key] = { $ifNull: ['$_site.name', 'No site'] };
    else if (key === 'category') groupKey[key] = { $ifNull: ['$_category.name', 'Uncategorised'] };
    else if (key === 'department') groupKey[key] = { $ifNull: ['$_department.name', 'No department'] };
    else if (key === 'vendor') groupKey[key] = { $ifNull: ['$_vendor.name', 'No vendor'] };
    else groupKey[key] = { $ifNull: [dim.expr, 'Unspecified'] };
  }

  const groupStage = { _id: groupKey };
  for (const key of measures) groupStage[key] = MEASURES[key].expr;
  pipeline.push({ $group: groupStage });

  const projection = { _id: 0 };
  for (const key of groupBy) projection[key] = `$_id.${key}`;
  for (const key of measures) projection[key] = 1;
  pipeline.push({ $project: projection });

  const sortBy = spec.sort?.by && (measures.includes(spec.sort.by) || groupBy.includes(spec.sort.by))
    ? spec.sort.by
    : measures[0];
  pipeline.push({ $sort: { [sortBy]: spec.sort?.dir === 'asc' ? 1 : -1 } });
  pipeline.push({ $limit: limit });

  return pipeline;
}

/** Column metadata so the client can render without guessing types. */
export function describeColumns(spec) {
  const groupBy = spec.groupBy?.length ? spec.groupBy : ['status'];
  const measures = spec.measures?.length ? spec.measures : ['count'];
  return [
    ...groupBy.map((key) => ({ key, label: DIMENSIONS[key].label, type: 'text' })),
    ...measures.map((key) => ({
      key,
      label: MEASURES[key].label,
      type: MEASURES[key].money ? 'money' : 'number',
    })),
  ];
}

async function runCustody({ overdueOnly }) {
  const filter = { checkedInAt: { $exists: false } };
  if (overdueOnly) filter.dueAt = { $lt: new Date() };

  const rows = await Assignment.find(filter)
    .populate('asset', 'tag name status')
    .populate('assignedTo', 'name email department')
    .populate('siteOut', 'name city')
    .sort({ checkedOutAt: 1 })
    .limit(2000)
    .lean();

  return {
    columns: [
      { key: 'tag', label: 'Asset tag', type: 'text' },
      { key: 'asset', label: 'Asset', type: 'text' },
      { key: 'holder', label: 'Held by', type: 'text' },
      { key: 'department', label: 'Department', type: 'text' },
      { key: 'site', label: 'Site', type: 'text' },
      { key: 'out', label: 'Out since', type: 'date' },
      { key: 'due', label: 'Due back', type: 'date' },
      { key: 'daysHeld', label: 'Days held', type: 'number' },
    ],
    rows: rows.map((r) => ({
      tag: r.asset?.tag || '',
      asset: r.asset?.name || '',
      holder: r.assignedTo?.name || '',
      department: r.assignedTo?.department || '',
      site: r.siteOut?.name || '',
      out: r.checkedOutAt,
      due: r.dueAt || null,
      daysHeld: Math.floor((Date.now() - new Date(r.checkedOutAt).getTime()) / 86400000),
    })),
  };
}

async function runMaintenanceHistory() {
  const rows = await Maintenance.find()
    .populate('asset', 'tag name')
    .populate('vendor', 'name')
    .populate('technician', 'name')
    .sort({ createdAt: -1 })
    .limit(2000)
    .lean();

  return {
    columns: [
      { key: 'tag', label: 'Asset tag', type: 'text' },
      { key: 'asset', label: 'Asset', type: 'text' },
      { key: 'title', label: 'Job', type: 'text' },
      { key: 'type', label: 'Type', type: 'text' },
      { key: 'status', label: 'Status', type: 'text' },
      { key: 'scheduledFor', label: 'Scheduled', type: 'date' },
      { key: 'completedAt', label: 'Completed', type: 'date' },
      { key: 'cost', label: 'Cost', type: 'money' },
      { key: 'downtimeHours', label: 'Downtime (h)', type: 'number' },
      { key: 'handledBy', label: 'Handled by', type: 'text' },
    ],
    rows: rows.map((r) => ({
      tag: r.asset?.tag || '',
      asset: r.asset?.name || '',
      title: r.title,
      type: r.type,
      status: r.status,
      scheduledFor: r.scheduledFor || null,
      completedAt: r.completedAt || null,
      cost: r.cost ?? null,
      downtimeHours: r.downtimeHours ?? null,
      handledBy: r.vendor?.name || r.technician?.name || '',
    })),
  };
}

/** Resolves a spec (preset or custom) into columns + rows. */
export async function runReport(input) {
  if (input.preset && SPECIAL_PRESETS[input.preset]) {
    if (input.preset === 'custody_open') return runCustody({ overdueOnly: false });
    if (input.preset === 'custody_overdue') return runCustody({ overdueOnly: true });
    if (input.preset === 'maintenance_history') return runMaintenanceHistory();
  }

  // A preset supplies the base spec; anything sent alongside it wins, so a
  // preset can be tweaked in the builder without being rebuilt from scratch.
  const base = input.preset ? PRESETS[input.preset]?.spec : null;
  if (input.preset && !base) throw ApiError.notFound(`Unknown report "${input.preset}"`);

  const spec = {
    ...(base || {}),
    ...(input.groupBy ? { groupBy: input.groupBy } : {}),
    ...(input.measures ? { measures: input.measures } : {}),
    filters: { ...(base?.filters || {}), ...(input.filters || {}) },
    sort: input.sort || base?.sort,
    limit: input.limit || base?.limit,
  };

  const rows = await Asset.aggregate(buildPipeline(spec));
  const columns = describeColumns(spec);

  // A totals row is what people reach for first on a grouped report.
  const totals = {};
  for (const col of columns.filter((c) => c.type !== 'text')) {
    totals[col.key] = rows.reduce((sum, r) => sum + (Number(r[col.key]) || 0), 0);
  }

  return { columns, rows, totals, spec };
}

export const listReports = asyncHandler(async (_req, res) => {
  res.json({
    presets: [
      ...Object.entries(PRESETS).map(([key, p]) => ({ key, label: p.label, blurb: p.blurb, kind: 'grouped' })),
      ...Object.entries(SPECIAL_PRESETS).map(([key, p]) => ({ key, label: p.label, blurb: p.blurb, kind: 'listing' })),
    ],
    dimensions: Object.entries(DIMENSIONS).map(([key, d]) => ({ key, label: d.label })),
    measures: Object.entries(MEASURES).map(([key, m]) => ({ key, label: m.label, money: Boolean(m.money) })),
    statuses: ASSET_STATUSES,
  });
});

export const runReportHandler = asyncHandler(async (req, res) => {
  const result = await runReport(req.body);
  res.json(result);
});

export const exportReport = asyncHandler(async (req, res) => {
  const { columns, rows, totals } = await runReport(req.body);

  const sheetRows = rows.map((row) => {
    const out = {};
    for (const col of columns) {
      const value = row[col.key];
      out[col.label] = col.type === 'date' && value
        ? new Date(value).toISOString().slice(0, 10)
        : value ?? '';
    }
    return out;
  });

  if (totals && Object.keys(totals).length) {
    const totalRow = {};
    for (const [i, col] of columns.entries()) {
      totalRow[col.label] = i === 0 ? 'TOTAL' : (totals[col.key] ?? '');
    }
    sheetRows.push(totalRow);
  }

  const sheet = XLSX.utils.json_to_sheet(sheetRows.length ? sheetRows : [{ Report: 'No rows matched' }]);
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, 'Report');

  const format = req.body.format === 'csv' ? 'csv' : 'xlsx';
  const buffer = XLSX.write(book, { type: 'buffer', bookType: format });
  const name = req.body.preset || 'custom-report';

  await recordAudit(req, {
    action: 'report.exported', entity: 'Report',
    entityLabel: `${name} (${rows.length} rows)`, meta: { format, preset: req.body.preset },
  });

  res.setHeader('Content-Disposition', `attachment; filename="${name}-${new Date().toISOString().slice(0, 10)}.${format}"`);
  res.setHeader(
    'Content-Type',
    format === 'csv' ? 'text/csv' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  );
  res.send(buffer);
});
