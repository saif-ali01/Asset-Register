import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import { ROLE_NAMES } from '../config/permissions.js';

/**
 * Marker stored instead of a hash for accounts that exist only so records can
 * point at a person — imported asset holders, for instance. It is not a hash
 * and can never match any input, so such an account cannot be signed into
 * until an admin sets a real password. Skipping bcrypt for these is also what
 * keeps a 400-account import from spending minutes on CPU it does not need.
 */
export const NO_LOGIN = '!no-login';

const BCRYPT_ROUNDS = 12;

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
    password: { type: String, required: true, select: false },
    role: { type: String, enum: ROLE_NAMES, default: 'employee', index: true },
    extraPermissions: { type: [String], default: [] },
    deniedPermissions: { type: [String], default: [] },
    employeeId: { type: String, trim: true },
    department: { type: String, trim: true },
    designation: { type: String, trim: true },
    phone: { type: String, trim: true },
    avatarUrl: { type: String, trim: true },
    isActive: { type: Boolean, default: true, index: true },
    mustChangePassword: { type: Boolean, default: false },
    lastLoginAt: { type: Date },
    failedLoginAttempts: { type: Number, default: 0 },
    lockedUntil: { type: Date },
    theme: { type: String, enum: ['light', 'dark', 'system'], default: 'system' },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

/** Minimum length is enforced here rather than in the schema, so the
 *  no-login marker is not rejected for being short. */
userSchema.path('password').validate(function passwordLength(value) {
  if (value === NO_LOGIN || value?.startsWith('$2')) return true;
  return typeof value === 'string' && value.length >= 8;
}, 'Use at least 8 characters');

userSchema.pre('save', async function hashPassword(next) {
  if (!this.isModified('password')) return next();
  // Already hashed, or deliberately unusable — leave it alone.
  if (this.password === NO_LOGIN || this.password.startsWith('$2')) return next();
  this.password = await bcrypt.hash(this.password, BCRYPT_ROUNDS);
  next();
});

userSchema.methods.comparePassword = function comparePassword(candidate) {
  // Refuse before reaching bcrypt: a malformed hash must be a definite "no",
  // never an error or an accidental match.
  if (!this.password || !this.password.startsWith('$2')) return Promise.resolve(false);
  return bcrypt.compare(candidate, this.password);
};

/** True when this account has a password it could actually sign in with. */
userSchema.virtual('canSignIn').get(function canSignIn() {
  return this.isActive && this.password !== NO_LOGIN;
});

userSchema.virtual('isLocked').get(function isLocked() {
  return Boolean(this.lockedUntil && this.lockedUntil > new Date());
});

userSchema.set('toJSON', {
  virtuals: true,
  transform: (_doc, ret) => {
    delete ret.password;
    delete ret.failedLoginAttempts;
    return ret;
  },
});

export const User = mongoose.model('User', userSchema);

/** Hashes a password outside a document, for bulk inserts. */
export const hashPassword = (plain) => bcrypt.hash(plain, BCRYPT_ROUNDS);
