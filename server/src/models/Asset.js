import mongoose from 'mongoose';

import {
  ASSET_CONDITIONS, ASSET_STATUSES, ASSIGNED_STATUSES,
  CLOSED_STATUSES, DEPRECIATION_METHODS,
} from '../config/reference.js';

export { ASSET_STATUSES, ASSIGNED_STATUSES, CLOSED_STATUSES, ASSET_CONDITIONS, DEPRECIATION_METHODS };

const attachmentSchema = new mongoose.Schema(
  {
    label: String,
    url: String,
    mimeType: String,
    sizeBytes: Number,
    uploadedAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const assetSchema = new mongoose.Schema(
  {
    /**
     * The tag as it is printed on the physical label — mixed case preserved,
     * because "AuroLT001" is what someone reads off the sticker. tagKey holds
     * the uppercase form and carries the uniqueness constraint, so VkCPC079
     * and VKCPC079 cannot both exist.
     */
    tag: { type: String, required: true, trim: true, index: true },
    tagKey: { type: String, required: true, unique: true, uppercase: true, trim: true },

    name: { type: String, required: true, trim: true, maxlength: 400 },
    description: { type: String, trim: true, maxlength: 2000 },

    /** Owning group company, encoded in the tag prefix (VKC, Auro, VFI…). */
    entity: { type: String, trim: true, index: true },

    category: { type: mongoose.Schema.Types.ObjectId, ref: 'Category', index: true },
    subCategory: { type: String, trim: true },
    department: { type: mongoose.Schema.Types.ObjectId, ref: 'Department', index: true },

    brand: { type: String, trim: true, index: true },
    model: { type: String, trim: true },

    /**
     * Not unique. The source register legitimately repeats serials —
     * "Assemble" appears on 38 built-to-order desktops, and some phones share
     * an IMEI-style value. A unique index here would reject real rows, so
     * duplicates are surfaced in the data-quality report instead.
     */
    serialNumber: { type: String, trim: true, index: true },

    status: { type: String, enum: ASSET_STATUSES, default: 'available', index: true },
    condition: { type: String, enum: ASSET_CONDITIONS },

    /** Site is the premises; its city and handler live on the Site record. */
    site: { type: mongoose.Schema.Types.ObjectId, ref: 'Site', index: true },

    assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
    /**
     * What the register said the holder was, verbatim. Around a tenth of the
     * imported rows name a department or a site rather than a person; keeping
     * the original text means nothing is lost when no user account matches.
     */
    assignedToLabel: { type: String, trim: true },
    assignedAt: { type: Date },
    dueAt: { type: Date },

    vendor: { type: mongoose.Schema.Types.ObjectId, ref: 'Vendor' },
    purchaseDate: { type: Date },
    purchaseCost: { type: Number, min: 0 },
    currency: { type: String, default: 'INR', uppercase: true, maxlength: 3 },
    invoiceNumber: { type: String, trim: true },
    poNumber: { type: String, trim: true },

    warrantyExpiry: { type: Date, index: true },
    amcExpiry: { type: Date },
    insuranceExpiry: { type: Date },

    depreciationMethod: { type: String, enum: DEPRECIATION_METHODS, default: 'none' },
    usefulLifeMonths: { type: Number, min: 0 },
    salvageValue: { type: Number, min: 0, default: 0 },

    quantity: { type: Number, default: 1, min: 0 },
    unit: { type: String, trim: true, default: 'unit' },
    notes: { type: String, trim: true, maxlength: 4000 },
    labels: { type: [String], default: [] },
    imageUrl: { type: String, trim: true },
    attachments: { type: [attachmentSchema], default: [] },

    /** Columns from the source sheet with no matching field. */
    customFields: { type: Map, of: String, default: undefined },

    isArchived: { type: Boolean, default: false, index: true },
    importBatch: { type: String, index: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } }
);

assetSchema.index({ name: 'text', description: 'text', brand: 'text', model: 'text', serialNumber: 'text', tag: 'text' });
assetSchema.index({ status: 1, site: 1, category: 1 });
assetSchema.index({ department: 1, status: 1 });

assetSchema.pre('validate', function syncTagKey(next) {
  if (this.tag) this.tagKey = this.tag.trim().toUpperCase();
  next();
});

assetSchema.virtual('isHeld').get(function isHeld() {
  return ASSIGNED_STATUSES.includes(this.status);
});

/** Book value today, or null when there is nothing to depreciate from. */
assetSchema.virtual('currentValue').get(function currentValue() {
  if (!this.purchaseCost || !this.purchaseDate) return null;
  if (this.depreciationMethod === 'none' || !this.usefulLifeMonths) return this.purchaseCost;
  const months = Math.max(
    0,
    (Date.now() - new Date(this.purchaseDate).getTime()) / (1000 * 60 * 60 * 24 * 30.4375)
  );
  const salvage = this.salvageValue || 0;
  if (this.depreciationMethod === 'straight_line') {
    const perMonth = (this.purchaseCost - salvage) / this.usefulLifeMonths;
    return Math.max(salvage, Number((this.purchaseCost - perMonth * months).toFixed(2)));
  }
  const years = this.usefulLifeMonths / 12;
  const rate = 1 - Math.pow(Math.max(salvage, 1) / this.purchaseCost, 1 / Math.max(years, 1));
  return Math.max(salvage, Number((this.purchaseCost * Math.pow(1 - rate, months / 12)).toFixed(2)));
});

assetSchema.virtual('warrantyState').get(function warrantyState() {
  if (!this.warrantyExpiry) return 'unknown';
  const days = (new Date(this.warrantyExpiry) - Date.now()) / 86400000;
  if (days < 0) return 'expired';
  if (days <= 30) return 'expiring';
  return 'active';
});

export const Asset = mongoose.model('Asset', assetSchema);
