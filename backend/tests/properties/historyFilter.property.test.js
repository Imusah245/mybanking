// tests/properties/historyFilter.property.test.js
//
// Property 17: History filter soundness and completeness (Task 11.5).
//
// *For any* transaction-history query over an owned dataset:
//   - a `type` filter returns exactly the owned transactions of that type;
//   - a valid `startDate`/`endDate` range returns exactly the owned
//     transactions whose creation timestamp falls inclusively within the range;
//   - a `search` term returns exactly the owned transactions whose
//     `description` OR `reference` contains the term as a case-insensitive
//     substring;
// with ALL supplied filters applied conjunctively — no matching owned record
// omitted and no non-matching (or foreign-owned) record included.
//
// **Validates: Requirements 8.5, 8.6, 8.8**  (`fast-check`)
//
// Approach: rather than drive the money-movement core (which would constrain
// type/createdAt/description), we insert Transaction documents DIRECTLY so each
// seeded record's `type`, `createdAt`, `description`, and `reference` are fully
// controlled. For each generated predicate we seed a random set of owned
// transactions for the acting user and a disjoint set for a SECOND user (whose
// records must never appear), build a random filter (some subset of type /
// date-range / search), then:
//   - compute the EXPECTED matching set independently in plain JS over the
//     seeded owned docs, and
//   - call `listTransactions` with a limit large enough to capture every match
//     (paging through if needed),
// and assert soundness (every returned item matches every supplied filter and
// is owned by the acting user) and completeness (the returned set of _ids equals
// the expected set of _ids).
//
// `listTransactions` is a pure read, but it is imported here through the same
// env-before-import discipline the other property suites use because
// src/config/env.js validates required secrets at import time and there is no
// committed .env. The in-memory single-node replica set is wired by
// tests/setup.js.

import fc from 'fast-check';
import mongoose from 'mongoose';

// Must be set before any env-validating module is (transitively) imported.
process.env.MONGO_URI =
  process.env.MONGO_URI ||
  'mongodb://127.0.0.1:27017/mybanking?replicaSet=rs0';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-value';
process.env.BCRYPT_ROUNDS = process.env.BCRYPT_ROUNDS || '4';

import Transaction, {
  TRANSACTION_TYPES,
  TRANSACTION_STATUSES,
} from '../../src/models/Transaction.js';
import { listTransactions } from '../../src/services/bankService.js';

const TYPES = Object.values(TRANSACTION_TYPES); // ['CREDIT','DEBIT','TRANSFER']

// A fixed window of candidate createdAt timestamps the generator draws from, so
// that a generated date range meaningfully partitions the seeded set (some in,
// some out) a good fraction of the time.
const BASE_TIME = Date.UTC(2023, 0, 1, 0, 0, 0); // 2023-01-01T00:00:00Z
const DAY_MS = 24 * 60 * 60 * 1000;
// Candidate day offsets (0..29) → createdAt = BASE_TIME + offset*DAY.
const DAY_SPAN = 30;

// A small pool of description fragments. Mixing shared substrings (e.g. "rent",
// "salary") with the random reference text gives the `search` filter real
// matches and real non-matches to discriminate.
const DESCRIPTION_WORDS = [
  'salary',
  'rent',
  'grocery',
  'refund',
  'bonus',
  'utility',
  '', // some records have an empty description (default)
];

// Generate a reference string in the schema-valid shape TXN-[A-Z0-9]{8}. We
// draw the 8 payload chars from a constrained alphabet so a `search` term can
// occasionally hit the reference as well as the description.
const REF_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

function refArb() {
  return fc
    .array(fc.integer({ min: 0, max: REF_ALPHABET.length - 1 }), {
      minLength: 8,
      maxLength: 8,
    })
    .map((idxs) => `TXN-${idxs.map((i) => REF_ALPHABET[i]).join('')}`);
}

// A single owned transaction's controllable fields. amount/balance values are
// fixed-valid (this property is about filtering, not monetary math).
function txnSpecArb() {
  return fc.record({
    type: fc.constantFrom(...TYPES),
    dayOffset: fc.integer({ min: 0, max: DAY_SPAN - 1 }),
    description: fc.constantFrom(...DESCRIPTION_WORDS),
    reference: refArb(),
  });
}

// A generated filter: each of type / date-range / search is independently
// present or absent, so predicates exercise every subset including the empty
// filter (which must return the full owned set).
function filterArb() {
  return fc.record({
    useType: fc.boolean(),
    typeValue: fc.constantFrom(...TYPES),

    useDateRange: fc.boolean(),
    // Two day offsets; the smaller becomes startDate, the larger endDate, so
    // the range is always well-formed (startDate <= endDate).
    dayA: fc.integer({ min: 0, max: DAY_SPAN - 1 }),
    dayB: fc.integer({ min: 0, max: DAY_SPAN - 1 }),

    useSearch: fc.boolean(),
    // Draw search terms from the same word pool plus short reference fragments
    // so the term matches some records and misses others. Mixed case exercises
    // the case-insensitive requirement.
    searchValue: fc.constantFrom(
      'SALARY',
      'Rent',
      'grocery',
      'TXN-',
      'bonus',
      'zzz-no-match',
    ),
  });
}

/**
 * Insert owned transactions for `userId` from the generated specs. Returns the
 * list of created plain docs (with _id, type, createdAt, description, reference)
 * for independent expected-set computation.
 */
async function seedOwned(userId, accountId, specs) {
  if (specs.length === 0) return [];

  const docs = specs.map((s) => ({
    userId,
    accountId,
    type: s.type,
    amount: 100,
    balanceBefore: 0,
    balanceAfter: 100,
    description: s.description,
    reference: s.reference,
    status: TRANSACTION_STATUSES.COMPLETED,
    createdAt: new Date(BASE_TIME + s.dayOffset * DAY_MS),
  }));

  // `timestamps: true` would stamp createdAt on save; insertMany with the
  // explicit createdAt and `timestamps:false` preserves our controlled dates.
  const created = await Transaction.insertMany(docs, { timestamps: false });
  return created;
}

/** Build the filter object passed to listTransactions from the generated spec. */
function buildFilter(gen) {
  const filter = {};
  if (gen.useType) filter.type = gen.typeValue;
  if (gen.useDateRange) {
    const lo = Math.min(gen.dayA, gen.dayB);
    const hi = Math.max(gen.dayA, gen.dayB);
    filter.startDate = new Date(BASE_TIME + lo * DAY_MS);
    // Inclusive end-of-day so a record stamped at hi*DAY (midnight) is inside
    // the [startDate, endDate] window.
    filter.endDate = new Date(BASE_TIME + hi * DAY_MS + (DAY_MS - 1));
  }
  if (gen.useSearch) filter.search = gen.searchValue;
  return filter;
}

/** Does a single seeded doc satisfy the generated filter (independent JS)? */
function matches(doc, gen) {
  if (gen.useType && doc.type !== gen.typeValue) return false;

  if (gen.useDateRange) {
    const lo = Math.min(gen.dayA, gen.dayB);
    const hi = Math.max(gen.dayA, gen.dayB);
    const start = BASE_TIME + lo * DAY_MS;
    const end = BASE_TIME + hi * DAY_MS + (DAY_MS - 1);
    const t = new Date(doc.createdAt).getTime();
    if (t < start || t > end) return false;
  }

  if (gen.useSearch) {
    const term = gen.searchValue.toLowerCase();
    const desc = (doc.description || '').toLowerCase();
    const ref = (doc.reference || '').toLowerCase();
    if (!desc.includes(term) && !ref.includes(term)) return false;
  }

  return true;
}

/** Remove every transaction so each predicate starts from a clean collection. */
async function cleanup() {
  await Transaction.deleteMany({});
}

describe('Property 17: history filter soundness and completeness', () => {
  test('type / date-range / search filters return exactly the matching owned records', async () => {
    await fc.assert(
      fc.asyncProperty(
        // Owned transactions for the acting user (0..12 so empty-set and larger
        // datasets are both covered).
        fc.array(txnSpecArb(), { minLength: 0, maxLength: 12 }),
        // Foreign transactions owned by a SECOND user — must never be returned.
        fc.array(txnSpecArb(), { minLength: 0, maxLength: 6 }),
        filterArb(),
        async (ownedSpecs, foreignSpecs, filterGen) => {
          const ownerUserId = new mongoose.Types.ObjectId();
          const ownerAccountId = new mongoose.Types.ObjectId();
          const foreignUserId = new mongoose.Types.ObjectId();
          const foreignAccountId = new mongoose.Types.ObjectId();

          try {
            const ownedDocs = await seedOwned(
              ownerUserId,
              ownerAccountId,
              ownedSpecs,
            );
            await seedOwned(foreignUserId, foreignAccountId, foreignSpecs);

            const filter = buildFilter(filterGen);

            // Independent expected set: owned docs that satisfy the filter.
            const expectedDocs = ownedDocs.filter((d) =>
              matches(d, filterGen),
            );
            const expectedIds = new Set(
              expectedDocs.map((d) => d._id.toString()),
            );

            // Page through with a large limit so every match is captured even
            // if the dataset exceeds a single page.
            const limit = 100;
            const collected = [];
            let page = 1;
            // Guard against runaway paging; owned set is <= 12 so a couple of
            // pages at most.
            for (let safety = 0; safety < 5; safety += 1) {
              const result = await listTransactions(ownerUserId, {
                ...filter,
                page,
                limit,
              });
              collected.push(...result.items);
              if (collected.length >= result.total) break;
              page += 1;
            }

            // --- Soundness: every returned item is owned and matches ----------
            for (const item of collected) {
              expect(item.userId.toString()).toBe(ownerUserId.toString());
              expect(matches(item, filterGen)).toBe(true);
            }

            // --- Completeness: returned id-set === expected id-set ------------
            const returnedIds = new Set(
              collected.map((i) => i._id.toString()),
            );
            expect(returnedIds.size).toBe(collected.length); // no duplicates
            expect(returnedIds.size).toBe(expectedIds.size);
            for (const id of expectedIds) {
              expect(returnedIds.has(id)).toBe(true);
            }

            // --- Ownership isolation: no foreign record ever appears ----------
            for (const item of collected) {
              expect(item.userId.toString()).not.toBe(
                foreignUserId.toString(),
              );
            }
          } finally {
            await cleanup();
          }
        },
      ),
      { numRuns: 30 },
    );
  });
});
