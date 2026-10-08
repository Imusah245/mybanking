// Transaction model.
//
// A Transaction is an immutable, append-only record of a balance-changing event
// (a deposit CREDIT, a withdrawal DEBIT, or a TRANSFER leg). The service layer
// (`bankService`) is the sole writer of these records; no code path mutates the
// monetary fields of an existing Transaction after it is created.
//
// Monetary integrity (Requirement 15.1): `amount`, `balanceBefore`, and
// `balanceAfter` are all stored as integer pesewas. Schema-level validators
// assert `Number.isInteger` and enforce the valid ranges as a defense-in-depth
// backstop behind the atomic updates in `bankService`.
//
// Audit integrity (Requirements 5.2, 6.2, 7.4; design Property 8): every record
// carries a `reference` of the form `TXN-XXXXXXXX` that is unique across the
// whole collection via a unique index. The format is produced by
// `generateReference` and enforced here by the `match` regex.
//
// Indexing: compound indexes support the ownership-scoped, newest-first history
// queries and the type-filtered variant used by the history endpoints
// (design Properties 14, 16, 17; Requirements 8.1, 8.5).
import mongoose from 'mongoose';

const { Schema, model } = mongoose;

export const TRANSACTION_TYPES = Object.freeze({
  CREDIT: 'CREDIT',
  DEBIT: 'DEBIT',
  TRANSFER: 'TRANSFER',
});

export const TRANSACTION_STATUSES = Object.freeze({
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
  REVERSED: 'REVERSED',
});

// Monetary bounds in integer pesewas (Requirement 15.1).
export const AMOUNT_MIN = 1;
export const AMOUNT_MAX = 999_999_999_999;

// Shared integer validator so each monetary field rejects non-integers (e.g.
// floating-point drift) with a clear, field-specific message.
const integerValidator = {
  validator: Number.isInteger,
  message: '{PATH} must be an integer number of pesewas',
};

const transactionSchema = new Schema(
  {
    // Owner of the transaction; always derived from the authenticated identity
    // (`req.user`), never from a client payload. Indexed for ownership-scoped
    // history lookups (Requirement 8.1, design Property 14).
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    // Account the transaction is recorded against. Indexed for per-account
    // queries.
    accountId: {
      type: Schema.Types.ObjectId,
      ref: 'Account',
      required: true,
      index: true,
    },
    type: {
      type: String,
      enum: Object.values(TRANSACTION_TYPES),
      required: true,
    },
    // Integer pesewas in [1, 999_999_999_999] (Requirement 15.1).
    amount: {
      type: Number,
      required: true,
      min: AMOUNT_MIN,
      max: AMOUNT_MAX,
      validate: integerValidator,
    },
    // Balance snapshots. balanceAfter = balanceBefore + signedAmount
    // (Requirement 15.3, design Property 1). Both are non-negative integers.
    balanceBefore: {
      type: Number,
      required: true,
      min: 0,
      validate: integerValidator,
    },
    balanceAfter: {
      type: Number,
      required: true,
      min: 0,
      validate: integerValidator,
    },
    description: {
      type: String,
      default: '',
      maxlength: 255,
    },
    // Unique, immutable audit reference. The unique index enforces the
    // system-wide uniqueness invariant (design Property 8); the regex enforces
    // the exact format produced by generateReference.
    reference: {
      type: String,
      required: true,
      unique: true,
      match: /^TXN-[A-Z0-9]{8}$/,
    },
    status: {
      type: String,
      enum: Object.values(TRANSACTION_STATUSES),
      required: true,
    },
    // Counterparty account for TRANSFER legs; null/absent for single-account
    // CREDIT and DEBIT records.
    relatedAccount: {
      type: Schema.Types.ObjectId,
      ref: 'Account',
      default: null,
    },
  },
  { timestamps: true }
);

// A user's transactions, newest-first: serves the default descending history
// query and ownership-scoped pagination (Requirements 8.1, 8.2; Properties 14, 16).
transactionSchema.index({ userId: 1, createdAt: -1 });

// Supports the type-filtered history variant while preserving newest-first order
// (Requirement 8.5; design Property 17).
transactionSchema.index({ userId: 1, type: 1, createdAt: -1 });

const Transaction = model('Transaction', transactionSchema);

export default Transaction;
