// tests/properties/ownershipIsolation.property.test.js
//
// Property 14: Data ownership isolation (Task 11.6).
//
// *For any* customer and *any* transaction data returned to them, every returned
// record is owned by that customer; and *for any* attempt by a customer to fetch
// a specific transaction owned by another user, the response is HTTP 404 and no
// foreign data is returned (existence is NOT leaked).
//
// This is a FEATURE property: it MUST HOLD, so the test is expected to PASS.
//
// **Validates: Requirements 8.1, 8.11, 14.6, 14.7**  (`fast-check`)
//
// Target surface: bankService.listTransactions(userId, filters) and
// bankService.getTransactionForUser(userId, txnId). Both are pure,
// ownership-scoped reads whose base query is ALWAYS constrained by `userId`, so:
//   - listTransactions(U) can only ever return U's own records; across every
//     page the union of returned ids equals exactly U's seeded id set and
//     never contains any other user's record.
//   - getTransactionForUser(U, ownId) returns U's record; getTransactionForUser
//     (U, foreignId) throws NotFoundError (404) — identical to a nonexistent id,
//     so the existence of another user's record is never leaked.
//
// Exercises the real service against the in-memory single-node replica set wired
// by tests/setup.js. No mocks: records are genuinely persisted and genuinely
// queried. Collections are cleared only between tests (not between fast-check
// runs), so each predicate re-seeds with globally unique emails/account numbers
// to avoid unique-index collisions, and cleans up its own data afterward.
//
// src/config/env.js validates required secrets at import time and there is no
// committed .env, so the required env vars are set BEFORE the env-dependent
// modules are dynamically imported (mirroring the other property tests).

import fc from 'fast-check';
import mongoose from 'mongoose';

// Must be set before any env-validating module is imported.
process.env.MONGO_URI =
  process.env.MONGO_URI ||
  'mongodb://127.0.0.1:27017/mybanking?replicaSet=rs0';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-value';
process.env.BCRYPT_ROUNDS = process.env.BCRYPT_ROUNDS || '4';

/** @type {typeof import('../../src/services/bankService.js')} */
let bankService;
/** @type {import('mongoose').Model} */
let User;
/** @type {import('mongoose').Model} */
let Account;
/** @type {import('mongoose').Model} */
let Transaction;
let TRANSACTION_TYPES;
let TRANSACTION_STATUSES;
let NotFoundError;

beforeAll(async () => {
  // Dynamic imports so the env vars above are in place before env.js validates.
  const userMod = await import('../../src/models/User.js');
  const accountMod = await import('../../src/models/Account.js');
  const txnMod = await import('../../src/models/Transaction.js');
  const errorsMod = await import('../../src/utils/errors.js');
  bankService = await import('../../src/services/bankService.js');

  User = userMod.default;
  Account = accountMod.default;
  Transaction = txnMod.default;
  TRANSACTION_TYPES = txnMod.TRANSACTION_TYPES;
  TRANSACTION_STATUSES = txnMod.TRANSACTION_STATUSES;
  NotFoundError = errorsMod.NotFoundError;
});

// Globally unique sequence shared across all fast-check runs within this file so
// repeated predicates (collections cleared only between tests) never collide on
// the unique email / accountNumber indexes.
let seq = 0;

/**
 * Seed one user with one Active account and `txnCount` genuinely-persisted
 * transactions owned by that user. Returns the user id, account, and the exact
 * set of created transaction ids (as strings) for later equality checks.
 */
async function seedUserWithTransactions(txnCount) {
  seq += 1;
  const tag = `${seq}-${Date.now()}`;

  const user = await User.create({
    firstName: 'Owner',
    lastName: `U${seq}`,
    email: `owner-${tag}@example.com`,
    phone: '0241234567',
    dateOfBirth: new Date('1990-01-01'),
    address: '1 Isolation Way',
    password: 'correct horse battery',
  });

  const accountNumber = String(1_000_000_000 + (seq % 8_999_999_999)).padStart(10, '0');
  const account = await Account.create({
    userId: user._id,
    accountNumber,
    balance: 1_000_000,
    status: 'Active',
  });

  const types = Object.values(TRANSACTION_TYPES);
  const ids = [];
  for (let i = 0; i < txnCount; i += 1) {
    const type = types[i % types.length];
    const amount = (i + 1) * 100; // positive integer pesewas within range
    const [txn] = await Transaction.create([
      {
        userId: user._id,
        accountId: account._id,
        type,
        amount,
        balanceBefore: 1_000_000,
        balanceAfter: 1_000_000,
        description: `seeded op ${i} for ${tag}`,
        reference: `TXN-${seq.toString(36).toUpperCase().padStart(4, '0').slice(-4)}${i
          .toString(36)
          .toUpperCase()
          .padStart(4, '0')
          .slice(-4)}`,
        status: TRANSACTION_STATUSES.COMPLETED,
      },
    ]);
    ids.push(String(txn._id));
  }

  return { userId: user._id, account, txnIds: ids };
}

/**
 * Page through listTransactions for a user and return the flattened set of
 * returned transaction ids (strings) plus every returned record, so we can
 * assert both the id set equality and per-item ownership.
 */
async function collectAllViaPagination(userId, pageLimit) {
  const seenIds = new Set();
  const allItems = [];
  let page = 1;
  // Hard upper bound on page walking to avoid any accidental infinite loop.
  for (let guard = 0; guard < 1000; guard += 1) {
    const result = await bankService.listTransactions(userId, {
      page,
      limit: pageLimit,
    });
    for (const item of result.items) {
      seenIds.add(String(item._id));
      allItems.push(item);
    }
    const totalPages = result.total === 0 ? 0 : Math.ceil(result.total / pageLimit);
    if (page >= totalPages) break;
    page += 1;
  }
  return { seenIds, allItems };
}

afterEach(async () => {
  // Explicit per-test cleanup (setup.js also clears between tests, but this keeps
  // the property self-contained and leaves no residue if ordering changes).
  await Promise.all([
    Transaction.deleteMany({}),
    Account.deleteMany({}),
    User.deleteMany({}),
  ]);
});

describe('Property 14: data ownership isolation', () => {
  test('listTransactions returns only the owner records; cross-user getById → 404 (no existence leak)', async () => {
    await fc.assert(
      fc.asyncProperty(
        // Per-user transaction counts for N distinct users (2–4 users).
        fc.array(fc.integer({ min: 0, max: 7 }), { minLength: 2, maxLength: 4 }),
        // Page size used to walk each user's history (small values force
        // genuine multi-page pagination for larger counts).
        fc.integer({ min: 1, max: 5 }),
        // Index selector used to pick which OTHER user's txn each user tries to
        // cross-fetch; mapped modulo the available foreign ids at use time.
        fc.integer({ min: 0, max: 50 }),
        async (counts, pageLimit, crossSelector) => {
          // --- Seed N distinct users, each with their own account + txns. ----
          const users = [];
          for (const count of counts) {
            // eslint-disable-next-line no-await-in-loop
            const seeded = await seedUserWithTransactions(count);
            users.push(seeded);
          }

          try {
            for (let u = 0; u < users.length; u += 1) {
              const me = users[u];
              const myIdSet = new Set(me.txnIds);

              // --- SOUNDNESS + COMPLETENESS via pagination -------------------
              const { seenIds, allItems } = await collectAllViaPagination(
                me.userId,
                pageLimit
              );

              // Every returned item is owned by this user (no foreign record).
              for (const item of allItems) {
                expect(String(item.userId)).toBe(String(me.userId));
              }

              // The union across pages equals EXACTLY this user's seeded ids.
              expect(seenIds.size).toBe(myIdSet.size);
              for (const id of myIdSet) {
                expect(seenIds.has(id)).toBe(true);
              }
              // And contains none of any OTHER user's ids.
              for (let v = 0; v < users.length; v += 1) {
                if (v === u) continue;
                for (const foreignId of users[v].txnIds) {
                  expect(seenIds.has(foreignId)).toBe(false);
                }
              }

              // --- getTransactionForUser: own id resolves --------------------
              if (me.txnIds.length > 0) {
                const ownId = me.txnIds[crossSelector % me.txnIds.length];
                const own = await bankService.getTransactionForUser(
                  me.userId,
                  ownId
                );
                expect(String(own._id)).toBe(ownId);
                expect(String(own.userId)).toBe(String(me.userId));
              }

              // --- getTransactionForUser: foreign id → 404 (no leak) ---------
              // Gather every OTHER user's txn id and try to cross-fetch one.
              const foreignIds = [];
              for (let v = 0; v < users.length; v += 1) {
                if (v === u) continue;
                foreignIds.push(...users[v].txnIds);
              }

              if (foreignIds.length > 0) {
                const foreignId = foreignIds[crossSelector % foreignIds.length];

                let threw = null;
                try {
                  await bankService.getTransactionForUser(me.userId, foreignId);
                } catch (err) {
                  threw = err;
                }

                // Must throw NotFoundError (404): a record owned by another user
                // is indistinguishable from a nonexistent one — no cross-user
                // read and no existence leak.
                expect(threw).toBeInstanceOf(NotFoundError);
                expect(threw.statusCode).toBe(404);
              }

              // Sanity: a definitely-nonexistent id yields the SAME 404, so the
              // foreign-id response is indistinguishable from a nonexistent one.
              const ghostId = new mongoose.Types.ObjectId().toString();
              let ghostThrew = null;
              try {
                await bankService.getTransactionForUser(me.userId, ghostId);
              } catch (err) {
                ghostThrew = err;
              }
              expect(ghostThrew).toBeInstanceOf(NotFoundError);
              expect(ghostThrew.statusCode).toBe(404);
            }
          } finally {
            // Clean up this run's data so the next fast-check run starts clean
            // (collections are only cleared between tests, not between runs).
            await Promise.all([
              Transaction.deleteMany({}),
              Account.deleteMany({}),
              User.deleteMany({}),
            ]);
          }
        }
      ),
      { numRuns: 30 }
    );
  });
});
