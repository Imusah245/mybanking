// tests/properties/listTransactionsPagination.property.test.js
//
// Property-based test for design Property 16 (Pagination correctness), Task 11.4.
//
// Property 16: For a user's transaction history, paging through the result set
// with a fixed page size returns each record exactly once with no gaps,
// overlaps, or duplicates; concatenating all pages in order reproduces the full
// deterministic newest-first ordering; the page/limit metadata (total, page,
// limit, totalPages) is correct; and a page beyond the last returns an empty
// item list with the same total.
//
// **Validates: Requirements 8.2, 8.3, 10.2, 10.5, 10.6**
//
// Module under test: src/services/bankService.js `listTransactions(userId, { page, limit, ... })`.
//
// This is a FEATURE spec property: it MUST HOLD, so the test is expected to
// PASS. The in-memory single-node replica set, Mongoose connection, and
// per-test collection clearing are provided by tests/setup.js (wired via
// jest.config.js). Because fast-check runs many predicate iterations inside a
// single Jest test (and setup.js only clears collections BETWEEN tests, not
// between fast-check runs), each predicate iteration seeds its OWN fresh
// user + account + transaction set and scopes every assertion to that user. It
// also deletes the transactions it created at the end of each iteration so runs
// stay independent without relying on inter-run cleanup.

import fc from 'fast-check';
import mongoose from 'mongoose';

import Account, { ACCOUNT_STATUS } from '../../src/models/Account.js';
import Transaction, {
  TRANSACTION_TYPES,
  TRANSACTION_STATUSES,
} from '../../src/models/Transaction.js';
import { listTransactions } from '../../src/services/bankService.js';

// A per-iteration unique 10-digit account number. fast-check iterations run
// sequentially (the predicate is awaited), so a simple incrementing counter
// padded to 10 digits yields a collision-free, schema-valid (^\d{10}$) number.
let accountSeq = 0;
function nextAccountNumber() {
  accountSeq += 1;
  return String(accountSeq).padStart(10, '0');
}

// A per-iteration unique transaction reference matching ^TXN-[A-Z0-9]{8}$.
// A base36 counter padded to 8 uppercase chars stays collision-free across the
// whole test (far fewer than 36^8 references are generated).
let refSeq = 0;
function nextReference() {
  refSeq += 1;
  return `TXN-${refSeq.toString(36).toUpperCase().padStart(8, '0')}`;
}

const TRANSACTION_TYPE_VALUES = Object.values(TRANSACTION_TYPES);

/**
 * Seed a fresh user id + an Active account plus `n` transactions owned by that
 * user, each with a strictly increasing `createdAt` so the newest-first
 * (createdAt desc, _id desc tiebreak) ordering is fully deterministic.
 *
 * Transactions are inserted directly (not via deposits) so N can vary freely
 * and cheaply. All monetary fields are valid integers; the exact values are
 * irrelevant to pagination, which is what this property exercises.
 *
 * @returns {{ userId: mongoose.Types.ObjectId, accountId: mongoose.Types.ObjectId }}
 */
async function seedUserWithTransactions(n) {
  const userId = new mongoose.Types.ObjectId();
  const account = await Account.create({
    userId,
    accountNumber: nextAccountNumber(),
    balance: 0,
    status: ACCOUNT_STATUS.ACTIVE,
  });

  // Base time anchor; each record is spaced one second apart so createdAt is
  // strictly increasing (record i is newer than record i-1).
  const base = Date.now();

  const docs = [];
  for (let i = 0; i < n; i += 1) {
    const createdAt = new Date(base + i * 1000);
    docs.push({
      userId,
      accountId: account._id,
      type: TRANSACTION_TYPE_VALUES[i % TRANSACTION_TYPE_VALUES.length],
      amount: 100 + i,
      balanceBefore: 0,
      balanceAfter: 100 + i,
      description: `seed txn ${i}`,
      reference: nextReference(),
      status: TRANSACTION_STATUSES.COMPLETED,
      createdAt,
      updatedAt: createdAt,
    });
  }

  if (docs.length > 0) {
    // Disable timestamps so our explicit createdAt/updatedAt are honored
    // verbatim and the ordering stays deterministic.
    await Transaction.insertMany(docs, { timestamps: false });
  }

  return { userId, accountId: account._id };
}

describe('Property 16: Pagination correctness (bankService.listTransactions)', () => {
  // Ensure indexes (unique accountNumber / reference) are built before the
  // property loop so seeding behaves as in production.
  beforeAll(async () => {
    await Account.init();
    await Transaction.init();
  });

  test('paging through a history with a fixed page size yields each record exactly once with correct metadata (Validates: Requirements 8.2, 8.3, 10.2, 10.5, 10.6)', async () => {
    await fc.assert(
      fc.asyncProperty(
        // Dataset size N (include 0 to exercise the empty-history case).
        fc.integer({ min: 0, max: 40 }),
        // Page size L within the valid range [1, 100].
        fc.integer({ min: 1, max: 100 }),
        async (n, limit) => {
          const { userId } = await seedUserWithTransactions(n);

          try {
            // The expected full ordering: newest-first by createdAt desc with
            // an _id desc tiebreak, computed independently of listTransactions.
            const expectedOrdered = await Transaction.find({ userId })
              .sort({ createdAt: -1, _id: -1 });
            const expectedIds = expectedOrdered.map((t) => String(t._id));
            expect(expectedIds).toHaveLength(n);

            const expectedTotalPages = n === 0 ? 0 : Math.ceil(n / limit);

            // Page through every page 1..totalPages, collecting items in order.
            const collectedIds = [];
            const lastPage = Math.max(expectedTotalPages, 1);

            for (let page = 1; page <= lastPage; page += 1) {
              const result = await listTransactions(userId, { page, limit });

              // Metadata is correct and echoes the requested page/limit.
              expect(result.total).toBe(n);
              expect(result.page).toBe(page);
              expect(result.limit).toBe(limit);
              expect(result.totalPages).toBe(expectedTotalPages);

              // Each page has the right length: full pages are `limit`, the
              // last page carries the remainder, and pages past the end (only
              // possible here when n === 0) are empty.
              let expectedLen;
              if (n === 0 || page > expectedTotalPages) {
                expectedLen = 0;
              } else if (page < expectedTotalPages) {
                expectedLen = limit;
              } else {
                const remainder = n % limit;
                expectedLen = remainder === 0 ? limit : remainder;
              }
              expect(result.items).toHaveLength(expectedLen);

              for (const item of result.items) {
                collectedIds.push(String(item._id));
              }
            }

            // Concatenating all pages reproduces the full newest-first order
            // exactly: no gaps, no overlaps, no duplicates, no omissions.
            expect(collectedIds).toEqual(expectedIds);

            // No duplicates across pages (defensive, in addition to equality).
            expect(new Set(collectedIds).size).toBe(collectedIds.length);

            // A page strictly beyond the last returns an empty slice with the
            // same total and totalPages.
            const beyond = await listTransactions(userId, {
              page: lastPage + 1,
              limit,
            });
            expect(beyond.items).toHaveLength(0);
            expect(beyond.total).toBe(n);
            expect(beyond.totalPages).toBe(expectedTotalPages);
            expect(beyond.page).toBe(lastPage + 1);
            expect(beyond.limit).toBe(limit);
          } finally {
            // Re-seed independence: remove this iteration's data so later runs
            // start from a clean, user-scoped slate.
            await Transaction.deleteMany({ userId });
            await Account.deleteMany({ userId });
          }
        }
      ),
      { numRuns: 30 }
    );
  });
});
