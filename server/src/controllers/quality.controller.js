import { Asset } from '../models/Asset.js';
import { Assignment } from '../models/Assignment.js';
import { Category, Department, Site } from '../models/Lookup.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ASSIGNED_STATUSES, HOLDER_PERMITTED_STATUSES } from '../config/reference.js';
import { isPlaceholderSerial } from '../config/reference.js';

/**
 * Checks the register for the problems that actually turn up in a hand-kept
 * sheet: repeated serials, holders recorded as text, spelling variants that
 * split one category in two, and rows whose status contradicts their holder.
 *
 * Each check returns a count, a severity and enough rows to act on. Nothing
 * is auto-corrected — the report tells someone what to look at.
 */

const SEVERITY = { high: 'high', medium: 'medium', low: 'low' };

async function duplicateSerials() {
  const groups = await Asset.aggregate([
    { $match: { isArchived: false, serialNumber: { $exists: true, $ne: null, $ne: '' } } },
    { $group: { _id: { $toUpper: '$serialNumber' }, count: { $sum: 1 }, assets: { $push: { _id: '$_id', tag: '$tag', name: '$name' } } } },
    { $match: { count: { $gt: 1 } } },
    { $sort: { count: -1 } },
    { $limit: 50 },
  ]);
  return {
    key: 'duplicate_serials',
    title: 'Serial numbers used more than once',
    severity: groups.length ? SEVERITY.high : SEVERITY.low,
    count: groups.length,
    affected: groups.reduce((n, g) => n + g.count, 0),
    why: 'Two assets sharing a serial cannot be told apart in an audit. Some are genuine placeholders that should be blanked instead.',
    groups: groups.map((g) => ({ value: g._id, count: g.count, assets: g.assets.slice(0, 12) })),
  };
}

async function placeholderSerials() {
  const assets = await Asset.find({ isArchived: false, serialNumber: { $exists: true, $ne: null } })
    .select('tag name serialNumber').limit(500).lean();
  const hits = assets.filter((a) => isPlaceholderSerial(a.serialNumber));
  return {
    key: 'placeholder_serials',
    title: 'Serial fields holding placeholder text',
    severity: hits.length ? SEVERITY.medium : SEVERITY.low,
    count: hits.length,
    why: 'Values like "Assemble" or "12345678" read as identifiers but are not. Blank is more honest and stops false duplicate warnings.',
    assets: hits.slice(0, 30),
  };
}

async function missingSerials() {
  const count = await Asset.countDocuments({
    isArchived: false,
    $or: [{ serialNumber: { $exists: false } }, { serialNumber: null }, { serialNumber: '' }],
  });
  const assets = await Asset.find({
    isArchived: false,
    $or: [{ serialNumber: { $exists: false } }, { serialNumber: null }, { serialNumber: '' }],
  }).select('tag name category').populate('category', 'name').limit(30).lean();
  return {
    key: 'missing_serials',
    title: 'Assets with no serial number',
    severity: count ? SEVERITY.medium : SEVERITY.low,
    count,
    why: 'Without a serial, a stolen or swapped unit cannot be proven. Highest priority on laptops, phones and anything portable.',
    assets,
  };
}

async function unmatchedHolders() {
  const assets = await Asset.find({
    isArchived: false,
    assignedToLabel: { $exists: true, $ne: null, $ne: '' },
    $or: [{ assignedTo: { $exists: false } }, { assignedTo: null }],
  }).select('tag name assignedToLabel status').limit(200).lean();

  // Group by the text, so the same unmatched name is one line, not many.
  const byLabel = new Map();
  for (const a of assets) {
    const list = byLabel.get(a.assignedToLabel) || [];
    list.push({ _id: a._id, tag: a.tag, name: a.name });
    byLabel.set(a.assignedToLabel, list);
  }
  const groups = [...byLabel.entries()]
    .map(([label, list]) => ({ value: label, count: list.length, assets: list.slice(0, 10) }))
    .sort((a, b) => b.count - a.count);

  return {
    key: 'unmatched_holders',
    title: 'Holders recorded as text, with no matching account',
    severity: groups.length ? SEVERITY.medium : SEVERITY.low,
    count: groups.length,
    affected: assets.length,
    why: 'These read as a name in the sheet but point at nobody in the system, so the asset cannot appear on a person\u2019s handover list. Some name a department or a site rather than a person.',
    groups: groups.slice(0, 40),
  };
}

async function statusHolderConflicts() {
  const heldWithoutHolder = await Asset.find({
    isArchived: false,
    status: { $in: ASSIGNED_STATUSES },
    $and: [
      { $or: [{ assignedTo: { $exists: false } }, { assignedTo: null }] },
      { $or: [{ assignedToLabel: { $exists: false } }, { assignedToLabel: null }, { assignedToLabel: '' }] },
    ],
  }).select('tag name status').limit(50).lean();

  // "under_repair" and "leased" may legitimately name a holder, so only
  // statuses where a holder makes no sense at all count as a conflict.
  const idleWithHolder = await Asset.find({
    isArchived: false,
    status: { $nin: HOLDER_PERMITTED_STATUSES },
    assignedTo: { $exists: true, $ne: null },
  }).select('tag name status assignedTo').populate('assignedTo', 'name').limit(50).lean();

  const total = heldWithoutHolder.length + idleWithHolder.length;
  return {
    key: 'status_conflicts',
    title: 'Status disagrees with the recorded holder',
    severity: total ? SEVERITY.high : SEVERITY.low,
    count: total,
    why: 'A checked-out asset must name a holder, and an available one must not. Either way round, the register is telling two different stories.',
    heldWithoutHolder,
    idleWithHolder,
  };
}

/**
 * Catches the specific inconsistency an older maintenance bug left behind:
 * an open custody record whose asset no longer says it is held by anyone.
 * The Custody tab shows "Holding now" while the header says Available.
 */
async function strandedCustody() {
  const open = await Assignment.find({ checkedInAt: { $exists: false } })
    .populate('asset', 'tag name status assignedTo')
    .populate('assignedTo', 'name')
    .limit(500)
    .lean();

  const stranded = open.filter((a) => {
    if (!a.asset) return false;
    return !HOLDER_PERMITTED_STATUSES.includes(a.asset.status);
  });

  return {
    key: 'stranded_custody',
    title: 'Open check-outs on assets that are not held',
    severity: stranded.length ? SEVERITY.high : SEVERITY.low,
    count: stranded.length,
    why: 'The asset header and the Custody tab disagree \u2014 one says it is free, the other says someone still has it. Check the asset in to close the record, or correct the status.',
    assets: stranded.slice(0, 30).map((a) => ({
      _id: a.asset._id,
      tag: a.asset.tag,
      name: `${a.asset.name} \u2014 open to ${a.assignedTo?.name || 'someone'}, but status is ${a.asset.status}`,
    })),
  };
}

async function lookupVariants() {
  // Names that collapse to the same letters are almost always the same thing.
  const squash = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const out = [];

  for (const [label, Model] of [['Category', Category], ['Department', Department], ['Site', Site]]) {
    const docs = await Model.find().select('name').lean();
    const buckets = new Map();
    for (const d of docs) {
      const key = squash(d.name);
      buckets.set(key, [...(buckets.get(key) || []), d]);
    }
    for (const [, list] of buckets) {
      if (list.length > 1) out.push({ kind: label, names: list.map((l) => l.name), ids: list.map((l) => String(l._id)) });
    }
  }

  return {
    key: 'lookup_variants',
    title: 'Lists holding two spellings of one thing',
    severity: out.length ? SEVERITY.medium : SEVERITY.low,
    count: out.length,
    why: 'Split spellings split the counts, so a category looks smaller than it is and filters miss rows. Merge them into one entry.',
    variants: out.slice(0, 40),
  };
}

async function emptyLookups() {
  const [cats, deps, sites] = await Promise.all([
    Category.find().select('name').lean(),
    Department.find().select('name').lean(),
    Site.find().select('name handler').lean(),
  ]);

  const counts = await Asset.aggregate([
    { $match: { isArchived: false } },
    {
      $facet: {
        byCategory: [{ $group: { _id: '$category', n: { $sum: 1 } } }],
        byDepartment: [{ $group: { _id: '$department', n: { $sum: 1 } } }],
        bySite: [{ $group: { _id: '$site', n: { $sum: 1 } } }],
      },
    },
  ]);
  const used = (arr) => new Set((arr || []).filter((x) => x._id).map((x) => String(x._id)));
  const usedCat = used(counts[0]?.byCategory);
  const usedDep = used(counts[0]?.byDepartment);
  const usedSite = used(counts[0]?.bySite);

  const unused = [
    ...cats.filter((c) => !usedCat.has(String(c._id))).map((c) => ({ kind: 'Category', name: c.name })),
    ...deps.filter((d) => !usedDep.has(String(d._id))).map((d) => ({ kind: 'Department', name: d.name })),
    ...sites.filter((s) => !usedSite.has(String(s._id))).map((s) => ({ kind: 'Site', name: s.name })),
  ];

  const sitesWithoutHandler = sites.filter((s) => !s.handler).map((s) => s.name);

  return [
    {
      key: 'unused_lookups',
      title: 'List entries nothing points at',
      severity: SEVERITY.low,
      count: unused.length,
      why: 'Harmless, but they clutter every dropdown. Deactivate the ones you are keeping for history.',
      entries: unused.slice(0, 40),
    },
    {
      key: 'sites_without_handler',
      title: 'Sites with no handler assigned',
      severity: sitesWithoutHandler.length ? SEVERITY.medium : SEVERITY.low,
      count: sitesWithoutHandler.length,
      why: 'The handler is who to call about hardware at that site. Without one, assets there have no named owner.',
      entries: sitesWithoutHandler.slice(0, 40).map((name) => ({ kind: 'Site', name })),
    },
  ];
}

async function missingCategory() {
  const count = await Asset.countDocuments({
    isArchived: false,
    $or: [{ category: { $exists: false } }, { category: null }],
  });
  const assets = await Asset.find({
    isArchived: false,
    $or: [{ category: { $exists: false } }, { category: null }],
  }).select('tag name').limit(30).lean();
  return {
    key: 'missing_category',
    title: 'Assets with no category',
    severity: count ? SEVERITY.medium : SEVERITY.low,
    count,
    why: 'Uncategorised assets drop out of every breakdown, so the totals never quite add up.',
    assets,
  };
}

export const dataQuality = asyncHandler(async (_req, res) => {
  const [
    dupSerials, placeholders, noSerials, holders,
    conflicts, stranded, variants, lookupChecks, noCategory,
  ] = await Promise.all([
    duplicateSerials(), placeholderSerials(), missingSerials(), unmatchedHolders(),
    statusHolderConflicts(), strandedCustody(), lookupVariants(), emptyLookups(), missingCategory(),
  ]);

  const checks = [
    conflicts, stranded, dupSerials, holders, placeholders,
    noSerials, noCategory, variants, ...lookupChecks,
  ];

  const totalAssets = await Asset.countDocuments({ isArchived: false });
  const openIssues = checks.filter((c) => c.count > 0);

  res.json({
    totalAssets,
    checkedAt: new Date().toISOString(),
    summary: {
      checksRun: checks.length,
      checksFailing: openIssues.length,
      high: openIssues.filter((c) => c.severity === 'high').length,
      medium: openIssues.filter((c) => c.severity === 'medium').length,
      low: openIssues.filter((c) => c.severity === 'low').length,
    },
    checks,
  });
});
