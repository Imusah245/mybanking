// tests/properties/transfer.atomicity.property.test.js
//
// Property-based test for Task 7.11 — design Property 6:
// "Failed transfer atomicity".
//
// Property 6 (design.md): For any transfer that fails at any point after the
// session transaction begins (insufficient funds, a non-Active sender, a
// non-Active recipient, or a recipient that does not exist), BOTH the sender
// and recipient balances remain exactly equal to their pre-transfer values and
// NO COMPLETED TRANSFER transactions persist. The ACID transaction rolls back
// the whole operation, so even a failure injected AFTER the sender debit (the
// recipient credit leg) leaves the sender's balance untouched.
//
// Validates: Requirements 7.5, 7.10, 15.6
//
// Module under test: src/services/bankService.js -> transfer(userId,
// recipientAccountNumber, amount).
// Models: Account, Transaction.
// Errors: InsufficientFundsError (400), AuthorizationError (403),
//         NotFoundError (404).
//
// The in-memory single-node replica set, Mongoose connection, and per-test
// collection clearing are provided by tests/setup.js. A replica set is required
// because transfers run inside a MongoDB ACID transaction; the rollback
// behavior under test only exists when transactions are available. Each
// fast-check predicate iteration re-seeds a fresh sender + recipient and cleans
// up its own data afterwards so iterations are independent (afterEach only runs
// between test cases, not between fast-check runs).
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
/** @type {typeof import('../../src/services/bankService.js').transfer} */
let transfer;
let InsufficientFundsError;
let AuthorizationError;
let NotFoundError;

beforeAll(async () => {
  const accountMod = await import('../../src/models/Account.js');
  Account = accountMod.default;
  ACCOUNT_STATUS = accountMod.ACCOUNT_STATUS;

  const txnMod = await import('../../src/models/Transaction.js');
  Transaction = txnMod.default;
  TRANSACTION_TYPES = txnMod.TRANSACTION_TYPES;

  const serviceMod = await import('../../src/services/bankService.js');
  transfer = serviceMod.transfer;

  const errorsMod = await import('../../src/utils/errors.js');
  InsufficientFundsError = errorsMod.InsufficientFundsError;
  AuthorizationError = errorsMod.AuthorizationError;
  NotFoundError = errorsMod.NotFoundError;
});

// Monotonically increasing, zero-padded 10-digit account numbers — always
// unique (so the unique index never collides across iterations) and always
// matching ^\d{10}$.
let accountSeq = 0;
function nextAccountNumber() {
  return String(accountSeq++).padStart(10, '0');
}

/** Seed one fresh user id + account with a given balance and status. */
async function seedAccount(balance, status) {
  const userId = new mongoose.Types.ObjectId();
  const accountNumber = nextAccountNumber();
  const account = await Account.create({
    userId,
    accountNumber,
    balance,
    status,
  });
  return { userId, account, accountNumber };
}

/** Remove everything seeded during an iteration so runs stay independent. */
async function cleanup() {
  await Promise.all([Account.deleteMany({}), Transaction.deleteMany({})]);
}

/**
 * Assert the atomicity invariant: both parties' persisted balances equal their
 * seeded values and NO TRANSFER ledger records exist anywhere in the system.
 */
async function assertNoSideEffects({
  senderId,
  senderExpected,
  recipientId,
  recipientExpected,
}) {
  const senderReread = await Account.findById(senderId);
  expect(senderReread.balance).toBe(senderExpected);

  if (recipientId) {
    const recipientReread = await Account.findById(recipientId);
    expect(recipientReread.balance).toBe(recipientExpected);
  }

  // No TRANSFER ledger record was persisted — the whole transaction rolled back.
  const transferCount = await Transaction.countDocuments({
    type: TRANSACTION_TYPES.TRANSFER,
  });
  expect(transferCount).toBe(0);
}

// Keep balances comfortably within range so arithmetic for over-transfer
// amounts stays valid.
const BALANCE_MAX = 1_000_000_000; // 10,000,000.00 GHS in pesewas

describe('Property 6: failed transfer atomicity (Task 7.11)', () => {
  // Case A — Insufficient funds: amount strictly greater than the sender's
  // balance. Both accounts Active. Rejected with InsufficientFundsError (400);
  // the sender debit never applies and no TRANSFER record persists.
  test('insufficient funds is rejected (400) with both balances unchanged and no TRANSFER records (Validates: Requirements 7.10, 15.6)', async () => {
    await fc.assert(
      fc
        .asyncProperty(
          fc.integer({ min: 0, max: BALANCE_MAX }),
          fc.integer({ min: 1, max: 1_000_000 }),
          fc.integer({ min: 0, max: BALANCE_MAX }),
          async (senderBalance, overBy, recipientBalance) => {
            const amount = senderBalance + overBy; // strictly > sender balance

            const sender = await seedAccount(
              senderBalance,
              ACCOUNT_STATUS.ACTIVE
            );
            const recipient = await seedAccount(
              recipientBalance,
              ACCOUNT_STATUS.ACTIVE
            );

            let caught;
            try {
              await transfer(sender.userId, recipient.accountNumber, amount);
            } catch (err) {
              caught = err;
            }

            expect(caught).toBeInstanceOf(InsufficientFundsError);
            expect(caught.statusCode).toBe(400);

            await assertNoSideEffects({
              senderId: sender.account._id,
              senderExpected: senderBalance,
              recipientId: recipient.account._id,
              recipientExpected: recipientBalance,
            });
          }
        )
        .afterEach(cleanup),
      { numRuns: 50 }
    );
  });

  // Case B — Recipient not Active (Frozen or Disabled): the sender is debited
  // first (leg 1 succeeds) and then the recipient credit (leg 2) fails,
  // aborting the transaction. The sender debit MUST roll back, so the sender
  // balance is unchanged and no TRANSFER record persists. This is the key
  // "failure injected after debit" case.
  test('a non-Active recipient is rejected (403) and the sender debit rolls back, leaving both balances unchanged with no TRANSFER records (Validates: Requirements 7.5, 7.10)', async () => {
    await fc.assert(
      fc
        .asyncProperty(
          // Sender balance large enough that the amount is always affordable,
          // so the debit leg would succeed and the failure is purely from the
          // recipient credit leg.
          fc.integer({ min: 1, max: BALANCE_MAX }),
          fc.integer({ min: 1, max: BALANCE_MAX }),
          fc.integer({ min: 0, max: BALANCE_MAX }),
          fc.constantFrom(ACCOUNT_STATUS.FROZEN, ACCOUNT_STATUS.DISABLED),
          async (senderBalance, amountSeed, recipientBalance, recipientStatus) => {
            // Amount in [1, senderBalance] so the sender debit would succeed.
            const safeAmount = Math.min(amountSeed, senderBalance);

            const sender = await seedAccount(
              senderBalance,
              ACCOUNT_STATUS.ACTIVE
            );
            const recipient = await seedAccount(
              recipientBalance,
              recipientStatus
            );

            let caught;
            try {
              await transfer(
                sender.userId,
                recipient.accountNumber,
                safeAmount
              );
            } catch (err) {
              caught = err;
            }

            expect(caught).toBeInstanceOf(AuthorizationError);
            expect(caught.statusCode).toBe(403);

            // The sender debit (leg 1) must have been rolled back by the abort.
            await assertNoSideEffects({
              senderId: sender.account._id,
              senderExpected: senderBalance,
              recipientId: recipient.account._id,
              recipientExpected: recipientBalance,
            });
          }
        )
        .afterEach(cleanup),
      { numRuns: 50 }
    );
  });

  // Case C — Sender not Active (Frozen or Disabled): the sender debit never
  // applies. Rejected with AuthorizationError (403); both balances unchanged
  // and no TRANSFER record persists.
  test('a non-Active sender is rejected (403) with both balances unchanged and no TRANSFER records (Validates: Requirements 7.5, 7.10)', async () => {
    await fc.assert(
      fc
        .asyncProperty(
          fc.integer({ min: 1, max: BALANCE_MAX }),
          fc.integer({ min: 1, max: BALANCE_MAX }),
          fc.integer({ min: 0, max: BALANCE_MAX }),
          fc.constantFrom(ACCOUNT_STATUS.FROZEN, ACCOUNT_STATUS.DISABLED),
          async (senderBalance, amountSeed, recipientBalance, senderStatus) => {
            const amount = Math.min(amountSeed, senderBalance);

            const sender = await seedAccount(senderBalance, senderStatus);
            const recipient = await seedAccount(
              recipientBalance,
              ACCOUNT_STATUS.ACTIVE
            );

            let caught;
            try {
              await transfer(sender.userId, recipient.accountNumber, amount);
            } catch (err) {
              caught = err;
            }

            expect(caught).toBeInstanceOf(AuthorizationError);
            expect(caught.statusCode).toBe(403);

            await assertNoSideEffects({
              senderId: sender.account._id,
              senderExpected: senderBalance,
              recipientId: recipient.account._id,
              recipientExpected: recipientBalance,
            });
          }
        )
        .afterEach(cleanup),
      { numRuns: 50 }
    );
  });

  // Case D — Recipient account number not found: there is no account matching
  // the given recipient number. Rejected with NotFoundError (404) before any
  // balance change; the sender balance is unchanged and no TRANSFER record
  // persists.
  test('an unknown recipient account number is rejected (404) with the sender balance unchanged and no TRANSFER records (Validates: Requirements 7.5, 7.10)', async () => {
    await fc.assert(
      fc
        .asyncProperty(
          fc.integer({ min: 1, max: BALANCE_MAX }),
          fc.integer({ min: 1, max: BALANCE_MAX }),
          async (senderBalance, amountSeed) => {
            const amount = Math.min(amountSeed, senderBalance);

            const sender = await seedAccount(
              senderBalance,
              ACCOUNT_STATUS.ACTIVE
            );

            // A 10-digit account number that is guaranteed not to exist: use a
            // high prefix well beyond the monotonic sequence counter and
            // confirm absence.
            const missingAccountNumber = String(9_000_000_000 + accountSeq++);
            const exists = await Account.exists({
              accountNumber: missingAccountNumber,
            });
            expect(exists).toBeNull();

            let caught;
            try {
              await transfer(sender.userId, missingAccountNumber, amount);
            } catch (err) {
              caught = err;
            }

            expect(caught).toBeInstanceOf(NotFoundError);
            expect(caught.statusCode).toBe(404);

            await assertNoSideEffects({
              senderId: sender.account._id,
              senderExpected: senderBalance,
              recipientId: null,
              recipientExpected: null,
            });
          }
        )
        .afterEach(cleanup),
      { numRuns: 50 }
    );
  });
});
