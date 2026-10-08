// Auth controller (Auth_Service) — Requirements 1.1, 1.2, 1.3, 1.5, 1.6, 2.1,
// 2.2, 4.1, 4.2.
//
// Controllers are deliberately THIN: they read the already-validated/sanitized
// request (validation runs in `validate.js` before these handlers), orchestrate
// the model/service calls, issue tokens, and shape the standardized response
// envelope via `ok()`. All failures are forwarded to the central
// `errorMiddleware` through `next(err)` so the failure envelope and status
// mapping live in exactly one place (Requirements 13.1, 13.2).
//
// TRUSTED IDENTITY (Requirement 3, design Property 12): every token this module
// issues derives its subject (`sub`) and `role` claims ONLY from the User this
// request created (register) or verified (login) — never from client-supplied
// identity fields. `authMiddleware` later reads `sub`→id and `role`→role, so
// the claims written here are the single identity source for protected routes.
//
// NO SECRET LEAKAGE (Requirement 13.3, design Property 22): the User model keeps
// `password` as `select:false`, so a default query never returns the hash. The
// safe-user projection below is an extra guard that explicitly whitelists the
// fields returned to the client; the bcrypt hash and the JWT secret are never
// placed in a response body.

import jwt from 'jsonwebtoken';

import { env } from '../config/env.js';
import User from '../models/User.js';
import Account, { ACCOUNT_STATUS } from '../models/Account.js';
import generateAccountNumber from '../utils/generateAccountNumber.js';
import { withTransaction } from '../services/bankService.js';
import { ok } from '../utils/response.js';
import {
  ConflictError,
  AuthenticationError,
  InternalError,
} from '../utils/errors.js';
import {
  recordLoginFailure,
  recordLoginSuccess,
} from '../middleware/rateLimiter.js';

/**
 * MongoDB duplicate-key error code. A race between the up-front email check and
 * the insert (or a concurrent registration) surfaces as this code on the unique
 * `email` index; we map it to the same 409 as the explicit pre-check so the
 * duplicate-email guarantee holds under concurrency (Requirement 1.3).
 */
const MONGO_DUPLICATE_KEY = 11000;

/**
 * Project a User document down to the client-safe fields. This NEVER includes
 * the `password` hash (Requirements 1.5, 2.1, 13.3; design Property 22). The
 * User model already excludes `password` by default via `select:false`, so this
 * projection is a deliberate, explicit whitelist rather than a blocklist.
 *
 * @param {import('mongoose').Document} user - The User document.
 * @returns {object} A plain object with only safe profile fields.
 */
function toSafeUser(user) {
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
 * Project an Account document down to the client-safe overview fields
 * (Requirements 1.5, 4.1). Balance is returned as the stored integer pesewas.
 *
 * @param {import('mongoose').Document} account - The Account document.
 * @returns {object} A plain object with the account overview fields.
 */
function toSafeAccount(account) {
  return {
    id: String(account._id),
    accountNumber: account.accountNumber,
    accountType: account.accountType,
    balance: account.balance,
    currency: account.currency,
    status: account.status,
  };
}

/**
 * Issue a signed JWT whose identity claims come ONLY from the supplied User.
 *
 * The `subject` is the user id (read later as `sub`→`req.user.id`) and a `role`
 * claim carries the authorization role. The token expires after
 * `env.JWT_EXPIRES_IN` seconds (default 3600s per Requirements 2.1). The signing
 * secret (`env.JWT_SECRET`) is never logged or returned anywhere but inside the
 * opaque token value (Requirement 13.3).
 *
 * @param {import('mongoose').Document} user - The authenticated/created user.
 * @returns {string} A signed JWT.
 */
function issueToken(user) {
  return jwt.sign({ role: user.role }, env.JWT_SECRET, {
    subject: String(user._id),
    expiresIn: env.JWT_EXPIRES_IN,
  });
}

/**
 * POST /api/auth/register — create a User and one linked Account atomically,
 * then issue a token (Requirement 1).
 *
 * Payload shape/content is already validated and sanitized by `validate.js`
 * before this handler runs (Requirement 1.4), so the body is trusted to be
 * well-formed here. The flow:
 *
 *   1. Reject a duplicate email up front with a `ConflictError` (409) so no User
 *      or Account is created (Requirement 1.3). A concurrent insert that slips
 *      past this check is still caught via the unique-index duplicate-key error
 *      below and mapped to the same 409.
 *   2. Inside a single `withTransaction` session (the same ACID facility used by
 *      transfers), create the User (the model's pre-save hook hashes the
 *      password with bcrypt) and then exactly one linked Account with balance 0
 *      pesewas, currency GHS, status Active, and a unique 10-digit account
 *      number. Both inserts commit together or neither persists — so a failure
 *      after the User insert rolls the User back, leaving no orphaned User
 *      (Requirements 1.2, 1.6).
 *   3. Issue a JWT for the created user and return 201 with the safe user +
 *      account overview + token. The password hash is never in the response
 *      (Requirements 1.5, 13.3).
 *
 * @type {import('express').RequestHandler}
 */
export async function register(req, res, next) {
  try {
    const { firstName, lastName, email, phone, dateOfBirth, address, password } =
      req.body;

    // Up-front duplicate-email guard: return 409 and create nothing
    // (Requirement 1.3). The unique index is the authoritative guard under
    // concurrency; this early check gives the common path a clean 409.
    const existing = await User.exists({ email });
    if (existing) {
      throw new ConflictError('Email is already registered');
    }

    let createdUser;
    let createdAccount;

    try {
      await withTransaction(async (session) => {
        // Create the User inside the transaction. The pre-save hook hashes the
        // password; `role` defaults to CUSTOMER (Requirement 1.1). `create`
        // with a session takes an array and returns an array.
        const [user] = await User.create(
          [
            {
              firstName,
              lastName,
              email,
              phone,
              dateOfBirth,
              address,
              password,
            },
          ],
          { session }
        );

        // Create exactly one linked Account with a unique 10-digit number,
        // balance 0 pesewas, currency GHS, status Active (Requirement 1.2). The
        // uniqueness lookup joins this transaction via the session.
        const accountNumber = await generateAccountNumber(Account, { session });
        const [account] = await Account.create(
          [
            {
              userId: user._id,
              accountNumber,
              balance: 0,
              currency: 'GHS',
              status: ACCOUNT_STATUS.ACTIVE,
            },
          ],
          { session }
        );

        createdUser = user;
        createdAccount = account;
      });
    } catch (txErr) {
      // A concurrent registration can still trip the unique email index between
      // our pre-check and the insert; map that to the same 409 (Requirement
      // 1.3). Any other failure means the transaction aborted and neither the
      // User nor the Account persisted — surface a 500 "registration could not
      // be completed" (Requirement 1.6).
      if (txErr && txErr.code === MONGO_DUPLICATE_KEY) {
        throw new ConflictError('Email is already registered');
      }
      throw new InternalError('Registration could not be completed');
    }

    const token = issueToken(createdUser);

    return ok(res, 201, 'Registration successful', {
      user: toSafeUser(createdUser),
      account: toSafeAccount(createdAccount),
      token,
    });
  } catch (err) {
    return next(err);
  }
}

/**
 * POST /api/auth/login — verify credentials and issue a token (Requirement 2).
 *
 * The email/password shape is already validated by `validate.js` (Requirement
 * 2.3) and the `loginThrottle` middleware has already rejected emails inside an
 * active lockout window (Requirement 2.4). The flow:
 *
 *   1. Look up the user by email WITH the normally-excluded password hash
 *      (`.select('+password')`) so `comparePassword` can run.
 *   2. On a missing user OR a non-matching password, record the failure (feeds
 *      the lockout counter) and throw a GENERIC `AuthenticationError` (401) that
 *      does not disclose which of email/password was wrong (Requirement 2.2).
 *   3. On success, clear the failure counter, issue a JWT (`sub`=userId, role
 *      claim, 3600s expiry) and return 200 with the safe user payload + token
 *      (Requirement 2.1). The hash is never returned (Requirement 13.3).
 *
 * @type {import('express').RequestHandler}
 */
export async function login(req, res, next) {
  try {
    const { email, password } = req.body;

    // Re-select the password hash (excluded by default) for verification only.
    const user = await User.findOne({ email }).select('+password');

    // Verify credentials. A missing user and a wrong password are reported
    // identically so an attacker cannot distinguish them (Requirement 2.2).
    const passwordMatches = user ? await user.comparePassword(password) : false;

    if (!user || !passwordMatches) {
      // Count this failure toward the per-email lockout (Requirement 2.4).
      recordLoginFailure(email);
      throw new AuthenticationError('Invalid credentials');
    }

    // Successful login clears the failure counter for this email.
    recordLoginSuccess(email);

    const token = issueToken(user);

    return ok(res, 200, 'Login successful', {
      user: toSafeUser(user),
      token,
    });
  } catch (err) {
    return next(err);
  }
}

/**
 * GET /api/auth/me — return the authenticated profile + account overview
 * (Requirements 4.1, 4.2).
 *
 * Identity comes solely from `req.user` (set by `authMiddleware` from the
 * verified token). The password hash is excluded by the model default and the
 * safe-user projection. If the authenticated user has no account, the account
 * field is returned as `null` rather than failing the profile overview.
 *
 * @type {import('express').RequestHandler}
 */
export async function me(req, res, next) {
  try {
    const user = await User.findById(req.user.id);
    if (!user) {
      // The token resolved to a user that no longer exists.
      throw new AuthenticationError('Authentication required');
    }

    const account = await Account.findOne({ userId: user._id });

    return ok(res, 200, 'Profile retrieved', {
      user: toSafeUser(user),
      account: account ? toSafeAccount(account) : null,
    });
  } catch (err) {
    return next(err);
  }
}

export default { register, login, me };
