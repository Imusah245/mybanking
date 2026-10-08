// tests/models/Transaction.test.js
//
// Unit tests for the Transaction model (Task 4.6).
//
// Coverage (design Properties 8, 9, 11; Requirements 5.2, 6.2, 7.4, 15.1):
//   - amount validation: rejects 0, negative, non-integer, and > AMOUNT_MAX;
//     accepts valid positive integers (including the AMOUNT_MAX boundary).
//   - reference format: rejects malformed refs, accepts a valid TXN-XXXXXXXX,
//     and the unique index rejects a duplicate reference.
//   - type and status enum validation.
//   - required fields enforced.
//
// The in-memory replica set, Mongoose connection, and per-test collection
// clearing are provided by tests/setup.js (wired via jest.config.js).

import mongoose from 'mongoose';
import Transaction, {
  TRANSACTION_TYPES,
  TRANSACTION_STATUSES,
  AMOUNT_MIN,
  AMOUNT_MAX,
} from '../../src/models/Transaction.js';

// Build a syntactically valid transaction document. Individual tests override
// just the field under test so each assertion isolates one validator.
let refCounter = 0;
function makeValidRef() {
  // Produce distinct, well-formed references of the form TXN-XXXXXXXX
  // (8 chars from [A-Z0-9]). Pad a base-36 counter to keep tests independent.
  const suffix = (refCounter++).toString(36).toUpperCase().padStart(8, '0');
  return `TXN-${suffix}`;
}

function validTransactionData(overrides = {}) {
  return {
    userId: new mongoose.Types.ObjectId(),
    accountId: new mongoose.Types.ObjectId(),
    type: TRANSACTION_TYPES.CREDIT,
    amount: 1000,
    balanceBefore: 0,
    balanceAfter: 1000,
    description: 'Test transaction',
    reference: makeValidRef(),
    status: TRANSACTION_STATUSES.COMPLETED,
    ...overrides,
  };
}

describe('Transaction model', () => {
  describe('exported constants', () => {
    test('exposes the expected type and status enums and amount bounds', () => {
      expect(Object.values(TRANSACTION_TYPES)).toEqual(
        expect.arrayContaining(['CREDIT', 'DEBIT', 'TRANSFER'])
      );
      expect(Object.values(TRANSACTION_STATUSES)).toEqual(
        expect.arrayContaining(['COMPLETED', 'FAILED', 'REVERSED'])
      );
      expect(AMOUNT_MIN).toBe(1);
      expect(AMOUNT_MAX).toBe(999_999_999_999);
    });
  });

  describe('amount validation (Requirement 15.1, Property 9)', () => {
    test('rejects an amount of 0 (below AMOUNT_MIN)', async () => {
      const doc = new Transaction(validTransactionData({ amount: 0 }));
      const err = doc.validateSync();
      expect(err).toBeDefined();
      expect(err.errors.amount).toBeDefined();
    });

    test('rejects a negative amount', async () => {
      const doc = new Transaction(validTransactionData({ amount: -500 }));
      const err = doc.validateSync();
      expect(err).toBeDefined();
      expect(err.errors.amount).toBeDefined();
    });

    test('rejects a non-integer amount', async () => {
      const doc = new Transaction(validTransactionData({ amount: 10.5 }));
      const err = doc.validateSync();
      expect(err).toBeDefined();
      expect(err.errors.amount).toBeDefined();
    });

    test('rejects an amount above AMOUNT_MAX', async () => {
      const doc = new Transaction(
        validTransactionData({ amount: AMOUNT_MAX + 1 })
      );
      const err = doc.validateSync();
      expect(err).toBeDefined();
      expect(err.errors.amount).toBeDefined();
    });

    test('accepts a valid positive integer amount', async () => {
      const doc = new Transaction(validTransactionData({ amount: 2500 }));
      expect(doc.validateSync()).toBeUndefined();
    });

    test('accepts the AMOUNT_MIN boundary (1 pesewa)', async () => {
      const doc = new Transaction(
        validTransactionData({ amount: AMOUNT_MIN, balanceAfter: AMOUNT_MIN })
      );
      expect(doc.validateSync()).toBeUndefined();
    });

    test('accepts the AMOUNT_MAX boundary', async () => {
      const doc = new Transaction(
        validTransactionData({ amount: AMOUNT_MAX, balanceAfter: AMOUNT_MAX })
      );
      expect(doc.validateSync()).toBeUndefined();
    });
  });

  describe('balance snapshot validation (Requirement 15.1)', () => {
    test('rejects a non-integer balanceBefore', () => {
      const doc = new Transaction(
        validTransactionData({ balanceBefore: 100.25 })
      );
      const err = doc.validateSync();
      expect(err).toBeDefined();
      expect(err.errors.balanceBefore).toBeDefined();
    });

    test('rejects a negative balanceAfter', () => {
      const doc = new Transaction(
        validTransactionData({ balanceAfter: -1 })
      );
      const err = doc.validateSync();
      expect(err).toBeDefined();
      expect(err.errors.balanceAfter).toBeDefined();
    });
  });

  describe('reference format validation (Property 8)', () => {
    test.each([
      ['missing TXN- prefix', 'ABC-12345678'],
      ['lowercase characters', 'TXN-abcd1234'],
      ['too few suffix characters', 'TXN-1234567'],
      ['too many suffix characters', 'TXN-123456789'],
      ['no suffix at all', 'TXN-'],
      ['empty string', ''],
      ['disallowed symbol in suffix', 'TXN-1234-567'],
    ])('rejects a malformed reference (%s)', (_label, badRef) => {
      const doc = new Transaction(
        validTransactionData({ reference: badRef })
      );
      const err = doc.validateSync();
      expect(err).toBeDefined();
      expect(err.errors.reference).toBeDefined();
    });

    test('accepts a valid TXN-XXXXXXXX reference', () => {
      const doc = new Transaction(
        validTransactionData({ reference: 'TXN-A1B2C3D4' })
      );
      expect(doc.validateSync()).toBeUndefined();
    });

    test('unique index rejects a duplicate reference', async () => {
      // Ensure the unique index is actually built against the collection
      // before relying on it (validateSync cannot catch uniqueness).
      await Transaction.init();
      await Transaction.syncIndexes();

      const reference = 'TXN-DUP00001';
      await Transaction.create(validTransactionData({ reference }));

      await expect(
        Transaction.create(validTransactionData({ reference }))
      ).rejects.toThrow();
    });
  });

  describe('type enum validation (Property 11)', () => {
    test('rejects an invalid type', () => {
      const doc = new Transaction(
        validTransactionData({ type: 'WITHDRAWAL' })
      );
      const err = doc.validateSync();
      expect(err).toBeDefined();
      expect(err.errors.type).toBeDefined();
    });

    test.each(Object.values(TRANSACTION_TYPES))(
      'accepts the valid type %s',
      (type) => {
        const doc = new Transaction(validTransactionData({ type }));
        expect(doc.validateSync()).toBeUndefined();
      }
    );
  });

  describe('status enum validation (Property 11)', () => {
    test('rejects an invalid status', () => {
      const doc = new Transaction(
        validTransactionData({ status: 'PENDING' })
      );
      const err = doc.validateSync();
      expect(err).toBeDefined();
      expect(err.errors.status).toBeDefined();
    });

    test.each(Object.values(TRANSACTION_STATUSES))(
      'accepts the valid status %s',
      (status) => {
        const doc = new Transaction(validTransactionData({ status }));
        expect(doc.validateSync()).toBeUndefined();
      }
    );
  });

  describe('required field enforcement', () => {
    test.each([
      'userId',
      'accountId',
      'type',
      'amount',
      'balanceBefore',
      'balanceAfter',
      'reference',
      'status',
    ])('rejects a document missing %s', (field) => {
      const data = validTransactionData();
      delete data[field];
      const doc = new Transaction(data);
      const err = doc.validateSync();
      expect(err).toBeDefined();
      expect(err.errors[field]).toBeDefined();
    });

    test('description is optional and defaults to an empty string', () => {
      const data = validTransactionData();
      delete data.description;
      const doc = new Transaction(data);
      expect(doc.validateSync()).toBeUndefined();
      expect(doc.description).toBe('');
    });

    test('relatedAccount is optional and defaults to null', () => {
      const data = validTransactionData();
      delete data.relatedAccount;
      const doc = new Transaction(data);
      expect(doc.validateSync()).toBeUndefined();
      expect(doc.relatedAccount).toBeNull();
    });
  });

  describe('description length validation', () => {
    test('rejects a description longer than 255 characters', () => {
      const doc = new Transaction(
        validTransactionData({ description: 'x'.repeat(256) })
      );
      const err = doc.validateSync();
      expect(err).toBeDefined();
      expect(err.errors.description).toBeDefined();
    });

    test('accepts a description of exactly 255 characters', () => {
      const doc = new Transaction(
        validTransactionData({ description: 'x'.repeat(255) })
      );
      expect(doc.validateSync()).toBeUndefined();
    });
  });
});
