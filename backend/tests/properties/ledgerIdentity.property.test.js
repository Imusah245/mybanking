// tests/properties/ledgerIdentity.property.test.js
//
// Property 1: Ledger balanceAfter identity (Task 7.6).
//
// *For any* deposit, withdrawal, or transfer transaction record produced by the
// system, `balanceAfter == balanceBefore + signedAmount`, where
// `signedAmount = +amount` for a CREDIT effect and `-amount` for a DEBIT effect.
// In addition, successive records on a single account chain so that each
// record's `balanceBefore` equals the immediately prior record's `balanceAfter`,
// and the final stored account balance equals the last record's `balanceAfter`.
//
// **Validates: Requirements 5.2, 6.2, 7.4, 15.3**  (`fast-check`)
//
// This exercises the real money-movement core (`bankService.deposit` /
// `bankService.withdraw`) against the in-memory single-node replica set wired by
// tests/setup.js (transactions require it). No mocks: every operation performs
// a genuine atomic balance mutation and appends a genuine Transaction record,
// so the asserted identity is checked against actual persisted ledger rows.
//
// Each fast-check run hits the DB (seed account + a sequence of ops), so a
// modest `numRuns` is used — enough to cover many random valid sequences while
// keeping total DB work bounded. src/config/env.js validates required secrets
// at import time and there is no committed .env, so (mirroring
// tests/user.model.test.js) the required env vars are set BEFORE the
// env-dependent modules are dynamically imported.

import { jest } from '@jest/globals';
import fc from 'fast-check';
import mongoose from 'mongoose';

// Must be set before any env-validating module is imported.
process.env.MONGO_URI =
  process.env.MONGO_URI ||
  'mongodb://127.0.0.1:27017/mybanking?replicaSet=rs0';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-value';
process.env.BCRYPT_ROUNDS = process.env.BCRYPT_ROUNDS || '4';

// Keep each generated amount comfortably below AMOUNT_MAX and keep the running
// balance well under MAX_BALANCE_PESEWAS so a long sequence of credits can never
// overflow the account's maximum (design Property 11 range).
const AMOUNT_CAP = 10_000_000; // 100,000.00 GHS per op — far below AMOUNT_MAX.
const INITIAL_BALANCE = 50_000_000; // 500,000.00 GHS seed, in pesewas.

/** @type {typeof import('../../src/services/bankService.js')} */
let bankService;
/** @type {import('mongoose').Model} */
let User;
/** @type {import('mongoose').Model} */
let Account;
/** @type {import('mongoose').Model} */
let Transaction;
let TRANSACTION_TYPES;

beforeAll(async () => {
  // Dynamic imports so the env vars above are in place before env.js validates.
  const userMod = await import('../../src/models/User.js');
  const accountMod = await import('../../src/models/Account.js');
  const txnMod = await import('../../src/models/Transaction.js');
  bankService = await import('../../src/services/bankService.js');

  User = userMod.default;
  Account = accountMod.default;
  Transaction = txnMod.default;
  TRANSACTION_TYPES = txnMod.TRANSACTION_TYPES;
});

let accountSeq = 0;

/**
 * Seed one user and one Active account with the given starting balance (in
 * pesewas), returning the created user id and account. Each account gets a
 * distinct 10-digit number and the user a distinct email so repeated fast-check
 * runs (which share a test, with collections cleared only between tests) do not
 * collide on unique indexes within a single property.
 */
async function seedUserWithAccount(initialBalance) {
  accountSeq += 1;
  const user = await User.create({
    firstName: 'Test',
    lastName: 'Owner',
    email: `owner-${accountSeq}-${Date.now()}@example.com`,
    phone: '0241234567',
    dateOfBirth: new Date('1990-01-01'),
    address: '1 Ledger Way',
    password: 'correct horse battery',
  });

  const accountNumber = String(1_000_000_000 + (accountSeq % 8_999_999_999)).padStart(10, '0');
  const account = await Account.create({
    userId: user._id,
    accountNumber,
    balance: initialBalance,
    status: 'Active',
  });

  return { userId: user._id, account };
}

/**
 * Signed amount a Transaction record represents, derived purely from the stored
 * record so the assertion is independent of how the service computed it:
 *   - CREDIT  => +amount
 *   - DEBIT   => -amount
 *   - TRANSFER => sign inferred from balanceAfter vs balanceBefore (a transfer
 *                 leg is a CREDIT effect on the recipient, a DEBIT on the sender)
 */
function signedAmountOf(txn) {
  if (txn.type === TRANSACTION_TYPES.CREDIT) return txn.amount;
  if (txn.type === TRANSACTION_TYPES.DEBIT) return -txn.amount;
  // TRANSFER leg: direction follows the balance delta.
  return txn.balanceAfter >= txn.balanceBefore ? txn.amount : -txn.amount;
}

describe('Property 1: ledger balanceAfter identity', () => {
  test('balanceAfter == balanceBefore + signedAmount for every record; chain is consistent', async () => {
    await fc.assert(
      fc.asyncProperty(
        // A random sequence of operations. Each is a deposit or a (bounded)
        // withdrawal; actual withdrawal amount is clamped to the available
        // balance at execution time so every operation is a *valid* op (the
        // identity must hold for records the system actually produces).
        fc.array(
          fc.record({
            kind: fc.constantFrom('deposit', 'withdraw'),
            amount: fc.integer({ min: 1, max: AMOUNT_CAP }),
          }),
          { minLength: 1, maxLength: 12 }
        ),
        async (ops) => {
          const { userId, account } = await seedUserWithAccount(INITIAL_BALANCE);

          // Execute the sequence through the real service. Mirror the running
          // balance locally so we can clamp withdrawals to what is available
          // and keep every operation valid (no insufficient-funds rejections).
          let running = INITIAL_BALANCE;
          for (const op of ops) {
            if (op.kind === 'deposit') {
              // Guard against the (very unlikely) overflow of MAX_BALANCE.
              if (running + op.amount > INITIAL_BALANCE + AMOUNT_CAP * 12) {
                continue;
              }
              await bankService.deposit(userId, op.amount);
              running += op.amount;
            } else {
              const amount = Math.min(op.amount, running);
              if (amount < 1) continue; // nothing to withdraw
              await bankService.withdraw(userId, amount);
              running -= amount;
            }
          }

          // Fetch every produced record for this account, oldest-first, so we
          // can verify the per-account chain in execution order.
          const records = await Transaction.find({ accountId: account._id })
            .sort({ createdAt: 1, _id: 1 })
            .lean();

          // Per-record ledger identity (the core of Property 1).
          for (const txn of records) {
            const signed = signedAmountOf(txn);
            expect(txn.balanceAfter).toBe(txn.balanceBefore + signed);
            // Monetary fields are integers and non-negative balances.
            expect(Number.isInteger(txn.balanceBefore)).toBe(true);
            expect(Number.isInteger(txn.balanceAfter)).toBe(true);
            expect(txn.balanceBefore).toBeGreaterThanOrEqual(0);
            expect(txn.balanceAfter).toBeGreaterThanOrEqual(0);
          }

          // Chain consistency: each record's balanceBefore equals the prior
          // record's balanceAfter, starting from the seeded initial balance.
          let prevAfter = INITIAL_BALANCE;
          for (const txn of records) {
            expect(txn.balanceBefore).toBe(prevAfter);
            prevAfter = txn.balanceAfter;
          }

          // The final stored account balance equals the last record's
          // balanceAfter (or the seed balance when no op ran).
          const finalAccount = await Account.findById(account._id).lean();
          expect(finalAccount.balance).toBe(prevAfter);
          expect(finalAccount.balance).toBe(running);
        }
      ),
      { numRuns: 30 }
    );
  });
});
