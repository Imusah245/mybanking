// User model.
//
// A User holds credentials and profile data. Passwords are stored ONLY as
// bcrypt hashes (Requirement 14.8) and the hash is excluded from query results
// by default via `select: false` (Requirement 14.9). The `role` defaults to
// CUSTOMER (Requirement 1.1).
//
// Hashing is performed in a pre-save hook using the cost factor configured in
// the environment (BCRYPT_ROUNDS). The hook only runs when the password field
// has actually changed, so re-saving an unmodified document never re-hashes an
// already-hashed value.
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

import env from '../config/env.js';

const { Schema, model } = mongoose;

export const ROLES = Object.freeze({
  CUSTOMER: 'CUSTOMER',
  ADMIN: 'ADMIN',
});

const userSchema = new Schema(
  {
    firstName: {
      type: String,
      required: true,
      trim: true,
      minlength: 1,
      maxlength: 50,
    },
    lastName: {
      type: String,
      required: true,
      trim: true,
      minlength: 1,
      maxlength: 50,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      maxlength: 254,
      index: true,
    },
    phone: {
      type: String,
      required: true,
      trim: true,
    },
    dateOfBirth: {
      type: Date,
      required: true,
    },
    address: {
      type: String,
      required: true,
      trim: true,
      minlength: 1,
      maxlength: 255,
    },
    // Stored as a bcrypt hash only. Excluded from query results by default;
    // callers that need it (e.g. login verification) must opt in with
    // `.select('+password')`.
    password: {
      type: String,
      required: true,
      select: false,
    },
    role: {
      type: String,
      enum: Object.values(ROLES),
      default: ROLES.CUSTOMER,
      index: true,
    },
  },
  { timestamps: true }
);

/**
 * Hash the password with bcrypt before persisting, but only when it has been
 * set or changed. This prevents double-hashing an already-hashed value on
 * subsequent saves of an unchanged document.
 */
userSchema.pre('save', async function hashPassword() {
  if (!this.isModified('password')) return;
  this.password = await bcrypt.hash(this.password, env.BCRYPT_ROUNDS);
});

/**
 * Compare a plaintext candidate against the stored bcrypt hash.
 *
 * The `password` field is `select:false`, so the document must have been loaded
 * with `.select('+password')` for `this.password` to be present; otherwise this
 * resolves to `false` rather than throwing.
 *
 * @param {string} candidate - The plaintext password to verify.
 * @returns {Promise<boolean>} True when the candidate matches the stored hash.
 */
userSchema.methods.comparePassword = function comparePassword(candidate) {
  if (!this.password) return Promise.resolve(false);
  return bcrypt.compare(candidate, this.password);
};

const User = model('User', userSchema);

export default User;
