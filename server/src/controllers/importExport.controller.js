import XLSX from 'xlsx';
import { z } from 'zod';
import mongoose from 'mongoose';
import { Asset } from '../models/Asset.js';
import { Assignment } from '../models/Assignment.js';
import { Category, Department, Site, Vendor } from '../models/Lookup.js';
import { User } from '../models/User.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { recordAudit } from '../utils/audit.js';
import {
  ASSIGNED_STATUSES, canonicalCategory, canonicalDepartment, categoryFromTag,
  entityFromTag, isPlaceholderSerial, normaliseStatus,
} from '../config/reference.js';

/**
 * Schema fields the importer can target, with the header names that actually
 * appear in asset registers — including the exact columns used by the source
 * sheet and by AssetTiger exports.
 *
 * `tag` is the key the whole import turns on: rows are matched to existing
 * assets by it, and it is the one column that cannot be left out.
 */
export const IMPORTABLE_FIELDS = {
  tag: ['asset tag id', 'asset tag', 'asset id', 'asset code', 'tag', 'asset no', 'asset number'],
  name: ['description', 'name', 'asset name', 'item', 'item name', 'asset'],
  brand: ['brand', 'make', 'manufacturer'],
  model: ['model', 'model no', 'model number'],
  serialNumber: ['serial no', 'serial number', 'serial', 'sn', 's/n', 'imei'],
  status: ['status', 'asset status', 'state'],
  condition: ['condition', 'asset condition'],
  category: ['category', 'asset type', 'type', 'asset category', 'group'],
  subCategory: ['sub category', 'subcategory', 'sub type'],
  department: ['department', 'dept', 'cost centre', 'cost center'],
  site: ['site', 'branch', 'office', 'unit', 'plant', 'premises'],
  city: ['location', 'city', 'place', 'region'],
  assignedToLabel: ['assigned to', 'assignee', 'custodian', 'user', 'holder', 'issued to'],
  handler: ['handler', 'responsible', 'it owner', 'asset manager'],

  /** Custody dates, so a historic check-out can be loaded with its real date. */
  checkedOutAt: [
    'checked out date', 'checkout date', 'check out date', 'out date',
    'issue date', 'date issued', 'assigned date', 'date assigned', 'issued on',
  ],
  checkedInAt: [
    'checked in date', 'checkin date', 'check in date', 'in date',
    'return date', 'date returned', 'returned on', 'received back',
  ],
  dueAt: ['due date', 'due back', 'return by', 'expected return', 'due on'],

  imageUrl: ['asset photo', 'photo', 'image', 'picture', 'image url'],
  vendor: ['vendor', 'supplier', 'dealer', 'seller'],
  purchaseDate: ['purchase date', 'date of purchase', 'bought on', 'invoice date', 'po date'],
  purchaseCost: ['purchase cost', 'cost', 'price', 'amount', 'value', 'purchase price'],
  invoiceNumber: ['invoice number', 'invoice no', 'bill no', 'invoice'],
  poNumber: ['po number', 'po no', 'purchase order'],
  warrantyExpiry: ['warranty expiry', 'warranty end', 'warranty till', 'warranty upto', 'warranty'],
  amcExpiry: ['amc expiry', 'amc till', 'amc end'],
  quantity: ['quantity', 'qty', 'count'],
  unit: ['unit of measure', 'uom'],
  notes: ['notes', 'remarks', 'comment', 'comments'],
};

/**
 * Normalises a header for matching. Bracketed qualifiers are dropped because
 * "Cost (INR)" and "Qty (Nos)" name the same field as "Cost" and "Qty" — the
 * bracket carries a unit, not part of the name.
 */
const norm = (s) => String(s ?? '')
  .toLowerCase()
  .replace(/\([^)]*\)/g, ' ')
  .replace(/[^a-z0-9]+/g, ' ')
  .trim()
  .replace(/\s+/g, ' ');

const CONDITION_ALIASES = {
  new: 'new', unused: 'new', good: 'good', working: 'good', ok: 'good', fine: 'good',
  fair: 'fair', average: 'fair', used: 'fair', poor: 'poor', bad: 'poor',
  damaged: 'damaged', broken: 'damaged', 'not working': 'damaged', dead: 'damaged',
};

/**
 * Guesses which schema field each spreadsheet column belongs to.
 *
 * Exact alias matches run first. The looser second pass requires the alias to
 * account for most of the header, so "Serial No." still finds `serialNumber`
 * while "Custodian Signature" is left alone rather than being mistaken for the
 * holder. Anything unmatched is kept as a custom field, and the preview screen
 * lets someone correct every guess before a row is written.
 */
export function suggestMapping(headers) {
  const mapping = {};
  const taken = new Set();

  const overlap = (header, alias) => {
    const longer = Math.max(header.length, alias.length);
    return longer === 0 ? 0 : Math.min(header.length, alias.length) / longer;
  };

  for (const header of headers) {
    const h = norm(header);
    let match = null;

    for (const [field, aliases] of Object.entries(IMPORTABLE_FIELDS)) {
      if (taken.has(field)) continue;
      if (aliases.includes(h)) { match = field; break; }
    }

    if (!match) {
      let best = 0;
      for (const [field, aliases] of Object.entries(IMPORTABLE_FIELDS)) {
        if (taken.has(field)) continue;
        for (const alias of aliases) {
          if (!h.includes(alias) && !alias.includes(h)) continue;
          const score = overlap(h, alias);
          // Below this the alias is only a fragment of the header, so the
          // match is more likely coincidence than intent.
          if (score >= 0.7 && score > best) { best = score; match = field; }
        }
      }
    }

    if (match) taken.add(match);
    mapping[header] = match || '__custom__';
  }
  return mapping;
}

function readSheet(file, sheetName) {
  if (!file) throw ApiError.badRequest('Attach a .xlsx or .csv file');
  const wb = XLSX.read(file.buffer, { type: 'buffer', cellDates: true });
  const name = sheetName && wb.SheetNames.includes(sheetName) ? sheetName : wb.SheetNames[0];
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { defval: null, raw: false, dateNF: 'yyyy-mm-dd' });
  return { sheetNames: wb.SheetNames, sheetName: name, rows };
}

/** How a run treats rows that do or do not already exist. */
export const IMPORT_MODES = {
  create: 'Only add new assets. A tag that already exists is reported, never overwritten.',
  update: 'Only update assets that already exist. A tag with no match is reported, never created.',
  upsert: 'Add new assets and update existing ones, matching on asset tag.',
};

export const parseDate = (v) => {
  if (!v) return undefined;
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v;
  const s = String(v).trim();
  // Prefer d/m/y — the order used across most non-US asset registers.
  const dmy = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/);
  if (dmy) {
    let [, d, m, y] = dmy;
    if (y.length === 2) y = Number(y) > 50 ? `19${y}` : `20${y}`;
    const dt = new Date(Number(y), Number(m) - 1, Number(d));
    return Number.isNaN(dt.getTime()) ? undefined : dt;
  }
  const dt = new Date(s);
  return Number.isNaN(dt.getTime()) ? undefined : dt;
};

/**
 * Reads a cost cell. Extracts the first numeric run instead of stripping
 * non-digits, so prefixes with their own punctuation ("Rs. 1,00,000") and
 * lakh-style grouping survive, while a cell of pure text ("TBD", "n/a")
 * returns undefined rather than collapsing to 0 and skewing value totals.
 */
export const parseMoney = (v) => {
  if (v === null || v === undefined || v === '') return undefined;
  const s = String(v).trim();
  const match = s.match(/\d[\d,\s]*(?:\.\d+)?/);
  if (!match) return undefined;

  const n = Number(match[0].replace(/[,\s]/g, ''));
  if (!Number.isFinite(n)) return undefined;

  // Accountancy negatives: a leading minus, or the whole value in brackets.
  const before = s.slice(0, match.index);
  const negative = /-\s*$/.test(before) || (/^\(/.test(s) && /\)$/.test(s));
  return negative ? -n : n;
};

/** Step 1: read the file, show headers, a suggested mapping and a sample. */
export const previewImport = asyncHandler(async (req, res) => {
  const { sheetNames, sheetName, rows } = readSheet(req.file, req.body.sheet);
  if (!rows.length) throw ApiError.badRequest(`Sheet "${sheetName}" has no data rows`);

  const headers = Object.keys(rows[0]);
  const mapping = suggestMapping(headers);
  const tagColumn = Object.entries(mapping).find(([, field]) => field === 'tag')?.[0] || null;

  // Surface tag problems before anything is written — a file with repeated or
  // blank tags cannot be imported at all, and it is far cheaper to say so now.
  const seen = new Map();
  const blankTagRows = [];
  const duplicateTags = [];
  if (tagColumn) {
    for (const [i, row] of rows.entries()) {
      const raw = String(row[tagColumn] ?? '').trim();
      if (!raw) { blankTagRows.push(i + 2); continue; }
      const key = raw.toUpperCase();
      if (seen.has(key)) duplicateTags.push({ tag: raw, rows: [seen.get(key), i + 2] });
      else seen.set(key, i + 2);
    }
  }

  res.json({
    sheetNames,
    sheetName,
    headers,
    totalRows: rows.length,
    suggestedMapping: mapping,
    fields: Object.keys(IMPORTABLE_FIELDS),
    modes: IMPORT_MODES,
    sample: rows.slice(0, 8),
    tagCheck: {
      column: tagColumn,
      distinctTags: seen.size,
      blankTagRows: blankTagRows.slice(0, 50),
      blankTagCount: blankTagRows.length,
      duplicateTags: duplicateTags.slice(0, 50),
      duplicateTagCount: duplicateTags.length,
    },
  });
});

/** Finds or creates a lookup row by name, caching within one import run. */
async function lookupId(Model, cache, rawName, userId, extra = {}) {
  const name = String(rawName || '').trim();
  if (!name) return undefined;
  const key = name.toLowerCase();
  if (cache.has(key)) return cache.get(key);

  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  let doc = await Model.findOne({ name: new RegExp(`^${escaped}$`, 'i') }).select('_id');
  if (!doc) doc = await Model.create({ name, createdBy: userId, ...extra });
  cache.set(key, doc._id);
  return doc._id;
}

/**
 * Matches an "Assigned to" cell against real user accounts. Around a tenth of
 * the register's values name a department or a site instead of a person, so a
 * miss is normal and never fatal — the raw text is kept either way.
 */
async function matchUser(cache, rawName) {
  const name = String(rawName || '').trim();
  if (!name) return undefined;
  const key = name.toLowerCase().replace(/\s+/g, ' ');
  if (cache.has(key)) return cache.get(key);

  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const found = await User.findOne({
    $or: [{ name: new RegExp(`^${escaped}$`, 'i') }, { email: name.toLowerCase() }],
  }).select('_id');
  cache.set(key, found?._id);
  return found?._id;
}

/**
 * Brings an asset's custody record into line with the dates on the sheet.
 *
 * This is what makes the check-out and check-in dates importable rather than
 * only settable by hand: an open assignment has its date corrected in place,
 * a check-in date closes it, and a check-out date on an asset with no open
 * assignment opens one dated correctly rather than dated "now".
 *
 * Custody only applies to an asset the sheet says is checked out to a real
 * person. A row with dates but no resolvable holder is skipped and reported —
 * an Assignment requires an assignedTo, and inventing one, or letting the
 * write fail, are both worse than saying which rows were left alone.
 */
async function syncCustody(asset, { checkedOutAt, checkedInAt, dueAt, holderId, siteId, actorId }) {
  if (!checkedOutAt && !checkedInAt && !dueAt) return null;

  const open = await Assignment.findOne({ asset: asset._id, checkedInAt: { $exists: false } })
    .sort({ checkedOutAt: -1 });

  // Correcting or closing a record that already exists needs no new holder,
  // because the existing record already names one.
  if (open) {
    if (checkedOutAt) open.checkedOutAt = checkedOutAt;
    if (dueAt) open.dueAt = dueAt;
    if (checkedInAt) {
      open.checkedInAt = checkedInAt;
      open.checkedInBy = actorId;
      open.status = 'returned';
      open.notesIn = open.notesIn || 'Closed by spreadsheet import';
    }
    await open.save();
    return checkedInAt ? 'closed' : 'redated';
  }

  // No open record. Only a check-out can open one, and only with a holder.
  if (!checkedOutAt) return null;

  const holder = holderId || asset.assignedTo;
  if (!holder) {
    return checkedInAt
      ? null
      : 'skipped_no_holder';
  }

  await Assignment.create({
    asset: asset._id,
    assignedTo: holder,
    assignedBy: actorId,
    checkedOutAt,
    dueAt,
    siteOut: siteId || asset.site,
    notesOut: 'Loaded from spreadsheet import',
    ...(checkedInAt
      ? { checkedInAt, checkedInBy: actorId, status: 'returned', notesIn: 'Loaded from spreadsheet import' }
      : { status: 'open' }),
  });
  return checkedInAt ? 'created_closed' : 'created_open';
}

/**
 * Step 2: write the rows.
 *
 * Asset tag is the key. Every row must carry one, it must be unique within the
 * file, and it decides whether a row is an insert or an update — which is what
 * makes a bulk detail update possible: re-upload the same tags with changed
 * columns and only those columns move.
 *
 * Unmapped columns are kept in customFields so no spreadsheet data is
 * silently dropped. dryRun validates without saving.
 */
export const commitImport = asyncHandler(async (req, res) => {
  const { rows } = readSheet(req.file, req.body.sheet);
  const mapping = typeof req.body.mapping === 'string' ? JSON.parse(req.body.mapping) : req.body.mapping;
  if (!mapping || typeof mapping !== 'object') throw ApiError.badRequest('Send a column mapping');

  if (!Object.values(mapping).includes('tag')) {
    throw ApiError.badRequest(
      'One column must be mapped to Asset tag. Assets are matched by tag, so an import without it cannot proceed.',
      { mapping: 'No column mapped to Asset tag' }
    );
  }

  const dryRun = String(req.body.dryRun) === 'true';
  const mode = Object.keys(IMPORT_MODES).includes(req.body.mode) ? req.body.mode : 'upsert';
  const batch = `import-${Date.now()}`;

  const caches = {
    category: new Map(), department: new Map(), site: new Map(),
    vendor: new Map(), user: new Map(),
  };
  const siteHandlers = new Map();
  const siteCities = new Map();

  const created = [];
  const updated = [];
  const skipped = [];
  const errors = [];
  const notices = [];
  const custodyChanges = [];
  const seenTagKeys = new Map();

  for (const [index, row] of rows.entries()) {
    const rowNumber = index + 2; // header occupies row 1
    try {
      const doc = {};
      const custom = {};
      const custody = {};
      let cityText = '';
      let siteText = '';
      let handlerText = '';

      for (const [header, field] of Object.entries(mapping)) {
        const value = row[header];
        if (field === '__ignore__') continue;
        if (field === '__custom__') {
          if (value !== null && String(value).trim() !== '') custom[header] = String(value).trim();
          continue;
        }
        if (value === null || String(value).trim() === '') continue;
        const raw = String(value).trim();

        switch (field) {
          case 'tag': doc.tag = raw; break;
          case 'purchaseCost': doc.purchaseCost = parseMoney(raw); break;
          case 'quantity': doc.quantity = Number(raw.replace(/[^0-9.]/g, '')) || 1; break;
          case 'purchaseDate': case 'warrantyExpiry': case 'amcExpiry':
            doc[field] = parseDate(value); break;
          case 'checkedOutAt': case 'checkedInAt': case 'dueAt':
            custody[field] = parseDate(value); break;
          case 'status': doc.status = normaliseStatus(raw); break;
          case 'condition': doc.condition = CONDITION_ALIASES[norm(raw)]; break;
          case 'category': doc.__categoryName = canonicalCategory(raw); break;
          case 'department': {
            const dep = canonicalDepartment(raw);
            if (dep) doc.__departmentName = dep;
            else custom[header] = raw;
            break;
          }
          case 'site': siteText = raw; break;
          case 'city': cityText = raw; break;
          case 'handler': handlerText = raw; break;
          case 'vendor': doc.vendor = await lookupId(Vendor, caches.vendor, raw, req.user._id); break;
          case 'assignedToLabel': doc.assignedToLabel = raw; break;
          case 'imageUrl': doc.imageUrl = raw; break;
          default: doc[field] = raw;
        }
      }

      // --- asset tag: required, and unique across the file -----------------
      if (!doc.tag) {
        errors.push({ row: rowNumber, message: 'No asset tag in this row. Every row needs one.' });
        continue;
      }
      const tagKey = doc.tag.toUpperCase();
      if (seenTagKeys.has(tagKey)) {
        errors.push({
          row: rowNumber, tag: doc.tag,
          message: `Asset tag ${doc.tag} already appears on row ${seenTagKeys.get(tagKey)} of this file`,
        });
        continue;
      }
      seenTagKeys.set(tagKey, rowNumber);

      doc.entity = entityFromTag(doc.tag) || undefined;

      if (!doc.__categoryName) {
        const inferred = categoryFromTag(doc.tag);
        if (inferred) {
          doc.__categoryName = inferred;
          notices.push({ row: rowNumber, tag: doc.tag, message: `Category read from the tag as "${inferred}"` });
        }
      }

      if (doc.__categoryName) {
        doc.category = await lookupId(Category, caches.category, doc.__categoryName, req.user._id);
      }
      if (doc.__departmentName) {
        doc.department = await lookupId(Department, caches.department, doc.__departmentName, req.user._id);
      }
      delete doc.__categoryName;
      delete doc.__departmentName;

      if (siteText) {
        doc.site = await lookupId(Site, caches.site, siteText, req.user._id, { city: cityText || undefined });
        if (handlerText) siteHandlers.set(siteText, handlerText);
        if (cityText) siteCities.set(siteText, cityText);
      } else if (cityText) {
        doc.site = await lookupId(Site, caches.site, cityText, req.user._id, { city: cityText });
      }

      if (doc.serialNumber && isPlaceholderSerial(doc.serialNumber)) {
        custom['Serial No (as given)'] = doc.serialNumber;
        delete doc.serialNumber;
      }

      // A holder only belongs on an asset the sheet says is held.
      let holderId;
      if (doc.assignedToLabel) {
        if (ASSIGNED_STATUSES.includes(doc.status || 'available')) {
          holderId = await matchUser(caches.user, doc.assignedToLabel);
          doc.assignedTo = holderId;
        } else {
          notices.push({
            row: rowNumber, tag: doc.tag,
            message: `Holder "${doc.assignedToLabel}" kept as a note because the status is ${doc.status || 'available'}`,
          });
          custom['Previous holder'] = doc.assignedToLabel;
          delete doc.assignedToLabel;
        }
      }

      // Custody dates decide assignedAt, so it is never just "now".
      if (custody.checkedOutAt) doc.assignedAt = custody.checkedOutAt;
      if (custody.dueAt) doc.dueAt = custody.dueAt;
      if (custody.checkedInAt) {
        // Checked back in: the asset is no longer in anyone's hands.
        doc.assignedTo = undefined;
        doc.assignedToLabel = undefined;
        doc.assignedAt = undefined;
        doc.dueAt = undefined;
        if (!doc.status || ASSIGNED_STATUSES.includes(doc.status)) doc.status = 'available';
      }

      if (Object.keys(custom).length) doc.customFields = custom;

      const existing = await Asset.findOne({ tagKey });

      // --- mode decides insert vs update ----------------------------------
      if (existing && mode === 'create') {
        skipped.push({ row: rowNumber, tag: existing.tag, reason: 'Already on the register' });
        continue;
      }
      if (!existing && mode === 'update') {
        skipped.push({ row: rowNumber, tag: doc.tag, reason: 'No asset with this tag to update' });
        continue;
      }

      if (existing) {
        if (!dryRun) {
          // Only the columns present in the file are touched, so a partial
          // sheet is a targeted bulk edit rather than a destructive overwrite.
          Object.assign(existing, doc, { updatedBy: req.user._id, importBatch: batch });
          await existing.save();

          const change = await syncCustody(existing, {
            ...custody, holderId, siteId: doc.site, actorId: req.user._id,
          });
          if (change === 'skipped_no_holder') {
            notices.push({
              row: rowNumber, tag: existing.tag,
              message: 'Custody dates ignored: nobody could be matched as the holder, so there is no check-out to record',
            });
          } else if (change) {
            custodyChanges.push({ row: rowNumber, tag: existing.tag, change });
          }
        }
        updated.push({ row: rowNumber, tag: existing.tag, fields: Object.keys(doc).length });
        continue;
      }

      if (!doc.name) doc.name = [doc.brand, doc.model].filter(Boolean).join(' ') || doc.tag;

      if (dryRun) {
        created.push({ row: rowNumber, tag: doc.tag, name: doc.name });
        continue;
      }

      const saved = await Asset.create({
        ...doc, importBatch: batch, createdBy: req.user._id, updatedBy: req.user._id,
      });
      const change = await syncCustody(saved, {
        ...custody, holderId, siteId: doc.site, actorId: req.user._id,
      });
      if (change === 'skipped_no_holder') {
        notices.push({
          row: rowNumber, tag: saved.tag,
          message: 'Custody dates ignored: nobody could be matched as the holder, so there is no check-out to record',
        });
      } else if (change) {
        custodyChanges.push({ row: rowNumber, tag: saved.tag, change });
      }

      created.push({ row: rowNumber, tag: saved.tag, name: saved.name });
    } catch (err) {
      // A unique-index violation here means the tag exists despite the lookup
      // above — report it against the tag rather than as an opaque failure.
      const message = err.code === 11000
        ? `Asset tag is already in use`
        : err.message;
      errors.push({ row: rowNumber, message });
    }
  }

  if (!dryRun) {
    for (const [siteName, handlerName] of siteHandlers) {
      const siteId = caches.site.get(siteName.toLowerCase());
      if (!siteId) continue;
      const handlerId = await matchUser(caches.user, handlerName);
      await Site.updateOne(
        { _id: siteId },
        {
          ...(handlerId ? { handler: handlerId } : {}),
          ...(siteCities.get(siteName) ? { city: siteCities.get(siteName) } : {}),
          $addToSet: { aliases: `handler:${handlerName}` },
        }
      );
    }

    await recordAudit(req, {
      action: 'asset.imported', entity: 'Asset',
      entityLabel: `${created.length} created, ${updated.length} updated`,
      meta: {
        batch, mode, created: created.length, updated: updated.length,
        skipped: skipped.length, errors: errors.length,
        custodyChanges: custodyChanges.length,
      },
    });
  }

  res.json({
    dryRun,
    mode,
    batch,
    summary: {
      total: rows.length,
      created: created.length,
      updated: updated.length,
      skipped: skipped.length,
      failed: errors.length,
      notices: notices.length,
      custodyChanges: custodyChanges.length,
    },
    created: created.slice(0, 100),
    updated: updated.slice(0, 100),
    skipped: skipped.slice(0, 100),
    errors: errors.slice(0, 100),
    notices: notices.slice(0, 100),
    custodyChanges: custodyChanges.slice(0, 100),
  });
});

export const exportQuerySchema = z.object({
  format: z.enum(['xlsx', 'csv']).default('xlsx'),
}).passthrough();

const STATUS_LABEL = {
  available: 'Available', checked_out: 'Checked Out', under_repair: 'Under Repair',
  leased: 'Leased', lost_missing: 'Lost/Missing', donated: 'Donated',
  sold: 'Sold', disposed: 'Disposed',
};

const iso = (d) => (d ? new Date(d).toISOString().slice(0, 10) : '');

/**
 * Every column the export can produce, keyed so the caller can pick a subset.
 * The first fourteen deliberately match the source register's own layout and
 * order, so a default export round-trips back into the same spreadsheet.
 */
export const EXPORT_COLUMNS = {
  imageUrl: { label: 'Asset Photo', register: true, get: (a) => a.imageUrl || '' },
  tag: { label: 'Asset Tag ID', register: true, get: (a) => a.tag },
  name: { label: 'Description', register: true, get: (a) => a.name },
  brand: { label: 'Brand', register: true, get: (a) => a.brand || '' },
  status: { label: 'Status', register: true, get: (a) => STATUS_LABEL[a.status] || a.status || '' },
  model: { label: 'Model', register: true, get: (a) => a.model || '' },
  serialNumber: { label: 'Serial No', register: true, get: (a) => a.serialNumber || '' },
  site: { label: 'Site', register: true, get: (a) => a.site?.name || '' },
  city: { label: 'Location', register: true, get: (a) => a.site?.city || '' },
  category: { label: 'Category', register: true, get: (a) => a.category?.name || '' },
  department: { label: 'Department', register: true, get: (a) => a.department?.name || '' },
  assignedTo: {
    label: 'Assigned to', register: true,
    get: (a) => a.assignedTo?.name || a.assignedToLabel || '',
  },
  subCategory: { label: 'Sub Category', register: true, get: (a) => a.subCategory || a.entity || '' },
  handler: { label: 'Handler', register: true, get: (a) => a.site?.handler?.name || '' },

  entity: { label: 'Owning company', get: (a) => a.entity || '' },
  condition: { label: 'Condition', get: (a) => a.condition || '' },
  assignedEmail: { label: 'Assigned email', get: (a) => a.assignedTo?.email || '' },
  dueAt: { label: 'Due back', get: (a) => iso(a.dueAt) },
  vendor: { label: 'Vendor', get: (a) => a.vendor?.name || '' },
  purchaseDate: { label: 'Purchase Date', get: (a) => iso(a.purchaseDate) },
  purchaseCost: { label: 'Purchase Cost', get: (a) => a.purchaseCost ?? '' },
  currentValue: { label: 'Book Value', get: (a) => bookValue(a) },
  currency: { label: 'Currency', get: (a) => a.currency || '' },
  invoiceNumber: { label: 'Invoice Number', get: (a) => a.invoiceNumber || '' },
  poNumber: { label: 'PO Number', get: (a) => a.poNumber || '' },
  warrantyExpiry: { label: 'Warranty Expiry', get: (a) => iso(a.warrantyExpiry) },
  amcExpiry: { label: 'AMC Expiry', get: (a) => iso(a.amcExpiry) },
  quantity: { label: 'Quantity', get: (a) => a.quantity ?? '' },
  labels: { label: 'Labels', get: (a) => (a.labels || []).join(', ') },
  notes: { label: 'Notes', get: (a) => a.notes || '' },
  createdAt: { label: 'Added On', get: (a) => iso(a.createdAt) },
  updatedAt: { label: 'Last Updated', get: (a) => iso(a.updatedAt) },
};

/** The register's own fourteen columns, in their original order. */
export const REGISTER_COLUMNS = Object.entries(EXPORT_COLUMNS)
  .filter(([, c]) => c.register)
  .map(([key]) => key);

function buildExportFilter(req) {
  // These go into an aggregation $match, which does not cast strings to
  // ObjectId the way find() does — an uncast id would match nothing at all.
  const oid = (v) => new mongoose.Types.ObjectId(String(v));

  const filter = { isArchived: req.query.archived === 'true' };
  if (req.query.status) filter.status = { $in: String(req.query.status).split(',') };
  if (req.query.category && mongoose.isValidObjectId(req.query.category)) filter.category = oid(req.query.category);
  if (req.query.site && mongoose.isValidObjectId(req.query.site)) filter.site = oid(req.query.site);
  if (req.query.department && mongoose.isValidObjectId(req.query.department)) filter.department = oid(req.query.department);
  if (req.query.entity) filter.entity = { $in: String(req.query.entity).split(',') };
  if (req.query.condition) filter.condition = { $in: String(req.query.condition).split(',') };
  if (req.isSelfScoped) filter.assignedTo = oid(req.user._id);
  return filter;
}

/**
 * Tells the client which columns exist, including every custom field key
 * actually present in the data — so the picker offers the columns this
 * database really has rather than a hardcoded guess.
 */
export const exportFields = asyncHandler(async (_req, res) => {
  // Ask the server for the key names only. Pulling every customFields object
  // back just to read its keys would move a lot of data for nothing.
  const found = await Asset.aggregate([
    { $match: { customFields: { $exists: true, $ne: null } } },
    { $project: { keys: { $objectToArray: '$customFields' } } },
    { $unwind: '$keys' },
    { $group: { _id: '$keys.k' } },
    { $sort: { _id: 1 } },
    { $limit: 200 },
  ]);

  res.json({
    columns: Object.entries(EXPORT_COLUMNS).map(([key, c]) => ({
      key, label: c.label, inRegisterLayout: Boolean(c.register),
    })),
    registerLayout: REGISTER_COLUMNS,
    customFields: found.map((f) => f._id).filter(Boolean),
  });
});

/** Book value today. Mirrors the Asset virtual, which lean() cannot give us. */
function bookValue(a) {
  if (!a.purchaseCost || !a.purchaseDate) return '';
  if (a.depreciationMethod === 'none' || !a.usefulLifeMonths) return a.purchaseCost;
  const months = Math.max(
    0,
    (Date.now() - new Date(a.purchaseDate).getTime()) / (1000 * 60 * 60 * 24 * 30.4375)
  );
  const salvage = a.salvageValue || 0;
  if (a.depreciationMethod === 'straight_line') {
    const perMonth = (a.purchaseCost - salvage) / a.usefulLifeMonths;
    return Math.max(salvage, Number((a.purchaseCost - perMonth * months).toFixed(2)));
  }
  const years = a.usefulLifeMonths / 12;
  const rate = 1 - Math.pow(Math.max(salvage, 1) / a.purchaseCost, 1 / Math.max(years, 1));
  return Math.max(salvage, Number((a.purchaseCost * Math.pow(1 - rate, months / 12)).toFixed(2)));
}

/**
 * Exports the current selection. With no `fields` given it reproduces the
 * register's own column layout; otherwise it honours the chosen columns in
 * the order they were sent. Custom fields are appended unless switched off.
 */
export const exportAssets = asyncHandler(async (req, res) => {
  const filter = buildExportFilter(req);

  const requested = req.query.fields
    ? String(req.query.fields).split(',').map((f) => f.trim()).filter((f) => EXPORT_COLUMNS[f])
    : REGISTER_COLUMNS;
  const columns = requested.length ? requested : REGISTER_COLUMNS;

  const includeCustom = req.query.includeCustomFields !== 'false';
  const onlyCustom = req.query.customFields
    ? String(req.query.customFields).split(',').map((f) => f.trim()).filter(Boolean)
    : null;

  // A single aggregation resolves every reference in one round trip, rather
  // than a find plus one query per populated collection.
  const assets = await Asset.aggregate([
    { $match: filter },
    { $sort: { tagKey: 1 } },
    { $lookup: { from: 'sites', localField: 'site', foreignField: '_id', as: 'site' } },
    { $unwind: { path: '$site', preserveNullAndEmptyArrays: true } },
    { $lookup: { from: 'users', localField: 'site.handler', foreignField: '_id', as: '_handler' } },
    { $lookup: { from: 'categories', localField: 'category', foreignField: '_id', as: 'category' } },
    { $unwind: { path: '$category', preserveNullAndEmptyArrays: true } },
    { $lookup: { from: 'departments', localField: 'department', foreignField: '_id', as: 'department' } },
    { $unwind: { path: '$department', preserveNullAndEmptyArrays: true } },
    { $lookup: { from: 'vendors', localField: 'vendor', foreignField: '_id', as: 'vendor' } },
    { $unwind: { path: '$vendor', preserveNullAndEmptyArrays: true } },
    { $lookup: { from: 'users', localField: 'assignedTo', foreignField: '_id', as: 'assignedTo' } },
    { $unwind: { path: '$assignedTo', preserveNullAndEmptyArrays: true } },
    {
      $addFields: {
        'site.handler': { $first: '$_handler' },
      },
    },
    { $project: { _handler: 0 } },
  ]).allowDiskUse(true);

  const rows = assets.map((a) => {
    const row = {};
    for (const key of columns) row[EXPORT_COLUMNS[key].label] = EXPORT_COLUMNS[key].get(a);

    if (includeCustom && a.customFields) {
      const custom = a.customFields instanceof Map
        ? Object.fromEntries(a.customFields)
        : a.customFields;
      for (const [k, v] of Object.entries(custom)) {
        if (onlyCustom && !onlyCustom.includes(k)) continue;
        // Never let a custom field quietly overwrite a real column.
        row[row[k] === undefined ? k : `${k} (custom)`] = v;
      }
    }
    return row;
  });

  const sheet = XLSX.utils.json_to_sheet(rows.length ? rows : [{ 'Asset Tag ID': 'No assets matched' }]);
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, 'Asset Register');

  const format = req.query.format === 'csv' ? 'csv' : 'xlsx';
  const buffer = XLSX.write(book, { type: 'buffer', bookType: format });
  const stamp = new Date().toISOString().slice(0, 10);

  await recordAudit(req, {
    action: 'asset.exported', entity: 'Asset',
    entityLabel: `${rows.length} rows, ${columns.length} column(s)`,
    meta: { format, columns, includeCustom, filter: req.query },
  });

  res.setHeader('Content-Disposition', `attachment; filename="asset-register-${stamp}.${format}"`);
  res.setHeader(
    'Content-Type',
    format === 'csv' ? 'text/csv' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  );
  res.send(buffer);
});

/** Blank workbook using the register's own headers. */
export const downloadTemplate = asyncHandler(async (_req, res) => {
  const headers = REGISTER_COLUMNS.map((key) => EXPORT_COLUMNS[key].label);
  const sheet = XLSX.utils.aoa_to_sheet([headers]);
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, 'Asset Register');
  const buffer = XLSX.write(book, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Disposition', 'attachment; filename="asset-register-template.xlsx"');
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buffer);
});
