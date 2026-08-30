import mongoose from 'mongoose';

/** Category, Department and Vendor share a shape, so they share a factory. */
function lookupModel(name, extra = {}) {
  const schema = new mongoose.Schema(
    {
      name: { type: String, required: true, trim: true, maxlength: 140 },
      code: { type: String, trim: true, uppercase: true, maxlength: 24 },
      description: { type: String, trim: true, maxlength: 600 },
      isActive: { type: Boolean, default: true },
      /** Set when an import folded a spelling variant into this record. */
      aliases: { type: [String], default: [] },
      createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      ...extra,
    },
    { timestamps: true }
  );
  schema.index({ name: 1 }, { unique: true });
  return mongoose.model(name, schema);
}

export const Category = lookupModel('Category', {
  parent: { type: mongoose.Schema.Types.ObjectId, ref: 'Category' },
  defaultUsefulLifeMonths: { type: Number, min: 0 },
  /** Tag prefixes that imply this category, e.g. LT for laptops. */
  tagCodes: { type: [String], default: [] },
});

export const Department = lookupModel('Department', {
  head: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
});

export const Vendor = lookupModel('Vendor', {
  contactPerson: { type: String, trim: true },
  email: { type: String, trim: true, lowercase: true },
  phone: { type: String, trim: true },
  gstin: { type: String, trim: true, uppercase: true },
  address: { type: String, trim: true },
});

/**
 * A site is a physical premises. The register's own data shows one IT handler
 * per site with no exceptions across 820 rows, so the handler belongs here
 * rather than being retyped on every asset.
 */
export const Site = lookupModel('Site', {
  city: { type: String, trim: true, index: true },
  state: { type: String, trim: true },
  country: { type: String, trim: true, default: 'India' },
  building: { type: String, trim: true },
  floor: { type: String, trim: true },
  handler: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
  kind: {
    type: String,
    enum: ['head_office', 'factory', 'warehouse', 'retail', 'office', 'other'],
    default: 'other',
  },
});
