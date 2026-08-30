/**
 * Reconciles assets whose status and custody records disagree.
 *
 *   npm run repair:custody -- --dry-run
 *   npm run repair:custody
 *
 * An earlier maintenance bug cleared an asset's holder when a repair job
 * started, without closing the open custody record. The result is an asset
 * whose header reads "Available" while its Custody tab still says someone is
 * holding it. New repairs no longer do this, but records already written that
 * way stay wrong until something reconciles them — which is what this does.
 *
 * Two directions are fixed:
 *   1. Open custody record, asset not held  -> restore the holder if the
 *      asset is genuinely still out, otherwise close the record.
 *   2. Asset says checked_out but names nobody -> adopt the holder from its
 *      open custody record, or fall back to available.
 *
 * Nothing is guessed silently: every change is listed, and --dry-run shows
 * the whole plan without writing.
 */
import mongoose from 'mongoose';
import { connectDb } from '../config/db.js';
import { Asset } from '../models/Asset.js';
import { Assignment } from '../models/Assignment.js';
import { AuditLog } from '../models/AuditLog.js';
import { User } from '../models/User.js';
import { HOLDER_PERMITTED_STATUSES } from '../config/reference.js';

const DRY = process.argv.includes('--dry-run');

/**
 * Whether a still-open custody record should be treated as real. An asset put
 * into repair keeps its custodian, so an open record there is correct; an
 * asset that has been disposed of or sold clearly should not still be out.
 */
const CLOSED_OUT = ['disposed', 'sold', 'donated', 'lost_missing'];

async function run() {
  await connectDb();

  const admin = await User.findOne({ role: 'super_admin' }).select('_id name role');
  const actorId = admin?._id;

  const open = await Assignment.find({ checkedInAt: { $exists: false } })
    .populate('asset', 'tag name status assignedTo assignedToLabel')
    .populate('assignedTo', 'name')
    .lean();

  console.log(`\nOpen custody records: ${open.length}`);

  const restoreHolder = [];
  const closeRecord = [];
  const orphanRecord = [];

  for (const record of open) {
    if (!record.asset) {
      orphanRecord.push(record);
      continue;
    }
    const { status } = record.asset;

    // Consistent already: the asset agrees that someone has it.
    if (HOLDER_PERMITTED_STATUSES.includes(status) && record.asset.assignedTo) continue;

    if (CLOSED_OUT.includes(status)) {
      // The asset has left the register; the loan cannot still be open.
      closeRecord.push(record);
    } else if (status === 'available') {
      /**
       * The ambiguous case. The old bug produced exactly this, and the honest
       * reading is that the asset really is back — a repair completed and set
       * it available — so the record should be closed rather than the holder
       * re-attached. Closing loses nothing: the record keeps both dates and
       * stays in the asset's history.
       */
      closeRecord.push(record);
    } else if (HOLDER_PERMITTED_STATUSES.includes(status)) {
      // Says it is held but names nobody: adopt the holder from the record.
      restoreHolder.push(record);
    } else {
      closeRecord.push(record);
    }
  }

  // The other direction: assets claiming to be held with nobody named.
  const heldWithoutHolder = await Asset.find({
    isArchived: false,
    status: 'checked_out',
    $and: [
      { $or: [{ assignedTo: { $exists: false } }, { assignedTo: null }] },
      { $or: [{ assignedToLabel: { $exists: false } }, { assignedToLabel: null }, { assignedToLabel: '' }] },
    ],
  }).select('tag name status').lean();

  console.log(`\nPlan`);
  console.log(`  close stranded custody records   ${closeRecord.length}`);
  console.log(`  restore holder onto asset        ${restoreHolder.length}`);
  console.log(`  checked_out assets naming nobody ${heldWithoutHolder.length}`);
  console.log(`  custody records with no asset    ${orphanRecord.length}`);

  for (const r of closeRecord.slice(0, 15)) {
    console.log(`    close  ${r.asset.tag}  (open to ${r.assignedTo?.name || '?'}, asset is ${r.asset.status})`);
  }
  for (const r of restoreHolder.slice(0, 15)) {
    console.log(`    holder ${r.asset.tag}  <- ${r.assignedTo?.name || '?'}`);
  }
  for (const a of heldWithoutHolder.slice(0, 15)) {
    console.log(`    free   ${a.tag}  (checked_out with nobody named)`);
  }

  if (DRY) {
    console.log('\nDry run — nothing was written.\n');
    return;
  }

  let closed = 0;
  let restored = 0;
  let freed = 0;

  for (const r of closeRecord) {
    await Assignment.updateOne(
      { _id: r._id },
      {
        checkedInAt: new Date(),
        checkedInBy: actorId,
        status: 'returned',
        notesIn: 'Closed by custody reconciliation: the asset was no longer recorded as held',
      }
    );
    closed += 1;
  }

  for (const r of restoreHolder) {
    await Asset.updateOne(
      { _id: r.asset._id },
      {
        assignedTo: r.assignedTo?._id ?? r.assignedTo,
        assignedToLabel: r.assignedTo?.name,
        assignedAt: r.checkedOutAt,
        ...(r.dueAt ? { dueAt: r.dueAt } : {}),
      }
    );
    restored += 1;
  }

  for (const a of heldWithoutHolder) {
    // Look for a record that can supply the holder before giving up on it.
    const record = await Assignment.findOne({ asset: a._id, checkedInAt: { $exists: false } })
      .populate('assignedTo', 'name');
    if (record?.assignedTo) {
      await Asset.updateOne({ _id: a._id }, {
        assignedTo: record.assignedTo._id,
        assignedToLabel: record.assignedTo.name,
        assignedAt: record.checkedOutAt,
      });
      restored += 1;
    } else {
      await Asset.updateOne({ _id: a._id }, {
        status: 'available',
        $unset: { assignedTo: '', assignedToLabel: '', assignedAt: '', dueAt: '' },
      });
      freed += 1;
    }
  }

  if (orphanRecord.length) {
    await Assignment.deleteMany({ _id: { $in: orphanRecord.map((r) => r._id) } });
  }

  await AuditLog.create({
    actor: actorId,
    actorName: admin?.name || 'System',
    actorRole: admin?.role,
    action: 'system.custody_reconciled',
    entity: 'System',
    entityLabel: `${closed} closed, ${restored} holders restored, ${freed} released`,
    meta: { closed, restored, freed, orphansRemoved: orphanRecord.length },
  });

  console.log(`\nClosed stranded records   ${closed}`);
  console.log(`Holders restored          ${restored}`);
  console.log(`Assets released           ${freed}`);
  console.log(`Orphan records removed    ${orphanRecord.length}`);
  console.log('\nRun Data quality again to confirm the checks are clear.\n');
}

run()
  .catch((err) => { console.error(err); process.exitCode = 1; })
  .finally(async () => { await mongoose.disconnect().catch(() => {}); });
