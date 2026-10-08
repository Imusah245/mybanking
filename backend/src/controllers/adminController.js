// Admin controller.
//
// Administrative, admin-only endpoints for system oversight (Requirements
// 10, 11, 12). Every handler in this module is mounted behind
// `authMiddleware` + `requireRole('ADMIN')` at the route layer (task 13.2);
// the RBAC gate (Requirements 10.1, 11.3, 12.2) is therefore enforced before
// any of these handlers run.
//
// Controllers are thin: they read request input, delegate to the models for
// reads/aggregations, and shape the standardized `{ success, message, data }`
// envelope via the `ok()` helper. Errors are forwarded to the central
// `errorMiddleware` via `next(err)`; typed errors (`NotFoundError`,
// `ValidationError`) carry the HTTP status the handler maps to.
//
// All monetary values are integer pesewas (Requirement 15.1); the statistics
// aggregation sums balances using MongoDB `$sum`, which operates on the stored
// integers and returns an integer total (design Property 18).
import mongoose from 'mongoose';

import User, { ROLES } from '../models/User.js';
import Account, { ACCOUNT_STATUS } from '../models/Account.js';
import Transaction, { TRANSACTION_TYPES } from '../models/Transaction.js';
import { ok } from '../utils/response.js';
import { NotFoundError, ValidationError } from '../utils/errors.js';

// Pagination defaults and bounds shared by every admin list endpoint
// (Requirements 10.2, 10.5, 10.6).
const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;
const LIMIT_MIN = 1;
const LIMIT_MAX = 100;

// Maximum length of the customers-list search term (Requirement 10.3).
const SEARCH_MAX_LENGTH = 256;

/**
 * Normalize and validate a pagination parameter.
 *
 * Accepts integers and integer-valued numeric strings only; rejects booleans,
 * floats, and non-numeric values with a `ValidationError` (400). Absent values
 * fall back to the supplied default. (Requirement 10.4)
 *
 * @param {*} value - Raw query value (may be undefined/null/empty).
 * @param {string} label - Human-readable parameter name for error messages.
 * @param {number} defaultValue - Value to use when the parameter is absent.
 * @returns {number} The parsed integer.
 * @throws {ValidationError} When the value is present but not an integer.
 */
function normalizePaginationValue(value, label, defaultValue) {
  if (value === undefined || value === null || value === '') {
    return defaultValue;
  }

  const isNumber = typeof value === 'number';
  const isNumericString =
    typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value));

  if (!isNumber && !isNumericString) {
    throw new ValidationError(`${label} must be a positive integer`);
  }

  const numeric = Number(value);
  if (!Number.isInteger(numeric)) {
    throw new ValidationError(`${label} must be a positive integer`);
  }

  return numeric;
}

/**
 * Resolve validated `page` and `limit` from a request query object, applying
 * the shared defaults and the 1–100 limit bound (Requirements 10.2, 10.5,
 * 10.6, 10.4).
 *
 * @param {object} query - The Express `req.query` object.
 * @returns {{ page: number, limit: number, skip: number }}
 * @throws {ValidationError} When a parameter is out of range or non-numeric.
 */
function resolvePagination(query = {}) {
  const page = normalizePaginationValue(query.page, 'page', DEFAULT_PAGE);
  const limit = normalizePaginationValue(query.limit, 'limit', DEFAULT_LIMIT);

  if (page < DEFAULT_PAGE) {
    throw new ValidationError('page must be a positive integer greater than or equal to 1');
  }
  if (limit < LIMIT_MIN || limit > LIMIT_MAX) {
    throw new ValidationError(`limit must be an integer between ${LIMIT_MIN} and ${LIMIT_MAX}`);
  }

  return { page, limit, skip: (page - 1) * limit };
}

/**
 * GET /api/admin/customers — list customers with pagination and optional
 * search (Requirements 10.2, 10.3, 10.4).
 *
 * Customers (role CUSTOMER) are returned newest-first with a stable `_id`
 * tie-breaker so the order is deterministic (design Property 16). Passwords are
 * never returned (the field is `select:false`). An optional `search` term
 * (≤256 chars) matches first name, last name, or email as a case-insensitive
 * substring.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
export async function listCustomers(req, res, next) {
  try {
    const { page, limit, skip } = resolvePagination(req.query);

    const query = { role: ROLES.CUSTOMER };

    const { search } = req.query;
    if (search !== undefined && search !== null && search !== '') {
      if (typeof search !== 'string' || search.length > SEARCH_MAX_LENGTH) {
        throw new ValidationError(
          `search must be a string between 1 and ${SEARCH_MAX_LENGTH} characters`
        );
      }
      // Match the term as a literal case-insensitive substring, not a pattern.
      const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const pattern = new RegExp(escaped, 'i');
      query.$or = [{ firstName: pattern }, { lastName: pattern }, { email: pattern }];
    }

    const [items, total] = await Promise.all([
      User.find(query).sort({ createdAt: -1, _id: -1 }).skip(skip).limit(limit),
      User.countDocuments(query),
    ]);

    const totalPages = total === 0 ? 0 : Math.ceil(total / limit);

    return ok(res, 200, 'Customers retrieved', {
      items,
      total,
      page,
      limit,
      totalPages,
    });
  } catch (err) {
    return next(err);
  }
}

/**
 * GET /api/admin/accounts — list accounts with their current balance
 * (Requirement 10.5).
 *
 * Accounts are returned newest-first with a stable `_id` tie-breaker so the
 * order is deterministic (design Property 16). Each account document already
 * carries its current integer-pesewa `balance`.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
export async function listAccounts(req, res, next) {
  try {
    const { page, limit, skip } = resolvePagination(req.query);

    const [items, total] = await Promise.all([
      Account.find({}).sort({ createdAt: -1, _id: -1 }).skip(skip).limit(limit),
      Account.countDocuments({}),
    ]);

    const totalPages = total === 0 ? 0 : Math.ceil(total / limit);

    return ok(res, 200, 'Accounts retrieved', {
      items,
      total,
      page,
      limit,
      totalPages,
    });
  } catch (err) {
    return next(err);
  }
}

/**
 * GET /api/admin/transactions — list system-wide transactions (Requirement
 * 10.6).
 *
 * Transactions are returned newest-first with a stable `_id` tie-breaker so the
 * order is deterministic (design Property 16).
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
export async function listTransactions(req, res, next) {
  try {
    const { page, limit, skip } = resolvePagination(req.query);

    const [items, total] = await Promise.all([
      Transaction.find({}).sort({ createdAt: -1, _id: -1 }).skip(skip).limit(limit),
      Transaction.countDocuments({}),
    ]);

    const totalPages = total === 0 ? 0 : Math.ceil(total / limit);

    return ok(res, 200, 'Transactions retrieved', {
      items,
      total,
      page,
      limit,
      totalPages,
    });
  } catch (err) {
    return next(err);
  }
}

/**
 * GET /api/admin/statistics — aggregate system statistics (Requirement 11).
 *
 * Computes, using MongoDB aggregation/counts over the stored collections
 * (Requirement 11.1):
 *   - totalCustomers   — count of Users with role CUSTOMER
 *   - totalAccounts    — count of Accounts
 *   - systemLiquidity  — sum of every account balance, in integer pesewas
 *   - totalDeposits    — count of COMPLETED/any CREDIT transactions
 *   - totalWithdrawals — count of DEBIT transactions
 *   - totalTransfers   — count of TRANSFER transactions
 *
 * The result is deterministic for a given collection state (design Property
 * 18): sums and counts are a pure function of the stored documents. Empty
 * collections yield 0 for every total rather than null or an omitted field
 * (Requirement 11.5). If any aggregation stage fails, the error propagates to
 * the central handler and no partial statistics are returned (Requirement
 * 11.4).
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
export async function statistics(req, res, next) {
  try {
    const [
      totalCustomers,
      totalAccounts,
      liquidityAgg,
      typeCountsAgg,
    ] = await Promise.all([
      User.countDocuments({ role: ROLES.CUSTOMER }),
      Account.countDocuments({}),
      // Sum of all account balances → System_Liquidity (Requirement 11.1).
      // `$sum` over integer pesewas yields an integer; `[]` when no accounts.
      Account.aggregate([
        { $group: { _id: null, total: { $sum: '$balance' } } },
      ]),
      // Count transactions grouped by type in a single pass.
      Transaction.aggregate([
        { $group: { _id: '$type', count: { $sum: 1 } } },
      ]),
    ]);

    // Empty collection → `[]`, so default the sum to 0 (Requirement 11.5).
    const systemLiquidity = liquidityAgg.length > 0 ? liquidityAgg[0].total : 0;

    // Fold the per-type counts into a lookup, defaulting every type to 0 so
    // absent types report 0 rather than being omitted (Requirement 11.5).
    const countsByType = typeCountsAgg.reduce((acc, { _id, count }) => {
      acc[_id] = count;
      return acc;
    }, {});

    const totalDeposits = countsByType[TRANSACTION_TYPES.CREDIT] || 0;
    const totalWithdrawals = countsByType[TRANSACTION_TYPES.DEBIT] || 0;
    const totalTransfers = countsByType[TRANSACTION_TYPES.TRANSFER] || 0;

    return ok(res, 200, 'Statistics retrieved', {
      totalCustomers,
      totalAccounts,
      systemLiquidity,
      totalDeposits,
      totalWithdrawals,
      totalTransfers,
    });
  } catch (err) {
    return next(err);
  }
}

/**
 * PUT /api/admin/accounts/:id/status — set an account's status (Requirement
 * 12).
 *
 * Sets the target account's `status` to a valid `ACCOUNT_STATUS` value
 * (Active, Frozen, Disabled). The operation is deterministic and idempotent:
 * applying the same status again leaves the stored status unchanged and returns
 * the same result (design Property 19). A missing/invalid status is rejected
 * with 400 (Requirement 12.4); a nonexistent account id yields 404 with no
 * state change (Requirement 12.3, design Property 20).
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
export async function updateAccountStatus(req, res, next) {
  try {
    const { id } = req.params;
    const { status } = req.body || {};

    // Validate the target status against the enum (Requirement 12.4). Although
    // the route layer validates too, the controller guards defensively so an
    // invalid value can never reach the write.
    const allowed = Object.values(ACCOUNT_STATUS);
    if (status === undefined || status === null || !allowed.includes(status)) {
      throw new ValidationError(`status must be one of: ${allowed.join(', ')}`);
    }

    // A malformed id can never match a document; treat it as not found (404)
    // rather than letting Mongoose throw a CastError (Requirement 12.3).
    if (!mongoose.isValidObjectId(id)) {
      throw new NotFoundError('Account not found');
    }

    // Deterministic, idempotent set-to-target update. `findByIdAndUpdate` with
    // `new:true` returns the post-update document; a null result means the id
    // does not exist, so no state change occurred (Requirements 12.1, 12.3).
    const account = await Account.findByIdAndUpdate(
      id,
      { $set: { status } },
      { new: true, runValidators: true }
    );

    if (!account) {
      throw new NotFoundError('Account not found');
    }

    return ok(res, 200, 'Account status updated', account);
  } catch (err) {
    return next(err);
  }
}

export default {
  listCustomers,
  listAccounts,
  listTransactions,
  statistics,
  updateAccountStatus,
};
