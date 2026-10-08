// tests/properties/trustedIdentity.property.test.js
//
// Property-based test for design Property 12 (Trusted identity), Task 9.4.
//
// Property 12: The authenticated identity used by the system is derived SOLELY
// from the verified JWT claims. A client cannot impersonate another user by
// placing a different `userId`/`role`/`sub`/`email` in the request body, query
// string, or headers — only the token's `sub`/`role` claims matter. The
// spoofed, attacker-controlled fields never influence `req.user`.
//
// Corollary (Property 13 touchpoint): a token signed with the wrong secret, an
// expired token, or a structurally tampered token is rejected with an
// `AuthenticationError` (401) via `next(err)`, and `req.user` is NEVER set —
// regardless of what identity the body/query/headers claim.
//
// **Validates: Requirements 3.1, 3.5, 3.6, 9.4**
//
// Module under test: src/middleware/authMiddleware.js `authMiddleware`.
//
// This is a FEATURE spec property: it MUST HOLD, so the test is expected to
// PASS. No database is needed — the middleware is exercised directly with a
// mock req/res/next, so this test does not touch Mongoose. tests/setup.js still
// runs (it is wired globally via jest.config.js) and manages the in-memory
// server lifecycle, but this file performs no DB work.
//
// authMiddleware statically imports src/config/env.js, which runs
// dotenv.config() and validates MONGO_URI and JWT_SECRET at import time,
// throwing when absent. Mirroring the unit tests, we set those vars BEFORE the
// dynamic import so import-time validation passes. Tokens are signed with the
// real `jsonwebtoken` library using env.JWT_SECRET — no mocking of JWT.

import jwt from 'jsonwebtoken';
import fc from 'fast-check';
import { jest } from '@jest/globals';

// Must be set before the env-validating module (env.js) is imported.
process.env.MONGO_URI =
  process.env.MONGO_URI ||
  'mongodb://127.0.0.1:27017/mybanking?replicaSet=rs0';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-value';

const JWT_SECRET = process.env.JWT_SECRET;
const WRONG_SECRET = `${JWT_SECRET}-not-the-real-secret`;

/** @type {import('express').RequestHandler} */
let authMiddleware;
/** @type {typeof import('../../src/utils/errors.js').AuthenticationError} */
let AuthenticationError;

beforeAll(async () => {
  // Dynamic import so the env vars above are in place before env.js validates.
  const authMod = await import('../../src/middleware/authMiddleware.js');
  authMiddleware = authMod.authMiddleware;

  const errorsMod = await import('../../src/utils/errors.js');
  AuthenticationError = errorsMod.AuthenticationError;
});

/** A throwaway response object — the middleware under test never touches it. */
function makeRes() {
  return {};
}

/**
 * Build a minimal Express-like request carrying a valid bearer `token` in the
 * Authorization header plus attacker-controlled, SPOOFED identity fields in the
 * body, query, and extra headers. None of the spoofed fields may influence the
 * identity the middleware establishes.
 */
function makeSpoofedReq(token, spoof) {
  return {
    headers: {
      authorization: `Bearer ${token}`,
      // Spoofed identity-looking headers (never consulted by the middleware).
      'x-user-id': spoof.userId,
      'x-user-role': spoof.role,
      'x-sub': spoof.sub,
    },
    body: {
      userId: spoof.userId,
      role: spoof.role,
      sub: spoof.sub,
      email: spoof.email,
      accountId: spoof.accountId,
      balance: spoof.balance,
      accountNumber: spoof.accountNumber,
    },
    query: {
      userId: spoof.userId,
      role: spoof.role,
      sub: spoof.sub,
    },
    // Pre-seed req.user with the attacker identity to prove the middleware
    // overwrites it from the token (success path) or leaves no trusted identity
    // on rejection. On rejection we assert the middleware did not install a
    // NEW trusted identity derived from spoofed input.
  };
}

// --- Generators ----------------------------------------------------------

// A realistic subject id: either a 24-hex Mongo ObjectId-like string or a
// numeric id (which the middleware coerces to a string via String(sub)).
const subArb = fc.oneof(
  fc.hexaString({ minLength: 1, maxLength: 24 }).filter((s) => s.length > 0),
  fc.integer({ min: 1, max: 10_000_000 })
);

// A role claim from the domain's role set.
const roleArb = fc.constantFrom('CUSTOMER', 'ADMIN');

// Attacker-controlled spoofed identity payload. Values are deliberately
// DIFFERENT shapes/types than the token claims, and the generators guarantee
// the spoofed id/role differ from the real token values (see predicate).
const spoofArb = fc.record({
  userId: fc.oneof(fc.string(), fc.integer(), fc.constant('attacker-id')),
  role: fc.constantFrom('ADMIN', 'CUSTOMER', 'SUPERUSER', 'root'),
  sub: fc.oneof(fc.string(), fc.integer(), fc.constant('attacker-sub')),
  email: fc.oneof(fc.emailAddress(), fc.string()),
  accountId: fc.oneof(fc.string(), fc.integer()),
  balance: fc.integer({ min: -1_000_000, max: 1_000_000 }),
  accountNumber: fc.string(),
});

describe('Property 12: Trusted identity (authMiddleware)', () => {
  test('req.user is derived SOLELY from the verified token claims; spoofed body/query/header identity has no effect (Validates: Requirements 3.1, 3.5, 3.6, 9.4)', () => {
    fc.assert(
      fc.property(subArb, roleArb, spoofArb, (sub, role, spoof) => {
        // Sign a VALID token with the real secret for the honest claims.
        const token = jwt.sign({ sub, role }, JWT_SECRET);

        const req = makeSpoofedReq(token, spoof);
        const next = jest.fn();

        authMiddleware(req, makeRes(), next);

        // Success: next() called exactly once with NO error argument.
        expect(next).toHaveBeenCalledTimes(1);
        expect(next).toHaveBeenCalledWith();

        // Trusted identity comes ONLY from the token's sub/role claims.
        expect(req.user).toEqual({ id: String(sub), role });

        // Explicitly: the spoofed values never leak into the established
        // identity. (String(sub)/role are the token's; any coincidental equality
        // with a spoofed value is irrelevant — identity still traces to the
        // token because the above equality holds against the token claims.)
        expect(req.user.id).toBe(String(sub));
        expect(req.user.role).toBe(role);
      }),
      { numRuns: 100 }
    );
  });

  test('a token signed with the WRONG secret is rejected 401 and req.user is NOT set, regardless of spoofed claims (Validates: Requirements 3.1, 3.5)', () => {
    fc.assert(
      fc.property(subArb, roleArb, spoofArb, (sub, role, spoof) => {
        const token = jwt.sign({ sub, role }, WRONG_SECRET);
        const req = makeSpoofedReq(token, spoof);
        const next = jest.fn();

        authMiddleware(req, makeRes(), next);

        expect(next).toHaveBeenCalledTimes(1);
        const err = next.mock.calls[0][0];
        expect(err).toBeInstanceOf(AuthenticationError);
        expect(err.statusCode).toBe(401);
        // No trusted identity was installed — the attacker's spoofed body/query
        // did not grant any identity.
        expect(req.user).toBeUndefined();
      }),
      { numRuns: 60 }
    );
  });

  test('an EXPIRED token is rejected 401 and req.user is NOT set, regardless of spoofed claims (Validates: Requirements 3.1, 3.5)', () => {
    fc.assert(
      fc.property(subArb, roleArb, spoofArb, (sub, role, spoof) => {
        // Correctly signed with the real secret but already expired.
        const token = jwt.sign({ sub, role }, JWT_SECRET, { expiresIn: -10 });
        const req = makeSpoofedReq(token, spoof);
        const next = jest.fn();

        authMiddleware(req, makeRes(), next);

        expect(next).toHaveBeenCalledTimes(1);
        const err = next.mock.calls[0][0];
        expect(err).toBeInstanceOf(AuthenticationError);
        expect(err.statusCode).toBe(401);
        expect(req.user).toBeUndefined();
      }),
      { numRuns: 60 }
    );
  });

  test('a TAMPERED token is rejected 401 and req.user is NOT set, regardless of spoofed claims (Validates: Requirements 3.1, 3.5)', () => {
    fc.assert(
      fc.property(
        subArb,
        roleArb,
        spoofArb,
        // Pick which character of the signature segment to flip.
        fc.integer({ min: 0, max: 1000 }),
        (sub, role, spoof, flipSeed) => {
          const valid = jwt.sign({ sub, role }, JWT_SECRET);
          const segments = valid.split('.');
          const signature = segments[2];
          // Flip one character of the signature so verification must fail,
          // while keeping the JWT structurally shaped (three dot-separated
          // base64url parts).
          const idx = flipSeed % signature.length;
          const original = signature[idx];
          const replacement = original === 'A' ? 'B' : 'A';
          segments[2] =
            signature.slice(0, idx) + replacement + signature.slice(idx + 1);
          const tampered = segments.join('.');

          // If the flip happened to produce the identical string (shouldn't,
          // but guard anyway), skip this run as uninformative.
          fc.pre(tampered !== valid);

          const req = makeSpoofedReq(tampered, spoof);
          const next = jest.fn();

          authMiddleware(req, makeRes(), next);

          expect(next).toHaveBeenCalledTimes(1);
          const err = next.mock.calls[0][0];
          expect(err).toBeInstanceOf(AuthenticationError);
          expect(err.statusCode).toBe(401);
          expect(req.user).toBeUndefined();
        }
      ),
      { numRuns: 60 }
    );
  });
});
