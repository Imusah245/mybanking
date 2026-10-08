/**
 * Central error handler (Error_Handler) — Requirements 13.2, 13.3, 13.4.
 *
 * This is the terminal Express error-handling middleware. Every thrown or
 * forwarded error ends up here and is converted into the standardized failure
 * envelope `{ success: false, message }` (no `data` field) with an HTTP status
 * code drawn from {400, 401, 403, 404, 409, 429, 500}.
 *
 * Guarantees:
 * - Operational typed errors (see utils/errors.js) surface their status + a
 *   client-safe message.
 * - A handful of well-known third-party error shapes (JWT, Mongoose/Mongo) are
 *   mapped to the correct status.
 * - Any unknown/unexpected error becomes a 500 with a generic message — its
 *   real message and stack trace are NEVER sent to the client (13.4).
 * - Password hashes, JWT values, and the JWT signing secret are never present
 *   in the response body or log output (13.3).
 */

import { errorBody } from '../utils/response.js';
import { AppError, ALLOWED_STATUS_CODES } from '../utils/errors.js';

/** Generic message used whenever we must not reveal internal failure detail. */
const GENERIC_500_MESSAGE = 'An unexpected error occurred';

/**
 * Patterns of secret-bearing substrings that must never appear in a message we
 * send to the client or write to logs. If a candidate message matches any of
 * these, we fall back to a generic message instead.
 */
const SECRET_PATTERNS = [
  /\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}/, // bcrypt hash
  /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/, // JWT (header.payload.signature)
  /jwt[_\s-]*secret/i,
  /bearer\s+[A-Za-z0-9._-]+/i,
];

/**
 * Decide whether a message is safe to expose. A message is unsafe if it looks
 * like it embeds a credential/secret.
 *
 * @param {unknown} message
 * @returns {boolean}
 */
function isMessageSafe(message) {
  if (typeof message !== 'string' || message.length === 0) return false;
  return !SECRET_PATTERNS.some((pattern) => pattern.test(message));
}

/**
 * Map a known third-party error shape to a typed status + client-safe message.
 * Returns null when the error is not one of the recognized shapes.
 *
 * @param {any} err
 * @returns {{ statusCode: number, message: string } | null}
 */
function mapKnownError(err) {
  if (!err || typeof err !== 'object') return null;

  // jsonwebtoken errors.
  if (err.name === 'TokenExpiredError') {
    return { statusCode: 401, message: 'Token expired' };
  }
  if (err.name === 'JsonWebTokenError') {
    return { statusCode: 401, message: 'Invalid token' };
  }

  // Mongoose/Mongo validation and cast errors → bad input.
  if (err.name === 'ValidationError') {
    return { statusCode: 400, message: 'Validation failed' };
  }
  if (err.name === 'CastError') {
    return { statusCode: 400, message: 'Invalid identifier' };
  }

  // Mongo duplicate-key error → conflict (e.g. duplicate email).
  if (err.code === 11000 || err.code === 11001) {
    return { statusCode: 409, message: 'Resource already exists' };
  }

  return null;
}

/**
 * Resolve the status code and client-safe message for an error without ever
 * leaking internals.
 *
 * @param {any} err
 * @returns {{ statusCode: number, message: string }}
 */
function resolveError(err) {
  // 1. Typed application errors we defined.
  if (err instanceof AppError) {
    const statusCode = ALLOWED_STATUS_CODES.includes(err.statusCode)
      ? err.statusCode
      : 500;
    if (statusCode === 500) {
      return { statusCode: 500, message: GENERIC_500_MESSAGE };
    }
    return {
      statusCode,
      message: isMessageSafe(err.message) ? err.message : GENERIC_500_MESSAGE,
    };
  }

  // 2. Well-known third-party error shapes.
  const known = mapKnownError(err);
  if (known) return known;

  // 3. A plain object/error carrying an explicit, allowed statusCode.
  const explicitStatus = err && (err.statusCode ?? err.status);
  if (
    typeof explicitStatus === 'number' &&
    ALLOWED_STATUS_CODES.includes(explicitStatus)
  ) {
    return {
      statusCode: explicitStatus,
      message: isMessageSafe(err.message) ? err.message : GENERIC_500_MESSAGE,
    };
  }

  // 4. Anything else is unexpected → generic 500, no detail leaked.
  return { statusCode: 500, message: GENERIC_500_MESSAGE };
}

/**
 * Terminal Express error-handling middleware.
 *
 * Must declare all four arguments so Express recognizes it as an error handler.
 *
 * @param {any} err - The error thrown or forwarded via next(err).
 * @param {import('express').Request} _req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} _next
 * @returns {import('express').Response}
 */
export function errorMiddleware(err, _req, res, _next) {
  const { statusCode, message } = resolveError(err);

  // Log server-side without secrets or stack trace in the client body. For 5xx
  // we record a generic marker rather than the raw error so logs never carry
  // credential-bearing content.
  if (statusCode >= 500) {
    // eslint-disable-next-line no-console
    console.error('[error] unhandled error → 500');
  }

  return res.status(statusCode).json(errorBody(message));
}

export default errorMiddleware;
