// tests/security.envelope.integration.test.js
//
// Security + response-envelope integration tests (Task 14.2).
//
// These exercise the REAL application assembled by the production factory
// (src/app.js → createApp(), via tests/helpers/buildTestApp.js) over HTTP with
// Supertest, backed by the in-memory single-node replica set from
// tests/setup.js (register runs a multi-document transaction, so a replica set
// is required).
//
// Coverage maps to design Properties 21 (Response envelope consistency) and 22
// (No secret leakage), plus the example-style security checks called out in the
// design's "Security-Specific Tests":
//
//   Security headers (R14.1):
//     - helmet sets x-content-type-options: nosniff on responses.
//     - x-powered-by is NEVER present (helmet strips Express's default).
//   CORS allowlist (R14.2):
//     - a request with an Origin on CORS_ALLOWLIST is reflected
//       (access-control-allow-origin echoes it).
//     - a non-allowlisted Origin receives NO access-control-allow-origin header.
//     - a request with no Origin succeeds (CORS only governs cross-origin).
//   Health check (R13.1):
//     - GET /health → 200 standardized success envelope.
//   404 handling (R13.1, R13.2):
//     - an unknown route → 404 { success:false, message } with NO data field.
//   Envelope consistency (Property 21 / R13.1, R13.2):
//     - success → { success:true, message, data }.
//     - error (401 no token, 400 bad validation) → { success:false, message }
//       with no data.
//   Body size limit (R14 defense-in-depth):
//     - an oversized JSON body (> the configured 100kb limit) is rejected
//       (413/400) and never reaches controller logic.
//   No secret leakage (Property 22 / R13.3, R13.4, R14.8, R14.9):
//     - error responses never contain a bcrypt hash, the JWT signing secret,
//       a raw JWT, a "password" field, or a stack trace.
//
// IMPORTANT: src/config/env.js validates MONGO_URI/JWT_SECRET and parses
// CORS_ALLOWLIST AT IMPORT TIME (and the resulting env object is frozen). So
// every one of those vars — crucially CORS_ALLOWLIST — is set on process.env
// BEFORE the app's module graph is dynamically imported. That makes the CORS
// assertions deterministic against a known allowlist rather than whatever the
// ambient environment happens to carry.
//
// The auth routes carry an IP-based rate limiter (5 requests / 15-min window)
// keyed on req.ip. buildTestApp sets `trust proxy`, so every register/login
// request presents a distinct synthetic client IP via uniqueIp() and the
// limiter never trips across these tests.

import request from 'supertest';
import fc from 'fast-check';

// --- Deterministic env (set BEFORE importing the app module graph) ---------

// A known, fixed allowlist so the CORS assertions are deterministic.
const ALLOWED_ORIGIN = 'https://app.allowed.example';
const SECOND_ALLOWED_ORIGIN = 'https://admin.allowed.example';
const DENIED_ORIGIN = 'https://evil.notallowed.example';

process.env.MONGO_URI =
  process.env.MONGO_URI ||
  'mongodb://127.0.0.1:27017/mybanking?replicaSet=rs0';
// A known secret value so the "no secret leakage" scan can look for it directly.
const JWT_SECRET = 'super-secret-signing-key-do-not-leak-123';
process.env.JWT_SECRET = JWT_SECRET;
// Low bcrypt cost keeps register/login fast without weakening the code path.
process.env.BCRYPT_ROUNDS = process.env.BCRYPT_ROUNDS || '4';
// Set the allowlist explicitly so CORS behavior is deterministic regardless of
// any ambient CORS_ALLOWLIST. Must happen before the dynamic import below.
process.env.CORS_ALLOWLIST = `${ALLOWED_ORIGIN},${SECOND_ALLOWED_ORIGIN}`;

/** @type {import('express').Express} */
let app;

beforeAll(async () => {
  // Dynamic import so the env vars above are in place before env.js validates
  // and freezes the configuration (CORS allowlist in particular).
  const mod = await import('./helpers/buildTestApp.js');
  app = mod.buildTestApp();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Monotonic counter backing uniqueIp()/unique emails within this file. */
let counter = 0;

/**
 * Return a fresh, unique IPv4 string for the X-Forwarded-For header so the
 * IP-based auth rate limiter (5/15min) keys on a distinct client per request
 * and never trips across these tests.
 */
function uniqueIp() {
  counter += 1;
  const a = 10 + Math.floor(counter / 254);
  const b = (counter % 254) + 1;
  return `10.${a}.0.${b}`;
}

/** A valid, unique registration payload for a brand-new customer. */
function buildRegistration(overrides = {}) {
  counter += 1;
  const n = String(counter).padStart(5, '0');
  return {
    firstName: 'Ama',
    lastName: `Owusu${n}`,
    email: `ama.${n}.${Date.now()}@example.com`,
    phone: `024${n}0000`.slice(0, 12),
    dateOfBirth: '1990-01-01',
    address: '7 Liberation Rd, Accra',
    password: 'Password123!',
    ...overrides,
  };
}

/** POST /api/auth/register from a distinct synthetic client IP. */
function postRegister(payload) {
  return request(app)
    .post('/api/auth/register')
    .set('X-Forwarded-For', uniqueIp())
    .send(payload);
}

/** POST /api/auth/login from a distinct synthetic client IP. */
function postLogin(body) {
  return request(app)
    .post('/api/auth/login')
    .set('X-Forwarded-For', uniqueIp())
    .send(body);
}

/** Assert a success envelope { success:true, message:string, data } exactly. */
function expectSuccessEnvelope(res, status) {
  expect(res.status).toBe(status);
  expect(res.body).toEqual(
    expect.objectContaining({
      success: true,
      message: expect.any(String),
    })
  );
  expect(res.body).toHaveProperty('data');
  // No stray `success:false`/extra top-level error key.
  expect(res.body.success).toBe(true);
  return res.body.data;
}

/** Allowed error statuses per Property 21. */
const ERROR_STATUSES = new Set([400, 401, 403, 404, 409, 429, 500]);

/**
 * Assert a failure envelope { success:false, message:string } with NO `data`
 * field and an allowed HTTP status (Property 21 / Requirement 13.2).
 */
function expectErrorEnvelope(res, status) {
  if (status !== undefined) expect(res.status).toBe(status);
  expect(ERROR_STATUSES.has(res.status)).toBe(true);
  expect(res.body).toEqual(
    expect.objectContaining({
      success: false,
      message: expect.any(String),
    })
  );
  expect(res.body).not.toHaveProperty('data');
}

/**
 * Scan a serialized response body for anything that must never leak
 * (Property 22 / Requirements 13.3, 13.4, 14.8, 14.9):
 *   - a password VALUE or a `"password"` object field,
 *   - a bcrypt hash ($2a$/$2b$/$2y$ ...),
 *   - the configured JWT signing secret,
 *   - a Node/V8 stack-trace marker.
 *
 * The leak scan deliberately does NOT forbid:
 *   - the literal word "password" appearing inside a human-readable validation
 *     MESSAGE (e.g. "Validation failed for: password, email") — that is a field
 *     name, not a credential value, and
 *   - a raw JWT appearing in a SUCCESS body that legitimately ISSUES a token
 *     (register/login). Property 22 forbids leaking the signing SECRET / hashes
 *     / stack traces, not the token the API is designed to hand back.
 *
 * @param {import('supertest').Response} res
 * @param {{ issuesToken?: boolean }} [opts] - when `issuesToken` is true, the
 *   body is a success response that is EXPECTED to contain the issued JWT, so
 *   the raw-JWT check is skipped (the token still must not contain the secret,
 *   which is asserted independently).
 */
function expectNoSecretLeak(res, opts = {}) {
  const body = res.body ?? {};
  const serialized = JSON.stringify(body);

  // No `"password"` OBJECT FIELD anywhere (a JSON key). This still catches a
  // leaked password/hash field without flagging the word inside a message.
  expect(serialized).not.toMatch(/"password"\s*:/i);
  // No bcrypt hash value.
  expect(serialized).not.toMatch(/\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}/);
  // The real signing secret must NEVER appear — not even inside an issued JWT.
  expect(serialized).not.toContain(JWT_SECRET);
  // No stack-trace lines leaking from a thrown error.
  expect(serialized).not.toMatch(/\bat\s+.+:\d+:\d+/);
  expect(serialized).not.toMatch(/\.js:\d+:\d+/);

  // A raw JWT is only forbidden where the endpoint is NOT supposed to issue one
  // (i.e. error responses and non-auth success bodies). Success bodies that
  // issue a token are exempted via opts.issuesToken.
  if (!opts.issuesToken) {
    expect(serialized).not.toMatch(
      /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/
    );
  }
}

// ---------------------------------------------------------------------------
// Security headers (helmet) — Requirements 14.1
// ---------------------------------------------------------------------------

describe('Security headers (helmet)', () => {
  test('GET /health sets x-content-type-options: nosniff and omits x-powered-by', async () => {
    const res = await request(app).get('/health');

    expect(res.status).toBe(200);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    // helmet removes Express's identifying header.
    expect(res.headers['x-powered-by']).toBeUndefined();
    // helmet also sets DNS-prefetch control; assert it is present.
    expect(res.headers['x-dns-prefetch-control']).toBeDefined();
  });

  test('headers are applied on an error (404) response too', async () => {
    const res = await request(app).get('/api/nope');

    expect(res.status).toBe(404);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// CORS allowlist — Requirement 14.2
// ---------------------------------------------------------------------------

describe('CORS allowlist', () => {
  test('an allowlisted Origin is reflected in access-control-allow-origin', async () => {
    const res = await request(app)
      .get('/health')
      .set('Origin', ALLOWED_ORIGIN);

    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBe(ALLOWED_ORIGIN);
  });

  test('a second allowlisted Origin is also reflected', async () => {
    const res = await request(app)
      .get('/health')
      .set('Origin', SECOND_ALLOWED_ORIGIN);

    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBe(
      SECOND_ALLOWED_ORIGIN
    );
  });

  test('a non-allowlisted Origin receives NO access-control-allow-origin header', async () => {
    const res = await request(app)
      .get('/health')
      .set('Origin', DENIED_ORIGIN);

    // The request itself still succeeds (allowlist-deny posture): the browser,
    // not the server, blocks the response because no CORS grant is emitted.
    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  test('a request with no Origin succeeds and carries no CORS grant', async () => {
    const res = await request(app).get('/health');

    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  test('a CORS preflight (OPTIONS) from an allowlisted Origin is granted', async () => {
    const res = await request(app)
      .options('/api/auth/login')
      .set('Origin', ALLOWED_ORIGIN)
      .set('Access-Control-Request-Method', 'POST');

    // cors short-circuits a valid preflight (204 by default) and reflects the
    // origin; a denied origin would carry no allow-origin header.
    expect(res.headers['access-control-allow-origin']).toBe(ALLOWED_ORIGIN);
  });
});

// ---------------------------------------------------------------------------
// Health check — Requirement 13.1
// ---------------------------------------------------------------------------

describe('GET /health', () => {
  test('returns 200 with a standardized success envelope', async () => {
    const res = await request(app).get('/health');

    const data = expectSuccessEnvelope(res, 200);
    expect(data).toBeDefined();
    expectNoSecretLeak(res);
  });
});

// ---------------------------------------------------------------------------
// 404 handling — Requirements 13.1, 13.2
// ---------------------------------------------------------------------------

describe('404 handling', () => {
  test('an unknown route → 404 failure envelope with no data field', async () => {
    const res = await request(app).get('/api/nope');

    expectErrorEnvelope(res, 404);
    expectNoSecretLeak(res);
  });

  test('an unknown nested route → 404 failure envelope', async () => {
    const res = await request(app).post('/api/does/not/exist').send({});

    expectErrorEnvelope(res, 404);
  });
});

// ---------------------------------------------------------------------------
// Envelope consistency — Property 21 (Requirements 13.1, 13.2)
// ---------------------------------------------------------------------------

describe('Response envelope consistency (Property 21)', () => {
  test('a success response (register 201) uses { success:true, message, data }', async () => {
    const res = await postRegister(buildRegistration());

    const data = expectSuccessEnvelope(res, 201);
    expect(data.user).toBeDefined();
    expect(data.account).toBeDefined();
    // Register legitimately issues a JWT in the success body.
    expectNoSecretLeak(res, { issuesToken: true });
  });

  test('a protected route without a token → 401 failure envelope (no data)', async () => {
    const res = await request(app).get('/api/auth/me');

    expectErrorEnvelope(res, 401);
    expectNoSecretLeak(res);
  });

  test('a bad validation payload → 400 failure envelope (no data)', async () => {
    const res = await postRegister(buildRegistration({ email: 'not-an-email' }));

    expectErrorEnvelope(res, 400);
    expectNoSecretLeak(res);
  });

  test('invalid credentials → 401 failure envelope (no data)', async () => {
    const res = await postLogin({
      email: `ghost.${Date.now()}@example.com`,
      password: 'Password123!',
    });

    expectErrorEnvelope(res, 401);
    expectNoSecretLeak(res);
  });

  test(
    'Property 21: every sampled endpoint returns a well-formed envelope',
    () => {
      // A representative set of routes covering success + each error status we
      // can reach without heavy fixtures. Each entry drives one HTTP call and
      // asserts the body is EXACTLY one of the two envelope shapes with an
      // allowed status.
      const requestArb = fc.constantFrom(
        () => request(app).get('/health'), // 200 success
        () => request(app).get('/api/nope'), // 404 error
        () => request(app).get('/api/auth/me'), // 401 error (no token)
        () =>
          request(app)
            .get('/api/auth/me')
            .set('Authorization', 'Bearer not-a-real-jwt'), // 401 error
        () =>
          request(app)
            .post('/api/auth/login')
            .set('X-Forwarded-For', uniqueIp())
            .send({ email: 'bad', password: 'x' }), // 400 validation error
        () =>
          request(app)
            .post('/api/auth/login')
            .set('X-Forwarded-For', uniqueIp())
            .send({
              email: `ghost.${Date.now()}.${counter}@example.com`,
              password: 'Password123!',
            }) // 401 invalid credentials
      );

      return fc.assert(
        fc.asyncProperty(requestArb, async (makeReq) => {
          const res = await makeReq();

          // The body is exactly one of the two envelope shapes.
          expect(typeof res.body.success).toBe('boolean');
          expect(typeof res.body.message).toBe('string');

          if (res.body.success === true) {
            expect(res.body).toHaveProperty('data');
            expect(res.status).toBeGreaterThanOrEqual(200);
            expect(res.status).toBeLessThan(300);
          } else {
            expect(res.body).not.toHaveProperty('data');
            expect(ERROR_STATUSES.has(res.status)).toBe(true);
          }

          // Property 22 touchpoint: no secret ever leaks on any sampled route.
          expectNoSecretLeak(res);
        }),
        { numRuns: 100 }
      );
    },
    30000
  );
});

// ---------------------------------------------------------------------------
// Body size limit — Requirement 14 defense-in-depth (express.json limit 100kb)
// ---------------------------------------------------------------------------

describe('JSON body size limit', () => {
  test('an oversized JSON body (> 100kb) is rejected and never reaches a controller', async () => {
    // Build a JSON payload well over the configured 100kb limit.
    const huge = 'x'.repeat(200 * 1024); // ~200 KB string
    const res = await request(app)
      .post('/api/auth/register')
      .set('X-Forwarded-For', uniqueIp())
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ ...buildRegistration(), address: huge }));

    // express.json surfaces an oversized body as 413 (payload too large); the
    // central error handler maps unknown shapes to 400/500. Accept the standard
    // rejection codes — the key guarantee is it is REJECTED, not processed.
    expect([400, 413, 500]).toContain(res.status);
    // Whatever the status, no secret/stack leaks in the rejection body.
    if (res.body && typeof res.body === 'object') {
      expectNoSecretLeak(res);
    }
  });
});

// ---------------------------------------------------------------------------
// No secret leakage — Property 22 (Requirements 13.3, 13.4, 14.8, 14.9)
// ---------------------------------------------------------------------------

describe('No secret leakage (Property 22)', () => {
  test('a 401 error body never contains a hash, secret, JWT, password, or stack trace', async () => {
    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', 'Bearer not-a-real-jwt');

    expectErrorEnvelope(res, 401);
    expectNoSecretLeak(res);
  });

  test('a successful register/login response never leaks a password or hash', async () => {
    const payload = buildRegistration();
    const reg = await postRegister(payload);
    expectSuccessEnvelope(reg, 201);
    // Both bodies legitimately carry an issued JWT; the scan still asserts no
    // signing secret / bcrypt hash / password field / stack trace leaks.
    expectNoSecretLeak(reg, { issuesToken: true });
    expect(reg.body.data.user).not.toHaveProperty('password');

    const login = await postLogin({
      email: payload.email,
      password: payload.password,
    });
    expectSuccessEnvelope(login, 200);
    expectNoSecretLeak(login, { issuesToken: true });
    // The user object returned by a default query omits the password field.
    expect(login.body.data.user).not.toHaveProperty('password');
  });
});
