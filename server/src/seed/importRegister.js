/**
 * Loads the Asset Tracker workbook into the database.
 *
 *   npm run import -- ../Asset_Tracker.xlsx --dry-run
 *   npm run import -- ../Asset_Tracker.xlsx --fresh
 *
 * Row parsing lives in analyse.js so the same logic backs the dry run, the
 * real import and the tests. This file only decides what to write.
 *
 * Written for bulk, not row-at-a-time. Everything existing is read in a
 * handful of queries up front, everything new is written with insertMany or
 * bulkWrite, and only accounts that can actually sign in pay for bcrypt.
 * Over a cloud cluster the difference is minutes versus seconds.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import mongoose from 'mongoose';
import XLSX from 'xlsx';
import { connectDb } from '../config/db.js';
import { env } from '../config/env.js';
import { Asset } from '../models/Asset.js';
import { Assignment } from '../models/Assignment.js';
import { Maintenance } from '../models/Maintenance.js';
import { AuditLog } from '../models/AuditLog.js';
import { RefreshToken } from '../models/RefreshToken.js';
import { NO_LOGIN, User, hashPassword } from '../models/User.js';
import { Category, Department, Site, Vendor } from '../models/Lookup.js';
import { analyseWorkbook } from './analyse.js';

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
const FRESH = args.includes('--fresh');
const DRY = args.includes('--dry-run');
const PASSWORD = env.adminPassword;

/** Rows per insertMany call. Large enough to be few round trips, small
 *  enough to stay well inside the 16MB command limit. */
const CHUNK = 500;

if (!file) {
  console.error('Usage: npm run import -- <workbook.xlsx> [--fresh] [--dry-run]');
  process.exit(1);
}

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '.').replace(/^\.|\.$/g, '');
const emailFor = (name) => `${slug(name) || 'user'}@${env.emailDomain}`;
const norm = (s) => String(s || '').trim().replace(/\s+/g, ' ');
const key = (s) => norm(s).toLowerCase();

/** Matches the kind of drop a flaky network or an idle cloud connection makes. */
const TRANSIENT = /ECONNRESET|ETIMEDOUT|ESOCKETTIMEDOUT|EPIPE|EAI_AGAIN|connection.*closed|topology.*closed|pool.*closed/i;

const isTransient = (err) => (
  TRANSIENT.test(err?.message || '')
  || ['MongoNetworkError', 'MongoServerSelectionError', 'MongoNetworkTimeoutError'].includes(err?.name)
);

async function withRetry(fn, { retries = 5, baseDelayMs = 500, label = 'operation' } = {}) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      if (!isTransient(err) || attempt > retries) throw err;
      const delay = baseDelayMs * 2 ** (attempt - 1);
      console.warn(`  ${label}: ${err.message} — retry ${attempt}/${retries} in ${delay}ms`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
}

/**
 * insertMany in chunks, unordered so one bad row cannot abort the batch.
 *
 * Retries have to be idempotent here. If a chunk partially writes and then
 * the connection drops, the retry re-sends the whole slice and the rows that
 * already landed come back as duplicate-key errors. Those are not failures —
 * the row is in the database, which is the outcome we wanted — so they are
 * counted separately rather than reported as data loss.
 */
async function insertChunked(Model, docs, label) {
  let written = 0;
  let alreadyPresent = 0;
  const failures = [];

  for (let i = 0; i < docs.length; i += CHUNK) {
    const slice = docs.slice(i, i + CHUNK);
    try {
      const res = await withRetry(
        () => Model.insertMany(slice, { ordered: false, rawResult: true }),
        { label: `${label} ${i + 1}-${i + slice.length}` }
      );
      written += res.insertedCount ?? slice.length;
    } catch (err) {
      // With ordered:false Mongo writes what it can and reports the rest.
      written += err.result?.insertedCount ?? err.insertedDocs?.length ?? 0;

      for (const e of err.writeErrors || []) {
        const code = e.code ?? e.err?.code;
        if (code === 11000) alreadyPresent += 1;
        else failures.push({ index: i + (e.index ?? 0), message: e.errmsg || e.message });
      }
      // A non-write error (auth, network exhausted after retries) is fatal.
      if (!err.writeErrors?.length) throw err;
    }
    process.stdout.write(`\r  ${label}: ${Math.min(i + CHUNK, docs.length)}/${docs.length}   `);
  }
  if (docs.length) process.stdout.write('\n');
  return { written, alreadyPresent, failures };
}

/** Reads the premises type out of the site's name. */
function siteKind(name) {
  const n = name.toLowerCase();
  if (n === 'ho' || n.includes('head')) return 'head_office';
  if (n.includes('factory') || n.includes('unit') || n.includes('plant')) return 'factory';
  if (n.startsWith('nt') || n.includes('retail') || n.includes('store')) return 'retail';
  if (n.includes('warehouse') || n.includes('godown')) return 'warehouse';
  if (n.includes('office')) return 'office';
  return 'other';
}

function report(a) {
  console.log('Detected from the sheet');
  console.log(`  assets          ${a.assets.length}`);
  console.log(`  handlers        ${a.handlers.map((h) => `${h.name} (${h.sites.length} sites)`).join(', ')}`);
  console.log(`  sites           ${a.sites.length}`);
  console.log(`  categories      ${a.categories.length}`);
  console.log(`  departments     ${a.departments.length}`);
  console.log(`  entities        ${a.entities.map((e) => `${e.name}:${e.count}`).join(', ')}`);
  console.log(`  named holders   ${a.holders.length}`);

  console.log('\nStatus after normalisation');
  for (const [k, v] of Object.entries(a.statusCounts).sort((x, y) => y[1] - x[1])) {
    console.log(`  ${k.padEnd(14)} ${v}`);
  }

  console.log('\n"Assigned to" column');
  for (const [k, v] of Object.entries(a.holderKinds).sort((x, y) => y[1] - x[1])) {
    console.log(`  ${k.padEnd(14)} ${v}`);
  }

  const byKind = {};
  for (const w of a.warnings) byKind[w.kind] = (byKind[w.kind] || 0) + 1;
  if (Object.keys(byKind).length) {
    console.log('\nThings worth a look (imported anyway, and listed under Data quality)');
    for (const [k, v] of Object.entries(byKind).sort((x, y) => y[1] - x[1])) {
      console.log(`  ${k.padEnd(24)} ${v}`);
    }
  }

  if (a.duplicateSerials.length) {
    console.log(`\nSerials used more than once: ${a.duplicateSerials.length} group(s)`);
    for (const d of a.duplicateSerials.slice(0, 8)) {
      console.log(`  ${d.serial} x${d.count} — ${d.tags.join(', ')}`);
    }
  }
}

/**
 * Upserts a set of names into a lookup collection in one round trip, then
 * reads the ids back in a second. Two queries per collection regardless of
 * how many names there are.
 */
async function syncLookup(Model, names, adminId, extraFor = () => ({})) {
  if (!names.length) return new Map();

  await withRetry(() => Model.bulkWrite(
    names.map((name) => ({
      updateOne: {
        filter: { name },
        update: { $set: extraFor(name), $setOnInsert: { name, createdBy: adminId } },
        upsert: true,
      },
    })),
    { ordered: false }
  ), { label: `${Model.modelName} upsert` });

  const docs = await withRetry(
    () => Model.find({ name: { $in: names } }).select('name').lean(),
    { label: `${Model.modelName} read-back` }
  );
  return new Map(docs.map((d) => [d.name, d._id]));
}

async function run() {
  const started = Date.now();
  const abs = path.resolve(file);
  const wb = XLSX.read(fs.readFileSync(abs), { type: 'buffer', cellDates: true });
  const sheetName = wb.SheetNames.includes('Asset Register') ? 'Asset Register' : wb.SheetNames[0];
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { defval: null, raw: false });

  console.log(`\nReading "${sheetName}" from ${path.basename(abs)} — ${rows.length} rows on the sheet\n`);
  const a = analyseWorkbook(rows);
  report(a);

  if (DRY) {
    console.log('\nDry run — nothing was written.\n');
    return;
  }

  await connectDb();

  if (FRESH) {
    console.log('\nClearing existing data…');
    await withRetry(() => Promise.all([
      Asset.deleteMany({}), Assignment.deleteMany({}), Maintenance.deleteMany({}),
      AuditLog.deleteMany({}), RefreshToken.deleteMany({}), User.deleteMany({}),
      Category.deleteMany({}), Department.deleteMany({}), Site.deleteMany({}), Vendor.deleteMany({}),
    ]), { label: 'clearing existing data' });
  }

  // ---- super admin ----
  let admin = await withRetry(() => User.findOne({ role: 'super_admin' }), { label: 'find super admin' });
  if (!admin) {
    admin = await withRetry(() => User.create({
      name: env.adminName,
      email: env.adminEmail,
      password: PASSWORD,
      role: 'super_admin',
      department: 'IT Department',
      designation: 'Head of IT',
    }), { label: 'create super admin' });
    console.log(`\nCreated super admin ${admin.email}`);
  }

  // ---- accounts, in bulk ----
  console.log('\nAccounts…');
  const existingUsers = await withRetry(
    () => User.find().select('name email').lean(),
    { label: 'read existing users' }
  );
  const userByKey = new Map();
  const takenEmails = new Set();
  for (const u of existingUsers) {
    userByKey.set(key(u.name), u);
    takenEmails.add(u.email);
  }

  const handlerNames = a.handlers.map((h) => norm(h.name));
  const holderNames = a.holders.map(norm);

  /**
   * Handlers run the register, so they get a real password. Holders exist only
   * so custody points at a person; their accounts are switched off and carry
   * the no-login marker, which is what avoids ~380 bcrypt hashes.
   */
  const handlerHash = handlerNames.length ? await hashPassword(PASSWORD) : null;
  const newUsers = [];

  const stage = (name, role, active, extra = {}) => {
    const k = key(name);
    if (!k || userByKey.has(k)) return;

    let email = emailFor(name);
    if (takenEmails.has(email)) {
      // Two spellings of one name can slugify to the same address.
      const suffix = crypto.randomBytes(2).toString('hex');
      email = email.replace('@', `.${suffix}@`);
    }
    takenEmails.add(email);

    const doc = {
      _id: new mongoose.Types.ObjectId(),
      name: norm(name),
      email,
      password: active ? handlerHash : NO_LOGIN,
      role,
      isActive: active,
      mustChangePassword: active,
      createdBy: admin._id,
      extraPermissions: [],
      deniedPermissions: [],
      theme: 'system',
      failedLoginAttempts: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...extra,
    };
    newUsers.push(doc);
    userByKey.set(k, doc);
  };

  for (const h of a.handlers) {
    stage(h.name, 'manager', true, {
      department: 'IT Department',
      designation: `Asset handler — ${h.sites.slice(0, 3).join(', ')}${h.sites.length > 3 ? '…' : ''}`,
    });
  }
  for (const name of holderNames) stage(name, 'employee', false);

  if (newUsers.length) {
    // insertMany skips the save hook, which is why the hash is prepared above.
    const res = await insertChunked(User, newUsers, 'accounts');
    if (res.failures.length) {
      console.warn(`  ${res.failures.length} account(s) could not be created`);
      for (const f of res.failures.slice(0, 5)) console.warn(`    ${f.message}`);
    }
  }
  console.log(`  ${handlerNames.length} handler(s) active, ${holderNames.length} holder(s) dormant`);

  // ---- lists, two round trips each ----
  console.log('\nLists…');
  const [catByName, depByName] = await Promise.all([
    syncLookup(Category, a.categories, admin._id),
    syncLookup(Department, a.departments, admin._id),
  ]);

  const siteByName = await syncLookup(
    Site,
    a.sites.map((s) => s.name),
    admin._id,
    (name) => {
      const site = a.sites.find((s) => s.name === name);
      const handler = site?.handler ? userByKey.get(key(site.handler)) : null;
      return {
        ...(site?.city ? { city: site.city } : {}),
        ...(handler ? { handler: handler._id } : {}),
        kind: siteKind(name),
      };
    }
  );
  console.log(`  ${catByName.size} categories, ${depByName.size} departments, ${siteByName.size} sites`);

  // ---- assets, in bulk ----
  console.log('\nAssets…');
  const existingTags = new Set(
    (await withRetry(() => Asset.find().select('tagKey').lean(), { label: 'read existing tags' }))
      .map((d) => d.tagKey)
  );

  const batch = `register-${new Date().toISOString().slice(0, 10)}`;
  const warningsByTag = new Map();
  for (const w of a.warnings) {
    if (w.tag) warningsByTag.set(w.tag, [...(warningsByTag.get(w.tag) || []), w.message]);
  }

  const assetDocs = [];
  const custody = [];
  let skipped = 0;

  for (const r of a.assets) {
    if (existingTags.has(r.tagKey)) { skipped += 1; continue; }

    const custom = {};
    if (r.placeholderSerial) custom['Serial No (as given)'] = r.serialAsGiven;
    if (r.assignedRaw && !r.isPerson) custom['Holder (as recorded)'] = r.assignedRaw;
    if (r.assignedRaw && !r.held) custom['Previous holder'] = r.assignedRaw;

    const holder = r.isPerson && r.held ? userByKey.get(key(r.assignedRaw)) : null;
    const now = new Date();
    const _id = new mongoose.Types.ObjectId();

    assetDocs.push({
      _id,
      tag: r.tag,
      tagKey: r.tagKey,
      name: r.name,
      entity: r.entity || undefined,
      brand: r.brand || undefined,
      model: r.model || undefined,
      serialNumber: r.serialNumber || undefined,
      status: r.status,
      category: r.category ? catByName.get(r.category) : undefined,
      department: r.department ? depByName.get(r.department) : undefined,
      site: r.site ? siteByName.get(r.site) : undefined,
      subCategory: r.subCategory || undefined,
      imageUrl: r.imageUrl || undefined,
      assignedTo: holder?._id,
      assignedToLabel: r.held ? r.assignedRaw || undefined : undefined,
      assignedAt: holder ? now : undefined,
      notes: warningsByTag.get(r.tag)?.length
        ? `Imported with notes: ${warningsByTag.get(r.tag).join('; ')}`
        : undefined,
      customFields: Object.keys(custom).length ? custom : undefined,
      importBatch: batch,
      quantity: 1,
      unit: 'unit',
      currency: 'INR',
      depreciationMethod: 'none',
      salvageValue: 0,
      labels: [],
      attachments: [],
      isArchived: false,
      createdBy: admin._id,
      updatedBy: admin._id,
      createdAt: now,
      updatedAt: now,
    });

    if (holder) {
      custody.push({
        asset: _id,
        assignedTo: holder._id,
        assignedBy: admin._id,
        checkedOutAt: now,
        siteOut: r.site ? siteByName.get(r.site) : undefined,
        notesOut: 'Opening balance from the register import',
        status: 'open',
        createdAt: now,
        updatedAt: now,
      });
    }
    existingTags.add(r.tagKey);
  }

  const assetResult = await insertChunked(Asset, assetDocs, 'assets');
  const custodyResult = custody.length
    ? await insertChunked(Assignment, custody, 'custody')
    : { written: 0, alreadyPresent: 0, failures: [] };

  await withRetry(() => AuditLog.create({
    actor: admin._id, actorName: admin.name, actorRole: admin.role,
    action: 'asset.imported', entity: 'Asset',
    entityLabel: `${assetResult.written} assets from ${path.basename(abs)}`,
    meta: {
      batch, sheet: sheetName,
      created: assetResult.written, skipped,
      failed: assetResult.failures.length, warnings: a.warnings.length,
    },
  }), { label: 'audit entry' });

  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  console.log(`\nAssets created   ${assetResult.written}`);
  console.log(`Already present  ${skipped + assetResult.alreadyPresent}`);
  console.log(`Open custody     ${custodyResult.written}`);
  console.log(`Failed           ${assetResult.failures.length}`);
  if (assetResult.alreadyPresent) {
    console.log(`  (${assetResult.alreadyPresent} of those were re-sent after a dropped connection and were already saved)`);
  }
  for (const f of assetResult.failures.slice(0, 10)) {
    console.log(`  ${assetDocs[f.index]?.tag || `row ${f.index}`}: ${f.message}`);
  }
  console.log(`\nFinished in ${seconds}s`);

  console.log(`\nSign in as ${admin.email} with the seed password.`);
  console.log(`Handlers (${a.handlers.map((h) => h.name).join(', ')}) share that password and must change it.`);
  console.log('Holder accounts have no password and cannot sign in until you set one in People.\n');
}

run()
  .catch((err) => { console.error(err); process.exitCode = 1; })
  .finally(async () => { await mongoose.disconnect().catch(() => {}); });