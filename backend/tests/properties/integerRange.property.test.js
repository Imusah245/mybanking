// tests/properties/integerRange.property.test.js
//
// Property-based test for Task 7.15 — design Property 11:
// "Monetary values are integers within range".
//
// Property 11 (design.md): For any reachable system state produced by a
// sequence of operations, every stored account balance is an integer in
// [0, MAX_BALANCE_PESEWAS] and every stored transaction amount /
// balanceBefore / balanceAfter is an integer in range. No floats, NaN, or
// out-of-range values are ever persisted. The service + schema validators
// enforce this.
//
// **Validates: Requirements 15.1**
//
// Modules under test:
//   - src/services/bankService.js  (deposit, withdraw, transfer)
//   - src/models/Account.js        (balance validator / bounds)
//   - src/models/Transaction.js    (amount / balanceBefore / balanceAfter)
//
// This is a FEATURE spec property: it MUST HOLD, so the test is expected to
// PASS. Transfers run inside a MongoDB multi-document ACID transaction, so this
// suite relies on the single-node replica set provided by tests/setup.js
// (wired via jest.config.js). Each fast-check predicate re-seeds its own fresh
// accounts and cleans up afterwards so iterations stay independent (afterEach
// only runs between Jest test cases, not between fast-check runs).
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
let ACCOUNT_STATUS;
let MIN_BALANCE_PESEWAS;
let MAX_BALANCE_PESEWAS;
/** @type {typeof import('../../src/models/Transaction.js').default} */
let Transaction;
let TRANSACTION_TYPES;
let TRANSACTION_STATUSES;
let AMOUNT_MIN;
let AMOUNT_MAX;
let deposit;
let withdraw;
let transfer;
/** @type {typeof import('../../src/utils/errors.js').ValidationError} */
let ValidationError;

beforeAll(async () => {
  const accountMod = await import('../../src/models/Account.js');
  Account = accountMod.default;
  ACCOUNT_STATUS = accountMod.ACCOUNT_STATUS;
  MIN_BALANCE_PESEWAS = accountMod.MIN_BALANCE_PESEWAS;
  MAX_BALANCE_PESEWAS = accountMod.MAX_BALANCE_PESEWAS;

  const txnMod = await import('../../src/models/Transaction.js');
  Transaction = txnMod.default;
  TRANSACTION_TYPES = txnMod.TRANSACTION_TYPES;
  TRANSACTION_STATUSES = txnMod.TRANSACTION_STATUSES;
  AMOUNT_MIN = txnMod.AMOUNT_MIN;
  AMOUNT_MAX = txnMod.AMOUNT_MAX;

  const serviceMod = await import('../../src/services/bankService.js');
  deposit = serviceMod.deposit;
  withdraw = serviceMod.withdraw;
  transfer = serviceMod.transfer;

  const errorsMod = await import('../../src/utils/errors.js');
  ValidationError = errorsMod.ValidationError;

  // Build the unique indexes (accountNumber / reference) before the property
  // loop so seeding and reference generation behave as in production.
  await Account.init();
  await Transaction.init();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Monotonically increasing, zero-padded 10-digit account numbers — always
// unique across the whole run and always matching the ^\d{10}$ schema regex, so
// seeding never collides on the unique index.
let accountSeq = 0;
function nextAccountNumber() {
  accountSeq += 1;
  return String(accountSeq).padStart(10, '0');
}

/** Seed a fresh user id + an account with the given balance and status. */
async function seedAccount(balance, status = undefined) {
  const userId = new mongoose.Types.ObjectId();
  const account = await Account.create({
    userId,
    accountNumber: nextAccountNumber(),
    balance,
    ...(status ? { status } : {}),
  });
  return { userId, account };
}

/** Remove everything seeded during an iteration so runs stay independent. */
async function cleanup() {
  await Promise.all([Account.deleteMany({}), Transaction.deleteMany({})]);
}

/**
 * Assert the monetary integer-range invariant across EVERY persisted account
 * and transaction in the database. This is the heart of Property 11: whatever
 * sequence of operations ran, the stored state must satisfy it.
 */
async function assertIntegerRangeInvariant() {
  const accounts = await Account.find({});
  for (const acc of accounts) {
    expect(Number.isInteger(acc.balance)).toBe(true);
    expect(Number.isNaN(acc.balance)).toBe(false);
    expect(acc.balance).toBeGreaterThanOrEqual(MIN_BALANCE_PESEWAS);
    expect(acc.balance).toBeLessThanOrEqual(MAX_BALANCE_PESEWAS);
  }

  const txns = await Transaction.find({});
  for (const txn of txns) {
    // amount ∈ [AMOUNT_MIN, AMOUNT_MAX], integer.
    expect(Number.isInteger(txn.amount)).toBe(true);
    expect(txn.amount).toBeGreaterThanOrEqual(AMOUNT_MIN);
    expect(txn.amount).toBeLessThanOrEqual(AMOUNT_MAX);

    // balanceBefore / balanceAfter are non-negative integers within balance
    // bounds (they are snapshots of a stored account balance).
    for (const snapshot of [txn.balanceBefore, txn.balanceAfter]) {
      expect(Number.isInteger(snapshot)).toBe(true);
      expect(snapshot).toBeGreaterThanOrEqual(MIN_BALANCE_PESEWAS);
      expect(snapshot).toBeLessThanOrEqual(MAX_BALANCE_PESEWAS);
    }
  }
}

// Keep seeded balances comfortably inside the stored-balance ceiling so a
// credit of (balance + amount) can never overflow MAX_BALANCE_PESEWAS during a
// sequence of valid deposits/transfers. Amounts stay well under AMOUNT_MAX too.
const OP_AMOUNT_MAX = 1_000_000_000; // 10,000,000.00 GHS in pesewas
const SEED_BALANCE_MAX = 1_000_000_000;

// A single step of the random operation sequence.
const opArb = fc.oneof(
  fc.record({
    kind: fc.constant('deposit'),
    amount: fc.integer({ min: AMOUNT_MIN, max: OP_AMOUNT_MAX }),
  }),
  fc.record({
    kind: fc.constant('withdraw'),
    amount: fc.integer({ min: AMOUNT_MIN, max: OP_AMOUNT_MAX }),
  }),
  fc.record({
    kind: fc.constant('transfer'),
    amount: fc.integer({ min: AMOUNT_MIN, max: OP_AMOUNT_MAX }),
    // Direction: A -> B when true, B -> A when false.
    aToB: fc.boolean(),
  })
);

describe('Property 11: monetary integer-range invariant (Task 7.15)', () => {
  // Case 1 — Running a random SEQUENCE of valid operations across two Active
  // accounts, the integer-range invariant holds on every persisted balance and
  // transaction after EACH operation (whether it succeeded or was rejected).
  test('a random sequence of valid operations keeps all balances and amounts integer and in range (Validates: Requirements 15.1)', async () => {
    await fc.assert(
      fc
        .asyncProperty(
          fc.integer({ min: 0, max: SEED_BALANCE_MAX }),
          fc.integer({ min: 0, max: SEED_BALANCE_MAX }),
          fc.array(opArb, { minLength: 1, maxLength: 10 }),
          async (balanceA, balanceB, ops) => {
            const { userId: userA, account: accA } = await seedAccount(
              balanceA
            );
            const { userId: userB, account: accB } = await seedAccount(
              balanceB
            );

            for (const op of ops) {
              try {
                if (op.kind === 'deposit') {
                  await deposit(userA, op.amount);
                } else if (op.kind === 'withdraw') {
                  await withdraw(userA, op.amount);
                } else {
                  const [fromUser, toAccount] = op.aToB
                    ? [userA, accB]
                    : [userB, accA];
                  await transfer(
                    fromUser,
                    toAccount.accountNumber,
                    op.amount
                  );
                }
              } catch (err) {
                // Expected, benign rejections (insufficient funds, etc.) leave
                // state untouched. Any error is fine for THIS property as long
                // as the stored invariant still holds — which we check next.
                // Re-throw only if it is clearly not an operational error.
                if (err && err.isOperational === false) {
                  throw err;
                }
              }

              // Invariant after EVERY operation: every stored balance and every
              // stored transaction field is an integer within range.
              await assertIntegerRangeInvariant();
            }
          }
        )
        .afterEach(cleanup),
      { numRuns: 50 }
    );
  });

  // Case 2 — The service rejects float / NaN / out-of-range amounts with a
  // ValidationError BEFORE anything is persisted, so an invalid value can never
  // enter the ledger. (Overlaps Property 9 but focuses on the integer-range
  // persistence invariant: nothing out of range is ever written.)
  test('invalid (float / NaN / out-of-range) amounts are rejected before persistence, so no out-of-range value is ever stored (Validates: Requirements 15.1)', async () => {
    const invalidAmountArb = fc.oneof(
      // Non-integer floats within the valid numeric band.
      fc
        .double({ min: 1.0001, max: 1_000_000, noNaN: true })
        .filter((n) => !Number.isInteger(n)),
      // Zero and negatives (below AMOUNT_MIN).
      fc.integer({ min: -1_000_000, max: 0 }),
      // Above AMOUNT_MAX.
      fc.integer({ min: AMOUNT_MAX + 1, max: AMOUNT_MAX + 1_000_000 }),
      // Non-finite values.
      fc.constantFrom(Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY)
    );

    await fc.assert(
      fc
        .asyncProperty(
          fc.integer({ min: 0, max: SEED_BALANCE_MAX }),
          invalidAmountArb,
          fc.constantFrom('deposit', 'withdraw', 'transfer'),
          async (startingBalance, badAmount, kind) => {
            const { userId, account } = await seedAccount(startingBalance);
            // A second account so transfers resolve a real recipient (the
            // amount is still validated first, before any lookup).
            const { account: recipient } = await seedAccount(0);

            let caught;
            try {
              if (kind === 'deposit') {
                await deposit(userId, badAmount);
              } else if (kind === 'withdraw') {
                await withdraw(userId, badAmount);
              } else {
                await transfer(userId, recipient.accountNumber, badAmount);
              }
            } catch (err) {
              caught = err;
            }

            // Rejected with a 400 ValidationError, before any write.
            expect(caught).toBeInstanceOf(ValidationError);
            expect(caught.statusCode).toBe(400);

            // No transaction was recorded anywhere.
            const txnCount = await Transaction.countDocuments({});
            expect(txnCount).toBe(0);

            // Balances are untouched and still integers in range.
            const reread = await Account.findById(account._id);
            expect(reread.balance).toBe(startingBalance);
            await assertIntegerRangeInvariant();
          }
        )
        .afterEach(cleanup),
      { numRuns: 50 }
    );
  });

  // Case 3 — Model-level defense-in-depth: the Account/Transaction schema
  // validators reject a non-integer or out-of-range balance/amount directly,
  // so even a hypothetical bypass of the service cannot persist a value that
  // violates the integer-range invariant.
  test('Account/Transaction schema validators reject non-integer or out-of-range monetary values (Validates: Requirements 15.1)', async () => {
    const invalidBalanceArb = fc.oneof(
      fc.double({ min: 0.1, max: 100, noNaN: true }).filter((n) => !Number.isInteger(n)),
      fc.integer({ min: -1_000_000, max: -1 }),
      fc.integer({ min: MAX_BALANCE_PESEWAS + 1, max: MAX_BALANCE_PESEWAS + 1_000_000 })
    );

    await fc.assert(
      fc
        .asyncProperty(invalidBalanceArb, async (badBalance) => {
          // Account.balance validator must reject a bad balance at save time.
          let accErr;
          try {
            await Account.create({
              userId: new mongoose.Types.ObjectId(),
              accountNumber: nextAccountNumber(),
              balance: badBalance,
              status: ACCOUNT_STATUS.ACTIVE,
            });
          } catch (err) {
            accErr = err;
          }
          expect(accErr).toBeInstanceOf(mongoose.Error.ValidationError);
          expect(accErr.errors.balance).toBeDefined();

          // Transaction.amount validator must reject the same bad value as an
          // amount. A floored, in-range balanceBefore/After pair isolates the
          // failure to the amount field.
          let txnErr;
          try {
            await Transaction.create({
              userId: new mongoose.Types.ObjectId(),
              accountId: new mongoose.Types.ObjectId(),
              type: TRANSACTION_TYPES.CREDIT,
              amount: badBalance,
              balanceBefore: 0,
              balanceAfter: 0,
              reference: 'TXN-ZZZZZZZZ',
              status: TRANSACTION_STATUSES.COMPLETED,
            });
          } catch (err) {
            txnErr = err;
          }
          expect(txnErr).toBeInstanceOf(mongoose.Error.ValidationError);
          expect(txnErr.errors.amount).toBeDefined();

          // Nothing invalid was persisted.
          expect(await Account.countDocuments({})).toBe(0);
          expect(await Transaction.countDocuments({})).toBe(0);
        })
        .afterEach(cleanup),
      { numRuns: 50 }
    );
  });
});
