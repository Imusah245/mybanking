// tests/rateLimiter.test.js
//
// Task 5.8 — Unit tests for the rate-limiter / login-throttle middleware.
//
// Module under test:
//   - src/middleware/rateLimiter.js
//       authRateLimiter (express-rate-limit instance)
//       loginThrottle(req, res, next)
//       recordLoginFailure(email) / recordLoginSuccess(email)
//       isLoginLocked(email) / resetLoginThrottle() / rateLimitError()
//
// Requirements:
//   2.4  — five consecutive failed logins for the same email lock it out (429);
//          the User record is never touched (verified here by the throttle
//          operating purely on in-memory email-keyed state).
//   14.3 — the auth limiter is configured for 5 req / 15-min and emits the
//          standardized { success:false, message } envelope on 429.
//
// Pure logic, no DB. A mock `res` records status()/json() calls; `next` is a
// jest.fn. The in-memory throttle store is wiped before each test via
// resetLoginThrottle() so cases are fully isolated.

import { jest } from '@jest/globals';
import {
  authRateLimiter,
  loginThrottle,
  recordLoginFailure,
  recordLoginSuccess,
  isLoginLocked,
  resetLoginThrottle,
  rateLimitError,
} from '../src/middleware/rateLimiter.js';
import { RateLimitError } from '../src/utils/errors.js';

/** Mock Express response recording status/json via jest spies. */
function makeRes() {
  const res = {
    statusCode: null,
    body: undefined,
  };
  res.status = jest.fn((code) => {
    res.statusCode = code;
    return res;
  });
  res.json = jest.fn((payload) => {
    res.body = payload;
    return res;
  });
  return res;
}

beforeEach(() => {
  resetLoginThrottle();
});

describe('rateLimiter — login throttle counting (Requirement 2.4)', () => {
  const EMAIL = 'victim@example.com';

  test('four consecutive failures do NOT lock the account', () => {
    for (let i = 0; i < 4; i += 1) {
      const locked = recordLoginFailure(EMAIL);
      expect(locked).toBe(false);
    }
    expect(isLoginLocked(EMAIL)).toBe(false);
  });

  test('the fifth consecutive failure triggers the lockout', () => {
    for (let i = 0; i < 4; i += 1) {
      expect(recordLoginFailure(EMAIL)).toBe(false);
    }
    // 5th failure crosses the threshold.
    expect(recordLoginFailure(EMAIL)).toBe(true);
    expect(isLoginLocked(EMAIL)).toBe(true);
  });

  test('a successful login clears the failure counter and the lock', () => {
    for (let i = 0; i < 5; i += 1) recordLoginFailure(EMAIL);
    expect(isLoginLocked(EMAIL)).toBe(true);

    recordLoginSuccess(EMAIL);

    expect(isLoginLocked(EMAIL)).toBe(false);
    // Counter reset: four fresh failures must not re-lock immediately.
    for (let i = 0; i < 4; i += 1) {
      expect(recordLoginFailure(EMAIL)).toBe(false);
    }
    expect(isLoginLocked(EMAIL)).toBe(false);
  });

  test('lockouts are isolated per email', () => {
    for (let i = 0; i < 5; i += 1) recordLoginFailure('a@example.com');
    expect(isLoginLocked('a@example.com')).toBe(true);
    expect(isLoginLocked('b@example.com')).toBe(false);
  });

  test('email normalization (case/whitespace) keys the same bucket', () => {
    recordLoginFailure('  User@Example.COM ');
    recordLoginFailure('user@example.com');
    recordLoginFailure('USER@EXAMPLE.COM');
    recordLoginFailure('user@example.com   ');
    // Fifth, formatted differently again, should trip the lock on the one bucket.
    expect(recordLoginFailure(' USER@example.com ')).toBe(true);
    expect(isLoginLocked('user@example.com')).toBe(true);
    expect(isLoginLocked('  USER@EXAMPLE.COM  ')).toBe(true);
  });

  test('non-string / empty emails are ignored and never lock', () => {
    expect(recordLoginFailure(undefined)).toBe(false);
    expect(recordLoginFailure(null)).toBe(false);
    expect(recordLoginFailure('')).toBe(false);
    expect(recordLoginFailure('   ')).toBe(false);
    expect(recordLoginFailure(12345)).toBe(false);
    expect(isLoginLocked(undefined)).toBe(false);
    expect(isLoginLocked('')).toBe(false);
  });
});

describe('rateLimiter — loginThrottle middleware (Requirement 2.4)', () => {
  const EMAIL = 'blocked@example.com';

  test('calls next() when the email is not locked', () => {
    const req = { body: { email: EMAIL } };
    const res = makeRes();
    const next = jest.fn();

    loginThrottle(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledWith();
    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
  });

  test('responds 429 with the standardized envelope and does NOT call next() when locked', () => {
    for (let i = 0; i < 5; i += 1) recordLoginFailure(EMAIL);
    expect(isLoginLocked(EMAIL)).toBe(true);

    const req = { body: { email: EMAIL } };
    const res = makeRes();
    const next = jest.fn();

    loginThrottle(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.body).toEqual({
      success: false,
      message: 'Too many requests, please try again later.',
    });
    // Failure envelope carries no data field.
    expect(res.body).not.toHaveProperty('data');
  });

  test('a locked email given with different casing/whitespace is still blocked', () => {
    for (let i = 0; i < 5; i += 1) recordLoginFailure('Mixed@Example.com');

    const req = { body: { email: '  MIXED@EXAMPLE.COM  ' } };
    const res = makeRes();
    const next = jest.fn();

    loginThrottle(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(429);
  });

  test('passes through when the request has no usable email (validation handles it)', () => {
    const res = makeRes();
    const next = jest.fn();

    loginThrottle({ body: {} }, res, next);

    expect(next).toHaveBeenCalledWith();
    expect(res.status).not.toHaveBeenCalled();
  });

  test('after a successful login the throttle lets the request through again', () => {
    for (let i = 0; i < 5; i += 1) recordLoginFailure(EMAIL);
    recordLoginSuccess(EMAIL);

    const req = { body: { email: EMAIL } };
    const res = makeRes();
    const next = jest.fn();

    loginThrottle(req, res, next);

    expect(next).toHaveBeenCalledWith();
    expect(res.status).not.toHaveBeenCalled();
  });
});

describe('rateLimiter — authRateLimiter behaviour (Requirement 14.3)', () => {
  // Drive the limiter the way Express would: a request carrying a client key
  // (ip) and a response that can carry the rate-limit headers. The limiter's
  // default MemoryStore counts per key, so repeated calls from the same ip
  // eventually exceed the window.
  function makeLimiterReq(ip) {
    return {
      ip,
      method: 'POST',
      // express-rate-limit v7 reads the key via a key generator that defaults
      // to req.ip; app/headers access is tolerant of these minimal stubs.
      app: { get: () => undefined },
      headers: {},
      get: () => undefined,
    };
  }

  function makeLimiterRes() {
    const res = makeRes();
    // express-rate-limit sets informational headers; absorb them.
    res.setHeader = jest.fn();
    res.getHeader = jest.fn();
    res.set = jest.fn(() => res);
    res.append = jest.fn(() => res);
    return res;
  }

  /** Run the limiter once and resolve after next()/response settles. */
  function runLimiter(req) {
    return new Promise((resolve) => {
      const res = makeLimiterRes();
      const next = jest.fn(() => resolve({ res, next }));
      // If the limit is hit the handler responds (no next); detect via json spy.
      const origJson = res.json;
      res.json = jest.fn((payload) => {
        origJson(payload);
        resolve({ res, next });
        return res;
      });
      authRateLimiter(req, res, next);
      // Safety: if neither fired synchronously, resolve on next tick.
      setImmediate(() => resolve({ res, next }));
    });
  }

  test('exports an Express middleware function', () => {
    expect(typeof authRateLimiter).toBe('function');
    expect(authRateLimiter.length).toBeGreaterThanOrEqual(2);
  });

  test('allows requests up to the limit, then 429s with the standardized envelope', async () => {
    const ip = '203.0.113.42';
    const req = makeLimiterReq(ip);

    // First 5 requests from this ip should pass through to next().
    for (let i = 0; i < 5; i += 1) {
      const { res, next } = await runLimiter(req);
      expect(next).toHaveBeenCalled();
      expect(res.statusCode).not.toBe(429);
    }

    // The 6th request exceeds the 5-request window and is short-circuited.
    const { res, next } = await runLimiter(req);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(429);
    expect(res.body).toEqual({
      success: false,
      message: 'Too many requests, please try again later.',
    });
    expect(res.body).not.toHaveProperty('data');
  });
});

describe('rateLimiter — rateLimitError() factory (Requirement 14.3)', () => {
  test('returns a 429 RateLimitError with the default message', () => {
    const err = rateLimitError();
    expect(err).toBeInstanceOf(RateLimitError);
    expect(err.statusCode).toBe(429);
    expect(err.message).toBe('Too many requests, please try again later.');
  });

  test('honours a custom message', () => {
    const err = rateLimitError('slow down');
    expect(err).toBeInstanceOf(RateLimitError);
    expect(err.message).toBe('slow down');
  });
});
