import { Asset } from '../models/Asset.js';
import { Assignment } from '../models/Assignment.js';
import { Maintenance } from '../models/Maintenance.js';
import { AuditLog } from '../models/AuditLog.js';
import { User } from '../models/User.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ASSIGNED_STATUSES, CLOSED_STATUSES } from '../config/reference.js';

const THIRTY_DAYS = 30 * 86400000;

/**
 * Deliberately mirrors the register's own Summary Dashboard: totals by status,
 * then by site, then by handler. Those are the three cuts the team already
 * reviews, so the app opens on numbers they can immediately recognise.
 */
export const dashboard = asyncHandler(async (req, res) => {
  const scope = req.isSelfScoped ? { assignedTo: req.user._id } : {};
  const base = { isArchived: false, ...scope };

  const [
    totals, byStatus, byCategory, bySite, byHandler, byDepartment, byEntity,
    overdue, openJobs, recent, topHolders, valued,
  ] = await Promise.all([
    Asset.aggregate([
      { $match: base },
      {
        $group: {
          _id: null,
          count: { $sum: 1 },
          value: { $sum: { $ifNull: ['$purchaseCost', 0] } },
          held: { $sum: { $cond: [{ $in: ['$status', ASSIGNED_STATUSES] }, 1, 0] } },
          closed: { $sum: { $cond: [{ $in: ['$status', CLOSED_STATUSES] }, 1, 0] } },
        },
      },
    ]),

    Asset.aggregate([{ $match: base }, { $group: { _id: '$status', count: { $sum: 1 } } }, { $sort: { count: -1 } }]),

    Asset.aggregate([
      { $match: base },
      { $group: { _id: '$category', count: { $sum: 1 } } },
      { $lookup: { from: 'categories', localField: '_id', foreignField: '_id', as: 'c' } },
      { $project: { name: { $ifNull: [{ $first: '$c.name' }, 'Uncategorised'] }, count: 1 } },
      { $sort: { count: -1 } }, { $limit: 12 },
    ]),

    // Site rows carry the same status columns the team's own pivot uses.
    Asset.aggregate([
      { $match: base },
      {
        $group: {
          _id: '$site',
          total: { $sum: 1 },
          available: { $sum: { $cond: [{ $eq: ['$status', 'available'] }, 1, 0] } },
          checkedOut: { $sum: { $cond: [{ $eq: ['$status', 'checked_out'] }, 1, 0] } },
          underRepair: { $sum: { $cond: [{ $eq: ['$status', 'under_repair'] }, 1, 0] } },
          disposed: { $sum: { $cond: [{ $eq: ['$status', 'disposed'] }, 1, 0] } },
        },
      },
      { $lookup: { from: 'sites', localField: '_id', foreignField: '_id', as: 's' } },
      { $unwind: { path: '$s', preserveNullAndEmptyArrays: true } },
      { $lookup: { from: 'users', localField: 's.handler', foreignField: '_id', as: 'h' } },
      {
        $project: {
          name: { $ifNull: ['$s.name', 'No site'] },
          city: '$s.city',
          handler: { $first: '$h.name' },
          total: 1, available: 1, checkedOut: 1, underRepair: 1, disposed: 1,
        },
      },
      { $sort: { total: -1 } },
    ]),

    Asset.aggregate([
      { $match: base },
      { $lookup: { from: 'sites', localField: 'site', foreignField: '_id', as: 's' } },
      { $unwind: { path: '$s', preserveNullAndEmptyArrays: true } },
      { $group: { _id: '$s.handler', total: { $sum: 1 },
        available: { $sum: { $cond: [{ $eq: ['$status', 'available'] }, 1, 0] } },
        checkedOut: { $sum: { $cond: [{ $eq: ['$status', 'checked_out'] }, 1, 0] } } } },
      { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'u' } },
      { $project: { name: { $ifNull: [{ $first: '$u.name' }, 'Unassigned'] }, total: 1, available: 1, checkedOut: 1 } },
      { $sort: { total: -1 } },
    ]),

    Asset.aggregate([
      { $match: base },
      { $group: { _id: '$department', count: { $sum: 1 } } },
      { $lookup: { from: 'departments', localField: '_id', foreignField: '_id', as: 'd' } },
      { $project: { name: { $ifNull: [{ $first: '$d.name' }, 'No department'] }, count: 1 } },
      { $sort: { count: -1 } }, { $limit: 12 },
    ]),

    Asset.aggregate([
      { $match: base },
      { $group: { _id: '$entity', count: { $sum: 1 } } },
      { $project: { name: { $ifNull: ['$_id', 'Unspecified'] }, count: 1 } },
      { $sort: { count: -1 } },
    ]),

    Assignment.countDocuments({
      checkedInAt: { $exists: false }, dueAt: { $lt: new Date() },
      ...(req.isSelfScoped ? { assignedTo: req.user._id } : {}),
    }),

    Maintenance.countDocuments({ status: { $in: ['scheduled', 'in_progress'] } }),

    AuditLog.find(req.isSelfScoped ? { actor: req.user._id } : {})
      .populate('actor', 'name avatarUrl').sort({ at: -1 }).limit(12).lean(),

    req.isSelfScoped ? [] : Asset.aggregate([
      { $match: { isArchived: false, assignedTo: { $exists: true, $ne: null } } },
      { $group: { _id: '$assignedTo', count: { $sum: 1 } } },
      { $sort: { count: -1 } }, { $limit: 6 },
      { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'u' } },
      { $project: { name: { $first: '$u.name' }, department: { $first: '$u.department' }, count: 1 } },
    ]),

    // How much of the register carries a cost at all — drives whether the
    // money tile is worth showing.
    Asset.countDocuments({ ...base, purchaseCost: { $exists: true, $ne: null, $gt: 0 } }),
  ]);

  const warranty = await Asset.aggregate([
    { $match: { ...base, warrantyExpiry: { $exists: true, $ne: null } } },
    {
      $group: {
        _id: null,
        expired: { $sum: { $cond: [{ $lt: ['$warrantyExpiry', new Date()] }, 1, 0] } },
        expiring: {
          $sum: {
            $cond: [
              { $and: [
                { $gte: ['$warrantyExpiry', new Date()] },
                { $lte: ['$warrantyExpiry', new Date(Date.now() + THIRTY_DAYS)] },
              ] },
              1, 0,
            ],
          },
        },
      },
    },
  ]);

  const userCount = req.isSelfScoped ? undefined : await User.countDocuments({ isActive: true });

  res.json({
    totals: {
      assets: totals[0]?.count || 0,
      held: totals[0]?.held || 0,
      closed: totals[0]?.closed || 0,
      purchaseValue: Math.round(totals[0]?.value || 0),
      /** Share of rows with a cost, so the UI can hide a meaningless total. */
      costedAssets: valued,
      activeUsers: userCount,
      overdue,
      openMaintenance: openJobs,
      warrantyExpired: warranty[0]?.expired || 0,
      warrantyExpiring: warranty[0]?.expiring || 0,
    },
    byStatus, byCategory, bySite, byHandler, byDepartment, byEntity,
    topHolders, recent,
  });
});
