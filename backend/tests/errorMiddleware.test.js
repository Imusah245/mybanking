// tests/errorMiddleware.test.js
//
// Task 5.2 — Unit tests for the central error handler.
//
// Modules under test:
//   - src/middleware/errorMiddleware.js (errorMiddleware(err, req, res, next))
//   - src/utils/errors.js              (typed AppError subclasses)
//   - src/utils/response.js            (error envelope shape)
//
// Requirements:
//   13.2 — failures return { success:false, message } (no data), status in
//          {400,401,403,404,409,429,500}.
//   13.4 — unhandled errors → 500 with a generic message and NO stack trace.
//
// These tests are pure (no DB). A tiny mock `res` records the status and body:
//   res.status(code) returns res (for chaining) and remembers the code,
//   res.json(body)  returns res and records the body.
//
// Supports Property 21 (envelope consistency) and Property 22 (no secret leakage).

import { errorMiddleware } from '../src/middleware/errorMiddleware.js';
import {
  ValidationError,
  AuthenticationError,
  AuthorizationError,
  NotFoundError,
  ConflictError,
  RateLimitError,
  InsufficientFundsError,
  InternalError,
} from '../src/utils/errors.js';

/**
 * Build a mock Express response that records what the handler sends.
 *
 * @returns {{ statusCode: number|null, body: any, status: Function, json: Function }}
 */
function makeRes() {
  const res = {
    statusCode: null,
    body: undefined,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
  return res;
}

/** Invoke the handler with a fresh mock res/req and return the recorded result. */
function handle(err) {
  const res = makeRes();
  const req = {};
  const next = () => {};
  errorMiddleware(err, req, res, next);
  return res;
}

// A representative generic 500 message (matches GENERIC_500_MESSAGE in the handler).
const GENERIC_500_MESSAGE = 'An unexpected error occurred';

describe('errorMiddleware — typed application errors (Requirement 13.2)', () => {
  const cases = [
    ['ValidationError', () => new ValidationError('Amount must be a positive integer'), 400],
    ['AuthenticationError', () => new AuthenticationError('Authentication required'), 401],
    ['AuthorizationError', () => new AuthorizationError('Insufficient privileges'), 403],
    ['NotFoundError', () => new NotFoundError('Account not found'), 404],
    ['ConflictError', () => new ConflictError('Email already registered'), 409],
    ['RateLimitError', () => new RateLimitError('Too many requests'), 429],
    ['InsufficientFundsError', () => new InsufficientFundsError('Insufficient funds'), 400],
  ];

  test.each(cases)('%s maps to its status and the safe envelope', (_name, make, expectedStatus) => {
    const err = make();
    const res = handle(err);

    expect(res.statusCode).toBe(expectedStatus);
    expect(res.body).toEqual({ success: false, message: err.message });
  });

  test.each(cases)('%s body has no data field', (_name, make) => {
    const err = make();
    const res = handle(err);

    expect(res.body).not.toHaveProperty('data');
    // Exactly the two envelope keys, nothing extra.
    expect(Object.keys(res.body).sort()).toEqual(['message', 'success']);
    expect(res.body.success).toBe(false);
  });

  test('InternalError (statusCode 500) → generic 500 message, not its own message', () => {
    const err = new InternalError('atomic $inc failed to persist account 507f1f77bcf86cd799439011');
    const res = handle(err);

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ success: false, message: GENERIC_500_MESSAGE });
    expect(res.body).not.toHaveProperty('data');
    // The raw internal message must not leak.
    expect(res.body.message).not.toContain('atomic');
    expect(res.body.message).not.toContain('507f1f77bcf86cd799439011');
  });
});

describe('errorMiddleware — unknown / unexpected errors (Requirement 13.4)', () => {
  test('a plain Error → 500 with the generic message and no raw message', () => {
    const err = new Error('TypeError: cannot read property balance of undefined at bankService.js:42');
    const res = handle(err);

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ success: false, message: GENERIC_500_MESSAGE });
    expect(res.body.message).not.toContain('bankService');
    expect(res.body.message).not.toContain('balance');
  });

  test('500 response body contains no stack trace', () => {
    const err = new Error('boom');
    // A real stack is present on the error object...
    expect(typeof err.stack).toBe('string');

    const res = handle(err);

    expect(res.statusCode).toBe(500);
    // ...but it is never copied into the response body.
    expect(res.body).not.toHaveProperty('stack');
    expect(JSON.stringify(res.body)).not.toContain('at ');
    expect(JSON.stringify(res.body)).not.toContain(err.stack);
  });

  test.each([
    ['null', null],
    ['undefined', undefined],
    ['a string', 'something broke'],
    ['a number', 42],
    ['a bare object', { foo: 'bar' }],
  ])('non-Error throwable (%s) → generic 500 envelope', (_label, thrown) => {
    const res = handle(thrown);

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ success: false, message: GENERIC_500_MESSAGE });
    expect(res.body).not.toHaveProperty('data');
  });

  test('an error carrying an out-of-range statusCode falls back to 500', () => {
    const err = Object.assign(new Error('teapot'), { statusCode: 418 });
    const res = handle(err);

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ success: false, message: GENERIC_500_MESSAGE });
  });
});

describe('errorMiddleware — known third-party error shapes (Requirement 13.2)', () => {
  test('jsonwebtoken TokenExpiredError → 401', () => {
    const err = Object.assign(new Error('jwt expired'), { name: 'TokenExpiredError' });
    const res = handle(err);

    expect(res.statusCode).toBe(401);
    expect(res.body.success).toBe(false);
    expect(res.body).not.toHaveProperty('data');
    expect(typeof res.body.message).toBe('string');
  });

  test('jsonwebtoken JsonWebTokenError → 401', () => {
    const err = Object.assign(new Error('invalid signature'), { name: 'JsonWebTokenError' });
    const res = handle(err);

    expect(res.statusCode).toBe(401);
    expect(res.body.success).toBe(false);
    expect(res.body).not.toHaveProperty('data');
  });

  test('Mongoose ValidationError → 400', () => {
    const err = Object.assign(new Error('Account validation failed: balance'), {
      name: 'ValidationError',
    });
    const res = handle(err);

    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body).not.toHaveProperty('data');
  });

  test('Mongoose CastError → 400', () => {
    const err = Object.assign(new Error('Cast to ObjectId failed'), { name: 'CastError' });
    const res = handle(err);

    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body).not.toHaveProperty('data');
  });

  test('Mongo duplicate-key error (code 11000) → 409', () => {
    const err = Object.assign(new Error('E11000 duplicate key error'), { code: 11000 });
    const res = handle(err);

    expect(res.statusCode).toBe(409);
    expect(res.body.success).toBe(false);
    expect(res.body).not.toHaveProperty('data');
  });
});

describe('errorMiddleware — status codes stay within the allowed set (Requirement 13.2)', () => {
  const ALLOWED = new Set([400, 401, 403, 404, 409, 429, 500]);
  const samples = [
    new ValidationError('x'),
    new AuthenticationError('x'),
    new AuthorizationError('x'),
    new NotFoundError('x'),
    new ConflictError('x'),
    new RateLimitError('x'),
    new InsufficientFundsError('x'),
    new InternalError('x'),
    new Error('x'),
    Object.assign(new Error('x'), { name: 'TokenExpiredError' }),
    Object.assign(new Error('x'), { code: 11000 }),
    null,
    'nope',
  ];

  test.each(samples.map((s, i) => [i, s]))(
    'sample #%i yields an allowed status',
    (_i, err) => {
      const res = handle(err);
      expect(ALLOWED.has(res.statusCode)).toBe(true);
    }
  );
});

describe('errorMiddleware — no secret leakage (Requirement 13.3, supports Property 22)', () => {
  const BCRYPT_HASH = '$2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy';
  const JWT =
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U';

  test('a bcrypt hash embedded in an operational error message is scrubbed', () => {
    const err = new ValidationError(`password mismatch for hash ${BCRYPT_HASH}`);
    const res = handle(err);

    expect(res.body.message).not.toContain(BCRYPT_HASH);
    // Scrubbed messages fall back to the generic message rather than leaking.
    expect(res.body.message).toBe(GENERIC_500_MESSAGE);
    expect(res.statusCode).toBe(400);
  });

  test('a JWT embedded in an error message is scrubbed', () => {
    const err = new AuthenticationError(`bad token ${JWT}`);
    const res = handle(err);

    expect(res.body.message).not.toContain(JWT);
    expect(res.body.message).toBe(GENERIC_500_MESSAGE);
    expect(res.statusCode).toBe(401);
  });

  test('a message naming the JWT signing secret is scrubbed', () => {
    const err = new AuthenticationError('verification failed with JWT_SECRET=supersecretvalue');
    const res = handle(err);

    expect(res.body.message).not.toContain('supersecretvalue');
    expect(res.body.message).toBe(GENERIC_500_MESSAGE);
  });

  test('a Bearer token in a message is scrubbed', () => {
    const err = new AuthenticationError('rejected Bearer abc123.def456.ghi789');
    const res = handle(err);

    expect(res.body.message).not.toContain('abc123.def456.ghi789');
    expect(res.body.message).toBe(GENERIC_500_MESSAGE);
  });

  test('secrets never leak via a 500 even when attached to an unknown error', () => {
    const err = new Error(`unexpected ${BCRYPT_HASH} ${JWT}`);
    const res = handle(err);

    expect(res.statusCode).toBe(500);
    const serialized = JSON.stringify(res.body);
    expect(serialized).not.toContain(BCRYPT_HASH);
    expect(serialized).not.toContain(JWT);
    expect(res.body.message).toBe(GENERIC_500_MESSAGE);
  });
});
