/**
 * Permissions are `resource:action` strings. Roles are bundles of them.
 * A user's effective set = role bundle + extraPermissions - deniedPermissions.
 * Grant the narrowest role that does the job, then widen with extraPermissions.
 */
export const PERMISSIONS = {
  ASSET_READ: 'asset:read',
  ASSET_CREATE: 'asset:create',
  ASSET_UPDATE: 'asset:update',
  ASSET_DELETE: 'asset:delete',
  ASSET_IMPORT: 'asset:import',
  ASSET_EXPORT: 'asset:export',

  ASSIGNMENT_READ: 'assignment:read',
  ASSIGNMENT_CHECKOUT: 'assignment:checkout',
  ASSIGNMENT_CHECKIN: 'assignment:checkin',

  MAINTENANCE_READ: 'maintenance:read',
  MAINTENANCE_WRITE: 'maintenance:write',

  LOOKUP_READ: 'lookup:read',
  LOOKUP_WRITE: 'lookup:write',

  USER_READ: 'user:read',
  USER_WRITE: 'user:write',
  USER_DELETE: 'user:delete',
  ROLE_MANAGE: 'role:manage',

  AUDIT_READ: 'audit:read',
  DASHBOARD_READ: 'dashboard:read',
};

const P = PERMISSIONS;
const ALL = Object.values(P);

const READ_ONLY = [
  P.ASSET_READ, P.ASSIGNMENT_READ, P.MAINTENANCE_READ,
  P.LOOKUP_READ, P.DASHBOARD_READ,
];

export const ROLES = {
  super_admin: {
    label: 'Super admin',
    blurb: 'Full control, including roles and deletions.',
    permissions: ALL,
  },
  admin: {
    label: 'Admin',
    blurb: 'Runs the system day to day. Cannot change role definitions.',
    permissions: ALL.filter((p) => p !== P.ROLE_MANAGE),
  },
  manager: {
    label: 'Manager',
    blurb: 'Owns a fleet: adds assets, checks them in and out, reads the trail.',
    permissions: [
      ...READ_ONLY, P.ASSET_CREATE, P.ASSET_UPDATE, P.ASSET_EXPORT,
      P.ASSIGNMENT_CHECKOUT, P.ASSIGNMENT_CHECKIN, P.MAINTENANCE_WRITE,
      P.LOOKUP_WRITE, P.USER_READ, P.AUDIT_READ,
    ],
  },
  technician: {
    label: 'Technician',
    blurb: 'Repairs and moves hardware. Cannot create or delete asset records.',
    permissions: [
      ...READ_ONLY, P.ASSET_UPDATE, P.ASSIGNMENT_CHECKOUT,
      P.ASSIGNMENT_CHECKIN, P.MAINTENANCE_WRITE, P.USER_READ,
    ],
  },
  auditor: {
    label: 'Auditor',
    blurb: 'Reads everything and exports. Changes nothing.',
    permissions: [...READ_ONLY, P.AUDIT_READ, P.ASSET_EXPORT, P.USER_READ],
  },
  employee: {
    label: 'Employee',
    blurb: 'Sees only the assets currently signed out to them.',
    permissions: [P.ASSET_READ, P.ASSIGNMENT_READ, P.DASHBOARD_READ],
  },
};

export const ROLE_NAMES = Object.keys(ROLES);

/** Roles whose asset/assignment reads are narrowed to their own records. */
export const SELF_SCOPED_ROLES = ['employee'];

export function permissionsForRole(role) {
  return ROLES[role]?.permissions ?? [];
}

export function effectivePermissions(user) {
  if (!user) return [];
  const base = new Set(permissionsForRole(user.role));
  (user.extraPermissions || []).forEach((p) => base.add(p));
  (user.deniedPermissions || []).forEach((p) => base.delete(p));
  return [...base];
}

export function can(user, permission) {
  return effectivePermissions(user).includes(permission);
}
