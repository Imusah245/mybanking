// tests/properties/statisticsAggregation.property.test.js
//
// Property 18: Statistics aggregation correctness (Task 13.4).
//
// *For any* dataset, the admin statistics response reports `System_Liquidity`
// equal to the independently computed sum of all account balances, and Total
// Customers, Total Accounts, Total Deposits, Total Withdrawals, and Total
// Transfers each equal to the independently computed count, with every total an
// integer greater than or equal to 0.
//
// **Validates: Requirements 11.1, 11.5**  (`fast-check`)
//
// This exercises the real `adminController.statistics` handler against the
// in-memory single-node replica set wired by tests/setup.js. No mocks: a random
// number of CUSTOMER users, Accounts (random integer-pesewa balances), and
// Transactions (random CREDIT/DEBIT/TRANSFER types) are seeded directly through
// the Mongoose models as valid documents, then the controller is invoked and
// each returned field is compared against a value computed independently in JS
// from exactly what was seeded.
//
// The controller is called directly with a minimal req/res/next stub: `ok()`
// resolves to `res.status(code).json({ success, message, data })`, so the fake
// `res` captures the status and body and the asserted data is read from
// `res.body.data`. Determinism (design Property 18) is checked by invoking the
// handler twice over the same unchanged state and asserting identical output.
//
// Each fast-check run seeds and tears down its own dataset so predicates are
// independent (collections are only cleared between tests by setup.js, not
// between runs). A modest `numRuns` keeps total DB work bounded while covering
// many random datasets; the empty-collection case (all zeros, Requirement 11.5)
// is additionally asserted as a dedicated example.
//
// src/config/env.js validates required secrets at import time and there is no
// committed .env, so (mirroring the other property tests) the required env vars
// are set BEFORE the env-dependent modules are dynamically imported.

import { jest } from '@jest/globals';
import fc from 'fast-check';
import mongoose from 'mongoose';

// Must be set before any env-validating module is imported.
process.env.MONGO_URI =
  process.env.MONGO_URI ||
  'mongodb://127.0.0.1:27017/mybanking?replicaSet=rs0';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-value';
process.env.BCRYPT_ROUNDS = process.env.BCRYPT_ROUNDS || '4';

/** @type {typeof import('../../src/controllers/adminController.js')} */
let adminController;
/** @type {import('mongoose').Model} */
let User;
let ROLES;
/** @type {import('mongoose').Model} */
let Account;
/** @type {import('mongoose').Model} */
let Transaction;
let TRANSACTION_TYPES;
let TRANSACTION_STATUSES;

beforeAll(async () => {
  // Dynamic imports so the env vars above are in place before env.js validates.
  const userMod = await import('../../src/models/User.js');
  const accountMod = await import('../../src/models/Account.js');
  const txnMod = await import('../../src/models/Transaction.js');
  adminController = await import('../../src/controllers/adminController.js');

  User = userMod.default;
  ROLES = userMod.ROLES;
  Account = accountMod.default;
  Transaction = txnMod.default;
  TRANSACTION_TYPES = txnMod.TRANSACTION_TYPES;
  TRANSACTION_STATUSES = txnMod.TRANSACTION_STATUSES;
});

// Monotonic counters so unique indexes (email, accountNumber, reference) never
// collide across runs within a single test (collections are cleared only
// between tests, not between fast-check runs).
let userSeq = 0;
let accountSeq = 0;
let txnSeq = 0;

// Keep per-account balances well under MAX_BALANCE_PESEWAS and keep the summed
// System_Liquidity a safe integer even with many accounts.
const BALANCE_CAP = 10_000_000; // 100,000.00 GHS per account, in pesewas.

/** Build a distinct, valid 10-digit account number for each seeded account. */
function nextAccountNumber() {
  accountSeq += 1;
  // 1_000_000_000..9_999_999_999 → always 10 digits.
  return String(1_000_000_000 + (accountSeq % 8_999_999_999)).padStart(10, '0');
}

/** Build a distinct, valid `TXN-XXXXXXXX` reference for each seeded txn. */
function nextReference() {
  txnSeq += 1;
  // 8 uppercase base36 chars, left-padded with zeros to the exact length.
  const body = txnSeq.toString(36).toUpperCase().padStart(8, '0').slice(-8);
  return `TXN-${body}`;
}

/**
 * Seed a dataset from a plain spec and return the independently computed
 * expectations. Everything is created directly through the models as valid
 * documents; the expectations are derived from the spec in JS without touching
 * the aggregation under test.
 *
 * @param {{ customers: number, admins: number, balances: number[], txnTypes: string[] }} spec
 */
async function seedDataset(spec) {
  // Users: `customers` CUSTOMER users (counted by statistics) plus `admins`
  // ADMIN users (which must NOT be counted toward totalCustomers).
  const createdUsers = [];
  for (let i = 0; i < spec.customers; i += 1) {
    userSeq += 1;
    // eslint-disable-next-line no-await-in-loop
    const u = await User.create({
      firstName: 'Cust',
      lastName: `User${userSeq}`,
      email: `cust-${userSeq}-${Date.now()}@example.com`,
      phone: '0241234567',
      dateOfBirth: new Date('1990-01-01'),
      address: '1 Stats Way',
      password: 'correct horse battery',
      role: ROLES.CUSTOMER,
    });
    createdUsers.push(u);
  }
  for (let i = 0; i < spec.admins; i += 1) {
    userSeq += 1;
    // eslint-disable-next-line no-await-in-loop
    await User.create({
      firstName: 'Admin',
      lastName: `User${userSeq}`,
      email: `admin-${userSeq}-${Date.now()}@example.com`,
      phone: '0241234567',
      dateOfBirth: new Date('1985-01-01'),
      address: '1 Admin Way',
      password: 'correct horse battery',
      role: ROLES.ADMIN,
    });
  }

  // An owner for every account/transaction. If no customers were requested,
  // create a single throwaway owner so accounts/txns still have a valid
  // userId; that owner is an ADMIN so it does not perturb totalCustomers.
  let owner = createdUsers[0];
  if (!owner) {
    userSeq += 1;
    owner = await User.create({
      firstName: 'Owner',
      lastName: `Only${userSeq}`,
      email: `owner-${userSeq}-${Date.now()}@example.com`,
      phone: '0241234567',
      dateOfBirth: new Date('1985-01-01'),
      address: '1 Owner Way',
      password: 'correct horse battery',
      role: ROLES.ADMIN,
    });
  }

  // Accounts with random integer-pesewa balances.
  const createdAccounts = [];
  for (const balance of spec.balances) {
    // eslint-disable-next-line no-await-in-loop
    const acct = await Account.create({
      userId: owner._id,
      accountNumber: nextAccountNumber(),
      balance,
      status: 'Active',
    });
    createdAccounts.push(acct);
  }

  // A reference account to attach transactions to (so accountId is valid). If
  // there are no accounts, create one dedicated account that is NOT part of the
  // balances set — but that would change totalAccounts, so instead only seed
  // transactions when at least one account exists; when none exist, there are
  // no transactions either (txnTypes still iterated but attached to a
  // transaction-only account created and counted explicitly — avoided here).
  const txnAccount = createdAccounts[0];
  let seededTxnTypes = spec.txnTypes;
  if (!txnAccount) {
    // No account to attach to → cannot seed transactions without inflating the
    // account count. Treat the transaction set as empty for this dataset.
    seededTxnTypes = [];
  }

  for (const type of seededTxnTypes) {
    // Minimal valid Transaction: amount within range, consistent balance
    // snapshots. Values here are arbitrary-but-valid; only the TYPE matters to
    // the statistics counts under test.
    // eslint-disable-next-line no-await-in-loop
    await Transaction.create({
      userId: owner._id,
      accountId: txnAccount._id,
      type,
      amount: 1000,
      balanceBefore: 0,
      balanceAfter: type === TRANSACTION_TYPES.DEBIT ? 0 : 1000,
      reference: nextReference(),
      status: TRANSACTION_STATUSES.COMPLETED,
    });
  }

  // Independent expectations, computed purely from the spec.
  const expectedLiquidity = spec.balances.reduce((sum, b) => sum + b, 0);
  const countType = (t) => seededTxnTypes.filter((x) => x === t).length;

  return {
    expected: {
      totalCustomers: spec.customers,
      totalAccounts: spec.balances.length,
      systemLiquidity: expectedLiquidity,
      totalDeposits: countType(TRANSACTION_TYPES.CREDIT),
      totalWithdrawals: countType(TRANSACTION_TYPES.DEBIT),
      totalTransfers: countType(TRANSACTION_TYPES.TRANSFER),
    },
  };
}

/** Remove every seeded document so the next fast-check run starts clean. */
async function clearAll() {
  await Promise.all([
    User.deleteMany({}),
    Account.deleteMany({}),
    Transaction.deleteMany({}),
  ]);
}

/**
 * Invoke `adminController.statistics` with a minimal stub and return the
 * captured `{ status, body }`. `ok(res, 200, msg, data)` calls
 * `res.status(200).json({ success, message, data })`, so the stub mirrors that
 * contract. `next` rethrows so any unexpected controller error fails the test
 * loudly instead of being silently swallowed.
 */
async function callStatistics() {
  const res = {
    code: undefined,
    body: undefined,
    status(code) {
      this.code = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
  await adminController.statistics({}, res, (err) => {
    throw err;
  });
  return { status: res.code, body: res.body };
}

/** Assert the controller output matches the independently computed expected. */
function assertMatches(out, expected) {
  expect(out.status).toBe(200);
  expect(out.body).toMatchObject({ success: true });
  const { data } = out.body;

  expect(data.totalCustomers).toBe(expected.totalCustomers);
  expect(data.totalAccounts).toBe(expected.totalAccounts);
  expect(data.systemLiquidity).toBe(expected.systemLiquidity);
  expect(data.totalDeposits).toBe(expected.totalDeposits);
  expect(data.totalWithdrawals).toBe(expected.totalWithdrawals);
  expect(data.totalTransfers).toBe(expected.totalTransfers);

  // Every total is a non-negative integer (design Property 18).
  for (const key of [
    'totalCustomers',
    'totalAccounts',
    'systemLiquidity',
    'totalDeposits',
    'totalWithdrawals',
    'totalTransfers',
  ]) {
    expect(Number.isInteger(data[key])).toBe(true);
    expect(data[key]).toBeGreaterThanOrEqual(0);
  }
}

describe('Property 18: statistics aggregation correctness', () => {
  test('every statistics field equals the independently computed value over random datasets', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          customers: fc.integer({ min: 0, max: 6 }),
          admins: fc.integer({ min: 0, max: 3 }),
          // Random number of accounts, each with a random integer balance.
          balances: fc.array(fc.integer({ min: 0, max: BALANCE_CAP }), {
            minLength: 0,
            maxLength: 8,
          }),
          // Random transaction types; counts per type are what statistics reports.
          txnTypes: fc.array(
            fc.constantFrom(
              'CREDIT',
              'DEBIT',
              'TRANSFER'
            ),
            { minLength: 0, maxLength: 12 }
          ),
        }),
        async (spec) => {
          try {
            const { expected } = await seedDataset(spec);

            const first = await callStatistics();
            assertMatches(first, expected);

            // Determinism/purity (design Property 18): a second invocation over
            // the same unchanged state yields byte-for-byte identical data.
            const second = await callStatistics();
            expect(second.body.data).toEqual(first.body.data);
          } finally {
            await clearAll();
          }
        }
      ),
      { numRuns: 30 }
    );
  });

  test('empty collections report zero for every total (Requirement 11.5)', async () => {
    // No users, accounts, or transactions seeded.
    const out = await callStatistics();
    assertMatches(out, {
      totalCustomers: 0,
      totalAccounts: 0,
      systemLiquidity: 0,
      totalDeposits: 0,
      totalWithdrawals: 0,
      totalTransfers: 0,
    });
  });
});
