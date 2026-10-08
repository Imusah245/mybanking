// tests/transaction.routes.test.js
//
// Integration tests for the transaction endpoints (Task 11.3).
//
// These tests exercise the real HTTP stack end-to-end with Supertest against an
// Express app assembled IN THE TEST from the production building blocks:
//
//   express.json()                      — body parser
//   /api/auth      → authRoutes         — register/login to obtain real JWTs
//   /api/transactions → transactionRoutes — the endpoints under test
//   errorMiddleware                      — terminal error handler (last)
//
// The app factory (Task 14.1) is not implemented yet, so this file builds its
// own minimal app from the same routers and the same central error handler the
// real server will use. Mounting the real `authRoutes` lets us register users
// and obtain genuine signed tokens, so every protected request is authenticated
// exactly as in production (identity derived from the verified JWT `sub` claim,
// never from the body — Requirement 3).
//
// What is covered (status codes + the standardized Requirement 13 envelope):
//   deposit   — 200 (balance up, CREDIT txn) / 400 invalid amount / 401 no token
//   withdraw  — 200 / 400 insufficient funds / 400 invalid amount / 401 no token
//   transfer  — 200 / 404 unknown recipient / 400 self-transfer /
//               400 insufficient funds / 400 bad recipient format / 401 no token
//   list      — 200 with items + pagination / 401 no token
//   getById   — 200 own txn / 404 another user's txn / 400 malformed id
//
// Every assertion checks BOTH the HTTP status AND the response envelope:
//   success → { success: true, message, data }
//   failure → { success: false, message } with NO `data` field (Requirement 13.2).
//
// env.js runs dotenv + validates MONGO_URI/JWT_SECRET on import and throws when
// they are absent. Mirroring the existing middleware tests, we set those vars
// BEFORE dynamically importing any env-dependent module. The Mongo connection
// itself is provided by tests/setup.js (in-memory single-node replica set).

import express from 'express';
import request from 'supertest';

// Must be set before importing any module that transitively imports env.js.
process.env.MONGO_URI =
  process.env.MONGO_URI ||
  'mongodb://127.0.0.1:27017/mybanking?replicaSet=rs0';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-value';

/** @type {import('express').Express} */
let app;

/**
 * Assemble the Express app from the real routers + the central error handler.
 * Dynamically imported so the env vars above are in place before env.js
 * validates them at import time.
 */
beforeAll(async () => {
  const { default: authRoutes } = await import('../src/routes/authRoutes.js');
  const { default: transactionRoutes } = await import(
    '../src/routes/transactionRoutes.js'
  );
  const { errorMiddleware } = await import(
    '../src/middleware/errorMiddleware.js'
  );

  app = express();
  // Trust a single proxy hop so `req.ip` (and therefore the IP-based auth rate
  // limiter) is keyed off the X-Forwarded-For client address. Each test
  // registers from a distinct synthetic IP (see `registerUser`) so the
  // production 5-requests-per-window auth limiter never trips on the shared
  // loopback address during this suite — we exercise the REAL authRoutes
  // (limiter included) without reconfiguring it. A hop count of 1 (rather than
  // `true`) avoids express-rate-limit's permissive-trust-proxy warning.
  app.set('trust proxy', 1);
  app.use(express.json());
  app.use('/api/auth', authRoutes);
  app.use('/api/transactions', transactionRoutes);
  app.use(errorMiddleware);
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Monotonic counter so each registered user gets a unique email/phone. */
let userCounter = 0;

/**
 * A valid registration payload for a brand-new customer. Every call produces a
 * distinct email and phone so repeated registrations never collide on the
 * unique email index. The password satisfies the 8–128 length rule and the
 * dateOfBirth implies an age well over 18.
 */
function buildRegistration(overrides = {}) {
  userCounter += 1;
  const n = String(userCounter).padStart(4, '0');
  return {
    firstName: 'Test',
    lastName: `User${n}`,
    email: `user${n}.${Date.now()}@example.com`,
    // 10–15 digits; keep it short and digits-only.
    phone: `02${n}000000`,
    dateOfBirth: '1990-01-01',
    address: '123 Test Street, Accra',
    password: 'Password123!',
    ...overrides,
  };
}

/**
 * Register a fresh user and return the issued token plus the created account
 * overview and the safe user. The register endpoint returns 201 with
 * `{ user, account, token }` under `data`.
 */
async function registerUser(overrides = {}) {
  const payload = buildRegistration(overrides);
  // Each registration comes from a distinct synthetic client IP so the real
  // IP-based auth rate limiter (5 requests / 15-min window) does not trip when
  // this suite registers many users from the shared loopback address.
  const forwardedIp = `10.${(userCounter >> 8) & 0xff}.${userCounter & 0xff}.1`;
  const res = await request(app)
    .post('/api/auth/register')
    .set('X-Forwarded-For', forwardedIp)
    .send(payload);

  expect(res.status).toBe(201);
  expect(res.body.success).toBe(true);
  expect(res.body.data).toBeDefined();
  expect(res.body.data.token).toEqual(expect.any(String));
  expect(res.body.data.account.accountNumber).toMatch(/^\d{10}$/);
  expect(res.body.data.account.balance).toBe(0);

  return {
    token: res.body.data.token,
    account: res.body.data.account,
    user: res.body.data.user,
    payload,
  };
}

/** Authorization header value for a bearer token. */
function bearer(token) {
  return `Bearer ${token}`;
}

/**
 * Assert a response is a success envelope: { success:true, message, data }.
 * Returns `res.body.data` for further inspection.
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
 * Assert a response is a failure envelope: { success:false, message } with NO
 * `data` field (Requirement 13.2).
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

/** Deposit `amount` for the token-holder; returns the Supertest response. */
function deposit(token, amount) {
  return request(app)
    .post('/api/transactions/deposit')
    .set('Authorization', bearer(token))
    .send({ amount });
}

/** Withdraw `amount` for the token-holder; returns the Supertest response. */
function withdraw(token, amount) {
  return request(app)
    .post('/api/transactions/withdraw')
    .set('Authorization', bearer(token))
    .send({ amount });
}

/** Transfer `amount` to `recipientAccountNumber`; returns the response. */
function transfer(token, body) {
  return request(app)
    .post('/api/transactions/transfer')
    .set('Authorization', bearer(token))
    .send(body);
}

// ---------------------------------------------------------------------------
// POST /api/transactions/deposit
// ---------------------------------------------------------------------------

describe('POST /api/transactions/deposit', () => {
  test('deposits with a valid amount → 200, balance increases, CREDIT txn', async () => {
    const { token } = await registerUser();

    const res = await deposit(token, 50_000);
    const data = expectSuccessEnvelope(res, 200);

    // Balance went from 0 to the deposited amount.
    expect(data.account.balance).toBe(50_000);
    // A COMPLETED CREDIT ledger record was created with a well-formed reference.
    expect(data.transaction.type).toBe('CREDIT');
    expect(data.transaction.status).toBe('COMPLETED');
    expect(data.transaction.amount).toBe(50_000);
    expect(data.transaction.balanceBefore).toBe(0);
    expect(data.transaction.balanceAfter).toBe(50_000);
    expect(data.transaction.reference).toMatch(/^TXN-[A-Z0-9]{8}$/);
  });

  test('rejects amount of 0 → 400', async () => {
    const { token } = await registerUser();
    const res = await deposit(token, 0);
    expectErrorEnvelope(res, 400);
  });

  test('rejects a negative amount → 400', async () => {
    const { token } = await registerUser();
    const res = await deposit(token, -100);
    expectErrorEnvelope(res, 400);
  });

  test('rejects a non-integer (float) amount → 400', async () => {
    const { token } = await registerUser();
    const res = await deposit(token, 12.5);
    expectErrorEnvelope(res, 400);
  });

  test('rejects a missing amount → 400', async () => {
    const { token } = await registerUser();
    const res = await request(app)
      .post('/api/transactions/deposit')
      .set('Authorization', bearer(token))
      .send({});
    expectErrorEnvelope(res, 400);
  });

  test('rejects a request with no token → 401', async () => {
    const res = await request(app)
      .post('/api/transactions/deposit')
      .send({ amount: 1000 });
    expectErrorEnvelope(res, 401);
  });
});

// ---------------------------------------------------------------------------
// POST /api/transactions/withdraw
// ---------------------------------------------------------------------------

describe('POST /api/transactions/withdraw', () => {
  test('withdraws within balance → 200, balance decreases, DEBIT txn', async () => {
    const { token } = await registerUser();
    await deposit(token, 80_000);

    const res = await withdraw(token, 30_000);
    const data = expectSuccessEnvelope(res, 200);

    expect(data.account.balance).toBe(50_000);
    expect(data.transaction.type).toBe('DEBIT');
    expect(data.transaction.status).toBe('COMPLETED');
    expect(data.transaction.amount).toBe(30_000);
    expect(data.transaction.balanceBefore).toBe(80_000);
    expect(data.transaction.balanceAfter).toBe(50_000);
  });

  test('rejects a withdrawal over the available balance → 400 (insufficient funds)', async () => {
    const { token } = await registerUser();
    await deposit(token, 10_000);

    const res = await withdraw(token, 10_001);
    expectErrorEnvelope(res, 400);
    expect(res.body.message).toMatch(/insufficient/i);
  });

  test('rejects an invalid amount → 400', async () => {
    const { token } = await registerUser();
    const res = await withdraw(token, -5);
    expectErrorEnvelope(res, 400);
  });

  test('rejects a request with no token → 401', async () => {
    const res = await request(app)
      .post('/api/transactions/withdraw')
      .send({ amount: 1000 });
    expectErrorEnvelope(res, 401);
  });
});

// ---------------------------------------------------------------------------
// POST /api/transactions/transfer
// ---------------------------------------------------------------------------

describe('POST /api/transactions/transfer', () => {
  test('transfers to another account → 200, both legs recorded, money conserved', async () => {
    const sender = await registerUser();
    const recipient = await registerUser();
    await deposit(sender.token, 100_000);

    const res = await transfer(sender.token, {
      recipientAccountNumber: recipient.account.accountNumber,
      amount: 40_000,
    });
    const data = expectSuccessEnvelope(res, 200);

    // Sender debit leg.
    expect(data.debitTxn.type).toBe('TRANSFER');
    expect(data.debitTxn.amount).toBe(40_000);
    expect(data.debitTxn.balanceAfter).toBe(60_000);
    // Recipient credit leg.
    expect(data.creditTxn.type).toBe('TRANSFER');
    expect(data.creditTxn.amount).toBe(40_000);
    expect(data.creditTxn.balanceAfter).toBe(40_000);

    // Verify conservation via the recipient's own history endpoint.
    const recipientList = await request(app)
      .get('/api/transactions')
      .set('Authorization', bearer(recipient.token));
    const listData = expectSuccessEnvelope(recipientList, 200);
    expect(listData.items.length).toBe(1);
    expect(listData.items[0].type).toBe('TRANSFER');
    expect(listData.items[0].amount).toBe(40_000);
  });

  test('rejects an unknown recipient account number → 404', async () => {
    const { token } = await registerUser();
    await deposit(token, 50_000);

    const res = await transfer(token, {
      // Well-formed 10 digits but no account has it.
      recipientAccountNumber: '0000000000',
      amount: 10_000,
    });
    expectErrorEnvelope(res, 404);
  });

  test('rejects a self-transfer → 400', async () => {
    const sender = await registerUser();
    await deposit(sender.token, 50_000);

    const res = await transfer(sender.token, {
      recipientAccountNumber: sender.account.accountNumber,
      amount: 10_000,
    });
    expectErrorEnvelope(res, 400);
  });

  test('rejects a transfer with insufficient funds → 400', async () => {
    const sender = await registerUser();
    const recipient = await registerUser();
    await deposit(sender.token, 5_000);

    const res = await transfer(sender.token, {
      recipientAccountNumber: recipient.account.accountNumber,
      amount: 5_001,
    });
    expectErrorEnvelope(res, 400);
    expect(res.body.message).toMatch(/insufficient/i);
  });

  test('rejects a badly formatted recipient account number → 400', async () => {
    const { token } = await registerUser();
    await deposit(token, 50_000);

    const res = await transfer(token, {
      recipientAccountNumber: '123', // not 10 digits
      amount: 10_000,
    });
    expectErrorEnvelope(res, 400);
  });

  test('rejects a request with no token → 401', async () => {
    const res = await request(app)
      .post('/api/transactions/transfer')
      .send({ recipientAccountNumber: '0000000000', amount: 1000 });
    expectErrorEnvelope(res, 401);
  });
});

// ---------------------------------------------------------------------------
// GET /api/transactions
// ---------------------------------------------------------------------------

describe('GET /api/transactions', () => {
  test('returns the user history with items + pagination → 200', async () => {
    const { token } = await registerUser();
    await deposit(token, 10_000);
    await deposit(token, 20_000);
    await withdraw(token, 5_000);

    const res = await request(app)
      .get('/api/transactions')
      .set('Authorization', bearer(token));
    const data = expectSuccessEnvelope(res, 200);

    // Three ledger records for this user, newest-first.
    expect(Array.isArray(data.items)).toBe(true);
    expect(data.items.length).toBe(3);
    // Pagination metadata present with defaults (page 1, limit 20).
    expect(data.pagination).toEqual(
      expect.objectContaining({
        total: 3,
        page: 1,
        limit: 20,
        totalPages: 1,
      })
    );
  });

  test('returns only the caller\'s own transactions (ownership isolation)', async () => {
    const alice = await registerUser();
    const bob = await registerUser();
    await deposit(alice.token, 10_000);
    await deposit(bob.token, 20_000);

    const res = await request(app)
      .get('/api/transactions')
      .set('Authorization', bearer(bob.token));
    const data = expectSuccessEnvelope(res, 200);

    expect(data.items.length).toBe(1);
    expect(data.items[0].amount).toBe(20_000);
  });

  test('rejects a request with no token → 401', async () => {
    const res = await request(app).get('/api/transactions');
    expectErrorEnvelope(res, 401);
  });
});

// ---------------------------------------------------------------------------
// GET /api/transactions/:id
// ---------------------------------------------------------------------------

describe('GET /api/transactions/:id', () => {
  test('returns the caller\'s own transaction → 200', async () => {
    const { token } = await registerUser();
    const depositData = expectSuccessEnvelope(await deposit(token, 15_000), 200);
    const txnId = depositData.transaction._id ?? depositData.transaction.id;

    const res = await request(app)
      .get(`/api/transactions/${txnId}`)
      .set('Authorization', bearer(token));
    const data = expectSuccessEnvelope(res, 200);

    expect(String(data.transaction._id ?? data.transaction.id)).toBe(
      String(txnId)
    );
    expect(data.transaction.amount).toBe(15_000);
  });

  test('returns 404 when fetching another user\'s transaction', async () => {
    const owner = await registerUser();
    const other = await registerUser();
    const ownerDeposit = expectSuccessEnvelope(
      await deposit(owner.token, 15_000),
      200
    );
    const txnId =
      ownerDeposit.transaction._id ?? ownerDeposit.transaction.id;

    // `other` tries to read a transaction owned by `owner`.
    const res = await request(app)
      .get(`/api/transactions/${txnId}`)
      .set('Authorization', bearer(other.token));
    expectErrorEnvelope(res, 404);
  });

  test('returns 400 for a malformed (non-ObjectId) transaction id', async () => {
    const { token } = await registerUser();

    // The route validator (param isMongoId) rejects a malformed id with 400
    // before it reaches the service.
    const res = await request(app)
      .get('/api/transactions/not-a-valid-id')
      .set('Authorization', bearer(token));
    expectErrorEnvelope(res, 400);
  });

  test('rejects a request with no token → 401', async () => {
    const res = await request(app).get(
      '/api/transactions/000000000000000000000000'
    );
    expectErrorEnvelope(res, 401);
  });
});
