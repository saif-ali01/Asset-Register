import mongoose from 'mongoose';

/** One row per custody event. Never updated in place except on check-in. */
const assignmentSchema = new mongoose.Schema(
  {
    asset: { type: mongoose.Schema.Types.ObjectId, ref: 'Asset', required: true, index: true },
    assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    assignedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    checkedOutAt: { type: Date, default: Date.now, index: true },
    dueAt: { type: Date },
    conditionOut: { type: String, trim: true },
    siteOut: { type: mongoose.Schema.Types.ObjectId, ref: 'Site' },
    notesOut: { type: String, trim: true, maxlength: 1000 },

    checkedInAt: { type: Date, index: true },
    checkedInBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    conditionIn: { type: String, trim: true },
    siteIn: { type: mongoose.Schema.Types.ObjectId, ref: 'Site' },
    notesIn: { type: String, trim: true, maxlength: 1000 },

    acknowledgedAt: { type: Date },
    status: { type: String, enum: ['open', 'returned', 'overdue'], default: 'open', index: true },
  },
  { timestamps: true, toJSON: { virtuals: true } }
);

assignmentSchema.virtual('isOverdue').get(function isOverdue() {
  return Boolean(!this.checkedInAt && this.dueAt && this.dueAt < new Date());
});

assignmentSchema.index({ asset: 1, checkedOutAt: -1 });

export const Assignment = mongoose.model('Assignment', assignmentSchema);
