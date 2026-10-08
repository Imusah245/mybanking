/**
 * Typed application errors (Requirements 13.2, 13.4).
 *
 * Every error the API throws deliberately carries an HTTP status code drawn
 * from the allowed set {400, 401, 403, 404, 409, 429}. The central
 * `errorMiddleware` reads `statusCode` to shape the standardized failure
 * envelope. Any error WITHOUT a safe `statusCode` (an unexpected/programmer
 * error) is treated as a 500 by the handler and its message is never leaked to
 * the client.
 *
 * `isOperational` marks errors that are expected, trusted parts of normal
 * request flow (bad input, missing resource, etc.) whose `message` is safe to
 * surface to the client. Unexpected errors are not operational, so the handler
 * substitutes a generic message.
 */

/** Status codes the error handler is allowed to emit (besides 500). */
export const ALLOWED_STATUS_CODES = Object.freeze([400, 401, 403, 404, 409, 429]);

/**
 * Base class for all typed application errors.
 *
 * @extends Error
 */
export class AppError extends Error {
  /**
   * @param {string} message - Human-readable, client-safe message.
   * @param {number} statusCode - HTTP status code to map to.
   */
  constructor(message, statusCode) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    /** Operational errors carry a client-safe message. */
    this.isOperational = true;
    // Keep the prototype chain correct when targeting older runtimes.
    Object.setPrototypeOf(this, new.target.prototype);
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }
}

/** 400 Bad Request — invalid input / failed validation. */
export class ValidationError extends AppError {
  constructor(message = 'Validation failed') {
    super(message, 400);
  }
}

/** 401 Unauthorized — missing/expired/invalid authentication. */
export class AuthenticationError extends AppError {
  constructor(message = 'Authentication required') {
    super(message, 401);
  }
}

/** 403 Forbidden — authenticated but not permitted. */
export class AuthorizationError extends AppError {
  constructor(message = 'Insufficient privileges') {
    super(message, 403);
  }
}

/** 404 Not Found — the requested resource does not exist / is not owned. */
export class NotFoundError extends AppError {
  constructor(message = 'Resource not found') {
    super(message, 404);
  }
}

/** 409 Conflict — e.g. duplicate email on registration. */
export class ConflictError extends AppError {
  constructor(message = 'Resource conflict') {
    super(message, 409);
  }
}

/** 429 Too Many Requests — rate limit / login lockout. */
export class RateLimitError extends AppError {
  constructor(message = 'Too many requests') {
    super(message, 429);
  }
}

/**
 * 400 Bad Request — a debit/transfer was rejected because the available
 * balance is less than the requested amount. Modeled as a 400 per the spec's
 * insufficient-funds mapping (Requirements 6.3, 7.10, 15.6).
 */
export class InsufficientFundsError extends AppError {
  constructor(message = 'Insufficient funds') {
    super(message, 400);
  }
}

/**
 * 500 Internal Server Error — an operation could not be completed for an
 * internal reason (e.g. an atomic update failed to persist). The handler maps
 * any 500 to a generic client message, so the supplied message is used for
 * logging/intent only and must never contain secrets.
 */
export class InternalError extends AppError {
  constructor(message = 'Internal server error') {
    super(message, 500);
    // A 500 is not a client-safe operational error.
    this.isOperational = false;
  }
}
