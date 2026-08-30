/**
 * Small demo dataset for evaluating the app without the real workbook.
 * Uses the same vocabulary the register uses, so what you see here matches
 * what an import produces.
 *
 *   npm run seed -- --fresh
 */
import mongoose from 'mongoose';
import { connectDb } from '../config/db.js';
import { env } from '../config/env.js';
import { User } from '../models/User.js';
import { Asset } from '../models/Asset.js';
import { Assignment } from '../models/Assignment.js';
import { Maintenance } from '../models/Maintenance.js';
import { AuditLog } from '../models/AuditLog.js';
import { RefreshToken } from '../models/RefreshToken.js';
import { Category, Department, Site, Vendor } from '../models/Lookup.js';

const PASSWORD = env.adminPassword;
const D = env.emailDomain;
const daysAgo = (n) => new Date(Date.now() - n * 86400000);
const daysAhead = (n) => new Date(Date.now() + n * 86400000);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

const PEOPLE = [
  { name: 'Saif Ali', email: env.adminEmail, role: 'super_admin', department: 'IT Department', designation: 'Head of IT' },
  { name: 'Ankit', email: `ankit@${D}`, role: 'manager', department: 'IT Department', designation: 'Asset handler — HO' },
  { name: 'Aalok Sharma', email: `aalok@${D}`, role: 'manager', department: 'IT Department', designation: 'Asset handler — Main Unit' },
  { name: 'Vikash Kumar', email: `vikash@${D}`, role: 'technician', department: 'IT Department', designation: 'Support Engineer' },
];

const CATEGORIES = [
  { name: 'Laptop', code: 'LT', tagCodes: ['LT'], defaultUsefulLifeMonths: 48 },
  { name: 'Desktop', code: 'PC', tagCodes: ['PC'], defaultUsefulLifeMonths: 60 },
  { name: 'Mobile', code: 'PH', tagCodes: ['PH'], defaultUsefulLifeMonths: 36 },
  { name: 'Printer', code: 'PT', tagCodes: ['PT', 'LPT'], defaultUsefulLifeMonths: 60 },
  { name: 'Switch', code: 'SW', tagCodes: ['SW'], defaultUsefulLifeMonths: 84 },
  { name: 'Biometric Machine', code: 'BM', tagCodes: ['BM'], defaultUsefulLifeMonths: 60 },
  { name: 'Walkie-Talkie', code: 'WT', tagCodes: ['WT'], defaultUsefulLifeMonths: 48 },
  { name: 'DVR', code: 'DVR', tagCodes: ['DVR'], defaultUsefulLifeMonths: 60 },
];

const DEPARTMENTS = [
  'HR, Admin & IT', 'IT Department', 'Sales', 'Finance, Accounts & Legal',
  'Supply Chain & Logistics', 'Production Management', 'Marketing & Creative', 'Retail',
];

const SITES = [
  { name: 'HO', city: 'Noida', kind: 'head_office', handlerName: 'Ankit Verma' },
  { name: 'Main Unit, Akbarpur Barota', city: 'Sonipat', kind: 'factory', handlerName: 'Aalok Sharma' },
  { name: 'TRONICA CITY', city: 'Ghaziabad', kind: 'factory', handlerName: 'Vikash Kumar' },
  { name: 'Jammu Factory', city: 'Jammu and Kashmir', kind: 'factory', handlerName: 'Vikash Kumar' },
  { name: 'NT Dwarka', city: 'New Delhi', kind: 'retail', handlerName: 'Vikash Kumar' },
];

const MODELS = {
  Laptop: [['Dell', 'Latitude 5450'], ['Lenovo', 'ThinkPad E14'], ['HP', 'Elitebook 8470p']],
  Desktop: [['Dell', 'OptiPlex 7010'], ['HP', 'ProDesk 400 G9']],
  Mobile: [['Samsung', 'Galaxy M14'], ['Apple', 'iPhone 15']],
  Printer: [['Kyocera', 'ECOSYS P2235dn'], ['TSC', 'TTP-345']],
  Switch: [['Cisco', 'Catalyst 9200L'], ['TP-Link', 'TL-SG1024']],
  'Biometric Machine': [['ESSL', 'X990-C'], ['Sensys', 'F22']],
  'Walkie-Talkie': [['Motorola', 'XiR P3688']],
  DVR: [['HIKVISION', 'DS-7A08HQHI-K1'], ['CPPLUS', 'CP-UVR-0801E1-CS']],
};

const CODE = { Laptop: 'LT', Desktop: 'PC', Mobile: 'PH', Printer: 'PT', Switch: 'SW', 'Biometric Machine': 'BM', 'Walkie-Talkie': 'WT', DVR: 'DVR' };

async function run() {
  await connectDb();
  const fresh = process.argv.includes('--fresh');

  if (fresh) {
    console.log('Clearing existing data…');
    await Promise.all([
      Asset.deleteMany({}), Assignment.deleteMany({}), Maintenance.deleteMany({}),
      AuditLog.deleteMany({}), RefreshToken.deleteMany({}), User.deleteMany({}),
      Category.deleteMany({}), Department.deleteMany({}), Site.deleteMany({}), Vendor.deleteMany({}),
    ]);
  } else if (await Asset.estimatedDocumentCount()) {
    console.log('Data already present. Re-run with --fresh to wipe and reseed.');
    await mongoose.disconnect();
    return;
  }

  const users = [];
  for (const p of PEOPLE) {
    users.push(await User.create({ ...p, password: PASSWORD, employeeId: `EMP${1000 + users.length}` }));
  }
  const admin = users[0];
  const byName = new Map(users.map((u) => [u.name, u]));

  const categories = await Category.insertMany(CATEGORIES.map((c) => ({ ...c, createdBy: admin._id })));
  const departments = await Department.insertMany(DEPARTMENTS.map((name) => ({ name, createdBy: admin._id })));
  const vendors = await Vendor.insertMany([
    { name: 'Dell Technologies India', code: 'DELL', contactPerson: 'Suresh Pillai' },
    { name: 'Lenovo Business Store', code: 'LNV' },
    { name: 'Hikvision Partner', code: 'HIK' },
  ].map((v) => ({ ...v, createdBy: admin._id })));

  const sites = [];
  for (const s of SITES) {
    const { handlerName, ...rest } = s;
    sites.push(await Site.create({ ...rest, handler: byName.get(handlerName)?._id, createdBy: admin._id }));
  }

  const holders = users.filter((u) => ['employee', 'technician'].includes(u.role));
  const counters = {};
  const assets = [];

  for (const category of categories) {
    const specs = MODELS[category.name] || [['Generic', 'Standard']];
    const howMany = category.name === 'Laptop' ? 12 : 6;

    for (let i = 0; i < howMany; i += 1) {
      const [brand, model] = pick(specs);
      const code = CODE[category.name];
      counters[code] = (counters[code] || 0) + 1;
      const tag = `VKC${code}${String(counters[code]).padStart(3, '0')}`;

      // Roughly the same status mix the real register carries.
      const roll = Math.random();
      const status = roll < 0.62 ? 'checked_out'
        : roll < 0.74 ? 'available'
        : roll < 0.78 ? 'under_repair'
        : roll < 0.8 ? 'leased'
        : roll < 0.82 ? 'lost_missing'
        : 'disposed';

      const holder = status === 'checked_out' ? pick(holders) : null;

      assets.push({
        tag,
        tagKey: tag,
        name: `${brand} ${model}`,
        entity: 'VKC',
        category: category._id,
        department: pick(departments)._id,
        site: pick(sites)._id,
        brand,
        model,
        serialNumber: `${code}${String(counters[code]).padStart(4, '0')}${Math.floor(Math.random() * 9000 + 1000)}`,
        status,
        condition: pick(['new', 'good', 'good', 'fair']),
        assignedTo: holder?._id,
        assignedToLabel: holder?.name,
        assignedAt: holder ? daysAgo(Math.floor(Math.random() * 200) + 1) : undefined,
        dueAt: holder && Math.random() < 0.25 ? daysAhead(Math.floor(Math.random() * 40) - 12) : undefined,
        vendor: pick(vendors)._id,
        createdBy: admin._id,
        updatedBy: admin._id,
      });
    }
  }

  const saved = await Asset.insertMany(assets);
  console.log(`Created ${saved.length} assets`);

  // Open custody rows for everything checked out, so check-in works.
  const custody = [];
  for (const asset of saved.filter((a) => a.status === 'checked_out' && a.assignedTo)) {
    custody.push({
      asset: asset._id, assignedTo: asset.assignedTo, assignedBy: admin._id,
      checkedOutAt: asset.assignedAt || daysAgo(30), dueAt: asset.dueAt,
      conditionOut: asset.condition, siteOut: asset.site,
      notesOut: 'Issued for regular work use', status: 'open',
    });
    await AuditLog.create({
      actor: admin._id, actorName: admin.name, actorRole: admin.role,
      action: 'asset.checked_out', entity: 'Asset', entityId: asset._id,
      entityLabel: `${asset.tag} · ${asset.name}`,
      changes: [
        { field: 'status', label: 'Status', from: 'available', to: 'checked_out' },
        { field: 'assignedTo', label: 'Assigned to', from: null, to: asset.assignedToLabel },
      ],
      at: asset.assignedAt || daysAgo(30),
    });
  }
  await Assignment.insertMany(custody);

  // A couple of returned loans so the custody rail has closed entries too.
  for (const asset of saved.filter((a) => a.status === 'available').slice(0, 5)) {
    const outAt = daysAgo(240 + Math.floor(Math.random() * 90));
    await Assignment.create({
      asset: asset._id, assignedTo: pick(holders)._id, assignedBy: admin._id,
      checkedOutAt: outAt, conditionOut: 'good', siteOut: asset.site,
      checkedInAt: new Date(outAt.getTime() + 90 * 86400000), checkedInBy: admin._id,
      conditionIn: pick(['good', 'fair']), notesIn: 'Returned during the laptop refresh',
      status: 'returned',
    });
  }

  for (const [i, asset] of saved.slice(0, 6).entries()) {
    const status = pick(['scheduled', 'in_progress', 'completed', 'completed']);
    await Maintenance.create({
      asset: asset._id,
      type: pick(['preventive', 'repair', 'inspection', 'upgrade']),
      status,
      title: pick(['Battery replacement', 'Annual preventive service', 'Screen flicker diagnosis', 'RAM upgrade to 16GB']),
      description: 'Raised from a user ticket and scheduled with the vendor.',
      scheduledFor: daysAhead(i * 3 - 5),
      startedAt: status !== 'scheduled' ? daysAgo(5) : undefined,
      completedAt: status === 'completed' ? daysAgo(2) : undefined,
      cost: status === 'completed' ? Math.round(1500 + Math.random() * 9000) : undefined,
      vendor: pick(vendors)._id,
      technician: byName.get('Vikash Kumar')._id,
      resolution: status === 'completed' ? 'Part replaced and the unit returned to stock.' : undefined,
      createdBy: admin._id,
    });
  }

  await AuditLog.create({
    actor: admin._id, actorName: admin.name, actorRole: admin.role,
    action: 'system.seeded', entity: 'System', entityLabel: 'Demo dataset',
    meta: { assets: saved.length, users: users.length },
  });

  console.log('\nSeed complete. Sign in with any of these (same password):');
  for (const u of users) console.log(`  ${u.role.padEnd(12)} ${u.email}`);
  console.log(`\n  password: ${PASSWORD}\n`);

  await mongoose.disconnect();
}

run().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect();
  process.exit(1);
});
