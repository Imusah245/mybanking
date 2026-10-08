// Account & profile controller (Account_Service) — Requirements 4.3, 4.4,
// 9.1, 9.2, 9.3, 9.4.
//
// These handlers are intentionally thin: they read the TRUSTED acting identity
// from `req.user` (populated by `authMiddleware` from the verified JWT `sub`
// claim) and NEVER from the request body, query, or params. Every read and
// write is scoped to `req.user.id`, so a user can only ever see or affect their
// OWN account and profile — this is the ownership-isolation guarantee
// (Property 14 / Requirements 14.6, 14.7). Client-supplied identity, balance,
// account-number, role, or email fields are never trusted (Requirement 3.6).
//
// All handlers are async and forward failures via `next(err)` so the central
// `errorMiddleware` shapes the standardized `{ success:false, message }`
// envelope. Successful responses use the `ok()` envelope helper.
import Account from '../models/Account.js';
import User from '../models/User.js';
import { ok } from '../utils/response.js';
import { NotFoundError } from '../utils/errors.js';
import { pesewasToDisplay } from '../utils/formatters.js';

/**
 * Shape an Account document into the client-facing account overview.
 *
 * Returns only the fields the account-details endpoint is specified to expose
 * (Requirement 4.3): accountNumber, balance (integer pesewas), currency,
 * accountType, and status. A display-formatted balance is included for
 * convenience; it is DISPLAY ONLY and is never used in balance arithmetic
 * (Requirement 15.1). The authoritative value remains the integer `balance`.
 *
 * @param {import('mongoose').Document} account - The owning user's Account.
 * @returns {object} The safe account overview payload.
 */
function toAccountOverview(account) {
  return {
    accountNumber: account.accountNumber,
    balance: account.balance, // integer pesewas — authoritative
    balanceDisplay: pesewasToDisplay(account.balance), // display only
    currency: account.currency,
    accountType: account.accountType,
    status: account.status,
  };
}

/**
 * Shape a User document into a safe profile payload.
 *
 * The `password` field is `select:false` on the model, so it is already absent
 * from the loaded document; this helper additionally returns an explicit
 * whitelist of safe fields so no unexpected field can ever leak
 * (Requirements 9.1, 14.9).
 *
 * @param {import('mongoose').Document} user - The authenticated User.
 * @returns {object} The safe profile payload (never includes the password).
 */
function toSafeProfile(user) {
  return {
    id: String(user._id),
    firstName: user.firstName,
    lastName: user.lastName,
    email: user.email,
    phone: user.phone,
    dateOfBirth: user.dateOfBirth,
    address: user.address,
    role: user.role,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

/**
 * GET /api/accounts/me — Account details for the authenticated user.
 *
 * Returns a 200 with the account overview (accountNumber, balance, currency,
 * accountType, status) for `req.user.id` (Requirement 4.3). If the user owns no
 * account, responds 404 and returns no account data (Requirement 4.4). The
 * lookup is scoped by `userId: req.user.id`, so one user can never read
 * another's account (Property 14).
 *
 * @type {import('express').RequestHandler}
 */
export async function getAccount(req, res, next) {
  try {
    const account = await Account.findOne({ userId: req.user.id });
    if (!account) {
      throw new NotFoundError('No account exists for this user');
    }
    return ok(res, 200, 'Account retrieved', toAccountOverview(account));
  } catch (err) {
    return next(err);
  }
}

/**
 * GET /api/users/me — Safe profile for the authenticated user.
 *
 * Returns a 200 with the authenticated user's profile, with the password field
 * omitted (Requirements 9.1, 9.2). Scoped by `req.user.id`. A missing user
 * (e.g. a valid token for a since-deleted account) results in a 404.
 *
 * @type {import('express').RequestHandler}
 */
export async function getProfile(req, res, next) {
  try {
    // `password` is `select:false`, so it is excluded by default.
    const user = await User.findById(req.user.id);
    if (!user) {
      throw new NotFoundError('User not found');
    }
    return ok(res, 200, 'Profile retrieved', toSafeProfile(user));
  } catch (err) {
    return next(err);
  }
}

/**
 * PUT /api/users/me — Update the authenticated user's safe profile fields.
 *
 * Updates ONLY `phone` and `address` for `req.user.id` (Requirement 9.3). Any
 * `balance`, `accountNumber`, `role`, or `email` field in the request body is
 * ignored and the stored values for those fields are left unchanged
 * (Requirement 9.4) — this handler never reads them. Field-level validation
 * (lengths, allowed phone characters) is enforced upstream by the validation
 * middleware (Requirement 9.5); here we build the update from a strict
 * whitelist so only safe fields can ever be written.
 *
 * @type {import('express').RequestHandler}
 */
export async function updateProfile(req, res, next) {
  try {
    const update = {};
    if (req.body?.phone !== undefined) update.phone = req.body.phone;
    if (req.body?.address !== undefined) update.address = req.body.address;

    const user = await User.findByIdAndUpdate(req.user.id, update, {
      new: true,
      runValidators: true,
    });
    if (!user) {
      throw new NotFoundError('User not found');
    }
    return ok(res, 200, 'Profile updated', toSafeProfile(user));
  } catch (err) {
    return next(err);
  }
}

export default { getAccount, getProfile, updateProfile };
