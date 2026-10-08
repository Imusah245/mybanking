// tests/models/Account.test.js
//
// Unit tests for the Account model (Task 4.4).
//
// Covers the monetary integer-range invariant (Property 11) and the structural
// invariants of the schema:
//   - defaults (balance 0, status Active, currency GHS)
//   - balance validation: integer-only, non-negative, within [MIN, MAX]
//   - accountNumber format (^\d{10}$) and unique index
//   - status enum
//
// The in-memory single-node replica set and per-test collection clearing are
// provided by tests/setup.js. Tests run under ESM Jest.
//
// _Requirements: 1.2, 15.1_

import mongoose from 'mongoose';
import Account, {
  ACCOUNT_STATUS,
  MIN_BALANCE_PESEWAS,
  MAX_BALANCE_PESEWAS,
} from '../../src/models/Account.js';

/** Build a valid-by-default account payload, overridable per test. */
const makeAccount = (overrides = {}) => ({
  userId: new mongoose.Types.ObjectId(),
  accountNumber: '0123456789',
  ...overrides,
});

describe('Account model', () => {
  describe('exported constants', () => {
    test('expose the expected balance bounds and status values', () => {
      expect(MIN_BALANCE_PESEWAS).toBe(0);
      expect(MAX_BALANCE_PESEWAS).toBe(9_999_999_999_999);
      expect(ACCOUNT_STATUS).toEqual({
        ACTIVE: 'Active',
        FROZEN: 'Frozen',
        DISABLED: 'Disabled',
      });
    });
  });

  describe('defaults', () => {
    test('applies balance 0, status Active, currency GHS, accountType Savings', async () => {
      const account = await Account.create(makeAccount());

      expect(account.balance).toBe(0);
      expect(account.status).toBe(ACCOUNT_STATUS.ACTIVE);
      expect(account.currency).toBe('GHS');
      expect(account.accountType).toBe('Savings');
    });
  });

  describe('balance validation (Property 11 integer-range invariant)', () => {
    test('rejects a non-integer balance', async () => {
      const account = new Account(makeAccount({ balance: 100.5 }));

      await expect(account.validate()).rejects.toThrow();
      const err = await account.validate().catch((e) => e);
      expect(err.errors.balance).toBeDefined();
    });

    test('rejects a negative balance', async () => {
      const account = new Account(makeAccount({ balance: -1 }));

      const err = await account.validate().catch((e) => e);
      expect(err).toBeInstanceOf(mongoose.Error.ValidationError);
      expect(err.errors.balance).toBeDefined();
    });

    test('rejects a balance above MAX_BALANCE_PESEWAS', async () => {
      const account = new Account(
        makeAccount({ balance: MAX_BALANCE_PESEWAS + 1 })
      );

      const err = await account.validate().catch((e) => e);
      expect(err).toBeInstanceOf(mongoose.Error.ValidationError);
      expect(err.errors.balance).toBeDefined();
    });

    test('accepts a valid integer balance', async () => {
      const account = new Account(makeAccount({ balance: 123456 }));
      await expect(account.validate()).resolves.toBeUndefined();
    });

    test('accepts the minimum balance (0)', async () => {
      const account = new Account(
        makeAccount({ balance: MIN_BALANCE_PESEWAS })
      );
      await expect(account.validate()).resolves.toBeUndefined();
    });

    test('accepts the maximum balance (MAX_BALANCE_PESEWAS)', async () => {
      const account = new Account(
        makeAccount({ balance: MAX_BALANCE_PESEWAS })
      );
      await expect(account.validate()).resolves.toBeUndefined();
    });
  });

  describe('accountNumber format validation', () => {
    test.each([
      ['too short (9 digits)', '012345678'],
      ['too long (11 digits)', '01234567890'],
      ['contains a non-digit', '01234A6789'],
      ['empty string', ''],
      ['contains whitespace', '012345678 '],
    ])('rejects an accountNumber that is %s', async (_label, accountNumber) => {
      const account = new Account(makeAccount({ accountNumber }));

      const err = await account.validate().catch((e) => e);
      expect(err).toBeInstanceOf(mongoose.Error.ValidationError);
      expect(err.errors.accountNumber).toBeDefined();
    });

    test('accepts a 10-digit accountNumber string', async () => {
      const account = new Account(makeAccount({ accountNumber: '9876543210' }));
      await expect(account.validate()).resolves.toBeUndefined();
    });

    test('enforces the unique index (duplicate accountNumber fails)', async () => {
      // Ensure the unique index is actually built before relying on it; by
      // default index creation is asynchronous and may not have completed.
      await Account.init();
      await Account.syncIndexes();

      await Account.create(makeAccount({ accountNumber: '5555555555' }));

      await expect(
        Account.create(makeAccount({ accountNumber: '5555555555' }))
      ).rejects.toMatchObject({ code: 11000 });
    });
  });

  describe('status enum validation', () => {
    test('rejects an invalid status value', async () => {
      const account = new Account(makeAccount({ status: 'Closed' }));

      const err = await account.validate().catch((e) => e);
      expect(err).toBeInstanceOf(mongoose.Error.ValidationError);
      expect(err.errors.status).toBeDefined();
    });

    test.each(Object.values(ACCOUNT_STATUS))(
      'accepts the valid status "%s"',
      async (status) => {
        const account = new Account(makeAccount({ status }));
        await expect(account.validate()).resolves.toBeUndefined();
      }
    );
  });
});
