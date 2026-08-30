/**
 * Pure analysis of a register worksheet: no database, no side effects.
 * The importer and the --dry-run report both use this, which also makes the
 * whole mapping testable against the workbook's own Summary Dashboard.
 */
import {
  ASSIGNED_STATUSES, canonicalCategory, canonicalDepartment, categoryFromTag,
  entityFromTag, isPlaceholderSerial, normaliseStatus,
} from '../config/reference.js';

const clean = (v) => (v === null || v === undefined ? '' : String(v).trim());

const ENTITY_CODES = ['VKC', 'AURO', 'VFI', 'NUTLOUNGE', 'NUTRAJ', 'VNS'];

/**
 * A holder is a person unless the cell actually names a site, a department or
 * an owning company. The source register uses all three interchangeably.
 */
export function classifyHolder(value, { siteNames, departmentNames }) {
  const v = clean(value);
  if (!v) return { kind: 'blank', isPerson: false };
  if (ENTITY_CODES.includes(v.toUpperCase())) return { kind: 'entity', isPerson: false };
  if (siteNames.has(v)) return { kind: 'site', isPerson: false };
  if (v.includes('/')) return { kind: 'site', isPerson: false };
  if (departmentNames.has(v) || /department$/i.test(v)) return { kind: 'department', isPerson: false };
  return { kind: 'person', isPerson: true };
}

export function analyseWorkbook(rows) {
  const siteNames = new Set(rows.map((r) => clean(r.Site)).filter(Boolean));
  const departmentNames = new Set(
    rows.map((r) => canonicalDepartment(clean(r.Department))).filter(Boolean)
  );

  const handlers = new Map();
  const siteInfo = new Map();
  const categories = new Set();
  const departments = new Set();
  const holders = new Set();
  const entities = new Map();
  const statusCounts = {};
  const holderKinds = {};
  const warnings = [];
  const assets = [];
  const seenTagKeys = new Map();

  for (const [i, row] of rows.entries()) {
    const rowNumber = i + 2;
    const tag = clean(row['Asset Tag ID']);
    if (!tag) {
      // Spreadsheets carry trailing blank rows; only complain when the row
      // actually holds data but is missing its tag.
      const hasContent = Object.values(row).some((v) => clean(v) !== '');
      if (hasContent) {
        warnings.push({ row: rowNumber, kind: 'no_tag', message: 'Row has data but no asset tag, so it was skipped' });
      }
      continue;
    }

    const tagKey = tag.toUpperCase();
    if (seenTagKeys.has(tagKey)) {
      warnings.push({
        row: rowNumber, kind: 'duplicate_tag', tag,
        message: `Tag repeats row ${seenTagKeys.get(tagKey)} (case-insensitive)`,
      });
      continue;
    }
    seenTagKeys.set(tagKey, rowNumber);

    const site = clean(row.Site);
    const city = clean(row.Location);
    const handler = clean(row.Handler);
    const rawStatus = clean(row.Status);
    const status = normaliseStatus(rawStatus);
    const assignedRaw = clean(row['Assigned to']);
    const serialRaw = clean(row['Serial No']);

    statusCounts[status] = (statusCounts[status] || 0) + 1;

    let category = canonicalCategory(clean(row.Category));
    if (!category) {
      category = categoryFromTag(tag);
      if (category) {
        warnings.push({ row: rowNumber, kind: 'category_from_tag', tag, message: `Category read from the tag as "${category}"` });
      }
    }
    const department = canonicalDepartment(clean(row.Department));
    const rawDepartment = clean(row.Department);
    if (rawDepartment && !department) {
      warnings.push({ row: rowNumber, kind: 'not_a_department', tag, message: `"${rawDepartment}" is not a department; kept as a note` });
    }

    if (handler && site) {
      if (!handlers.has(handler)) handlers.set(handler, new Set());
      handlers.get(handler).add(site);
    }
    if (site && !siteInfo.has(site)) siteInfo.set(site, { city, handler });
    else if (site && city && siteInfo.get(site).city && siteInfo.get(site).city !== city) {
      warnings.push({
        row: rowNumber, kind: 'site_city_conflict', tag,
        message: `Site "${site}" is recorded in both ${siteInfo.get(site).city} and ${city}`,
      });
    }
    if (category) categories.add(category);
    if (department) departments.add(department);

    const entity = entityFromTag(tag);
    if (entity) entities.set(entity, (entities.get(entity) || 0) + 1);

    const holder = classifyHolder(assignedRaw, { siteNames, departmentNames });
    holderKinds[holder.kind] = (holderKinds[holder.kind] || 0) + 1;

    const held = ASSIGNED_STATUSES.includes(status);
    if (assignedRaw && !held) {
      warnings.push({ row: rowNumber, kind: 'holder_without_custody', tag, message: `Holder "${assignedRaw}" recorded but status is ${status}` });
    }
    if (!assignedRaw && held) {
      warnings.push({ row: rowNumber, kind: 'custody_without_holder', tag, message: `Status is ${status} but nobody is named` });
    }
    if (holder.isPerson && held) holders.add(assignedRaw);

    const placeholderSerial = Boolean(serialRaw) && isPlaceholderSerial(serialRaw);
    if (placeholderSerial) {
      warnings.push({ row: rowNumber, kind: 'placeholder_serial', tag, message: `Serial "${serialRaw}" is placeholder text, not an identifier` });
    }
    if (!serialRaw) {
      warnings.push({ row: rowNumber, kind: 'missing_serial', tag, message: 'No serial number recorded' });
    }
    if (tag !== tagKey) {
      warnings.push({ row: rowNumber, kind: 'tag_casing', tag, message: `Tag "${tag}" is not upper case; matched case-insensitively` });
    }

    assets.push({
      rowNumber, tag, tagKey, site, city, handler, status, entity,
      category, department, subCategory: clean(row['Sub Category']),
      name: clean(row.Description) || [clean(row.Brand), clean(row.Model)].filter(Boolean).join(' ') || tag,
      brand: clean(row.Brand),
      model: clean(row.Model),
      serialNumber: placeholderSerial || !serialRaw ? '' : serialRaw,
      serialAsGiven: serialRaw,
      placeholderSerial,
      imageUrl: clean(row['Asset Photo']),
      assignedRaw,
      holderKind: holder.kind,
      isPerson: holder.isPerson,
      held,
    });
  }

  // Serial duplicates across the whole file, ignoring placeholders.
  const bySerial = new Map();
  for (const a of assets) {
    if (!a.serialNumber) continue;
    const key = a.serialNumber.toUpperCase();
    bySerial.set(key, [...(bySerial.get(key) || []), a.tag]);
  }
  const duplicateSerials = [...bySerial.entries()]
    .filter(([, tags]) => tags.length > 1)
    .map(([serial, tags]) => ({ serial, count: tags.length, tags }))
    .sort((a, b) => b.count - a.count);

  return {
    assets,
    statusCounts,
    holderKinds,
    handlers: [...handlers.entries()].map(([name, sites]) => ({ name, sites: [...sites] })),
    sites: [...siteInfo.entries()].map(([name, info]) => ({ name, ...info })),
    categories: [...categories].sort(),
    departments: [...departments].sort(),
    entities: [...entities.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
    holders: [...holders].sort(),
    duplicateSerials,
    warnings,
  };
}
