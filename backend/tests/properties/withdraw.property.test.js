// tests/properties/withdraw.property.test.js
//
// Property-based test for Task 7.8 — design Property 3:
// "Withdrawal effect and non-negativity".
//
// Property 3 (design.md): For any Active account whose balance is greater than
// or equal to a valid amount, after a successful withdrawal the balance equals
// the prior balance minus the amount and is NEVER negative, and exactly one
// COMPLETED DEBIT transaction is recorded. Conversely, a withdrawal that
// exceeds the available balance is rejected with InsufficientFundsError (400)
// and leaves the balance unchanged with no transaction recorded.
//
// Validates: Requirements 6.1, 6.2, 15.3
//
// Module under test: src/services/bankService.js -> withdraw(userId, amount).
// Models: Account, Transaction. Error: InsufficientFundsError (statusCode 400).
//
// The in-memory single-node replica set, Mongoose connection, and per-test
// collection clearing are provided by tests/setup.js. Each fast-check predicate
// iteration re-seeds a fresh user + Active account and cleans up its own data
// afterwards so iterations are independent (afterEach only runs between test
// cases, not between fast-check runs).
//
// env.js validates MONGO_URI and JWT_SECRET at import time; mirroring the other
// tests we set them before dynamically importing the service under test.

import fc from 'fast-check';
import mongoose from 'mongoose';

// Must be set before env-validating modules are imported.
process.env.MONGO_URI =
  process.env.MONGO_URI ||
  'mongodb://127.0.0.1:27017/mybanking?replicaSet=rs0';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-value';

/** @type {typeof import('../../src/models/Account.js').default} */
let Account;
/** @type {{ ACCOUNT_STATUS: Record<string,string> }} */
let ACCOUNT_STATUS;
/** @type {typeof import('../../src/models/Transaction.js').default} */
let Transaction;
let TRANSACTION_TYPES;
let TRANSACTION_STATUSES;
let AMOUNT_MAX;
/** @type {typeof import('../../src/services/bankService.js').withdraw} */
let withdraw;
/** @type {typeof import('../../src/utils/errors.js').InsufficientFundsError} */
let InsufficientFundsError;

beforeAll(async () => {
  const accountMod = await import('../../src/models/Account.js');
  Account = accountMod.default;
  ACCOUNT_STATUS = accountMod.ACCOUNT_STATUS;

  const txnMod = await import('../../src/models/Transaction.js');
  Transaction = txnMod.default;
  TRANSACTION_TYPES = txnMod.TRANSACTION_TYPES;
  TRANSACTION_STATUSES = txnMod.TRANSACTION_STATUSES;
  AMOUNT_MAX = txnMod.AMOUNT_MAX;

  const serviceMod = await import('../../src/services/bankService.js');
  withdraw = serviceMod.withdraw;

  const errorsMod = await import('../../src/utils/errors.js');
  InsufficientFundsError = errorsMod.InsufficientFundsError;
});

/**
 * Seed one fresh user id + Active account with the given starting balance.
 * Each account gets a unique 10-digit number so iterations never collide on the
 * unique index.
 */
let accountSeq = 0;
async function seedAccount(startingBalance) {
  const userId = new mongoose.Types.ObjectId();
  // Zero-padded, monotonically increasing 10-digit number — always unique and
  // always matches ^\d{10}$.
  const accountNumber = String(accountSeq++).padStart(10, '0');
  const account = await Account.create({
    userId,
    accountNumber,
    balance: startingBalance,
    status: ACCOUNT_STATUS.ACTIVE,
  });
  return { userId, account };
}

/** Remove everything seeded during an iteration so runs stay independent. */
async function cleanup() {
  await Promise.all([Account.deleteMany({}), Transaction.deleteMany({})]);
}

// Keep balances well under AMOUNT_MAX so that an over-withdraw amount in
// [balance+1, AMOUNT_MAX] is always a non-empty, valid range.
const BALANCE_MAX = 1_000_000_000; // 10,000,000.00 GHS in pesewas

describe('Property 3: withdrawal effect and non-negativity (Task 7.8)', () => {
  // Case A — a valid withdrawal of an amount within [1, balance] succeeds:
  // the balance decreases by exactly the amount (never negative) and exactly
  // one COMPLETED DEBIT transaction is recorded with the correct snapshots.
  test('valid withdrawal decreases balance by exactly the amount and records one COMPLETED DEBIT (Validates: Requirements 6.1, 6.2, 15.3)', async () => {
    await fc.assert(
      fc
        .asyncProperty(
          fc.integer({ min: 1, max: BALANCE_MAX }),
          fc.integer({ min: 1, max: BALANCE_MAX }),
          async (startingBalance, amountSeed) => {
            // Constrain the withdrawal to [1, startingBalance].
            const amount =
              startingBalance === 1
                ? 1
                : (amountSeed % startingBalance) + 1; // in [1, startingBalance]

            const { userId, account } = await seedAccount(startingBalance);

            const { account: updated, transaction } = await withdraw(
              userId,
              amount
            );

            // Balance decreased by exactly the amount and is never negative.
            expect(updated.balance).toBe(startingBalance - amount);
            expect(updated.balance).toBeGreaterThanOrEqual(0);

            // Persisted balance matches the returned document.
            const reread = await Account.findById(account._id);
            expect(reread.balance).toBe(startingBalance - amount);

            // Exactly one COMPLETED DEBIT transaction for this account.
            const txns = await Transaction.find({ accountId: account._id });
            expect(txns).toHaveLength(1);
            expect(transaction.type).toBe(TRANSACTION_TYPES.DEBIT);
            expect(transaction.status).toBe(TRANSACTION_STATUSES.COMPLETED);
            expect(transaction.amount).toBe(amount);
            // Ledger snapshots: balanceBefore=old, balanceAfter=old-amount.
            expect(transaction.balanceBefore).toBe(startingBalance);
            expect(transaction.balanceAfter).toBe(startingBalance - amount);
          }
        )
        .afterEach(cleanup),
      { numRuns: 40 }
    );
  });

  // Case B — an over-withdrawal of an amount in [balance+1, AMOUNT_MAX] is
  // rejected with InsufficientFundsError (400); the balance is unchanged and no
  // transaction is recorded.
  test('over-withdrawal is rejected with InsufficientFundsError (400) and leaves balance unchanged with no transaction (Validates: Requirements 6.1, 15.3)', async () => {
    await fc.assert(
      fc
        .asyncProperty(
          fc.integer({ min: 0, max: BALANCE_MAX }),
          fc.integer({ min: 0, max: 1_000_000 }),
          async (startingBalance, overSeed) => {
            // Amount strictly greater than the balance, within [balance+1, AMOUNT_MAX].
            const amount = startingBalance + 1 + (overSeed % 1_000_000);
            // Safety: never exceed AMOUNT_MAX.
            const safeAmount = Math.min(amount, AMOUNT_MAX);

            const { userId, account } = await seedAccount(startingBalance);

            let caught;
            try {
              await withdraw(userId, safeAmount);
            } catch (err) {
              caught = err;
            }

            // Rejected with InsufficientFundsError (statusCode 400).
            expect(caught).toBeInstanceOf(InsufficientFundsError);
            expect(caught.statusCode).toBe(400);

            // Balance unchanged.
            const reread = await Account.findById(account._id);
            expect(reread.balance).toBe(startingBalance);

            // No transaction recorded.
            const count = await Transaction.countDocuments({
              accountId: account._id,
            });
            expect(count).toBe(0);
          }
        )
        .afterEach(cleanup),
      { numRuns: 40 }
    );
  });

  // Non-negativity invariant across a random SEQUENCE of withdrawals on a single
  // account: every attempted withdrawal either succeeds (and never drives the
  // balance below zero) or is rejected as insufficient funds; the running
  // balance stays >= 0 throughout and equals the sum of applied debits.
  test('a random sequence of withdrawals never drives the balance below zero (Validates: Requirements 6.1, 15.3)', async () => {
    await fc.assert(
      fc
        .asyncProperty(
          fc.integer({ min: 0, max: BALANCE_MAX }),
          fc.array(fc.integer({ min: 1, max: BALANCE_MAX }), {
            minLength: 1,
            maxLength: 8,
          }),
          async (startingBalance, amounts) => {
            const { userId, account } = await seedAccount(startingBalance);

            let expectedBalance = startingBalance;
            let completedDebits = 0;

            for (const amount of amounts) {
              const cappedAmount = Math.min(amount, AMOUNT_MAX);
              try {
                const { account: updated } = await withdraw(
                  userId,
                  cappedAmount
                );
                // Success only when funds covered it; balance decreased exactly.
                expectedBalance -= cappedAmount;
                completedDebits += 1;
                expect(updated.balance).toBe(expectedBalance);
                expect(updated.balance).toBeGreaterThanOrEqual(0);
              } catch (err) {
                // The only expected rejection is insufficient funds; it must
                // leave the balance unchanged.
                expect(err).toBeInstanceOf(InsufficientFundsError);
                expect(err.statusCode).toBe(400);
              }

              // Invariant after every step: balance never negative and matches
              // the independently tracked expected balance.
              const reread = await Account.findById(account._id);
              expect(reread.balance).toBeGreaterThanOrEqual(0);
              expect(reread.balance).toBe(expectedBalance);
            }

            // Exactly one COMPLETED DEBIT per successful withdrawal.
            const debitCount = await Transaction.countDocuments({
              accountId: account._id,
              type: TRANSACTION_TYPES.DEBIT,
              status: TRANSACTION_STATUSES.COMPLETED,
            });
            expect(debitCount).toBe(completedDebits);
          }
        )
        .afterEach(cleanup),
      { numRuns: 30 }
    );
  });
});
