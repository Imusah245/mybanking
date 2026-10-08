// tests/auth.flow.integration.test.js
//
// End-to-end integration tests for the authentication flow (Task 9.3).
//
// These exercise the REAL auth router (register/login/me, rate limiter +
// per-email login throttle + express-validator chains + the JWT auth
// middleware + the central error handler) assembled by
// tests/helpers/buildTestApp.js, driven over HTTP with Supertest and backed by
// the in-memory single-node replica set from tests/setup.js (register runs a
// multi-document transaction, so a replica set is required).
//
// Coverage:
//   POST /api/auth/register
//     - valid body        → 201 { success:true, message, data:{ user, account, token } }
//                           password/hash NEVER present; accountNumber ^\d{10}$;
//                           balance 0; token is a string.
//     - duplicate email   → 409 failure envelope.
//     - invalid bodies    → 400 (bad email, short password, underage dob,
//                           missing fields).
//   POST /api/auth/login
//     - correct creds     → 200 with token.
//     - wrong password    → 401 generic message.
//     - unknown email     → 401 same generic message (no user enumeration).
//   GET /api/auth/me
//     - Bearer token      → 200 profile + account.
//     - no token          → 401.
//     - garbage token     → 401.
//
// Every assertion checks BOTH the HTTP status AND the standardized envelope
// (Requirement 13.2): success → { success:true, message, data }; failure →
// { success:false, message } with NO `data` field.
//
// `src/config/env.js` validates MONGO_URI/JWT_SECRET (and BCRYPT_ROUNDS) at
// import time, so those vars are set BEFORE the app's router graph is
// dynamically imported — matching tests/account.profile.integration.test.js.
//
// The auth routes carry an IP-based rate limiter (5 requests / 15-min window)
// keyed on req.ip. buildTestApp sets `trust proxy`, so every register/login
// request below presents a distinct synthetic client IP via `uniqueIp()` and
// the limiter never trips across these tests.

import request from 'supertest';

// Must be set before importing any module that transitively imports env.js.
process.env.MONGO_URI =
  process.env.MONGO_URI ||
  'mongodb://127.0.0.1:27017/mybanking?replicaSet=rs0';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-value';
// A low bcrypt cost keeps register/login fast without weakening the code path.
process.env.BCRYPT_ROUNDS = process.env.BCRYPT_ROUNDS || '4';

/** @type {import('express').Express} */
let app;

beforeAll(async () => {
  const mod = await import('./helpers/buildTestApp.js');
  app = mod.buildTestApp();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Monotonic counter backing uniqueIp()/unique emails within this file. */
let counter = 0;

/**
 * Return a fresh, unique IPv4 string for the X-Forwarded-For header. The app
 * trusts one proxy hop, so the IP-based auth rate limiter keys on this value —
 * a distinct IP per register/login keeps every request under the per-IP limit.
 */
function uniqueIp() {
  counter += 1;
  const a = 10 + Math.floor(counter / 254);
  const b = (counter % 254) + 1;
  return `10.${a}.0.${b}`;
}

/**
 * A valid registration payload for a brand-new customer. Every call produces a
 * distinct email/phone so repeated registrations never collide on the unique
 * email index. The password is within 8–128 chars and the dateOfBirth implies
 * an age well over 18.
 */
function buildRegistration(overrides = {}) {
  counter += 1;
  const n = String(counter).padStart(5, '0');
  return {
    firstName: 'Kofi',
    lastName: `Mensah${n}`,
    email: `kofi.${n}.${Date.now()}@example.com`,
    phone: `024${n}0000`.slice(0, 12),
    dateOfBirth: '1990-01-01',
    address: '12 Independence Ave, Accra',
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

/** Authorization header value for a bearer token. */
function bearer(token) {
  return `Bearer ${token}`;
}

/**
 * Assert a success envelope { success:true, message:string, data } and return
 * res.body.data.
 */
function expectSuccessEnvelope(res, status) {
  expect(res.status).toBe(status);
  expect(res.body).toEqual(
    expect.objectContaining({
      success: true,
      message: expect.any(String),
    })
  );
  expect(res.body).toHaveProperty('data');
  return res.body.data;
}

/**
 * Assert a failure envelope { success:false, message:string } with NO data
 * field (Requirement 13.2).
 */
function expectErrorEnvelope(res, status) {
  expect(res.status).toBe(status);
  expect(res.body).toEqual(
    expect.objectContaining({
      success: false,
      message: expect.any(String),
    })
  );
  expect(res.body).not.toHaveProperty('data');
}

/** Assert no password/hash is present anywhere in the serialized response. */
function expectNoPasswordLeak(res) {
  const serialized = JSON.stringify(res.body);
  expect(serialized).not.toMatch(/password/i);
  // No bcrypt hash prefix ($2a$/$2b$/$2y$) leaks either.
  expect(serialized).not.toMatch(/\$2[aby]\$/);
}

// ---------------------------------------------------------------------------
// POST /api/auth/register
// ---------------------------------------------------------------------------

describe('POST /api/auth/register', () => {
  test('valid body → 201 with { user, account, token }, no password leak', async () => {
    const payload = buildRegistration();

    const res = await postRegister(payload);
    const data = expectSuccessEnvelope(res, 201);

    // User echoed back without any secret material.
    expect(data.user).toBeDefined();
    expect(data.user.email).toBe(payload.email);
    expect(data.user.firstName).toBe(payload.firstName);
    expect(data.user.lastName).toBe(payload.lastName);
    expect(data.user.role).toBe('CUSTOMER');
    expect(data.user).not.toHaveProperty('password');

    // Exactly one linked account: 10-digit number, zero integer balance.
    expect(data.account).toBeDefined();
    expect(data.account.accountNumber).toMatch(/^\d{10}$/);
    expect(data.account.balance).toBe(0);
    expect(Number.isInteger(data.account.balance)).toBe(true);

    // A signed token string is issued.
    expect(data.token).toEqual(expect.any(String));
    expect(data.token.length).toBeGreaterThan(0);

    // The password hash must never appear anywhere in the response body.
    expectNoPasswordLeak(res);
  });

  test('duplicate email → 409', async () => {
    const payload = buildRegistration();

    const first = await postRegister(payload);
    expectSuccessEnvelope(first, 201);

    // Register again with the SAME email (fresh IP so the limiter is not the
    // thing rejecting us). Email is normalized/lowercased, so reuse it as-is.
    const second = await postRegister({
      ...buildRegistration(),
      email: payload.email,
    });
    expectErrorEnvelope(second, 409);
  });

  test('invalid email format → 400', async () => {
    const res = await postRegister(buildRegistration({ email: 'not-an-email' }));
    expectErrorEnvelope(res, 400);
  });

  test('password too short → 400', async () => {
    const res = await postRegister(buildRegistration({ password: 'short' }));
    expectErrorEnvelope(res, 400);
  });

  test('underage date of birth → 400', async () => {
    // A date of birth two years ago implies an age well under the 18 minimum.
    const twoYearsAgo = new Date();
    twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2);
    const dob = twoYearsAgo.toISOString().slice(0, 10);

    const res = await postRegister(buildRegistration({ dateOfBirth: dob }));
    expectErrorEnvelope(res, 400);
  });

  test('missing required fields → 400', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .set('X-Forwarded-For', uniqueIp())
      .send({ email: 'someone@example.com' });
    expectErrorEnvelope(res, 400);
  });
});

// ---------------------------------------------------------------------------
// POST /api/auth/login
// ---------------------------------------------------------------------------

describe('POST /api/auth/login', () => {
  test('correct credentials → 200 with token', async () => {
    const payload = buildRegistration();
    expectSuccessEnvelope(await postRegister(payload), 201);

    const res = await postLogin({
      email: payload.email,
      password: payload.password,
    });
    const data = expectSuccessEnvelope(res, 200);

    expect(data.token).toEqual(expect.any(String));
    expect(data.user.email).toBe(payload.email);
    expect(data.user).not.toHaveProperty('password');
    expectNoPasswordLeak(res);
  });

  test('wrong password → 401 (generic message)', async () => {
    const payload = buildRegistration();
    expectSuccessEnvelope(await postRegister(payload), 201);

    const res = await postLogin({
      email: payload.email,
      password: 'WrongPassword123!',
    });
    expectErrorEnvelope(res, 401);
  });

  test('unknown email → 401 with the SAME generic message as a wrong password', async () => {
    // Register a user so we have a known-good password to contrast against.
    const known = buildRegistration();
    expectSuccessEnvelope(await postRegister(known), 201);

    // Wrong password for an EXISTING user.
    const wrongPwRes = await postLogin({
      email: known.email,
      password: 'WrongPassword123!',
    });
    expectErrorEnvelope(wrongPwRes, 401);

    // UNKNOWN email entirely.
    const unknownRes = await postLogin({
      email: `nobody.${counter}.${Date.now()}@example.com`,
      password: 'Password123!',
    });
    expectErrorEnvelope(unknownRes, 401);

    // User enumeration is prevented: both failures yield an identical message
    // (Requirement 2.2).
    expect(unknownRes.body.message).toBe(wrongPwRes.body.message);
  });
});

// ---------------------------------------------------------------------------
// GET /api/auth/me
// ---------------------------------------------------------------------------

describe('GET /api/auth/me', () => {
  test('with a Bearer token → 200 profile + account', async () => {
    const payload = buildRegistration();
    const registerData = expectSuccessEnvelope(await postRegister(payload), 201);

    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', bearer(registerData.token));
    const data = expectSuccessEnvelope(res, 200);

    // Profile belongs to the token holder.
    expect(data.user.email).toBe(payload.email);
    expect(data.user).not.toHaveProperty('password');
    // Account overview is returned alongside the profile.
    expect(data.account).toBeDefined();
    expect(data.account.accountNumber).toBe(registerData.account.accountNumber);
    expect(data.account.balance).toBe(0);
    expectNoPasswordLeak(res);
  });

  test('without a token → 401', async () => {
    const res = await request(app).get('/api/auth/me');
    expectErrorEnvelope(res, 401);
  });

  test('with a garbage token → 401', async () => {
    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', bearer('not-a-real-jwt'));
    expectErrorEnvelope(res, 401);
  });
});
