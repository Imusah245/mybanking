// tests/properties/referenceUniqueness.property.test.js
//
// Property-based test for design Property 8 (Transaction reference uniqueness),
// Task 7.13.
//
// Property 8: For any sequence of successful money operations, every created
// Transaction has a `reference` matching `TXN-[A-Z0-9]{8}` that is unique
// across all transactions in the system.
//
// **Validates: Requirements 5.2, 6.2, 7.4**
//
// Module under test: src/services/bankService.js (`deposit`, `withdraw`,
// `transfer` — each composes `recordTransaction`, which calls
// `generateReference` and persists a Transaction whose `reference` is guarded
// by the model's unique index). The reference format itself is produced by
// src/utils/generateReference.js and enforced by the Transaction model's
// `match` regex.
//
// This is a FEATURE spec property: it MUST HOLD, so the test is expected to
// PASS. Transfers run inside a MongoDB multi-document ACID transaction, so this
// suite relies on the single-node replica set provided by tests/setup.js
// (wired via jest.config.js), which also connects Mongoose and clears every
// collection BETWEEN Jest test cases (not between fast-check runs).
//
// Each fast-check predicate run drives MANY money operations across a pool of
// freshly seeded Active accounts so a large batch of Transaction records is
// created, then collects EVERY reference in the collection and asserts:
//   1. every reference matches ^TXN-[A-Z0-9]{8}$,
//   2. there are no duplicate references (Set size === array length), and
//   3. the count equals the number of ledger legs the operations produced
//      (deposit/withdraw => 1 leg; transfer => 2 legs).
// Because fast-check runs many predicate iterations inside a single Jest test
// and setup.js only clears collections between test cases, each run re-seeds
// its own pool and cleans up afterwards so iterations stay independent.
//
// env.js validates MONGO_URI and JWT_SECRET at import time; mirroring the other
// tests/properties files we set them before importing the service under test.

import fc from 'fast-check';
import mongoose from 'mongoose';

// Must be set before env-validating modules are imported.
process.env.MONGO_URI =
  process.env.MONGO_URI ||
  'mongodb://127.0.0.1:27017/mybanking?replicaSet=rs0';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-value';

/** @type {typeof import('../../src/models/Account.js').default} */
let Account;
let ACCOUNT_STATUS;
/** @type {typeof import('../../src/models/Transaction.js').default} */
let Transaction;
let AMOUNT_MAX;
/** @type {typeof import('../../src/services/bankService.js').deposit} */
let deposit;
/** @type {typeof import('../../src/services/bankService.js').withdraw} */
let withdraw;
/** @type {typeof import('../../src/services/bankService.js').transfer} */
let transfer;

beforeAll(async () => {
  const accountMod = await import('../../src/models/Account.js');
  Account = accountMod.default;
  ACCOUNT_STATUS = accountMod.ACCOUNT_STATUS;

  const txnMod = await import('../../src/models/Transaction.js');
  Transaction = txnMod.default;
  AMOUNT_MAX = txnMod.AMOUNT_MAX;

  const serviceMod = await import('../../src/services/bankService.js');
  deposit = serviceMod.deposit;
  withdraw = serviceMod.withdraw;
  transfer = serviceMod.transfer;

  // Build the unique indexes (reference / accountNumber) before the property
  // loop so uniqueness behaves as it does in production.
  await Account.init();
  await Transaction.init();
});

// The reference format every persisted Transaction must satisfy (design
// Property 8; enforced by generateReference and the Transaction `match` regex).
const REFERENCE_PATTERN = /^TXN-[A-Z0-9]{8}$/;

// A per-iteration unique 10-digit account number. fast-check predicate runs are
// awaited sequentially, so a monotonically increasing, zero-padded counter
// yields collision-free numbers that always match the ^\d{10}$ schema rule.
let accountSeq = 0;
function nextAccountNumber() {
  accountSeq += 1;
  return String(accountSeq).padStart(10, '0');
}

// Keep every seeded balance and every operation amount comfortably inside the
// stored-balance ceiling so a recipient credit can never overflow
// MAX_BALANCE_PESEWAS and the many operations in a run never approach the max.
const START_BALANCE = 1_000_000_000; // 10,000,000.00 GHS in pesewas
const OP_AMOUNT_MAX = 1_000_000; //       10,000.00 GHS in pesewas

/**
 * Seed `n` fresh Active accounts, each owned by a distinct user and funded with
 * a generous starting balance so that a run's mix of withdrawals and transfers
 * mostly succeeds (and therefore records ledger legs).
 *
 * @param {number} n - How many accounts to create.
 * @returns {Promise<Array<{ userId: mongoose.Types.ObjectId, account: import('mongoose').Document }>>}
 */
async function seedAccounts(n) {
  const seeded = [];
  for (let i = 0; i < n; i += 1) {
    const userId = new mongoose.Types.ObjectId();
    // eslint-disable-next-line no-await-in-loop
    const account = await Account.create({
      userId,
      accountNumber: nextAccountNumber(),
      balance: START_BALANCE,
      status: ACCOUNT_STATUS.ACTIVE,
    });
    seeded.push({ userId, account });
  }
  return seeded;
}

/** Remove all accounts and transactions so each predicate run starts clean. */
async function cleanup() {
  await Promise.all([Account.deleteMany({}), Transaction.deleteMany({})]);
}

// A single money operation descriptor the predicate executes against the pool.
// `op` picks the operation; the index/amount seeds select accounts and amount.
const opArb = fc.record({
  op: fc.constantFrom('deposit', 'withdraw', 'transfer'),
  from: fc.nat(),
  to: fc.nat(),
  amount: fc.integer({ min: 1, max: OP_AMOUNT_MAX }),
});

describe('Property 8: Transaction reference uniqueness (bankService money operations)', () => {
  test('many mixed money operations produce only well-formed, globally unique references (Validates: Requirements 5.2, 6.2, 7.4)', async () => {
    await fc.assert(
      fc.asyncProperty(
        // A pool of 2..5 distinct Active accounts so transfers have a valid,
        // non-self counterparty to target.
        fc.integer({ min: 2, max: 5 }),
        // A long batch of operations so MANY Transaction records are created
        // in every single run.
        fc.array(opArb, { minLength: 20, maxLength: 40 }),
        async (accountCount, ops) => {
          const pool = await seedAccounts(accountCount);
          try {
            // The number of ledger legs we expect to be persisted: a deposit or
            // withdraw records 1 leg; a transfer records 2 (debit + credit).
            // Only operations that actually succeed count — withdrawals that
            // exceed the balance throw and record nothing.
            let expectedLegs = 0;

            for (const { op, from, to, amount } of ops) {
              const sender = pool[from % pool.length];
              // A distinct recipient for transfers (skip ahead so it is never
              // the sender, which would trip the self-transfer guard).
              const recipient = pool[(to + 1) % pool.length];
              const safeAmount = Math.min(amount, OP_AMOUNT_MAX, AMOUNT_MAX);

              try {
                if (op === 'deposit') {
                  // eslint-disable-next-line no-await-in-loop
                  await deposit(sender.userId, safeAmount);
                  expectedLegs += 1;
                } else if (op === 'withdraw') {
                  // eslint-disable-next-line no-await-in-loop
                  await withdraw(sender.userId, safeAmount);
                  expectedLegs += 1;
                } else {
                  // transfer: ensure sender !== recipient; if the pool mapping
                  // collides, nudge to the next account.
                  let dest = recipient;
                  if (
                    dest.account.accountNumber ===
                    sender.account.accountNumber
                  ) {
                    dest = pool[(to + 2) % pool.length];
                  }
                  if (
                    dest.account.accountNumber ===
                    sender.account.accountNumber
                  ) {
                    // Pool of size 1 edge (shouldn't happen: min 2) — skip.
                    continue;
                  }
                  // eslint-disable-next-line no-await-in-loop
                  await transfer(
                    sender.userId,
                    dest.account.accountNumber,
                    safeAmount
                  );
                  expectedLegs += 2;
                }
              } catch (err) {
                // A withdrawal/transfer may legitimately fail on insufficient
                // funds after prior operations drained the account. Such a
                // failure records NO transaction, so it does not contribute a
                // leg. Any other error is a real defect and should surface.
                const isInsufficient =
                  err?.statusCode === 400 &&
                  /insufficient funds/i.test(err?.message ?? '');
                if (!isInsufficient) {
                  throw err;
                }
              }
            }

            // Collect EVERY reference across the whole collection.
            const txns = await Transaction.find({}, { reference: 1, _id: 0 });
            const refs = txns.map((t) => t.reference);

            // The number of persisted records equals the ledger legs the
            // successful operations produced.
            expect(refs).toHaveLength(expectedLegs);

            // 1) Every reference is well-formed.
            for (const ref of refs) {
              expect(ref).toMatch(REFERENCE_PATTERN);
            }

            // 2) All references are globally unique (no duplicates).
            expect(new Set(refs).size).toBe(refs.length);
          } finally {
            await cleanup();
          }
        }
      ),
      { numRuns: 25 }
    );
  });
});
