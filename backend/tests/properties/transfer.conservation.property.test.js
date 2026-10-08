// tests/properties/transfer.conservation.property.test.js
//
// Property 5: Successful transfer conserves money.
//
// For any valid transfer between two distinct Active accounts where the sender
// balance is >= the amount, after commit:
//   - the sender balance decreases by exactly the amount,
//   - the recipient balance increases by exactly the amount,
//   - the combined balance of the two accounts is unchanged (conservation),
//   - exactly two COMPLETED TRANSFER transactions are recorded: a DEBIT effect
//     on the sender and a CREDIT effect on the recipient, each with a distinct
//     unique reference matching TXN-[A-Z0-9]{8} and a `relatedAccount` link to
//     the counterparty.
//
// Validates: Requirements 7.1, 7.2, 7.3, 7.4
//
// Transfers run inside a MongoDB multi-document ACID transaction, so this suite
// relies on the single-node replica set provided by tests/setup.js. Each
// generated predicate re-seeds a fresh sender (user + Active account) and a
// fresh recipient (Active account with a distinct account number), runs the
// transfer, asserts the property, then cleans up so predicates stay isolated.

import fc from 'fast-check';
import mongoose from 'mongoose';

import Account, {
  ACCOUNT_STATUS,
  MAX_BALANCE_PESEWAS,
} from '../../src/models/Account.js';
import Transaction, {
  AMOUNT_MIN,
  AMOUNT_MAX,
  TRANSACTION_TYPES,
  TRANSACTION_STATUSES,
} from '../../src/models/Transaction.js';
import { transfer } from '../../src/services/bankService.js';

// Keep the generated balances comfortably inside the stored-balance bounds so a
// recipient credit of R + A can never overflow MAX_BALANCE_PESEWAS. We cap the
// sender balance S and amount A so that R + A <= MAX_BALANCE_PESEWAS holds for
// any R we generate. Using a modest ceiling also keeps the random amounts
// representative without flirting with the extreme upper bound every run.
const MAX_SENDER_BALANCE = 1_000_000_000; // 10,000,000.00 GHS in pesewas

/**
 * Seed a sender (a User + an Active Account with the given balance) and a
 * recipient (an Active Account with a distinct account number and balance).
 * Account numbers are fixed, distinct 10-digit strings so the self-transfer
 * guard never trips.
 */
async function seedPair(senderBalance, recipientBalance) {
  const senderUserId = new mongoose.Types.ObjectId();
  const recipientUserId = new mongoose.Types.ObjectId();

  const [senderAccount, recipientAccount] = await Promise.all([
    Account.create({
      userId: senderUserId,
      accountNumber: '1000000001',
      balance: senderBalance,
      status: ACCOUNT_STATUS.ACTIVE,
    }),
    Account.create({
      userId: recipientUserId,
      accountNumber: '2000000002',
      balance: recipientBalance,
      status: ACCOUNT_STATUS.ACTIVE,
    }),
  ]);

  return { senderUserId, senderAccount, recipientAccount };
}

/** Remove all accounts and transactions so each predicate starts clean. */
async function cleanup() {
  await Promise.all([Account.deleteMany({}), Transaction.deleteMany({})]);
}

describe('Property 5: successful transfer conserves money', () => {
  test('sender -A, recipient +A, combined unchanged, two TRANSFER legs recorded', async () => {
    await fc.assert(
      fc.asyncProperty(
        // Sender balance S in [AMOUNT_MIN, MAX_SENDER_BALANCE] so a valid
        // transfer amount A in [AMOUNT_MIN, S] always exists.
        fc.integer({ min: AMOUNT_MIN, max: MAX_SENDER_BALANCE }),
        // A fraction used to derive the transfer amount A within [1, S].
        fc.double({ min: 0, max: 1, noNaN: true }),
        // Recipient starting balance R, bounded so R + A can never exceed the
        // stored-balance ceiling (A <= S <= MAX_SENDER_BALANCE).
        fc.integer({
          min: 0,
          max: MAX_BALANCE_PESEWAS - MAX_SENDER_BALANCE,
        }),
        async (senderBalance, amountFraction, recipientBalance) => {
          // Derive A in [1, senderBalance] from the fraction (integer pesewas).
          const amount = Math.min(
            senderBalance,
            Math.max(AMOUNT_MIN, Math.round(amountFraction * senderBalance) || AMOUNT_MIN)
          );

          // Precondition sanity: a valid in-range amount that the sender covers.
          expect(Number.isInteger(amount)).toBe(true);
          expect(amount).toBeGreaterThanOrEqual(AMOUNT_MIN);
          expect(amount).toBeLessThanOrEqual(AMOUNT_MAX);
          expect(amount).toBeLessThanOrEqual(senderBalance);
          expect(recipientBalance + amount).toBeLessThanOrEqual(
            MAX_BALANCE_PESEWAS
          );

          const { senderUserId, senderAccount, recipientAccount } =
            await seedPair(senderBalance, recipientBalance);

          try {
            const { debitTxn, creditTxn } = await transfer(
              senderUserId,
              recipientAccount.accountNumber,
              amount
            );

            // --- Balance effects --------------------------------------------
            const [senderAfter, recipientAfter] = await Promise.all([
              Account.findById(senderAccount._id),
              Account.findById(recipientAccount._id),
            ]);

            expect(senderAfter.balance).toBe(senderBalance - amount);
            expect(recipientAfter.balance).toBe(recipientBalance + amount);

            // Conservation: the combined balance is unchanged.
            expect(senderAfter.balance + recipientAfter.balance).toBe(
              senderBalance + recipientBalance
            );

            // --- Ledger records ---------------------------------------------
            const txns = await Transaction.find({
              type: TRANSACTION_TYPES.TRANSFER,
            });
            expect(txns).toHaveLength(2);

            // The returned debit leg: a DEBIT effect on the sender.
            expect(debitTxn.type).toBe(TRANSACTION_TYPES.TRANSFER);
            expect(debitTxn.status).toBe(TRANSACTION_STATUSES.COMPLETED);
            expect(debitTxn.accountId.toString()).toBe(
              senderAccount._id.toString()
            );
            expect(debitTxn.amount).toBe(amount);
            expect(debitTxn.balanceAfter).toBe(senderBalance - amount);
            expect(debitTxn.balanceBefore).toBe(senderBalance);
            expect(debitTxn.relatedAccount.toString()).toBe(
              recipientAccount._id.toString()
            );

            // The returned credit leg: a CREDIT effect on the recipient.
            expect(creditTxn.type).toBe(TRANSACTION_TYPES.TRANSFER);
            expect(creditTxn.status).toBe(TRANSACTION_STATUSES.COMPLETED);
            expect(creditTxn.accountId.toString()).toBe(
              recipientAccount._id.toString()
            );
            expect(creditTxn.amount).toBe(amount);
            expect(creditTxn.balanceAfter).toBe(recipientBalance + amount);
            expect(creditTxn.balanceBefore).toBe(recipientBalance);
            expect(creditTxn.relatedAccount.toString()).toBe(
              senderAccount._id.toString()
            );

            // References: valid format and distinct across the two legs.
            const referencePattern = /^TXN-[A-Z0-9]{8}$/;
            expect(debitTxn.reference).toMatch(referencePattern);
            expect(creditTxn.reference).toMatch(referencePattern);
            expect(debitTxn.reference).not.toBe(creditTxn.reference);
          } finally {
            await cleanup();
          }
        }
      ),
      { numRuns: 30 }
    );
  });
});
