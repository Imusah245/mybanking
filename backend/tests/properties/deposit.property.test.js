// tests/properties/deposit.property.test.js
//
// Property-based test for design Property 2 (Deposit effect), Task 7.7.
//
// Property 2: For any Active account and valid integer amount, after a
// successful deposit the account balance equals the prior balance plus the
// amount, and exactly one COMPLETED CREDIT transaction is recorded for that
// account.
//
// **Validates: Requirements 5.1, 5.2**
//
// Module under test: src/services/bankService.js `deposit(userId, amount)`.
//
// This is a FEATURE spec property: it MUST HOLD, so the test is expected to
// PASS. The in-memory single-node replica set, Mongoose connection, and
// per-test collection clearing are provided by tests/setup.js (wired via
// jest.config.js). Because fast-check runs many predicate iterations inside a
// single Jest test (and setup.js only clears collections BETWEEN tests, not
// between fast-check runs), each predicate iteration seeds its OWN fresh
// user + Active account with a unique account number and scopes every
// assertion to that account/user. This keeps iterations independent without
// relying on inter-run cleanup.

import fc from 'fast-check';
import mongoose from 'mongoose';

import Account, {
  ACCOUNT_STATUS,
  MAX_BALANCE_PESEWAS,
} from '../../src/models/Account.js';
import Transaction, {
  TRANSACTION_TYPES,
  TRANSACTION_STATUSES,
  AMOUNT_MIN,
  AMOUNT_MAX,
} from '../../src/models/Transaction.js';
import { deposit } from '../../src/services/bankService.js';

// A per-iteration unique 10-digit account number. fast-check iterations run
// sequentially (the predicate is awaited), so a simple incrementing counter
// padded to 10 digits yields a collision-free, schema-valid (^\d{10}$) number.
let accountSeq = 0;
function nextAccountNumber() {
  accountSeq += 1;
  return String(accountSeq).padStart(10, '0');
}

/**
 * Seed a fresh user id + an Active account with the given starting balance.
 * Returns the created account document.
 */
async function seedActiveAccount(startingBalance) {
  const userId = new mongoose.Types.ObjectId();
  const account = await Account.create({
    userId,
    accountNumber: nextAccountNumber(),
    balance: startingBalance,
    status: ACCOUNT_STATUS.ACTIVE,
  });
  return account;
}

describe('Property 2: Deposit effect (bankService.deposit)', () => {
  // Ensure indexes (unique accountNumber / reference) are built before the
  // property loop so seeding and reference generation behave as in production.
  beforeAll(async () => {
    await Account.init();
    await Transaction.init();
  });

  test('depositing a valid amount increases balance by exactly that amount and records exactly one COMPLETED CREDIT (Validates: Requirements 5.1, 5.2)', async () => {
    await fc.assert(
      fc.asyncProperty(
        // A random valid starting balance (integer pesewas). Kept well below
        // MAX so that oldBalance + amount can never exceed the schema max; the
        // deposit-amount generator below is further constrained per-run.
        fc.integer({ min: 0, max: 1_000_000_000 }),
        // A random valid deposit amount in [AMOUNT_MIN, AMOUNT_MAX]. The
        // predicate additionally derives a safe amount so that
        // oldBalance + amount <= MAX_BALANCE_PESEWAS, avoiding the schema max
        // backstop (which is out of scope for this property).
        fc.integer({ min: AMOUNT_MIN, max: AMOUNT_MAX }),
        async (startingBalance, rawAmount) => {
          // Seed a fresh Active account for this iteration.
          const account = await seedActiveAccount(startingBalance);
          const oldBalance = account.balance;

          // Constrain the deposit amount so old + amount stays within the
          // account balance ceiling while remaining a valid amount (>= 1).
          const headroom = MAX_BALANCE_PESEWAS - oldBalance;
          const amount = Math.max(
            AMOUNT_MIN,
            Math.min(rawAmount, headroom)
          );

          // Perform the deposit under test.
          const { account: updatedAccount, transaction } = await deposit(
            account.userId,
            amount
          );

          // --- Balance effect: newBalance === oldBalance + amount ---
          expect(updatedAccount.balance).toBe(oldBalance + amount);

          // The persisted account reflects the same balance.
          const persisted = await Account.findById(account._id);
          expect(persisted.balance).toBe(oldBalance + amount);

          // --- Exactly one COMPLETED CREDIT transaction for this account ---
          const credits = await Transaction.find({
            accountId: account._id,
            type: TRANSACTION_TYPES.CREDIT,
          });
          expect(credits).toHaveLength(1);

          const [credit] = credits;
          expect(credit.type).toBe(TRANSACTION_TYPES.CREDIT);
          expect(credit.status).toBe(TRANSACTION_STATUSES.COMPLETED);
          expect(credit.amount).toBe(amount);
          expect(credit.balanceBefore).toBe(oldBalance);
          expect(credit.balanceAfter).toBe(oldBalance + amount);
          // The returned transaction is the one that was recorded.
          expect(String(credit._id)).toBe(String(transaction._id));
          // Ledger identity for a CREDIT effect (Property 1 corollary).
          expect(credit.balanceAfter).toBe(credit.balanceBefore + credit.amount);

          // No DEBIT/TRANSFER records were created as a side effect.
          const nonCredits = await Transaction.countDocuments({
            accountId: account._id,
            type: { $ne: TRANSACTION_TYPES.CREDIT },
          });
          expect(nonCredits).toBe(0);
        }
      ),
      { numRuns: 40 }
    );
  });
});
