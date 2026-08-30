import mongoose from 'mongoose';

/**
 * Append-only history. Writes go through utils/audit.js, never directly,
 * so every entry carries actor, target and a field-level diff.
 */
const auditLogSchema = new mongoose.Schema(
  {
    actor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
    actorName: { type: String },
    actorRole: { type: String },
    action: { type: String, required: true, index: true },
    entity: { type: String, required: true, index: true },
    entityId: { type: mongoose.Schema.Types.ObjectId, index: true },
    entityLabel: { type: String },
    changes: {
      type: [
        {
          field: String,
          label: String,
          from: mongoose.Schema.Types.Mixed,
          to: mongoose.Schema.Types.Mixed,
          _id: false,
        },
      ],
      default: [],
    },
    meta: { type: mongoose.Schema.Types.Mixed },
    ip: { type: String },
    userAgent: { type: String },
  },
  { timestamps: { createdAt: 'at', updatedAt: false } }
);

auditLogSchema.index({ at: -1 });
auditLogSchema.index({ entity: 1, entityId: 1, at: -1 });

export const AuditLog = mongoose.model('AuditLog', auditLogSchema);
