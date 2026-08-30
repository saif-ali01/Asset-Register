import XLSX from 'xlsx';

import { NO_LOGIN, User, hashPassword } from '../models/User.js';
import { Asset } from '../models/Asset.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { recordAudit } from '../utils/audit.js';
import { ROLE_NAMES } from '../config/permissions.js';
import { canManageTarget } from '../middleware/auth.js';

/**
 * Bulk import of people from a spreadsheet.
 *
 * Email is the key: it is unique on the account, so it decides whether a row
 * is a new person or an edit to an existing one.
 *
 * Permissions are deliberately NOT importable. Roles are, because a role is a
 * named bundle someone reviewed once; per-person permission overrides are the
 * mechanism for granting rights beyond a role, and letting those in through a
 * spreadsheet would make privilege escalation a matter of typing a column
 * heading. Overrides stay editable only in People, one person at a time, where
 * the person doing it can see what they are granting.
 */
export const IMPORTABLE_USER_FIELDS = {
  name: ['name', 'full name', 'employee name', 'person', 'user name'],
  email: ['email', 'email address', 'work email', 'official email', 'mail'],
  role: ['role', 'access', 'access level', 'user type', 'permission level'],
  employeeId: ['employee id', 'emp id', 'employee code', 'emp code', 'staff id'],
  department: ['department', 'dept', 'team'],
  designation: ['designation', 'title', 'job title', 'position'],
  phone: ['phone', 'mobile', 'contact', 'phone number', 'mobile number'],
  isActive: ['active', 'is active', 'status', 'enabled', 'account status'],
  password: ['password', 'temporary password', 'temp password', 'initial password'],
};

/** Fields a spreadsheet may never set, with the reason shown in the UI. */
export const BLOCKED_USER_FIELDS = {
  extraPermissions: 'Granting extra permissions in bulk would make escalation trivial \u2014 set these per person in People.',
  deniedPermissions: 'Blocking permissions in bulk hides who lost what \u2014 set these per person in People.',
  lastLoginAt: 'Recorded by the system when someone signs in.',
  failedLoginAttempts: 'Recorded by the system.',
  lockedUntil: 'Recorded by the system.',
};

export const USER_IMPORT_MODES = {
  create: 'Only add new people. An email that already exists is reported, never overwritten.',
  update: 'Only update people who already exist. An email with no match is reported, never created.',
  upsert: 'Add new people and update existing ones, matching on email.',
};

const norm = (s) => String(s ?? '')
  .toLowerCase()
  .replace(/\([^)]*\)/g, ' ')
  .replace(/[^a-z0-9]+/g, ' ')
  .trim()
  .replace(/\s+/g, ' ');

const ROLE_ALIASES = {
  'super admin': 'super_admin', superadmin: 'super_admin', owner: 'super_admin',
  admin: 'admin', administrator: 'admin',
  manager: 'manager', handler: 'manager', lead: 'manager',
  technician: 'technician', tech: 'technician', engineer: 'technician', support: 'technician',
  auditor: 'auditor', audit: 'auditor', 'read only': 'auditor', readonly: 'auditor', viewer: 'auditor',
  employee: 'employee', user: 'employee', staff: 'employee', member: 'employee',
};

const TRUE_VALUES = ['yes', 'y', 'true', '1', 'active', 'enabled'];
const FALSE_VALUES = ['no', 'n', 'false', '0', 'inactive', 'disabled', 'deactivated'];

const parseActive = (raw) => {
  const v = norm(raw);
  if (TRUE_VALUES.includes(v)) return true;
  if (FALSE_VALUES.includes(v)) return false;
  return undefined;
};

export function suggestUserMapping(headers) {
  const mapping = {};
  const taken = new Set();

  const overlap = (a, b) => {
    const longer = Math.max(a.length, b.length);
    return longer === 0 ? 0 : Math.min(a.length, b.length) / longer;
  };

  for (const header of headers) {
    const h = norm(header);
    let match = null;

    for (const [field, aliases] of Object.entries(IMPORTABLE_USER_FIELDS)) {
      if (taken.has(field)) continue;
      if (aliases.includes(h)) { match = field; break; }
    }
    if (!match) {
      let best = 0;
      for (const [field, aliases] of Object.entries(IMPORTABLE_USER_FIELDS)) {
        if (taken.has(field)) continue;
        for (const alias of aliases) {
          if (!h.includes(alias) && !alias.includes(h)) continue;
          const score = overlap(h, alias);
          if (score >= 0.7 && score > best) { best = score; match = field; }
        }
      }
    }
    if (match) taken.add(match);
    mapping[header] = match || '__ignore__';
  }
  return mapping;
}

function readSheet(file, sheetName) {
  if (!file) throw ApiError.badRequest('Attach a .xlsx or .csv file');
  const wb = XLSX.read(file.buffer, { type: 'buffer', cellDates: true });
  const name = sheetName && wb.SheetNames.includes(sheetName) ? sheetName : wb.SheetNames[0];
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { defval: null, raw: false });
  return { sheetNames: wb.SheetNames, sheetName: name, rows };
}

const isEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v || '').trim());

export const previewUserImport = asyncHandler(async (req, res) => {
  const { sheetNames, sheetName, rows } = readSheet(req.file, req.body.sheet);
  if (!rows.length) throw ApiError.badRequest(`Sheet "${sheetName}" has no data rows`);

  const headers = Object.keys(rows[0]);
  const mapping = suggestUserMapping(headers);
  const emailColumn = Object.entries(mapping).find(([, f]) => f === 'email')?.[0] || null;

  // Email problems are worth surfacing before anything is written.
  const seen = new Map();
  const blankRows = [];
  const invalidRows = [];
  const duplicates = [];
  if (emailColumn) {
    for (const [i, row] of rows.entries()) {
      const raw = String(row[emailColumn] ?? '').trim().toLowerCase();
      if (!raw) { blankRows.push(i + 2); continue; }
      if (!isEmail(raw)) { invalidRows.push({ row: i + 2, value: raw }); continue; }
      if (seen.has(raw)) duplicates.push({ email: raw, rows: [seen.get(raw), i + 2] });
      else seen.set(raw, i + 2);
    }
  }

  // How many of these already have accounts is useful context, but it is only
  // context — a preview must still render if that lookup cannot be made.
  let alreadyExist = null;
  if (seen.size) {
    try {
      const found = await User.find({ email: { $in: [...seen.keys()] } }).select('email').lean();
      alreadyExist = found.length;
    } catch {
      alreadyExist = null;
    }
  } else {
    alreadyExist = 0;
  }

  res.json({
    sheetNames,
    sheetName,
    headers,
    totalRows: rows.length,
    suggestedMapping: mapping,
    fields: Object.keys(IMPORTABLE_USER_FIELDS),
    blockedFields: BLOCKED_USER_FIELDS,
    modes: USER_IMPORT_MODES,
    roles: ROLE_NAMES,
    sample: rows.slice(0, 8),
    emailCheck: {
      column: emailColumn,
      distinctEmails: seen.size,
      blankRows: blankRows.slice(0, 50),
      blankCount: blankRows.length,
      invalidRows: invalidRows.slice(0, 50),
      invalidCount: invalidRows.length,
      duplicates: duplicates.slice(0, 50),
      duplicateCount: duplicates.length,
      alreadyExist,
    },
  });
});

export const commitUserImport = asyncHandler(async (req, res) => {
  const { rows } = readSheet(req.file, req.body.sheet);
  const mapping = typeof req.body.mapping === 'string' ? JSON.parse(req.body.mapping) : req.body.mapping;
  if (!mapping || typeof mapping !== 'object') throw ApiError.badRequest('Send a column mapping');

  if (!Object.values(mapping).includes('email')) {
    throw ApiError.badRequest(
      'One column must be mapped to Email. People are matched by email, so an import without it cannot proceed.',
      { mapping: 'No column mapped to Email' }
    );
  }

  const dryRun = String(req.body.dryRun) === 'true';
  const mode = Object.keys(USER_IMPORT_MODES).includes(req.body.mode) ? req.body.mode : 'upsert';
  const defaultRole = ROLE_NAMES.includes(req.body.defaultRole) ? req.body.defaultRole : 'employee';

  // Accounts without a password are created dormant: the record exists so
  // assets can point at the person, but nobody can sign in until an admin
  // sets one. Any real password given in the sheet is hashed once here.
  const activateWithoutPassword = String(req.body.activateWithoutPassword) === 'true';

  const created = [];
  const updated = [];
  const skipped = [];
  const errors = [];
  const notices = [];
  const seenEmails = new Map();

  for (const [index, row] of rows.entries()) {
    const rowNumber = index + 2;
    try {
      const doc = {};
      let plainPassword = null;

      for (const [header, field] of Object.entries(mapping)) {
        if (field === '__ignore__') continue;
        if (BLOCKED_USER_FIELDS[field]) {
          notices.push({ row: rowNumber, message: `Column "${header}" ignored: ${BLOCKED_USER_FIELDS[field]}` });
          continue;
        }
        const value = row[header];
        if (value === null || String(value).trim() === '') continue;
        const raw = String(value).trim();

        switch (field) {
          case 'email': doc.email = raw.toLowerCase(); break;
          case 'role': {
            const resolved = ROLE_ALIASES[norm(raw)] || (ROLE_NAMES.includes(norm(raw).replace(/ /g, '_')) ? norm(raw).replace(/ /g, '_') : null);
            if (resolved) doc.role = resolved;
            else notices.push({ row: rowNumber, message: `Role "${raw}" not recognised; using ${defaultRole}` });
            break;
          }
          case 'isActive': {
            const parsed = parseActive(raw);
            if (parsed !== undefined) doc.isActive = parsed;
            break;
          }
          case 'password': plainPassword = raw; break;
          default: doc[field] = raw;
        }
      }

      if (!doc.email) {
        errors.push({ row: rowNumber, message: 'No email in this row. Every row needs one.' });
        continue;
      }
      if (!isEmail(doc.email)) {
        errors.push({ row: rowNumber, email: doc.email, message: `"${doc.email}" is not a valid email address` });
        continue;
      }
      if (seenEmails.has(doc.email)) {
        errors.push({
          row: rowNumber, email: doc.email,
          message: `${doc.email} already appears on row ${seenEmails.get(doc.email)} of this file`,
        });
        continue;
      }
      seenEmails.set(doc.email, rowNumber);

      const role = doc.role || defaultRole;

      // You cannot import an account more privileged than your own, exactly as
      // you cannot create one by hand.
      if (!canManageTarget(req.user, role)) {
        errors.push({
          row: rowNumber, email: doc.email,
          message: `Your role (${req.user.role}) cannot create or change a ${role} account`,
        });
        continue;
      }

      const existing = await User.findOne({ email: doc.email });

      if (existing && mode === 'create') {
        skipped.push({ row: rowNumber, email: doc.email, reason: 'Already has an account' });
        continue;
      }
      if (!existing && mode === 'update') {
        skipped.push({ row: rowNumber, email: doc.email, reason: 'No account with this email to update' });
        continue;
      }

      if (existing) {
        if (!canManageTarget(req.user, existing.role)) {
          errors.push({
            row: rowNumber, email: doc.email,
            message: `${doc.email} is a ${existing.role} and outranks you`,
          });
          continue;
        }
        if (String(existing._id) === String(req.user._id) && doc.role && doc.role !== existing.role) {
          errors.push({ row: rowNumber, email: doc.email, message: 'You cannot change your own role' });
          continue;
        }

        if (!dryRun) {
          // Only the columns present are applied, so a partial sheet is a
          // targeted bulk edit. An existing password is never touched unless
          // the sheet actually supplies a new one.
          Object.assign(existing, doc);
          if (plainPassword) {
            existing.password = plainPassword; // hashed by the save hook
            existing.mustChangePassword = true;
            existing.isActive = doc.isActive ?? true;
          }
          await existing.save();
        }
        updated.push({ row: rowNumber, email: doc.email, fields: Object.keys(doc).length });
        continue;
      }

      if (!doc.name) doc.name = doc.email.split('@')[0].replace(/[._]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

      const willBeActive = doc.isActive ?? (plainPassword ? true : activateWithoutPassword);
      if (willBeActive && !plainPassword) {
        notices.push({
          row: rowNumber,
          message: `${doc.email} has no password in the sheet, so it is created dormant \u2014 set a password in People to switch it on`,
        });
      }

      if (dryRun) {
        created.push({ row: rowNumber, email: doc.email, name: doc.name, role });
        continue;
      }

      const saved = await User.create({
        ...doc,
        role,
        // No password in the sheet means an unusable marker, not a guessable
        // default shared across every imported account.
        password: plainPassword ? await hashPassword(plainPassword) : NO_LOGIN,
        isActive: plainPassword ? (doc.isActive ?? true) : false,
        mustChangePassword: Boolean(plainPassword),
        createdBy: req.user._id,
      });
      created.push({ row: rowNumber, email: saved.email, name: saved.name, role: saved.role });
    } catch (err) {
      const message = err.code === 11000 ? 'That email is already in use' : err.message;
      errors.push({ row: rowNumber, message });
    }
  }

  if (!dryRun) {
    await recordAudit(req, {
      action: 'user.imported', entity: 'User',
      entityLabel: `${created.length} created, ${updated.length} updated`,
      meta: {
        mode, created: created.length, updated: updated.length,
        skipped: skipped.length, errors: errors.length,
      },
    });
  }

  res.json({
    dryRun,
    mode,
    summary: {
      total: rows.length,
      created: created.length,
      updated: updated.length,
      skipped: skipped.length,
      failed: errors.length,
      notices: notices.length,
    },
    created: created.slice(0, 100),
    updated: updated.slice(0, 100),
    skipped: skipped.slice(0, 100),
    errors: errors.slice(0, 100),
    notices: notices.slice(0, 100),
  });
});

/** Blank workbook with the headers the user importer understands. */
export const downloadUserTemplate = asyncHandler(async (_req, res) => {
  const headers = ['Name', 'Email', 'Role', 'Employee ID', 'Department', 'Designation', 'Phone', 'Active', 'Password'];
  const sheet = XLSX.utils.aoa_to_sheet([
    headers,
    ['Ritika Sharma', 'ritika@nutraj.com', 'manager', 'EMP1001', 'IT Department', 'IT Manager', '', 'Yes', ''],
  ]);
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, 'People');
  const buffer = XLSX.write(book, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Disposition', 'attachment; filename="people-import-template.xlsx"');
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buffer);
});

/** Exports the current people list, in the same shape the importer reads. */
export const exportUsers = asyncHandler(async (req, res) => {
  const users = await User.find().sort('name').lean();
  const counts = await Asset.aggregate([
    { $match: { isArchived: false, assignedTo: { $exists: true, $ne: null } } },
    { $group: { _id: '$assignedTo', n: { $sum: 1 } } },
  ]);
  const held = Object.fromEntries(counts.map((c) => [String(c._id), c.n]));

  const rows = users.map((u) => ({
    Name: u.name,
    Email: u.email,
    Role: u.role,
    'Employee ID': u.employeeId || '',
    Department: u.department || '',
    Designation: u.designation || '',
    Phone: u.phone || '',
    Active: u.isActive ? 'Yes' : 'No',
    'Can Sign In': u.password === NO_LOGIN ? 'No' : 'Yes',
    'Assets Held': held[String(u._id)] || 0,
    'Last Signed In': u.lastLoginAt ? new Date(u.lastLoginAt).toISOString().slice(0, 10) : '',
    // Password is never exported, and permission overrides are shown as a
    // count only — the detail belongs in People, not in a file that travels.
    'Permission Overrides': (u.extraPermissions?.length || 0) + (u.deniedPermissions?.length || 0),
  }));

  const sheet = XLSX.utils.json_to_sheet(rows.length ? rows : [{ Email: 'No people found' }]);
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, 'People');

  const format = req.query.format === 'csv' ? 'csv' : 'xlsx';
  const buffer = XLSX.write(book, { type: 'buffer', bookType: format });

  await recordAudit(req, {
    action: 'user.exported', entity: 'User', entityLabel: `${rows.length} people`, meta: { format },
  });

  res.setHeader('Content-Disposition', `attachment; filename="people-${new Date().toISOString().slice(0, 10)}.${format}"`);
  res.setHeader(
    'Content-Type',
    format === 'csv' ? 'text/csv' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  );
  res.send(buffer);
});
