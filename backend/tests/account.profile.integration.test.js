// tests/account.profile.integration.test.js
//
// Integration tests for the account and profile endpoints (Task 10.3):
//   GET  /api/accounts/me   — account overview
//   GET  /api/users/me      — safe profile (never includes password)
//   PUT  /api/users/me       — update ONLY phone/address; ignore protected fields
//
// These exercise the REAL routers assembled by tests/helpers/buildTestApp.js
// (authRoutes to obtain tokens, userRoutes, accountRoutes, + errorMiddleware)
// against Supertest, backed by the in-memory replica set from tests/setup.js.
//
// Requirements covered: 4.3, 4.4, 9.1, 9.2, 9.3, 9.4, 9.5.
//
// `src/config/env.js` validates MONGO_URI/JWT_SECRET at import time, so those
// vars are set BEFORE the app (and its router graph) is dynamically imported,
// mirroring the pattern in tests/middleware/authRole.middleware.test.js.

import request from 'supertest';

// Must be set before any env-validating module is imported.
process.env.MONGO_URI =
  process.env.MONGO_URI ||
  'mongodb://127.0.0.1:27017/mybanking?replicaSet=rs0';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-value';

/** @type {import('express').Express} */
let app;

beforeAll(async () => {
  const mod = await import('./helpers/buildTestApp.js');
  app = mod.buildTestApp();
});

/**
 * Monotonic counter backing `uniqueIp()`, giving every registration its own
 * synthetic client IP within this test file.
 */
let ipCounter = 0;

/**
 * Return a fresh, unique IPv4 address string for the `X-Forwarded-For` header.
 * The app is configured with `trust proxy`, so the auth rate limiter keys on
 * this value — a new IP per registration keeps each under the per-IP limit.
 */
function uniqueIp() {
  ipCounter += 1;
  const a = 10 + Math.floor(ipCounter / 254);
  const b = (ipCounter % 254) + 1;
  return `10.${a}.0.${b}`;
}

/**
 * A valid registration payload. `suffix` keeps the email unique within a test
 * so a second user does not collide on the unique email index. All fields
 * satisfy the register validation chain (digits-only phone 10–15, age >= 18).
 */
function registrationPayload(suffix = 'a') {
  return {
    firstName: 'Ama',
    lastName: 'Mensah',
    email: `user.${suffix}@example.com`,
    phone: '0241234567',
    dateOfBirth: '1990-05-20',
    address: '12 Independence Ave, Accra',
    password: 'sup3rSecret!',
  };
}

/**
 * Register a user through the real auth endpoint and return the parsed body
 * `{ user, account, token }` plus the raw response. Asserts a 201 so a broken
 * registration fails loudly here rather than in the endpoint under test.
 */
async function registerUser(suffix = 'a') {
  // Each registration presents a distinct client IP so the IP-based auth rate
  // limiter (5 requests / 15-min window) never trips across tests in this file.
  const res = await request(app)
    .post('/api/auth/register')
    .set('X-Forwarded-For', uniqueIp())
    .send(registrationPayload(suffix));

  expect(res.status).toBe(201);
  expect(res.body.success).toBe(true);
  return { res, ...res.body.data };
}

describe('GET /api/accounts/me (Requirements 4.3, 4.4)', () => {
  test('returns 200 with the account overview for a Bearer token', async () => {
    const { token, account } = await registerUser('acct');

    const res = await request(app)
      .get('/api/accounts/me')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    // Envelope shape.
    expect(res.body.success).toBe(true);
    expect(typeof res.body.message).toBe('string');
    expect(res.body).toHaveProperty('data');

    const data = res.body.data;
    // A fresh account: 10-digit number, zero integer balance, GHS, Active.
    expect(data.accountNumber).toBe(account.accountNumber);
    expect(data.accountNumber).toMatch(/^\d{10}$/);
    expect(Number.isInteger(data.balance)).toBe(true);
    expect(data.balance).toBe(0);
    expect(data.currency).toBe('GHS');
    expect(data.accountType).toBe('Savings');
    expect(data.status).toBe('Active');
  });

  test('returns 401 without a token', async () => {
    const res = await request(app).get('/api/accounts/me');

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
    expect(typeof res.body.message).toBe('string');
    // Failure envelope carries no data field.
    expect(res.body).not.toHaveProperty('data');
  });

  test('returns 401 for a malformed/garbage token', async () => {
    const res = await request(app)
      .get('/api/accounts/me')
      .set('Authorization', 'Bearer not-a-real-jwt');

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });
});

describe('GET /api/users/me (Requirements 9.1, 9.2)', () => {
  test('returns 200 with the safe profile and NEVER the password', async () => {
    const { token } = await registerUser('prof');
    const payload = registrationPayload('prof');

    const res = await request(app)
      .get('/api/users/me')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const data = res.body.data;
    expect(data.email).toBe(payload.email);
    expect(data.firstName).toBe(payload.firstName);
    expect(data.lastName).toBe(payload.lastName);
    expect(data.phone).toBe(payload.phone);
    expect(data.role).toBe('CUSTOMER');

    // The password hash must never be present anywhere in the profile payload.
    expect(data).not.toHaveProperty('password');
    expect(JSON.stringify(res.body)).not.toMatch(/password/i);
    // No bcrypt hash substring leaks either.
    expect(JSON.stringify(res.body)).not.toMatch(/\$2[aby]\$/);
  });

  test('returns 401 without a token', async () => {
    const res = await request(app).get('/api/users/me');

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
    expect(res.body).not.toHaveProperty('data');
  });
});

describe('PUT /api/users/me (Requirements 9.3, 9.4, 9.5)', () => {
  test('updates only phone and address and returns the updated profile', async () => {
    const { token } = await registerUser('upd');

    const res = await request(app)
      .put('/api/users/me')
      .set('Authorization', `Bearer ${token}`)
      .send({ phone: '+233 24 (555) 0100', address: '9 Ring Road, Kumasi' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.phone).toBe('+233 24 (555) 0100');
    expect(res.body.data.address).toBe('9 Ring Road, Kumasi');
    expect(res.body.data).not.toHaveProperty('password');
  });

  test('updating just one field leaves the other unchanged', async () => {
    const { token } = await registerUser('one');
    const payload = registrationPayload('one');

    const res = await request(app)
      .put('/api/users/me')
      .set('Authorization', `Bearer ${token}`)
      .send({ address: '1 New Street, Tema' });

    expect(res.status).toBe(200);
    expect(res.body.data.address).toBe('1 New Street, Tema');
    // phone was not sent, so it keeps its registered value.
    expect(res.body.data.phone).toBe(payload.phone);
  });

  test('ignores protected fields (balance/accountNumber/role/email)', async () => {
    const { token, account } = await registerUser('prot');
    const payload = registrationPayload('prot');

    const res = await request(app)
      .put('/api/users/me')
      .set('Authorization', `Bearer ${token}`)
      .send({
        phone: '0209998888',
        balance: 9999999,
        accountNumber: '0000000000',
        role: 'ADMIN',
        email: 'attacker@evil.com',
      });

    expect(res.status).toBe(200);
    // The one allowed field changed.
    expect(res.body.data.phone).toBe('0209998888');
    // Protected fields are unchanged.
    expect(res.body.data.role).toBe('CUSTOMER');
    expect(res.body.data.email).toBe(payload.email);

    // Confirm the account is untouched by re-reading it.
    const acctRes = await request(app)
      .get('/api/accounts/me')
      .set('Authorization', `Bearer ${token}`);
    expect(acctRes.status).toBe(200);
    expect(acctRes.body.data.balance).toBe(0);
    expect(acctRes.body.data.accountNumber).toBe(account.accountNumber);

    // And the profile re-read confirms role/email stayed put.
    const profRes = await request(app)
      .get('/api/users/me')
      .set('Authorization', `Bearer ${token}`);
    expect(profRes.body.data.role).toBe('CUSTOMER');
    expect(profRes.body.data.email).toBe(payload.email);
  });

  test('rejects an invalid phone with 400 and makes no change', async () => {
    const { token } = await registerUser('badph');
    const payload = registrationPayload('badph');

    const res = await request(app)
      .put('/api/users/me')
      .set('Authorization', `Bearer ${token}`)
      .send({ phone: 'not-a-phone!!!' });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body).not.toHaveProperty('data');

    // Re-read: phone is still the registered value.
    const profRes = await request(app)
      .get('/api/users/me')
      .set('Authorization', `Bearer ${token}`);
    expect(profRes.body.data.phone).toBe(payload.phone);
  });

  test('rejects an over-long address with 400 and makes no change', async () => {
    const { token } = await registerUser('badaddr');

    const res = await request(app)
      .put('/api/users/me')
      .set('Authorization', `Bearer ${token}`)
      .send({ address: 'x'.repeat(256) });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body).not.toHaveProperty('data');
  });

  test('returns 401 without a token', async () => {
    const res = await request(app)
      .put('/api/users/me')
      .send({ phone: '0241112222' });

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });
});

describe('ownership isolation (Property 14 — Requirements 9.4, 14.6, 14.7)', () => {
  test("user A only ever sees A's own account and profile", async () => {
    // Two independent users registered in the same test.
    const a = await registerUser('ownerA');
    const b = await registerUser('ownerB');

    // Sanity: they really are distinct accounts/users.
    expect(a.account.accountNumber).not.toBe(b.account.accountNumber);
    expect(a.user.email).not.toBe(b.user.email);

    // A's token resolves to A's account — never B's.
    const aAcct = await request(app)
      .get('/api/accounts/me')
      .set('Authorization', `Bearer ${a.token}`);
    expect(aAcct.status).toBe(200);
    expect(aAcct.body.data.accountNumber).toBe(a.account.accountNumber);
    expect(aAcct.body.data.accountNumber).not.toBe(b.account.accountNumber);

    // A's token resolves to A's profile — never B's.
    const aProf = await request(app)
      .get('/api/users/me')
      .set('Authorization', `Bearer ${a.token}`);
    expect(aProf.status).toBe(200);
    expect(aProf.body.data.email).toBe(a.user.email);
    expect(aProf.body.data.email).not.toBe(b.user.email);

    // A updating their profile cannot touch B's record.
    await request(app)
      .put('/api/users/me')
      .set('Authorization', `Bearer ${a.token}`)
      .send({ address: 'A-only address' });

    const bProf = await request(app)
      .get('/api/users/me')
      .set('Authorization', `Bearer ${b.token}`);
    expect(bProf.body.data.email).toBe(b.user.email);
    expect(bProf.body.data.address).not.toBe('A-only address');
  });
});
