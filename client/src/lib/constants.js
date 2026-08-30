/**
 * Labels are the register's own words. "Checked Out" rather than "Assigned",
 * because that is what the team already says and what the printed reports use.
 */
export const STATUS_META = {
  available: { label: 'Available', tone: 'brand' },
  checked_out: { label: 'Checked Out', tone: 'steel' },
  under_repair: { label: 'Under Repair', tone: 'amber' },
  leased: { label: 'Leased', tone: 'steel' },
  lost_missing: { label: 'Lost/Missing', tone: 'danger' },
  donated: { label: 'Donated', tone: 'neutral' },
  sold: { label: 'Sold', tone: 'neutral' },
  disposed: { label: 'Disposed', tone: 'neutral' },
};

/** Statuses that keep an asset on the live register. */
export const LIVE_STATUSES = ['available', 'checked_out', 'under_repair', 'leased'];
/** Statuses that close it out. */
export const CLOSED_STATUSES = ['disposed', 'sold', 'donated', 'lost_missing'];
/** A named holder is expected only here. */
export const ASSIGNED_STATUSES = ['checked_out'];

export const CONDITION_META = {
  new: { label: 'New', tone: 'brand' },
  good: { label: 'Good', tone: 'brand' },
  fair: { label: 'Fair', tone: 'amber' },
  poor: { label: 'Poor', tone: 'amber' },
  damaged: { label: 'Damaged', tone: 'danger' },
};

export const MAINTENANCE_STATUS_META = {
  scheduled: { label: 'Scheduled', tone: 'steel' },
  in_progress: { label: 'In progress', tone: 'amber' },
  completed: { label: 'Completed', tone: 'brand' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
};

export const STATUSES = Object.keys(STATUS_META);
export const ENTITIES = ['VKC', 'Auro', 'VFI', 'Nutlounge', 'Nutraj', 'VNS', 'Rented'];
export const CONDITIONS = Object.keys(CONDITION_META);
export const MAINTENANCE_TYPES = ['preventive', 'repair', 'upgrade', 'inspection', 'calibration'];
export const MAINTENANCE_STATUSES = Object.keys(MAINTENANCE_STATUS_META);
export const DEPRECIATION_METHODS = [
  { value: 'none', label: 'None' },
  { value: 'straight_line', label: 'Straight line' },
  { value: 'wdv', label: 'Written-down value' },
];

export const P = {
  ASSET_READ: 'asset:read', ASSET_CREATE: 'asset:create', ASSET_UPDATE: 'asset:update',
  ASSET_DELETE: 'asset:delete', ASSET_IMPORT: 'asset:import', ASSET_EXPORT: 'asset:export',
  ASSIGNMENT_READ: 'assignment:read', ASSIGNMENT_CHECKOUT: 'assignment:checkout',
  ASSIGNMENT_CHECKIN: 'assignment:checkin',
  MAINTENANCE_READ: 'maintenance:read', MAINTENANCE_WRITE: 'maintenance:write',
  LOOKUP_READ: 'lookup:read', LOOKUP_WRITE: 'lookup:write',
  USER_READ: 'user:read', USER_WRITE: 'user:write', USER_DELETE: 'user:delete',
  ROLE_MANAGE: 'role:manage', AUDIT_READ: 'audit:read', DASHBOARD_READ: 'dashboard:read',
};

/** The lists behind the asset form, in the order they appear in Settings. */
export const LOOKUP_RESOURCES = ['categories', 'departments', 'sites', 'vendors'];

export const ACTION_LABELS = {
  'asset.created': 'Asset added',
  'asset.updated': 'Asset edited',
  'asset.archived': 'Asset archived',
  'asset.restored': 'Asset restored',
  'asset.deleted': 'Asset deleted',
  'asset.checked_out': 'Checked out',
  'asset.checked_in': 'Checked in',
  'asset.transferred': 'Transferred',
  'asset.bulk_updated': 'Bulk edit',
  'asset.imported': 'Spreadsheet import',
  'asset.exported': 'Export',
  'auth.login': 'Signed in',
  'user.registered': 'Account created',
  'user.created': 'User added',
  'user.updated': 'User edited',
  'user.deactivated': 'User deactivated',
  'user.deleted': 'User deleted',
  'user.password_reset': 'Password reset',
  'user.password_changed': 'Password changed',
  'user.profile_updated': 'Profile edited',
  'maintenance.created': 'Maintenance raised',
  'maintenance.updated': 'Maintenance updated',
  'maintenance.deleted': 'Maintenance removed',
  'system.seeded': 'Demo data loaded',
};
