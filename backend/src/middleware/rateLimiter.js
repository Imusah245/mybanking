/**
 * Rate_Limiter middleware (Requirements 2.4, 14.3, 13.2).
 *
 * Two independent concerns protect the authentication endpoints:
 *
 * 1. `authRateLimiter` — an IP-based `express-rate-limit` of 5 requests per
 *    15-minute window applied to the auth endpoints (register/login). When the
 *    limit is exceeded it responds with HTTP 429 and the standardized failure
 *    envelope `{ success: false, message }` (Requirement 14.3).
 *
 * 2. `loginThrottle` — an email-keyed login throttle. Five consecutive FAILED
 *    logins for the same normalized email within a 300s rolling window trigger
 *    a 900s lockout that returns HTTP 429. The lockout is tracked in a
 *    process-local in-memory store keyed by normalized email; the User record
 *    is never touched (Requirement 2.4). In a multi-instance deployment this
 *    store would be replaced by a shared backend (e.g. Redis). A successful
 *    login clears the counter via `recordLoginSuccess`; a failed login
 *    increments it via `recordLoginFailure` (called by the auth controller).
 *
 * Both concerns emit the exact same failure envelope the central
 * `errorMiddleware` would produce, so clients see a consistent error shape.
 */

import rateLimit from 'express-rate-limit';
import { errorBody } from '../utils/response.js';
import { RateLimitError } from '../utils/errors.js';

/** IP limiter: window length in milliseconds (15 minutes). */
const AUTH_WINDOW_MS = 15 * 60 * 1000;
/** IP limiter: max requests allowed per window per client. */
const AUTH_MAX_REQUESTS = 5;

/** Login throttle: rolling window in which failures accumulate (300s). */
const LOGIN_FAILURE_WINDOW_MS = 300 * 1000;
/** Login throttle: consecutive failures that trigger a lockout. */
const LOGIN_FAILURE_THRESHOLD = 5;
/** Login throttle: how long a lockout lasts once triggered (900s). */
const LOGIN_LOCKOUT_MS = 900 * 1000;

/** Message surfaced to the client on any throttle/limit hit. */
const RATE_LIMIT_MESSAGE = 'Too many requests, please try again later.';

/**
 * Shared 429 responder. Produces the standardized failure envelope so the
 * response is identical whether it comes from the IP limiter, the login
 * throttle, or the central error handler.
 *
 * @param {import('express').Response} res
 * @param {string} [message]
 * @returns {import('express').Response}
 */
function sendRateLimited(res, message = RATE_LIMIT_MESSAGE) {
  return res.status(429).json(errorBody(message));
}

/**
 * IP-based auth endpoint limiter (Requirement 14.3).
 *
 * Uses `express-rate-limit`. On limit exceeded it short-circuits with 429 and
 * the standardized envelope rather than the library default body.
 */
export const authRateLimiter = rateLimit({
  windowMs: AUTH_WINDOW_MS,
  limit: AUTH_MAX_REQUESTS,
  standardHeaders: true,
  legacyHeaders: false,
  // express-rate-limit v7 handler signature: (req, res, next, options).
  handler: (_req, res) => sendRateLimited(res),
});

/**
 * Process-local store of per-email login state.
 *
 * key: normalized email
 * value: { failures: number[], lockedUntil: number|null }
 *   - `failures` holds the timestamps (ms) of recent consecutive failures,
 *     pruned to the rolling window.
 *   - `lockedUntil` is the epoch-ms at which an active lockout expires, or null.
 *
 * @type {Map<string, { failures: number[], lockedUntil: number|null }>}
 */
const loginState = new Map();

/**
 * Normalize an email for use as a stable throttle key.
 *
 * @param {unknown} email
 * @returns {string|null} normalized email, or null when not a usable string.
 */
function normalizeEmail(email) {
  if (typeof email !== 'string') return null;
  const trimmed = email.trim().toLowerCase();
  return trimmed === '' ? null : trimmed;
}

/**
 * Read the throttle entry for an email, pruning expired failure timestamps and
 * clearing an expired lockout. Returns null when there is nothing tracked.
 *
 * @param {string} key - normalized email.
 * @param {number} now - current epoch ms.
 * @returns {{ failures: number[], lockedUntil: number|null } | null}
 */
function readEntry(key, now) {
  const entry = loginState.get(key);
  if (!entry) return null;

  // Expire a finished lockout.
  if (entry.lockedUntil !== null && entry.lockedUntil <= now) {
    entry.lockedUntil = null;
    entry.failures = [];
  }

  // Drop failures that have aged out of the rolling window.
  entry.failures = entry.failures.filter(
    (ts) => now - ts < LOGIN_FAILURE_WINDOW_MS
  );

  if (entry.lockedUntil === null && entry.failures.length === 0) {
    loginState.delete(key);
    return null;
  }
  return entry;
}

/**
 * Login throttle middleware (Requirement 2.4). Place BEFORE the login
 * controller. It only blocks requests whose email is currently locked out; it
 * does not itself count failures (the controller reports the auth outcome via
 * `recordLoginFailure` / `recordLoginSuccess`).
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
export function loginThrottle(req, res, next) {
  const key = normalizeEmail(req.body && req.body.email);
  if (key === null) {
    // No usable email to key on — let validation handle the bad payload.
    return next();
  }

  const now = Date.now();
  const entry = readEntry(key, now);
  if (entry && entry.lockedUntil !== null && entry.lockedUntil > now) {
    return sendRateLimited(res);
  }
  return next();
}

/**
 * Record a failed login for an email. The fifth consecutive failure inside the
 * rolling window starts a lockout. Never touches the User record.
 *
 * @param {unknown} email
 * @returns {boolean} true when this failure triggered (or extended) a lockout.
 */
export function recordLoginFailure(email) {
  const key = normalizeEmail(email);
  if (key === null) return false;

  const now = Date.now();
  const entry = readEntry(key, now) ?? { failures: [], lockedUntil: null };

  // Already locked out — keep it locked, nothing more to count.
  if (entry.lockedUntil !== null && entry.lockedUntil > now) {
    loginState.set(key, entry);
    return true;
  }

  entry.failures.push(now);
  let lockedNow = false;
  if (entry.failures.length >= LOGIN_FAILURE_THRESHOLD) {
    entry.lockedUntil = now + LOGIN_LOCKOUT_MS;
    lockedNow = true;
  }
  loginState.set(key, entry);
  return lockedNow;
}

/**
 * Clear login throttle state for an email after a successful login.
 *
 * @param {unknown} email
 * @returns {void}
 */
export function recordLoginSuccess(email) {
  const key = normalizeEmail(email);
  if (key === null) return;
  loginState.delete(key);
}

/**
 * Whether an email is currently within an active lockout window.
 *
 * @param {unknown} email
 * @returns {boolean}
 */
export function isLoginLocked(email) {
  const key = normalizeEmail(email);
  if (key === null) return false;
  const now = Date.now();
  const entry = readEntry(key, now);
  return Boolean(entry && entry.lockedUntil !== null && entry.lockedUntil > now);
}

/**
 * Test/maintenance helper: wipe all tracked login-throttle state.
 *
 * @returns {void}
 */
export function resetLoginThrottle() {
  loginState.clear();
}

/**
 * Convenience factory that returns a fresh `RateLimitError` for callers that
 * prefer to throw into the central error handler instead of responding
 * directly. The emitted envelope is identical either way.
 *
 * @param {string} [message]
 * @returns {RateLimitError}
 */
export function rateLimitError(message = RATE_LIMIT_MESSAGE) {
  return new RateLimitError(message);
}

export default authRateLimiter;
