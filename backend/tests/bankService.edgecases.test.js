// tests/bankService.edgecases.test.js
//
// Example-based (NOT property) tests for bankService edge cases, Task 7.16.
//
// These are concrete, hand-picked examples that pin down the service's error
// paths and boundary behaviours that the property tests do not target directly:
//
//   - deposit/withdraw/transfer when the user has NO account    -> NotFoundError (404)
//   - transfer to a non-existent recipient account number       -> NotFoundError (404)
//   - self-transfer (recipient == sender's own number)          -> ValidationError (400)
//   - exact-balance withdrawal / transfer (amount === balance)  -> succeeds, balance -> 0
//   - minimum valid amount (1 pesewa) deposit / withdraw        -> succeeds
//   - listTransactions: default pagination (page 1, limit 20),
//       empty result -> { items: [], total: 0 }, type filtering,
//       ownership isolation, invalid page/limit -> ValidationError,
//       and newest-first ordering (Requirement 8.9).
//   - getTransactionForUser: own txn returned; another user's txn id -> 404;
//       malformed ObjectId -> 404 (Requirements 8.10, 8.11).
//
// Module under test: src/services/bankService.js.
//
// The in-memory single-node replica set, Mongoose connection, and per-test
// collection clearing are provided by tests/setup.js (wired via jest.config.js).
// env.js validates MONGO_URI and JWT_SECRET at import time; mirroring the other
// tests we set them before importing the service under test.

// Must be set before any env-validating module is imported.
process.env.MONGO_URI =
  process.env.MONGO_URI ||
  'mongodb://127.0.0.1:27017/mybanking?replicaSet=rs0';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-value';
process.env.BCRYPT_ROUNDS = process.env.BCRYPT_ROUNDS || '4';

import mongoose from 'mongoose';

import Account, { ACCOUNT_STATUS } from '../src/models/Account.js';
import Transaction, {
  TRANSACTION_TYPES,
  TRANSACTION_STATUSES,
} from '../src/models/Transaction.js';
import {
  deposit,
  withdraw,
  transfer,
  listTransactions,
  getTransactionForUser,
} from '../src/services/bankService.js';
import {
  ValidationError,
  NotFoundError,
} from '../src/utils/errors.js';

// A monotonic, collision-free 10-digit account number generator. Tests run
// sequentially and collections are cleared between tests, but a global counter
// keeps numbers unique even within a single test that seeds several accounts.
let accountSeq = 0;
function nextAccountNumber() {
  accountSeq += 1;
  return String(accountSeq).padStart(10, '0');
}

/**
 * Seed a fresh user id + an account with the given balance and status.
 * @returns {Promise<import('mongoose').Document>} the created Account document.
 */
async function seedAccount({
  balance = 0,
  status = ACCOUNT_STATUS.ACTIVE,
  userId = new mongoose.Types.ObjectId(),
} = {}) {
  return Account.create({
    userId,
    accountNumber: nextAccountNumber(),
    balance,
    status,
  });
}

beforeAll(async () => {
  // Build the unique indexes (accountNumber, reference) before seeding so the
  // behaviour matches production.
  await Account.init();
  await Transaction.init();
});

describe('bankService edge cases (example tests, Task 7.16)', () => {
  // -------------------------------------------------------------------------
  // Missing-account paths -> NotFoundError (404)
  // -------------------------------------------------------------------------
  describe('user has no account -> NotFoundError (404)', () => {
    test('deposit throws NotFoundError when the user has no account', async () => {
      const orphanUserId = new mongoose.Types.ObjectId();
      await expect(deposit(orphanUserId, 1000)).rejects.toBeInstanceOf(
        NotFoundError
      );
      // No ledger side effects.
      await expect(Transaction.countDocuments({})).resolves.toBe(0);
    });

    test('withdraw throws NotFoundError when the user has no account', async () => {
      const orphanUserId = new mongoose.Types.ObjectId();
      await expect(withdraw(orphanUserId, 1000)).rejects.toBeInstanceOf(
        NotFoundError
      );
      await expect(Transaction.countDocuments({})).resolves.toBe(0);
    });

    test('transfer throws NotFoundError when the sender has no account', async () => {
      // A valid, Active recipient exists so the only failure is the missing sender.
      const recipient = await seedAccount({ balance: 500 });
      const orphanUserId = new mongoose.Types.ObjectId();

      await expect(
        transfer(orphanUserId, recipient.accountNumber, 100)
      ).rejects.toBeInstanceOf(NotFoundError);

      // Recipient balance untouched; no ledger records.
      const persistedRecipient = await Account.findById(recipient._id);
      expect(persistedRecipient.balance).toBe(500);
      await expect(Transaction.countDocuments({})).resolves.toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // Transfer recipient resolution and self-transfer guard
  // -------------------------------------------------------------------------
  describe('transfer recipient resolution', () => {
    test('transfer to a non-existent recipient account number throws NotFoundError', async () => {
      const sender = await seedAccount({ balance: 10_000 });

      // A 10-digit number that was never issued.
      const missingNumber = '9999999999';
      // Guard against an accidental collision with the sender's own number.
      expect(sender.accountNumber).not.toBe(missingNumber);

      await expect(
        transfer(sender.userId, missingNumber, 1000)
      ).rejects.toBeInstanceOf(NotFoundError);

      // Sender balance unchanged; nothing recorded.
      const persistedSender = await Account.findById(sender._id);
      expect(persistedSender.balance).toBe(10_000);
      await expect(Transaction.countDocuments({})).resolves.toBe(0);
    });

    test('self-transfer (recipient == sender account number) throws ValidationError', async () => {
      const sender = await seedAccount({ balance: 10_000 });

      await expect(
        transfer(sender.userId, sender.accountNumber, 1000)
      ).rejects.toBeInstanceOf(ValidationError);

      // No-op: balance unchanged, no transaction recorded.
      const persistedSender = await Account.findById(sender._id);
      expect(persistedSender.balance).toBe(10_000);
      await expect(Transaction.countDocuments({})).resolves.toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // Exact-balance boundaries -> succeed, balance becomes 0
  // -------------------------------------------------------------------------
  describe('exact-balance boundaries', () => {
    test('withdrawing the entire balance succeeds and drives balance to 0', async () => {
      const account = await seedAccount({ balance: 7_500 });

      const { account: updated, transaction } = await withdraw(
        account.userId,
        7_500
      );

      expect(updated.balance).toBe(0);
      expect(transaction.type).toBe(TRANSACTION_TYPES.DEBIT);
      expect(transaction.status).toBe(TRANSACTION_STATUSES.COMPLETED);
      expect(transaction.amount).toBe(7_500);
      expect(transaction.balanceBefore).toBe(7_500);
      expect(transaction.balanceAfter).toBe(0);

      const persisted = await Account.findById(account._id);
      expect(persisted.balance).toBe(0);
    });

    test('transferring the entire sender balance succeeds and drives sender to 0', async () => {
      const sender = await seedAccount({ balance: 4_200 });
      const recipient = await seedAccount({ balance: 0 });

      const { debitTxn, creditTxn } = await transfer(
        sender.userId,
        recipient.accountNumber,
        4_200
      );

      // Sender emptied, recipient received the full amount.
      const persistedSender = await Account.findById(sender._id);
      const persistedRecipient = await Account.findById(recipient._id);
      expect(persistedSender.balance).toBe(0);
      expect(persistedRecipient.balance).toBe(4_200);

      // Two TRANSFER legs with counterparty links.
      expect(debitTxn.type).toBe(TRANSACTION_TYPES.TRANSFER);
      expect(creditTxn.type).toBe(TRANSACTION_TYPES.TRANSFER);
      expect(debitTxn.balanceAfter).toBe(0);
      expect(creditTxn.balanceAfter).toBe(4_200);
      expect(String(debitTxn.relatedAccount)).toBe(String(recipient._id));
      expect(String(creditTxn.relatedAccount)).toBe(String(sender._id));

      // Combined balance conserved.
      expect(persistedSender.balance + persistedRecipient.balance).toBe(4_200);
    });
  });

  // -------------------------------------------------------------------------
  // Minimum valid amount (1 pesewa)
  // -------------------------------------------------------------------------
  describe('minimum valid amount (1 pesewa)', () => {
    test('depositing 1 pesewa succeeds', async () => {
      const account = await seedAccount({ balance: 0 });

      const { account: updated, transaction } = await deposit(
        account.userId,
        1
      );

      expect(updated.balance).toBe(1);
      expect(transaction.amount).toBe(1);
      expect(transaction.type).toBe(TRANSACTION_TYPES.CREDIT);
      expect(transaction.balanceBefore).toBe(0);
      expect(transaction.balanceAfter).toBe(1);
    });

    test('withdrawing 1 pesewa succeeds', async () => {
      const account = await seedAccount({ balance: 1 });

      const { account: updated, transaction } = await withdraw(
        account.userId,
        1
      );

      expect(updated.balance).toBe(0);
      expect(transaction.amount).toBe(1);
      expect(transaction.type).toBe(TRANSACTION_TYPES.DEBIT);
      expect(transaction.balanceBefore).toBe(1);
      expect(transaction.balanceAfter).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // listTransactions
  // -------------------------------------------------------------------------
  describe('listTransactions', () => {
    test('empty history returns items: [] and total: 0 with default pagination (Requirement 8.9)', async () => {
      const userId = new mongoose.Types.ObjectId();

      const result = await listTransactions(userId);

      expect(result.items).toEqual([]);
      expect(result.total).toBe(0);
      // Defaults are page 1, limit 20 (Requirement 8.2).
      expect(result.page).toBe(1);
      expect(result.limit).toBe(20);
      expect(result.totalPages).toBe(0);
    });

    test('default pagination returns the first 20 of a larger owned set, newest-first', async () => {
      const account = await seedAccount({ balance: 0 });

      // Create 25 CREDIT deposits so there are more than one default page.
      for (let i = 0; i < 25; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        await deposit(account.userId, 100);
      }

      const result = await listTransactions(account.userId);

      expect(result.total).toBe(25);
      expect(result.page).toBe(1);
      expect(result.limit).toBe(20);
      expect(result.totalPages).toBe(2);
      expect(result.items).toHaveLength(20);

      // Newest-first ordering: each item's createdAt is >= the next item's.
      for (let i = 0; i < result.items.length - 1; i += 1) {
        expect(result.items[i].createdAt.getTime()).toBeGreaterThanOrEqual(
          result.items[i + 1].createdAt.getTime()
        );
      }
    });

    test('type filter returns only matching transactions', async () => {
      const sender = await seedAccount({ balance: 100_000 });
      const recipient = await seedAccount({ balance: 0 });

      // 2 credits, 1 withdrawal (debit), 1 transfer (one DEBIT leg owned by sender).
      await deposit(sender.userId, 1000);
      await deposit(sender.userId, 2000);
      await withdraw(sender.userId, 500);
      await transfer(sender.userId, recipient.accountNumber, 750);

      const credits = await listTransactions(sender.userId, {
        type: TRANSACTION_TYPES.CREDIT,
      });
      expect(credits.total).toBe(2);
      expect(credits.items.every((t) => t.type === TRANSACTION_TYPES.CREDIT)).toBe(
        true
      );

      const debits = await listTransactions(sender.userId, {
        type: TRANSACTION_TYPES.DEBIT,
      });
      expect(debits.total).toBe(1);
      expect(debits.items[0].type).toBe(TRANSACTION_TYPES.DEBIT);

      const transfers = await listTransactions(sender.userId, {
        type: TRANSACTION_TYPES.TRANSFER,
      });
      expect(transfers.total).toBe(1);
      expect(transfers.items[0].type).toBe(TRANSACTION_TYPES.TRANSFER);
    });

    test('ownership isolation: user A never sees user B transactions', async () => {
      const accountA = await seedAccount({ balance: 0 });
      const accountB = await seedAccount({ balance: 0 });

      await deposit(accountA.userId, 1000);
      await deposit(accountA.userId, 2000);
      await deposit(accountB.userId, 9999);

      const forA = await listTransactions(accountA.userId);
      expect(forA.total).toBe(2);
      expect(
        forA.items.every((t) => String(t.userId) === String(accountA.userId))
      ).toBe(true);

      const forB = await listTransactions(accountB.userId);
      expect(forB.total).toBe(1);
      expect(String(forB.items[0].userId)).toBe(String(accountB.userId));
      expect(forB.items[0].amount).toBe(9999);
    });

    test('invalid page (0) throws ValidationError and returns no transactions', async () => {
      const account = await seedAccount({ balance: 0 });
      await deposit(account.userId, 100);

      await expect(
        listTransactions(account.userId, { page: 0 })
      ).rejects.toBeInstanceOf(ValidationError);
    });

    test('invalid limit (over the max of 100) throws ValidationError', async () => {
      const userId = new mongoose.Types.ObjectId();
      await expect(
        listTransactions(userId, { limit: 101 })
      ).rejects.toBeInstanceOf(ValidationError);
    });

    test('non-integer page throws ValidationError', async () => {
      const userId = new mongoose.Types.ObjectId();
      await expect(
        listTransactions(userId, { page: 1.5 })
      ).rejects.toBeInstanceOf(ValidationError);
    });

    test('unrecognized type filter throws ValidationError', async () => {
      const userId = new mongoose.Types.ObjectId();
      await expect(
        listTransactions(userId, { type: 'NOT_A_TYPE' })
      ).rejects.toBeInstanceOf(ValidationError);
    });
  });

  // -------------------------------------------------------------------------
  // getTransactionForUser
  // -------------------------------------------------------------------------
  describe('getTransactionForUser', () => {
    test('returns the caller own transaction by id', async () => {
      const account = await seedAccount({ balance: 0 });
      const { transaction } = await deposit(account.userId, 1234);

      const fetched = await getTransactionForUser(
        account.userId,
        transaction._id
      );

      expect(String(fetched._id)).toBe(String(transaction._id));
      expect(fetched.amount).toBe(1234);
      expect(String(fetched.userId)).toBe(String(account.userId));
    });

    test("another user's transaction id throws NotFoundError (never leaked)", async () => {
      const accountA = await seedAccount({ balance: 0 });
      const accountB = await seedAccount({ balance: 0 });

      // B owns a transaction; A must not be able to fetch it.
      const { transaction: bTxn } = await deposit(accountB.userId, 500);

      await expect(
        getTransactionForUser(accountA.userId, bTxn._id)
      ).rejects.toBeInstanceOf(NotFoundError);
    });

    test('a malformed (non-ObjectId) id throws NotFoundError, not a cast error', async () => {
      const userId = new mongoose.Types.ObjectId();

      await expect(
        getTransactionForUser(userId, 'not-a-valid-object-id')
      ).rejects.toBeInstanceOf(NotFoundError);
    });
  });
});
