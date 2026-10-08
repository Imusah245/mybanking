// tests/properties/nonActiveReject.property.test.js
//
// Property 7: Non-active accounts reject money movement.
//
// For any account whose status is NOT Active (Frozen or Disabled), every
// money-movement operation is rejected and leaves the ledger untouched:
//   - deposit(userId, amount)  → AuthorizationError (403); balance unchanged;
//     no transaction recorded.
//   - withdraw(userId, amount) → AuthorizationError (403); balance unchanged;
//     no transaction recorded.
//   - transfer where the SENDER is non-active → AuthorizationError (403); both
//     balances unchanged; no TRANSFER records.
//   - transfer where the RECIPIENT is non-active (sender Active with funds) →
//     AuthorizationError (403); BOTH balances unchanged (the sender debit is
//     rolled back by the aborted ACID transaction); no TRANSFER records.
//
// The guard is the atomic status gate `status:'Active'` in creditAtomic /
// debitAtomic: a non-active account never matches the conditional
// findOneAndUpdate filter, so no balance change occurs, and the service maps the
// null result to an AuthorizationError (403) with no ledger write.
//
// **Validates: Requirements 5.4, 6.5, 7.9, 12.5**
//
// This is a FEATURE spec property: it MUST HOLD, so the test is expected to
// PASS. Transfers run inside a MongoDB multi-document ACID transaction, so this
// suite relies on the single-node replica set provided by tests/setup.js (wired
// via jest.config.js). setup.js only clears collections BETWEEN Jest tests, not
// between fast-check runs, so each predicate iteration re-seeds its own fresh
// account(s) with unique account numbers and cleans up afterward to stay
// isolated.

import fc from 'fast-check';
import mongoose from 'mongoose';

import Account, {
  ACCOUNT_STATUS,
  MAX_BALANCE_PESEWAS,
} from '../../src/models/Account.js';
import Transaction, {
  AMOUNT_MIN,
  AMOUNT_MAX,
} from '../../src/models/Transaction.js';
import { deposit, withdraw, transfer } from '../../src/services/bankService.js';
import { AuthorizationError } from '../../src/utils/errors.js';

// The two non-active statuses under test.
const NON_ACTIVE_STATUSES = [ACCOUNT_STATUS.FROZEN, ACCOUNT_STATUS.DISABLED];

// Keep generated balances/amounts comfortably inside the stored-balance bounds
// so a (never-applied) credit could not overflow MAX_BALANCE_PESEWAS and the
// chosen transfer amount is always a valid in-range amount.
const MAX_SEED_BALANCE = 1_000_000_000; // 10,000,000.00 GHS in pesewas

// Per-iteration unique 10-digit account numbers. fast-check awaits each
// predicate, so an incrementing counter padded to 10 digits yields collision-
// free, schema-valid (^\d{10}$) numbers across the whole run.
let accountSeq = 0;
function nextAccountNumber() {
  accountSeq += 1;
  return String(accountSeq).padStart(10, '0');
}

/** Create an account with an explicit status and starting balance. */
async function seedAccount(status, balance) {
  const userId = new mongoose.Types.ObjectId();
  const account = await Account.create({
    userId,
    accountNumber: nextAccountNumber(),
    balance,
    status,
  });
  return account;
}

/** Remove all accounts and transactions so each predicate starts clean. */
async function cleanup() {
  await Promise.all([Account.deleteMany({}), Transaction.deleteMany({})]);
}

describe('Property 7: non-active accounts reject money movement', () => {
  // Build unique indexes (accountNumber / reference) before the property loop
  // so seeding and reference generation behave as in production.
  beforeAll(async () => {
    await Account.init();
    await Transaction.init();
  });

  test('Frozen/Disabled accounts reject deposit, withdraw, and transfer (sender and recipient) with 403 and no side effects (Validates: Requirements 5.4, 6.5, 7.9, 12.5)', async () => {
    await fc.assert(
      fc.asyncProperty(
        // Pick a non-active status for the account under test.
        fc.constantFrom(...NON_ACTIVE_STATUSES),
        // A random valid starting balance (integer pesewas).
        fc.integer({ min: 0, max: MAX_SEED_BALANCE }),
        // A random valid operation amount in [AMOUNT_MIN, AMOUNT_MAX].
        fc.integer({ min: AMOUNT_MIN, max: AMOUNT_MAX }),
        async (status, startingBalance, rawAmount) => {
          // --- Predicate 1: deposit against a non-active account -----------
          {
            const account = await seedAccount(status, startingBalance);
            // Keep the amount within range (deposit never applies anyway).
            const amount = Math.min(rawAmount, AMOUNT_MAX);

            await expect(deposit(account.userId, amount)).rejects.toBeInstanceOf(
              AuthorizationError
            );

            const persisted = await Account.findById(account._id);
            expect(persisted.balance).toBe(startingBalance);
            expect(persisted.status).toBe(status);

            const txnCount = await Transaction.countDocuments({
              accountId: account._id,
            });
            expect(txnCount).toBe(0);

            await cleanup();
          }

          // --- Predicate 2: withdraw against a non-active account ----------
          {
            const account = await seedAccount(status, startingBalance);
            const amount = Math.min(rawAmount, AMOUNT_MAX);

            await expect(
              withdraw(account.userId, amount)
            ).rejects.toBeInstanceOf(AuthorizationError);

            const persisted = await Account.findById(account._id);
            expect(persisted.balance).toBe(startingBalance);
            expect(persisted.status).toBe(status);

            const txnCount = await Transaction.countDocuments({
              accountId: account._id,
            });
            expect(txnCount).toBe(0);

            await cleanup();
          }

          // --- Predicate 3: transfer where the SENDER is non-active --------
          {
            // Sender is non-active; recipient is a distinct Active account.
            const sender = await seedAccount(status, startingBalance);
            const recipientBalance = Math.min(
              startingBalance,
              MAX_BALANCE_PESEWAS - MAX_SEED_BALANCE
            );
            const recipient = await seedAccount(
              ACCOUNT_STATUS.ACTIVE,
              recipientBalance
            );
            // Amount the (non-active) sender would need to cover; capped so it
            // is a valid in-range amount regardless of its balance.
            const amount = Math.min(rawAmount, AMOUNT_MAX);

            await expect(
              transfer(sender.userId, recipient.accountNumber, amount)
            ).rejects.toBeInstanceOf(AuthorizationError);

            const [senderAfter, recipientAfter] = await Promise.all([
              Account.findById(sender._id),
              Account.findById(recipient._id),
            ]);
            expect(senderAfter.balance).toBe(startingBalance);
            expect(recipientAfter.balance).toBe(recipientBalance);

            const transferCount = await Transaction.countDocuments({});
            expect(transferCount).toBe(0);

            await cleanup();
          }

          // --- Predicate 4: transfer where the RECIPIENT is non-active -----
          {
            // Sender is Active and funded; recipient is non-active. The sender
            // debit must be rolled back by the aborted ACID transaction so BOTH
            // balances remain unchanged.
            const senderBalance = Math.max(
              startingBalance,
              AMOUNT_MIN // ensure the sender can cover at least AMOUNT_MIN
            );
            const sender = await seedAccount(
              ACCOUNT_STATUS.ACTIVE,
              senderBalance
            );
            const recipient = await seedAccount(status, startingBalance);
            // Choose an amount the Active sender can cover, so the ONLY reason
            // the transfer fails is the non-active recipient (not funds).
            const amount = Math.min(rawAmount, senderBalance, AMOUNT_MAX);

            await expect(
              transfer(sender.userId, recipient.accountNumber, amount)
            ).rejects.toBeInstanceOf(AuthorizationError);

            const [senderAfter, recipientAfter] = await Promise.all([
              Account.findById(sender._id),
              Account.findById(recipient._id),
            ]);
            // Sender debit rolled back → unchanged; recipient never credited.
            expect(senderAfter.balance).toBe(senderBalance);
            expect(recipientAfter.balance).toBe(startingBalance);

            const transferCount = await Transaction.countDocuments({});
            expect(transferCount).toBe(0);

            await cleanup();
          }
        }
      ),
      { numRuns: 50 }
    );
  });
});
