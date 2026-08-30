import mongoose from 'mongoose';

export const MAINTENANCE_TYPES = ['preventive', 'repair', 'upgrade', 'inspection', 'calibration'];
export const MAINTENANCE_STATUSES = ['scheduled', 'in_progress', 'completed', 'cancelled'];

const maintenanceSchema = new mongoose.Schema(
  {
    asset: { type: mongoose.Schema.Types.ObjectId, ref: 'Asset', required: true, index: true },
    type: { type: String, enum: MAINTENANCE_TYPES, default: 'repair' },
    status: { type: String, enum: MAINTENANCE_STATUSES, default: 'scheduled', index: true },
    title: { type: String, required: true, trim: true, maxlength: 200 },
    description: { type: String, trim: true, maxlength: 2000 },
    scheduledFor: { type: Date, index: true },
    startedAt: { type: Date },
    completedAt: { type: Date },
    cost: { type: Number, min: 0 },
    currency: { type: String, default: 'INR', uppercase: true },
    /** Vendor's invoice or bill reference for this job, for reconciliation. */
    billNumber: { type: String, trim: true, maxlength: 80, index: true },
    vendor: { type: mongoose.Schema.Types.ObjectId, ref: 'Vendor' },
    technician: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    downtimeHours: { type: Number, min: 0 },
    resolution: { type: String, trim: true, maxlength: 2000 },

    /**
     * Whether this job moved the asset to "under repair", and what the status
     * was beforehand. Scheduling a job never touches the asset — only starting
     * work does, and only when explicitly asked. Recording the previous value
     * means closing the job restores exactly what was there rather than
     * assuming "available", which would quietly lose a "leased" or "lost".
     */
    assetStatusChanged: { type: Boolean, default: false },
    previousAssetStatus: { type: String },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

maintenanceSchema.index({ asset: 1, createdAt: -1 });

export const Maintenance = mongoose.model('Maintenance', maintenanceSchema);
