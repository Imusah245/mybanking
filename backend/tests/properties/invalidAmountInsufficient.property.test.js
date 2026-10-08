// tests/properties/invalidAmountInsufficient.property.test.js
//
// Property-based test for Task 7.14 — design Properties 9 and 10.
//
// Property 9 (design.md): "Invalid amount rejected without side effects".
//   For any deposit/withdrawal/transfer amount that is NOT a positive integer
//   within [1, 999_999_999_999] pesewas (zero, negatives, non-integer floats,
//   NaN/Infinity, values above AMOUNT_MAX, or non-number types), the request is
//   rejected with a ValidationError (HTTP 400) BEFORE any balance change, so the
//   affected account balance is unchanged and no transaction is recorded.
//   Validates: Requirements 5.3, 6.4, 7.6, 15.5
//
// Property 10 (design.md): "Insufficient funds rejected without side effects".
//   For any withdrawal/transfer whose (valid) amount exceeds the available
//   active sender balance, the request is rejected with an InsufficientFundsError
//   (HTTP 400) and all affected balances remain unchanged with no transaction
//   recorded.
//   Validates: Requirements 6.3, 7.10, 15.6
//
// Module under test: src/services/bankService.js -> deposit / withdraw /
// transfer (and the assertValidAmount/isValidAmount guard behind them).
// Models: Account, Transaction. Errors: ValidationError (400),
// InsufficientFundsError (400).
//
// Transfers run inside a MongoDB multi-document ACID transaction, so this suite
// relies on the single-node replica set provided by tests/setup.js. The
// Mongoose connection and per-test collection clearing are also provided there.
// Each fast-check predicate iteration re-seeds fresh Active account(s) and
// cleans up its own data afterwards so iterations are independent (afterEach
// only runs between test cases, not between fast-check runs).
//
// env.js validates MONGO_URI and JWT_SECRET at import time; mirroring the other
// property tests we set them before dynamically importing the service.

import fc from 'fast-check';
import mongoose from 'mongoose';

// Must be set before env-validating modules are imported.
process.env.MONGO_URI =
  process.env.MONGO_URI ||
  'mongodb://127.0.0.1:27017/mybanking?replicaSet=rs0';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-value';

/** @type {typeof import('../../src/models/Account.js').default} */
let Account;
/** @type {Record<string,string>} */
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
/** @type {typeof import('../../src/utils/errors.js').ValidationError} */
let ValidationError;
/** @type {typeof import('../../src/utils/errors.js').InsufficientFundsError} */
let InsufficientFundsError;

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

  const errorsMod = await import('../../src/utils/errors.js');
  ValidationError = errorsMod.ValidationError;
  InsufficientFundsError = errorsMod.InsufficientFundsError;
});

// Monotonic sequence so every seeded account number is unique and matches
// ^\d{10}$ (never collides on the unique index across iterations).
let accountSeq = 0;
function nextAccountNumber() {
  return String(accountSeq++).padStart(10, '0');
}

/** Seed one fresh user id + Active account with the given starting balance. */
async function seedAccount(startingBalance) {
  const userId = new mongoose.Types.ObjectId();
  const account = await Account.create({
    userId,
    accountNumber: nextAccountNumber(),
    balance: startingBalance,
    status: ACCOUNT_STATUS.ACTIVE,
  });
  return { userId, account };
}

/**
 * Seed a sender (user + Active account) and a recipient (Active account with a
 * distinct account number) so transfer never trips the self-transfer guard.
 */
async function seedPair(senderBalance, recipientBalance) {
  const senderUserId = new mongoose.Types.ObjectId();
  const recipientUserId = new mongoose.Types.ObjectId();
  const [senderAccount, recipientAccount] = await Promise.all([
    Account.create({
      userId: senderUserId,
      accountNumber: nextAccountNumber(),
      balance: senderBalance,
      status: ACCOUNT_STATUS.ACTIVE,
    }),
    Account.create({
      userId: recipientUserId,
      accountNumber: nextAccountNumber(),
      balance: recipientBalance,
      status: ACCOUNT_STATUS.ACTIVE,
    }),
  ]);
  return { senderUserId, senderAccount, recipientAccount };
}

/** Remove everything seeded during an iteration so runs stay independent. */
async function cleanup() {
  await Promise.all([Account.deleteMany({}), Transaction.deleteMany({})]);
}

// Keep balances well under AMOUNT_MAX so an over-amount in [balance+1,
// AMOUNT_MAX] is always a non-empty, valid range for the insufficient-funds
// case.
const BALANCE_MAX = 1_000_000_000; // 10,000,000.00 GHS in pesewas

/**
 * Generator of INVALID amounts covering every rejection class of Property 9:
 *   - zero and negative integers,
 *   - non-integer finite floats (e.g. 10.5),
 *   - NaN and ±Infinity,
 *   - integers strictly greater than AMOUNT_MAX (out of range high),
 *   - non-number types (string / boolean / null / undefined / object).
 * isValidAmount must reject all of these.
 */
function invalidAmountArbitrary() {
  return fc.oneof(
    // Zero and negative integers (<= 0).
    fc.integer({ min: -1_000_000_000, max: 0 }),
    // Non-integer finite floats. Filter out any value that happens to be an
    // integer (e.g. 3.0) so the amount is genuinely non-integer.
    fc
      .double({ min: -1_000_000, max: 1_000_000, noNaN: true })
      .filter((n) => !Number.isInteger(n)),
    // Special non-finite numbers.
    fc.constantFrom(Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY),
    // Integers above the maximum allowed amount.
    fc.integer({ min: AMOUNT_MAX + 1, max: Number.MAX_SAFE_INTEGER }),
    // Non-number types.
    fc.constantFrom('100', '', 'abc', true, false, null, undefined, {}, [])
  );
}

describe('Property 9: invalid amount rejected without side effects (Task 7.14)', () => {
  // deposit/withdraw with an invalid amount must throw ValidationError (400)
  // and leave the single account's balance unchanged with no transaction.
  test('deposit and withdraw reject invalid amounts with ValidationError (400), no side effects (Validates: Requirements 5.3, 6.4, 15.5)', async () => {
    await fc.assert(
      fc
        .asyncProperty(
          fc.integer({ min: 0, max: BALANCE_MAX }),
          invalidAmountArbitrary(),
          fc.constantFrom('deposit', 'withdraw'),
          async (startingBalance, badAmount, op) => {
            const { userId, account } = await seedAccount(startingBalance);

            let caught;
            try {
              if (op === 'deposit') {
                await deposit(userId, badAmount);
              } else {
                await withdraw(userId, badAmount);
              }
            } catch (err) {
              caught = err;
            }

            // Rejected with ValidationError (statusCode 400).
            expect(caught).toBeInstanceOf(ValidationError);
            expect(caught.statusCode).toBe(400);

            // Balance unchanged (no side effect).
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
      { numRuns: 80 }
    );
  });

  // transfer with an invalid amount must throw ValidationError (400) and leave
  // BOTH the sender and recipient balances unchanged with no transaction.
  test('transfer rejects invalid amounts with ValidationError (400), both balances unchanged (Validates: Requirements 7.6, 15.5)', async () => {
    await fc.assert(
      fc
        .asyncProperty(
          fc.integer({ min: 0, max: BALANCE_MAX }),
          fc.integer({ min: 0, max: BALANCE_MAX }),
          invalidAmountArbitrary(),
          async (senderBalance, recipientBalance, badAmount) => {
            const { senderUserId, senderAccount, recipientAccount } =
              await seedPair(senderBalance, recipientBalance);

            let caught;
            try {
              await transfer(
                senderUserId,
                recipientAccount.accountNumber,
                badAmount
              );
            } catch (err) {
              caught = err;
            }

            // Rejected with ValidationError (statusCode 400).
            expect(caught).toBeInstanceOf(ValidationError);
            expect(caught.statusCode).toBe(400);

            // Both balances unchanged (no side effect on either party).
            const [senderReread, recipientReread] = await Promise.all([
              Account.findById(senderAccount._id),
              Account.findById(recipientAccount._id),
            ]);
            expect(senderReread.balance).toBe(senderBalance);
            expect(recipientReread.balance).toBe(recipientBalance);

            // No transactions recorded for either account.
            const count = await Transaction.countDocuments({
              accountId: { $in: [senderAccount._id, recipientAccount._id] },
            });
            expect(count).toBe(0);
          }
        )
        .afterEach(cleanup),
      { numRuns: 60 }
    );
  });
});

describe('Property 10: insufficient funds rejected without side effects (Task 7.14)', () => {
  // withdraw of a valid amount strictly greater than the balance must throw
  // InsufficientFundsError (400); balance unchanged, no transaction.
  test('withdraw rejects a valid amount exceeding the balance with InsufficientFundsError (400), no side effects (Validates: Requirements 6.3, 15.6)', async () => {
    await fc.assert(
      fc
        .asyncProperty(
          fc.integer({ min: 0, max: BALANCE_MAX }),
          fc.integer({ min: 1, max: 1_000_000 }),
          async (startingBalance, overSeed) => {
            // A valid-but-too-large amount in [balance+1, AMOUNT_MAX].
            const amount = Math.min(startingBalance + overSeed, AMOUNT_MAX);
            // Guard: with balance <= BALANCE_MAX and overSeed >= 1 this is
            // always > balance and within range, so skip only the impossible
            // degenerate case.
            if (amount <= startingBalance) return;

            const { userId, account } = await seedAccount(startingBalance);

            let caught;
            try {
              await withdraw(userId, amount);
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
      { numRuns: 60 }
    );
  });

  // transfer of a valid amount strictly greater than the sender balance must
  // throw InsufficientFundsError (400); both balances unchanged, no txn.
  test('transfer rejects a valid amount exceeding the sender balance with InsufficientFundsError (400), no side effects (Validates: Requirements 7.10, 15.6)', async () => {
    await fc.assert(
      fc
        .asyncProperty(
          fc.integer({ min: 0, max: BALANCE_MAX }),
          fc.integer({ min: 0, max: BALANCE_MAX }),
          fc.integer({ min: 1, max: 1_000_000 }),
          async (senderBalance, recipientBalance, overSeed) => {
            const amount = Math.min(senderBalance + overSeed, AMOUNT_MAX);
            if (amount <= senderBalance) return;

            const { senderUserId, senderAccount, recipientAccount } =
              await seedPair(senderBalance, recipientBalance);

            let caught;
            try {
              await transfer(
                senderUserId,
                recipientAccount.accountNumber,
                amount
              );
            } catch (err) {
              caught = err;
            }

            // Rejected with InsufficientFundsError (statusCode 400).
            expect(caught).toBeInstanceOf(InsufficientFundsError);
            expect(caught.statusCode).toBe(400);

            // Both balances unchanged.
            const [senderReread, recipientReread] = await Promise.all([
              Account.findById(senderAccount._id),
              Account.findById(recipientAccount._id),
            ]);
            expect(senderReread.balance).toBe(senderBalance);
            expect(recipientReread.balance).toBe(recipientBalance);

            // No transactions recorded for either account.
            const count = await Transaction.countDocuments({
              accountId: { $in: [senderAccount._id, recipientAccount._id] },
            });
            expect(count).toBe(0);
          }
        )
        .afterEach(cleanup),
      { numRuns: 60 }
    );
  });
});
