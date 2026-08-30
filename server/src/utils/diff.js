const FIELD_LABELS = {
  tag: 'Asset tag', name: 'Name', status: 'Status', condition: 'Condition',
  category: 'Category', site: 'Site', department: 'Department',
  assignedTo: 'Assigned to', assignedToLabel: 'Holder (as recorded)',
  entity: 'Owning company', subCategory: 'Sub category', tagKey: 'Tag key',
  vendor: 'Vendor', purchaseCost: 'Purchase cost', purchaseDate: 'Purchase date',
  warrantyExpiry: 'Warranty expiry', serialNumber: 'Serial number',
  role: 'Role', isActive: 'Active', extraPermissions: 'Extra permissions',
  deniedPermissions: 'Denied permissions',
  depreciationMethod: 'Depreciation method', usefulLifeMonths: 'Useful life (months)',
};

const IGNORED = new Set(['updatedAt', 'createdAt', '__v', '_id', 'updatedBy', 'password', 'tagKey']);

const normalise = (value) => {
  if (value === undefined || value === null || value === '') return null;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(String).sort().join(', ') || null;
  if (value instanceof Map) return JSON.stringify(Object.fromEntries(value));
  if (typeof value === 'object' && value._id) return String(value._id);
  if (typeof value === 'object') return JSON.stringify(value);
  return value;
};

/** Field-level diff between two plain objects, ready for the audit trail. */
export function buildDiff(before = {}, after = {}) {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  const changes = [];
  for (const key of keys) {
    if (IGNORED.has(key)) continue;
    const from = normalise(before[key]);
    const to = normalise(after[key]);
    if (String(from) === String(to)) continue;
    changes.push({ field: key, label: FIELD_LABELS[key] || key, from, to });
  }
  return changes;
}
