// tests/middleware/authRole.middleware.test.js
//
// Unit tests for the authentication and role-based access control middleware,
// Task 5.7.
//
// Modules under test:
//   - src/middleware/authMiddleware.js  (authMiddleware)
//   - src/middleware/roleMiddleware.js  (requireRole, requireAdmin)
//
// What is covered (Property 12 "trusted identity", Property 13 "rejection",
// and RBAC — Requirements 3.1-3.6, 10.1, 12.2, 14):
//
//   authMiddleware
//     - a valid token populates req.user from the token claims ONLY and calls
//       next() with no error (Property 12);
//     - identity comes from the token even when the request body claims a
//       different id/role — the body is never consulted (Property 12);
//     - a missing Authorization header is rejected 401 (Property 13);
//     - a malformed header (no scheme, wrong scheme, missing token, extra
//       parts) is rejected 401 (Property 13);
//     - an invalid signature is rejected 401 with "Invalid token";
//     - an expired token is rejected 401 with "Token expired";
//     - a structurally valid token without a `sub` claim is rejected 401.
//
//   roleMiddleware
//     - an allowed role passes through (next() with no error);
//     - a disallowed role is rejected 403 (AuthorizationError);
//     - a missing req.user is rejected 401 (AuthenticationError);
//     - requireAdmin permits ADMIN and rejects CUSTOMER.
//
// Both middlewares establish/consult identity through `req.user` only; these
// tests use a plain mock req/res/next (next is a jest.fn) and assert on the
// error forwarded to next() — its instanceof type and its statusCode — rather
// than on any HTTP response, mirroring how the central errorMiddleware consumes
// these errors.
//
// authMiddleware statically imports src/config/env.js, which runs
// dotenv.config() and validates MONGO_URI and JWT_SECRET on import, throwing
// when absent. Mirroring tests/user.model.test.js, we set those vars BEFORE the
// dynamic import so import-time validation passes. Tokens are signed with the
// real `jsonwebtoken` library using the same secret — no mocking of JWT.

import jwt from 'jsonwebtoken';
import { jest } from '@jest/globals';

// Must be set before the env-validating module is imported.
process.env.MONGO_URI =
  process.env.MONGO_URI ||
  'mongodb://127.0.0.1:27017/mybanking?replicaSet=rs0';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-value';

const JWT_SECRET = process.env.JWT_SECRET;

/** @type {import('express').RequestHandler} */
let authMiddleware;
/** @type {(...roles: Array<string | string[]>) => import('express').RequestHandler} */
let requireRole;
/** @type {import('express').RequestHandler} */
let requireAdmin;
/** @type {typeof import('../../src/utils/errors.js').AuthenticationError} */
let AuthenticationError;
/** @type {typeof import('../../src/utils/errors.js').AuthorizationError} */
let AuthorizationError;

beforeAll(async () => {
  // Dynamic import so the env vars above are in place before env.js validates.
  const authMod = await import('../../src/middleware/authMiddleware.js');
  authMiddleware = authMod.authMiddleware;

  const roleMod = await import('../../src/middleware/roleMiddleware.js');
  requireRole = roleMod.requireRole;
  requireAdmin = roleMod.requireAdmin;

  const errorsMod = await import('../../src/utils/errors.js');
  AuthenticationError = errorsMod.AuthenticationError;
  AuthorizationError = errorsMod.AuthorizationError;
});

/**
 * Build a minimal Express-like request. `authorization` sets the header; any
 * extra fields (e.g. a spoofed body) are merged in.
 */
function makeReq({ authorization, ...rest } = {}) {
  const headers = {};
  if (typeof authorization !== 'undefined') {
    headers.authorization = authorization;
  }
  return { headers, ...rest };
}

/** A throwaway response object — the middleware under test never touches it. */
function makeRes() {
  return {};
}

/**
 * Sign a JWT with the shared test secret. `options` is forwarded to jwt.sign
 * (e.g. { expiresIn }). Pass claims like { sub, role }.
 */
function sign(claims, options = {}) {
  return jwt.sign(claims, JWT_SECRET, options);
}

describe('authMiddleware (Property 12 trusted identity, Property 13 rejection)', () => {
  describe('valid token', () => {
    test('populates req.user from the token claims and calls next() with no error', () => {
      const token = sign({ sub: 'user-123', role: 'CUSTOMER' });
      const req = makeReq({ authorization: `Bearer ${token}` });
      const next = jest.fn();

      authMiddleware(req, makeRes(), next);

      // next() called exactly once, with no error argument.
      expect(next).toHaveBeenCalledTimes(1);
      expect(next).toHaveBeenCalledWith();
      // Trusted identity derived solely from the verified claims.
      expect(req.user).toEqual({ id: 'user-123', role: 'CUSTOMER' });
    });

    test('coerces a numeric sub claim to a string id', () => {
      const token = sign({ sub: 42, role: 'ADMIN' });
      const req = makeReq({ authorization: `Bearer ${token}` });
      const next = jest.fn();

      authMiddleware(req, makeRes(), next);

      expect(next).toHaveBeenCalledWith();
      expect(req.user).toEqual({ id: '42', role: 'ADMIN' });
    });

    test('accepts a case-insensitive "bearer" scheme', () => {
      const token = sign({ sub: 'u1', role: 'CUSTOMER' });
      const req = makeReq({ authorization: `bearer ${token}` });
      const next = jest.fn();

      authMiddleware(req, makeRes(), next);

      expect(next).toHaveBeenCalledWith();
      expect(req.user).toEqual({ id: 'u1', role: 'CUSTOMER' });
    });

    test('identity comes ONLY from the token, not the request body (Property 12)', () => {
      // The token says one identity; the body tries to claim another.
      const token = sign({ sub: 'real-owner', role: 'CUSTOMER' });
      const req = makeReq({
        authorization: `Bearer ${token}`,
        body: { userId: 'attacker', role: 'ADMIN', sub: 'attacker' },
        user: { id: 'attacker', role: 'ADMIN' }, // pre-seeded, must be overwritten
      });
      const next = jest.fn();

      authMiddleware(req, makeRes(), next);

      expect(next).toHaveBeenCalledWith();
      // The spoofed body/role is ignored; identity is the token's.
      expect(req.user).toEqual({ id: 'real-owner', role: 'CUSTOMER' });
    });
  });

  describe('rejection (Property 13)', () => {
    /**
     * Assert that next() was called once with an AuthenticationError (401)
     * carrying the expected message, and that no identity was set.
     */
    function expectAuthFailure(req, next, message) {
      expect(next).toHaveBeenCalledTimes(1);
      const err = next.mock.calls[0][0];
      expect(err).toBeInstanceOf(AuthenticationError);
      expect(err.statusCode).toBe(401);
      if (message) {
        expect(err.message).toBe(message);
      }
      expect(req.user).toBeUndefined();
    }

    test('rejects a missing Authorization header with 401', () => {
      const req = makeReq(); // no authorization header
      const next = jest.fn();

      authMiddleware(req, makeRes(), next);

      expectAuthFailure(req, next, 'Authentication required');
    });

    test('rejects an empty Authorization header with 401', () => {
      const req = makeReq({ authorization: '' });
      const next = jest.fn();

      authMiddleware(req, makeRes(), next);

      expectAuthFailure(req, next, 'Authentication required');
    });

    const malformedHeaders = [
      ['no scheme (bare token)', 'abc.def.ghi'],
      ['wrong scheme', 'Basic abc.def.ghi'],
      ['token scheme', 'Token abc.def.ghi'],
      ['scheme only, no token', 'Bearer'],
      ['scheme with trailing space only', 'Bearer '],
      ['extra parts', 'Bearer abc def'],
    ];

    test.each(malformedHeaders)(
      'rejects a malformed header (%s) with 401',
      (_label, headerValue) => {
        const req = makeReq({ authorization: headerValue });
        const next = jest.fn();

        authMiddleware(req, makeRes(), next);

        expectAuthFailure(req, next, 'Authentication required');
      }
    );

    test('rejects an invalid signature with 401 "Invalid token"', () => {
      // Signed with a different secret → signature verification fails.
      const token = jwt.sign({ sub: 'u1', role: 'CUSTOMER' }, 'a-different-secret');
      const req = makeReq({ authorization: `Bearer ${token}` });
      const next = jest.fn();

      authMiddleware(req, makeRes(), next);

      expectAuthFailure(req, next, 'Invalid token');
    });

    test('rejects a garbage (non-JWT) token with 401 "Invalid token"', () => {
      const req = makeReq({ authorization: 'Bearer not-a-real-jwt' });
      const next = jest.fn();

      authMiddleware(req, makeRes(), next);

      expectAuthFailure(req, next, 'Invalid token');
    });

    test('rejects an expired token with 401 "Token expired"', () => {
      // Issued in the past and already expired (expiresIn negative seconds).
      const token = sign({ sub: 'u1', role: 'CUSTOMER' }, { expiresIn: -10 });
      const req = makeReq({ authorization: `Bearer ${token}` });
      const next = jest.fn();

      authMiddleware(req, makeRes(), next);

      expectAuthFailure(req, next, 'Token expired');
    });

    test('rejects a verified token that is missing its sub claim with 401', () => {
      // Structurally valid, correctly signed, but carries no subject.
      const token = sign({ role: 'ADMIN' });
      const req = makeReq({ authorization: `Bearer ${token}` });
      const next = jest.fn();

      authMiddleware(req, makeRes(), next);

      expectAuthFailure(req, next, 'Invalid token');
    });

    test('rejects a token whose sub claim is empty with 401', () => {
      const token = sign({ sub: '', role: 'CUSTOMER' });
      const req = makeReq({ authorization: `Bearer ${token}` });
      const next = jest.fn();

      authMiddleware(req, makeRes(), next);

      expectAuthFailure(req, next, 'Invalid token');
    });
  });
});

describe('roleMiddleware (RBAC — requireRole / requireAdmin)', () => {
  describe('requireRole', () => {
    test('passes through when the user has an allowed role', () => {
      const guard = requireRole('CUSTOMER', 'ADMIN');
      const req = { user: { id: 'u1', role: 'CUSTOMER' } };
      const next = jest.fn();

      guard(req, makeRes(), next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(next).toHaveBeenCalledWith();
    });

    test('accepts a single array of roles', () => {
      const guard = requireRole(['ADMIN', 'CUSTOMER']);
      const req = { user: { id: 'u1', role: 'ADMIN' } };
      const next = jest.fn();

      guard(req, makeRes(), next);

      expect(next).toHaveBeenCalledWith();
    });

    test('rejects a disallowed role with 403 (AuthorizationError)', () => {
      const guard = requireRole('ADMIN');
      const req = { user: { id: 'u1', role: 'CUSTOMER' } };
      const next = jest.fn();

      guard(req, makeRes(), next);

      expect(next).toHaveBeenCalledTimes(1);
      const err = next.mock.calls[0][0];
      expect(err).toBeInstanceOf(AuthorizationError);
      expect(err.statusCode).toBe(403);
    });

    test('rejects a missing req.user with 401 (AuthenticationError)', () => {
      const guard = requireRole('CUSTOMER');
      const req = {}; // auth middleware did not run
      const next = jest.fn();

      guard(req, makeRes(), next);

      expect(next).toHaveBeenCalledTimes(1);
      const err = next.mock.calls[0][0];
      expect(err).toBeInstanceOf(AuthenticationError);
      expect(err.statusCode).toBe(401);
    });

    test('rejects a req.user without a role with 401 (AuthenticationError)', () => {
      const guard = requireRole('CUSTOMER');
      const req = { user: { id: 'u1' } }; // no role
      const next = jest.fn();

      guard(req, makeRes(), next);

      expect(next).toHaveBeenCalledTimes(1);
      const err = next.mock.calls[0][0];
      expect(err).toBeInstanceOf(AuthenticationError);
      expect(err.statusCode).toBe(401);
    });

    test('throws at wiring time when called with no roles', () => {
      expect(() => requireRole()).toThrow();
    });
  });

  describe('requireAdmin', () => {
    test('permits an ADMIN user', () => {
      const req = { user: { id: 'admin-1', role: 'ADMIN' } };
      const next = jest.fn();

      requireAdmin(req, makeRes(), next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(next).toHaveBeenCalledWith();
    });

    test('rejects a CUSTOMER user with 403', () => {
      const req = { user: { id: 'u1', role: 'CUSTOMER' } };
      const next = jest.fn();

      requireAdmin(req, makeRes(), next);

      expect(next).toHaveBeenCalledTimes(1);
      const err = next.mock.calls[0][0];
      expect(err).toBeInstanceOf(AuthorizationError);
      expect(err.statusCode).toBe(403);
    });

    test('rejects a missing req.user with 401', () => {
      const req = {};
      const next = jest.fn();

      requireAdmin(req, makeRes(), next);

      expect(next).toHaveBeenCalledTimes(1);
      const err = next.mock.calls[0][0];
      expect(err).toBeInstanceOf(AuthenticationError);
      expect(err.statusCode).toBe(401);
    });
  });
});
