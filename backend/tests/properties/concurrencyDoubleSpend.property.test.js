// tests/properties/concurrencyDoubleSpend.property.test.js
//
// Property 4: Concurrency and double-spend safety (Task 7.9).
//
// *For any* account with an initial balance and *any* set of concurrent
// withdrawal/transfer-debit requests, the final balance is never negative and
// the sum of all successfully applied debits is less than or equal to the
// initial balance (conservation under concurrency).
//
// **Validates: Requirements 6.6, 15.2, 15.4**
//
// This is the critical double-spend safety invariant. The guard under test is
// `debitAtomic`'s conditional `findOneAndUpdate` with the filter
// `{ status:'Active', balance:{ $gte: amount } }`: because the balance
// condition is evaluated atomically at write time, two concurrent debits can
// never both succeed past the available balance and a balance can never be
// driven negative — no money is created or destroyed.
//
// Strategy:
//   - Seed one Active account with a random integer balance B pesewas.
//   - Fire N concurrent withdrawals (via Promise.allSettled) whose amounts sum
//     to MORE than B, so only a subset can succeed. We size each amount near
//     B/(N-1) so a few succeed and the rest must be rejected for insufficient
//     funds.
//   - Assert the INVARIANT (not a fixed success count, which can shift under
//     write-conflict transients): final balance >= 0; final balance equals
//     B minus the sum of successful debit amounts; the number of COMPLETED
//     DEBIT ledger records equals the number of fulfilled calls; the sum of
//     successful debits is <= B; and every rejection is an
//     InsufficientFundsError.
//
// A second property exercises concurrent TRANSFERS out of one sender to several
// distinct recipients and asserts conservation: the sender is never negative,
// and total money across sender + recipients is conserved.
//
// The in-memory single-node replica set from tests/setup.js supports the ACID
// transactions used by `withTransaction`; transient write conflicts are retried
// internally by bankService, so successful ops settle while genuine
// insufficient-funds failures surface as InsufficientFundsError.

import mongoose from 'mongoose';
import fc from 'fast-check';

import Account, { ACCOUNT_STATUS } from '../../src/models/Account.js';
import Transaction, {
  TRANSACTION_TYPES,
  TRANSACTION_STATUSES,
} from '../../src/models/Transaction.js';
import { withdraw, transfer } from '../../src/services/bankService.js';
import { InsufficientFundsError } from '../../src/utils/errors.js';

// Concurrent transactions + bounded transient retries are slow; keep numRuns
// modest and give each test a generous ceiling (passed as the per-test timeout
// argument since the `jest` global is unavailable under native-ESM Jest).
const TEST_TIMEOUT_MS = 180000;

let accountSeq = 0;
/** Produce a distinct, well-formed 10-digit account number per account. */
function nextAccountNumber() {
  accountSeq += 1;
  return String(accountSeq).padStart(10, '0');
}

/** Create one Active account owned by a fresh user with the given balance. */
async function seedAccount(balance) {
  return Account.create({
    userId: new mongoose.Types.ObjectId(),
    accountNumber: nextAccountNumber(),
    balance,
    status: ACCOUNT_STATUS.ACTIVE,
  });
}

describe('Property 4: concurrency and double-spend safety', () => {
  test('concurrent over-committed withdrawals never overspend or go negative', async () => {
    await fc.assert(
      fc.asyncProperty(
        // Initial balance B in integer pesewas (keep modest to bound test time).
        fc.integer({ min: 1000, max: 2_000_000 }),
        // Number of concurrent debit requests.
        fc.integer({ min: 3, max: 8 }),
        // A multiplier that spreads the per-request amount so the total demanded
        // exceeds B (ensuring not all can succeed). 1.1x..3x of a fair share.
        fc.integer({ min: 110, max: 300 }),
        async (B, N, overCommitPct) => {
          const account = await seedAccount(B);
          const userId = account.userId;

          // Fair share per request if all N succeeded would be B/N. We size each
          // amount as overCommitPct% of B/(N-1) so the sum demanded strictly
          // exceeds B and some requests MUST fail for insufficient funds.
          const share = Math.max(1, Math.floor((B / (N - 1)) * (overCommitPct / 100)));
          const amounts = Array.from({ length: N }, () => share);

          const results = await Promise.allSettled(
            amounts.map((amount) => withdraw(userId, amount))
          );

          const fulfilled = results.filter((r) => r.status === 'fulfilled');
          const rejected = results.filter((r) => r.status === 'rejected');

          // Every rejection must be a genuine insufficient-funds rejection — the
          // debit guard, not a crash or a spurious error.
          for (const r of rejected) {
            expect(r.reason).toBeInstanceOf(InsufficientFundsError);
          }

          // Sum of amounts for the calls that succeeded.
          const successTotal = fulfilled.reduce(
            (sum, r) => sum + r.value.transaction.amount,
            0
          );

          const finalAccount = await Account.findById(account._id);

          // INVARIANT 1: balance never negative.
          expect(finalAccount.balance).toBeGreaterThanOrEqual(0);
          // INVARIANT 2: no double-spend — applied debits never exceed B.
          expect(successTotal).toBeLessThanOrEqual(B);
          // INVARIANT 3: conservation — final balance is exactly B minus the
          // sum of successful debits (no money created or destroyed).
          expect(finalAccount.balance).toBe(B - successTotal);
          // INVARIANT 4: stored balance stays an integer number of pesewas.
          expect(Number.isInteger(finalAccount.balance)).toBe(true);

          // Ledger agreement: exactly one COMPLETED DEBIT per fulfilled call,
          // and their amounts sum to the applied total.
          const debitTxns = await Transaction.find({
            accountId: account._id,
            type: TRANSACTION_TYPES.DEBIT,
            status: TRANSACTION_STATUSES.COMPLETED,
          });
          expect(debitTxns).toHaveLength(fulfilled.length);
          const ledgerTotal = debitTxns.reduce((s, t) => s + t.amount, 0);
          expect(ledgerTotal).toBe(successTotal);

          // Clean up so each run starts from an empty collection set.
          await Account.deleteMany({});
          await Transaction.deleteMany({});
        }
      ),
      { numRuns: 20 }
    );
  }, TEST_TIMEOUT_MS);

  test('concurrent transfers out of one sender conserve total money', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1000, max: 1_000_000 }),
        fc.integer({ min: 2, max: 5 }),
        fc.integer({ min: 110, max: 250 }),
        async (B, N, overCommitPct) => {
          const sender = await seedAccount(B);
          const senderUserId = sender.userId;

          // N distinct Active recipients, each starting at 0.
          const recipients = [];
          for (let i = 0; i < N; i += 1) {
            // eslint-disable-next-line no-await-in-loop
            recipients.push(await seedAccount(0));
          }

          const share = Math.max(
            1,
            Math.floor((B / (N - 1 || 1)) * (overCommitPct / 100))
          );

          const results = await Promise.allSettled(
            recipients.map((r) => transfer(senderUserId, r.accountNumber, share))
          );

          const fulfilled = results.filter((x) => x.status === 'fulfilled');
          const rejected = results.filter((x) => x.status === 'rejected');

          // Any rejection must be insufficient funds — the atomic debit guard
          // in the first leg of the transfer refused to overspend.
          for (const x of rejected) {
            expect(x.reason).toBeInstanceOf(InsufficientFundsError);
          }

          const finalSender = await Account.findById(sender._id);
          const finalRecipients = await Promise.all(
            recipients.map((r) => Account.findById(r._id))
          );
          const recipientTotal = finalRecipients.reduce(
            (s, r) => s + r.balance,
            0
          );

          // Sender never negative.
          expect(finalSender.balance).toBeGreaterThanOrEqual(0);
          // Applied transfers never exceed the sender's starting balance.
          const movedTotal = fulfilled.length * share;
          expect(movedTotal).toBeLessThanOrEqual(B);
          // Conservation: total across sender + recipients equals B exactly.
          expect(finalSender.balance + recipientTotal).toBe(B);
          // The amount that left the sender equals the amount recipients gained.
          expect(B - finalSender.balance).toBe(recipientTotal);
          expect(recipientTotal).toBe(movedTotal);

          // Each successful transfer records a DEBIT + CREDIT TRANSFER pair.
          const transferTxns = await Transaction.find({
            type: TRANSACTION_TYPES.TRANSFER,
            status: TRANSACTION_STATUSES.COMPLETED,
          });
          expect(transferTxns).toHaveLength(fulfilled.length * 2);

          await Account.deleteMany({});
          await Transaction.deleteMany({});
        }
      ),
      { numRuns: 15 }
    );
  }, TEST_TIMEOUT_MS);
});
