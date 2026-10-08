// tests/admin.routes.test.js
//
// Integration tests for the admin endpoints, including RBAC (Task 13.3).
//
// These tests exercise the real HTTP stack end-to-end with Supertest against an
// Express app assembled from the production building blocks via the shared
// `buildTestApp()` factory (tests/helpers/buildTestApp.js), which mounts:
//
//   express.json()                 — body parser
//   /api/auth   → authRoutes       — register/login to obtain real JWTs
//   /api/users  → userRoutes
//   /api/accounts → accountRoutes
//   /api/transactions → transactionRoutes — used here to seed real ledger data
//   /api/admin  → adminRoutes      — the endpoints under test
//   errorMiddleware                — terminal error handler (last)
//
// Admin endpoints (all require auth + ADMIN role):
//   GET /api/admin/customers
//   GET /api/admin/accounts
//   GET /api/admin/transactions
//   GET /api/admin/statistics
//   PUT /api/admin/accounts/:id/status
//
// RBAC matrix asserted for every admin route:
//   no token        → 401 (AuthenticationError)
//   CUSTOMER token  → 403 (AuthorizationError)
//   ADMIN token     → 200
//
// Obtaining an ADMIN identity: `authMiddleware` derives `req.user.role`
// directly from the verified JWT `role` claim, so the simplest route to an
// admin caller is to SIGN a token directly with `jsonwebtoken` using
// `env.JWT_SECRET`, `sub = <some user id>`, `role = 'ADMIN'`. A matching User
// doc is created (and promoted to ADMIN) so statistics counts stay consistent.
// CUSTOMER tokens are obtained the normal way (register) for the negative RBAC
// and happy-path data-seeding tests.
//
// Every assertion checks BOTH the HTTP status AND the Requirement 13 envelope:
//   success → { success:true, message, data }
//   failure → { success:false, message } with NO `data` field.
//
// env.js runs dotenv + validates MONGO_URI/JWT_SECRET on import and throws when
// absent. We set those vars BEFORE dynamically importing any env-dependent
// module. The Mongo connection is provided by tests/setup.js (in-memory
// single-node replica set).

import request from 'supertest';
import jwt from 'jsonwebtoken';

// Must be set before importing any module that transitively imports env.js.
process.env.MONGO_URI =
  process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/mybanking?replicaSet=rs0';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-value';

/** @type {import('express').Express} */
let app;
/** @type {typeof import('../src/config/env.js').env} */
let env;
/** @type {typeof import('../src/models/User.js').default} */
let User;
/** ROLES enum from the User model. */
let ROLES;

beforeAll(async () => {
  const { buildTestApp } = await import('./helpers/buildTestApp.js');
  ({ env } = await import('../src/config/env.js'));
  const userModule = await import('../src/models/User.js');
  User = userModule.default;
  ROLES = userModule.ROLES;

  app = buildTestApp();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Monotonic counter so each registered user gets a unique email/phone/IP. */
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
    phone: `02${n}000000`,
    dateOfBirth: '1990-01-01',
    address: '123 Test Street, Accra',
    password: 'Password123!',
    ...overrides,
  };
}

/** A distinct synthetic client IP per registration to dodge the auth limiter. */
function forwardedIp() {
  return `10.${(userCounter >> 8) & 0xff}.${userCounter & 0xff}.1`;
}

/**
 * Register a fresh CUSTOMER and return the issued token plus the created
 * account overview, the safe user, and the raw payload.
 */
async function registerCustomer(overrides = {}) {
  const payload = buildRegistration(overrides);
  const ip = forwardedIp();
  const res = await request(app)
    .post('/api/auth/register')
    .set('X-Forwarded-For', ip)
    .send(payload);

  expect(res.status).toBe(201);
  expect(res.body.success).toBe(true);
  expect(res.body.data.token).toEqual(expect.any(String));

  return {
    token: res.body.data.token,
    account: res.body.data.account,
    user: res.body.data.user,
    payload,
  };
}

/**
 * Sign an ADMIN JWT directly with the configured secret. The `role: 'ADMIN'`
 * claim is what `authMiddleware` trusts; `sub` is the acting user id.
 */
function signAdminToken(userId) {
  return jwt.sign({ role: ROLES.ADMIN }, env.JWT_SECRET, {
    subject: String(userId),
    expiresIn: env.JWT_EXPIRES_IN,
  });
}

/**
 * Create a real ADMIN User doc (register a customer, then promote via the model
 * directly) and return an ADMIN token signed for that user id. Promoting a real
 * doc keeps the `totalCustomers` statistic honest — an admin is NOT a customer.
 */
async function createAdmin() {
  const customer = await registerCustomer();
  const userId = customer.user._id ?? customer.user.id;
  await User.updateOne({ _id: userId }, { $set: { role: ROLES.ADMIN } });
  return { token: signAdminToken(userId), userId };
}

/** Authorization header value for a bearer token. */
function bearer(token) {
  return `Bearer ${token}`;
}

/** Assert a success envelope; returns `res.body.data`. */
function expectSuccessEnvelope(res, status) {
  expect(res.status).toBe(status);
  expect(res.body).toEqual(
    expect.objectContaining({ success: true, message: expect.any(String) })
  );
  expect(res.body).toHaveProperty('data');
  return res.body.data;
}

/** Assert a failure envelope: { success:false, message } with NO `data`. */
function expectErrorEnvelope(res, status) {
  expect(res.status).toBe(status);
  expect(res.body).toEqual(
    expect.objectContaining({ success: false, message: expect.any(String) })
  );
  expect(res.body).not.toHaveProperty('data');
}

/** Deposit `amount` for the token-holder. */
function deposit(token, amount) {
  return request(app)
    .post('/api/transactions/deposit')
    .set('Authorization', bearer(token))
    .send({ amount });
}

/** Withdraw `amount` for the token-holder. */
function withdraw(token, amount) {
  return request(app)
    .post('/api/transactions/withdraw')
    .set('Authorization', bearer(token))
    .send({ amount });
}

/** Transfer `amount` to `recipientAccountNumber` for the token-holder. */
function transfer(token, recipientAccountNumber, amount) {
  return request(app)
    .post('/api/transactions/transfer')
    .set('Authorization', bearer(token))
    .send({ recipientAccountNumber, amount });
}

// The admin route table under test. Used to drive the RBAC matrix uniformly.
// `needsId` routes have `:id` substituted with a well-formed ObjectId.
const ADMIN_ROUTES = [
  { method: 'get', path: '/api/admin/customers' },
  { method: 'get', path: '/api/admin/accounts' },
  { method: 'get', path: '/api/admin/transactions' },
  { method: 'get', path: '/api/admin/statistics' },
  {
    method: 'put',
    path: '/api/admin/accounts/000000000000000000000000/status',
    body: { status: 'Frozen' },
  },
];

// ---------------------------------------------------------------------------
// RBAC — every admin route: no token → 401, CUSTOMER → 403, ADMIN → not 401/403
// ---------------------------------------------------------------------------

describe('Admin RBAC', () => {
  test.each(ADMIN_ROUTES)(
    '$method $path with NO token → 401',
    async ({ method, path, body }) => {
      const req = request(app)[method](path);
      const res = await (body ? req.send(body) : req);
      expectErrorEnvelope(res, 401);
    }
  );

  test.each(ADMIN_ROUTES)(
    '$method $path with a CUSTOMER token → 403',
    async ({ method, path, body }) => {
      const { token } = await registerCustomer();
      const req = request(app)[method](path).set('Authorization', bearer(token));
      const res = await (body ? req.send(body) : req);
      expectErrorEnvelope(res, 403);
    }
  );

  test.each(ADMIN_ROUTES)(
    '$method $path with an ADMIN token → authorized (not 401/403)',
    async ({ method, path, body }) => {
      const { token } = await createAdmin();
      const req = request(app)[method](path).set('Authorization', bearer(token));
      const res = await (body ? req.send(body) : req);
      // The ADMIN passes auth + RBAC; the only non-200 here is the PUT against a
      // nonexistent account id (→ 404). Crucially never 401/403.
      expect([200, 404]).toContain(res.status);
      expect(res.status).not.toBe(401);
      expect(res.status).not.toBe(403);
    }
  );
});

// ---------------------------------------------------------------------------
// GET /api/admin/customers
// ---------------------------------------------------------------------------

describe('GET /api/admin/customers', () => {
  test('returns a paginated customer list → 200; passwords never present', async () => {
    const admin = await createAdmin();
    const c1 = await registerCustomer({ firstName: 'Ama', lastName: 'Mensah' });
    const c2 = await registerCustomer({ firstName: 'Kofi', lastName: 'Owusu' });

    const res = await request(app)
      .get('/api/admin/customers')
      .set('Authorization', bearer(admin.token));
    const data = expectSuccessEnvelope(res, 200);

    expect(Array.isArray(data.items)).toBe(true);
    // Two customers registered here; the promoted admin is NOT a customer.
    expect(data.total).toBe(2);
    expect(data.page).toBe(1);
    expect(data.limit).toBe(20);

    const emails = data.items.map((u) => u.email);
    expect(emails).toEqual(
      expect.arrayContaining([c1.payload.email, c2.payload.email])
    );
    // No password/hash field is ever serialized (Requirement 14.9).
    for (const u of data.items) {
      expect(u).not.toHaveProperty('password');
    }
  });

  test('respects pagination (page/limit) → 200', async () => {
    const admin = await createAdmin();
    await registerCustomer();
    await registerCustomer();
    await registerCustomer();

    const res = await request(app)
      .get('/api/admin/customers?page=1&limit=2')
      .set('Authorization', bearer(admin.token));
    const data = expectSuccessEnvelope(res, 200);

    expect(data.total).toBe(3);
    expect(data.page).toBe(1);
    expect(data.limit).toBe(2);
    expect(data.items.length).toBe(2);
    expect(data.totalPages).toBe(2);
  });

  test('optional search matches first/last name or email → 200', async () => {
    const admin = await createAdmin();
    const target = await registerCustomer({
      firstName: 'Zenobia',
      lastName: 'Unmatchable',
    });
    await registerCustomer({ firstName: 'Common', lastName: 'Name' });

    const res = await request(app)
      .get('/api/admin/customers?search=Zenobia')
      .set('Authorization', bearer(admin.token));
    const data = expectSuccessEnvelope(res, 200);

    expect(data.total).toBe(1);
    expect(data.items.length).toBe(1);
    expect(data.items[0].email).toBe(target.payload.email);
  });

  test('rejects invalid page (0) → 400', async () => {
    const admin = await createAdmin();
    const res = await request(app)
      .get('/api/admin/customers?page=0')
      .set('Authorization', bearer(admin.token));
    expectErrorEnvelope(res, 400);
  });

  test('rejects invalid limit (over 100) → 400', async () => {
    const admin = await createAdmin();
    const res = await request(app)
      .get('/api/admin/customers?limit=101')
      .set('Authorization', bearer(admin.token));
    expectErrorEnvelope(res, 400);
  });
});

// ---------------------------------------------------------------------------
// GET /api/admin/accounts
// ---------------------------------------------------------------------------

describe('GET /api/admin/accounts', () => {
  test('returns accounts with integer-pesewa balances → 200', async () => {
    const admin = await createAdmin();
    const c1 = await registerCustomer();
    const c2 = await registerCustomer();
    await deposit(c1.token, 50_000);

    const res = await request(app)
      .get('/api/admin/accounts')
      .set('Authorization', bearer(admin.token));
    const data = expectSuccessEnvelope(res, 200);

    // Admin + two customers each have exactly one account at registration.
    expect(data.total).toBe(3);
    for (const acc of data.items) {
      expect(acc.accountNumber).toMatch(/^\d{10}$/);
      expect(Number.isInteger(acc.balance)).toBe(true);
      expect(acc.balance).toBeGreaterThanOrEqual(0);
    }

    const funded = data.items.find(
      (a) => a.accountNumber === c1.account.accountNumber
    );
    expect(funded.balance).toBe(50_000);

    const unfunded = data.items.find(
      (a) => a.accountNumber === c2.account.accountNumber
    );
    expect(unfunded.balance).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// GET /api/admin/transactions
// ---------------------------------------------------------------------------

describe('GET /api/admin/transactions', () => {
  test('returns the system-wide transaction list → 200', async () => {
    const admin = await createAdmin();
    const c1 = await registerCustomer();
    const c2 = await registerCustomer();
    await deposit(c1.token, 80_000); // CREDIT
    await withdraw(c1.token, 10_000); // DEBIT
    await deposit(c2.token, 20_000); // CREDIT

    const res = await request(app)
      .get('/api/admin/transactions')
      .set('Authorization', bearer(admin.token));
    const data = expectSuccessEnvelope(res, 200);

    expect(Array.isArray(data.items)).toBe(true);
    // 2 deposits + 1 withdrawal across the whole system.
    expect(data.total).toBe(3);
    for (const txn of data.items) {
      expect(txn.reference).toMatch(/^TXN-[A-Z0-9]{8}$/);
      expect(Number.isInteger(txn.amount)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// GET /api/admin/statistics
// ---------------------------------------------------------------------------

describe('GET /api/admin/statistics', () => {
  test('empty state (only the admin) yields zeroed customer/money totals', async () => {
    const admin = await createAdmin();

    const res = await request(app)
      .get('/api/admin/statistics')
      .set('Authorization', bearer(admin.token));
    const data = expectSuccessEnvelope(res, 200);

    // The promoted admin is not a CUSTOMER, so totalCustomers is 0...
    expect(data.totalCustomers).toBe(0);
    // ...but the admin still has one account created at registration.
    expect(data.totalAccounts).toBe(1);
    expect(data.systemLiquidity).toBe(0);
    expect(data.totalDeposits).toBe(0);
    expect(data.totalWithdrawals).toBe(0);
    expect(data.totalTransfers).toBe(0);
  });

  test('aggregates match an independently seeded dataset → 200', async () => {
    const admin = await createAdmin();
    const alice = await registerCustomer();
    const bob = await registerCustomer();

    // Seed a known ledger:
    //   alice: deposit 100_000 (CREDIT), withdraw 10_000 (DEBIT)
    //   bob:   deposit  50_000 (CREDIT)
    //   alice → bob transfer 30_000 (one DEBIT TRANSFER + one CREDIT TRANSFER)
    await deposit(alice.token, 100_000);
    await withdraw(alice.token, 10_000);
    await deposit(bob.token, 50_000);
    await transfer(alice.token, bob.account.accountNumber, 30_000);

    // Expected balances:
    //   alice: 100_000 - 10_000 - 30_000 = 60_000
    //   bob:    50_000 + 30_000          = 80_000
    //   admin:  0
    // System liquidity = 60_000 + 80_000 = 140_000.
    const res = await request(app)
      .get('/api/admin/statistics')
      .set('Authorization', bearer(admin.token));
    const data = expectSuccessEnvelope(res, 200);

    expect(data.totalCustomers).toBe(2); // alice + bob (admin is not a customer)
    expect(data.totalAccounts).toBe(3); // alice + bob + admin
    expect(data.systemLiquidity).toBe(140_000);
    // Counts by transaction type (the transfer adds exactly two TRANSFER legs).
    expect(data.totalDeposits).toBe(2); // 2 CREDIT (non-transfer deposits)
    expect(data.totalWithdrawals).toBe(1); // 1 DEBIT
    expect(data.totalTransfers).toBe(2); // 2 TRANSFER legs

    // Every monetary aggregate is an integer (Requirement 15.1).
    expect(Number.isInteger(data.systemLiquidity)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// PUT /api/admin/accounts/:id/status
// ---------------------------------------------------------------------------

describe('PUT /api/admin/accounts/:id/status', () => {
  /** Resolve the Mongo _id of a customer's account via the admin accounts list. */
  async function accountIdFor(adminToken, accountNumber) {
    const res = await request(app)
      .get('/api/admin/accounts')
      .set('Authorization', bearer(adminToken));
    const data = expectSuccessEnvelope(res, 200);
    const acc = data.items.find((a) => a.accountNumber === accountNumber);
    return acc._id ?? acc.id;
  }

  test('admin sets a valid status (Frozen) → 200 updated', async () => {
    const admin = await createAdmin();
    const customer = await registerCustomer();
    const accId = await accountIdFor(admin.token, customer.account.accountNumber);

    const res = await request(app)
      .put(`/api/admin/accounts/${accId}/status`)
      .set('Authorization', bearer(admin.token))
      .send({ status: 'Frozen' });
    const data = expectSuccessEnvelope(res, 200);

    expect(data.status).toBe('Frozen');
    expect(String(data._id ?? data.id)).toBe(String(accId));
  });

  test('admin can set each valid status in turn (Active/Frozen/Disabled)', async () => {
    const admin = await createAdmin();
    const customer = await registerCustomer();
    const accId = await accountIdFor(admin.token, customer.account.accountNumber);

    for (const status of ['Frozen', 'Disabled', 'Active']) {
      const res = await request(app)
        .put(`/api/admin/accounts/${accId}/status`)
        .set('Authorization', bearer(admin.token))
        .send({ status });
      const data = expectSuccessEnvelope(res, 200);
      expect(data.status).toBe(status);
    }
  });

  test('invalid status value → 400', async () => {
    const admin = await createAdmin();
    const customer = await registerCustomer();
    const accId = await accountIdFor(admin.token, customer.account.accountNumber);

    const res = await request(app)
      .put(`/api/admin/accounts/${accId}/status`)
      .set('Authorization', bearer(admin.token))
      .send({ status: 'Suspended' }); // not in the enum
    expectErrorEnvelope(res, 400);
  });

  test('missing status body → 400', async () => {
    const admin = await createAdmin();
    const customer = await registerCustomer();
    const accId = await accountIdFor(admin.token, customer.account.accountNumber);

    const res = await request(app)
      .put(`/api/admin/accounts/${accId}/status`)
      .set('Authorization', bearer(admin.token))
      .send({});
    expectErrorEnvelope(res, 400);
  });

  test('nonexistent (well-formed) account id → 404', async () => {
    const admin = await createAdmin();

    const res = await request(app)
      // Valid ObjectId shape, but no account has it.
      .put('/api/admin/accounts/000000000000000000000000/status')
      .set('Authorization', bearer(admin.token))
      .send({ status: 'Frozen' });
    expectErrorEnvelope(res, 404);
  });

  test('malformed account id → 400 (isMongoId validator)', async () => {
    const admin = await createAdmin();

    // The route param validator (`isMongoId`) rejects a malformed id with 400
    // before the controller runs.
    const res = await request(app)
      .put('/api/admin/accounts/not-a-valid-id/status')
      .set('Authorization', bearer(admin.token))
      .send({ status: 'Frozen' });
    expectErrorEnvelope(res, 400);
  });

  test('a CUSTOMER cannot update account status → 403', async () => {
    const admin = await createAdmin();
    const customer = await registerCustomer();
    const accId = await accountIdFor(admin.token, customer.account.accountNumber);

    const res = await request(app)
      .put(`/api/admin/accounts/${accId}/status`)
      .set('Authorization', bearer(customer.token))
      .send({ status: 'Frozen' });
    expectErrorEnvelope(res, 403);
  });
});
