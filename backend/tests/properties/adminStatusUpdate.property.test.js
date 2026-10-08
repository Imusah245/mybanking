// tests/properties/adminStatusUpdate.property.test.js
//
// Property 19: Account status update is deterministic and idempotent (Task 13.5).
// Property 20: Resource-not-found handling (Task 13.5).
//
// Property 19 — *For any* existing account and *any* valid target status
// (Active, Frozen, Disabled), `adminController.updateAccountStatus` sets the
// stored status to the target and the response reflects it; applying any
// sequence of valid targets is deterministic (stored status equals the last
// applied value) and applying the same status again is idempotent (no error,
// no drift — the stored status and the 200 response are unchanged).
//
// Property 20 — *For any* status update referencing a nonexistent account id
// (a valid ObjectId not present in the DB) OR a malformed id (not an
// ObjectId), the controller yields a NotFoundError (404) and no state change
// occurs. An invalid status value (not in the enum) yields a ValidationError
// (400) with no state change.
//
// **Validates: Requirements 7.8, 8.11, 12.1, 12.3**  (`fast-check`)
//
// The controller is driven DIRECTLY with a stub req/res/next against the real
// Account model and the in-memory single-node replica set wired by
// tests/setup.js — no HTTP layer, no mocks. `next = err => { throw err }` so a
// thrown typed error surfaces as a rejected call we can assert on. Each
// predicate re-seeds its own account (random initial status) and cleans up so
// repeated fast-check runs within one test do not collide on the unique
// accountNumber index. A modest `numRuns` keeps total DB work bounded while
// covering many random valid sequences.
//
// src/config/env.js validates required secrets at import time and there is no
// committed .env, so (mirroring the other property tests) the required env
// vars are set BEFORE the env-dependent modules are dynamically imported.

import fc from 'fast-check';
import mongoose from 'mongoose';

// Must be set before any env-validating module is imported.
process.env.MONGO_URI =
  process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/mybanking?replicaSet=rs0';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-value';
process.env.BCRYPT_ROUNDS = process.env.BCRYPT_ROUNDS || '4';

/** @type {import('mongoose').Model} */
let User;
/** @type {import('mongoose').Model} */
let Account;
let ACCOUNT_STATUS;
let adminController;
let NotFoundError;
let ValidationError;

/** Valid target statuses (Active, Frozen, Disabled). */
let STATUS_VALUES;

beforeAll(async () => {
  // Dynamic imports so the env vars above are in place before env.js validates.
  const userMod = await import('../../src/models/User.js');
  const accountMod = await import('../../src/models/Account.js');
  adminController = await import('../../src/controllers/adminController.js');
  const errorsMod = await import('../../src/utils/errors.js');

  User = userMod.default;
  Account = accountMod.default;
  ACCOUNT_STATUS = accountMod.ACCOUNT_STATUS;
  NotFoundError = errorsMod.NotFoundError;
  ValidationError = errorsMod.ValidationError;

  STATUS_VALUES = Object.values(ACCOUNT_STATUS);
});

let seq = 0;

/**
 * Seed one user and one account with the given starting status, returning the
 * created account. Each account gets a distinct 10-digit number and the user a
 * distinct email so repeated fast-check runs (collections are cleared only
 * between tests) do not collide on unique indexes within a single property.
 */
async function seedAccount(initialStatus) {
  seq += 1;
  const user = await User.create({
    firstName: 'Admin',
    lastName: 'Target',
    email: `acct-${seq}-${Date.now()}@example.com`,
    phone: '0241234567',
    dateOfBirth: new Date('1990-01-01'),
    address: '1 Status Way',
    password: 'correct horse battery',
  });

  const accountNumber = String(1_000_000_000 + (seq % 8_999_999_999)).padStart(10, '0');
  const account = await Account.create({
    userId: user._id,
    accountNumber,
    balance: 0,
    status: initialStatus,
  });

  return account;
}

/** Build a fresh res stub capturing the status code and JSON body. */
function makeRes() {
  return {
    code: undefined,
    body: undefined,
    status(code) {
      this.code = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

/** next that rethrows so a controller-forwarded error surfaces to the caller. */
const rethrowNext = (err) => {
  throw err;
};

/**
 * Invoke updateAccountStatus directly. Returns the res stub on success; on a
 * forwarded error (via next) the awaited call rejects, which the caller asserts
 * on. (The controller catches synchronously-thrown errors and forwards them to
 * next, so with a rethrowing next the error surfaces from the awaited call.)
 */
async function callUpdate(id, status) {
  const req = { params: { id }, body: { status } };
  const res = makeRes();
  await adminController.updateAccountStatus(req, res, rethrowNext);
  return res;
}

describe('Property 19: account status update is deterministic and idempotent', () => {
  test('applying a sequence of valid statuses is deterministic; re-applying is idempotent (200, no drift)', async () => {
    await fc.assert(
      fc.asyncProperty(
        // Random initial status for the seeded account.
        fc.constantFrom('Active', 'Frozen', 'Disabled'),
        // A non-empty random sequence of valid target statuses to apply.
        fc.array(fc.constantFrom('Active', 'Frozen', 'Disabled'), {
          minLength: 1,
          maxLength: 8,
        }),
        async (initialStatus, targets) => {
          const account = await seedAccount(initialStatus);

          try {
            for (const target of targets) {
              // First application: status is set to the target and the 200
              // response reflects it.
              const res1 = await callUpdate(String(account._id), target);
              expect(res1.code).toBe(200);
              expect(res1.body.success).toBe(true);
              expect(res1.body.data.status).toBe(target);
              const stored1 = await Account.findById(account._id).lean();
              expect(stored1.status).toBe(target);

              // Idempotence: applying the SAME status again leaves the stored
              // status unchanged and still returns 200 with the same status.
              const res2 = await callUpdate(String(account._id), target);
              expect(res2.code).toBe(200);
              expect(res2.body.success).toBe(true);
              expect(res2.body.data.status).toBe(target);
              const stored2 = await Account.findById(account._id).lean();
              expect(stored2.status).toBe(target);
            }

            // Determinism: after the whole sequence the stored status equals
            // the LAST applied target.
            const finalStored = await Account.findById(account._id).lean();
            expect(finalStored.status).toBe(targets[targets.length - 1]);
          } finally {
            // Clean up so unique indexes do not accumulate across runs.
            await Account.deleteOne({ _id: account._id });
            await User.deleteOne({ _id: account.userId });
          }
        }
      ),
      { numRuns: 40 }
    );
  });

  test('an invalid status value is rejected with ValidationError (400) and no state change', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom('Active', 'Frozen', 'Disabled'),
        // Garbage values that are never a member of ACCOUNT_STATUS.
        fc
          .string()
          .filter((s) => !STATUS_VALUES.includes(s))
          .map((s) => (s === '' ? 'not-a-status' : s)),
        async (initialStatus, badStatus) => {
          const account = await seedAccount(initialStatus);

          try {
            await expect(callUpdate(String(account._id), badStatus)).rejects.toBeInstanceOf(
              ValidationError
            );

            // No state change: stored status still equals the seeded value.
            const stored = await Account.findById(account._id).lean();
            expect(stored.status).toBe(initialStatus);
          } finally {
            await Account.deleteOne({ _id: account._id });
            await User.deleteOne({ _id: account.userId });
          }
        }
      ),
      { numRuns: 30 }
    );
  });
});

describe('Property 20: resource-not-found handling for status update', () => {
  test('a nonexistent (valid) account id yields NotFoundError (404) and no state change', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom('Active', 'Frozen', 'Disabled'),
        async (target) => {
          // A fresh, valid ObjectId that is guaranteed not to be in the DB.
          const missingId = new mongoose.Types.ObjectId();

          await expect(callUpdate(String(missingId), target)).rejects.toBeInstanceOf(
            NotFoundError
          );

          // No document was created or mutated by the failed update.
          const count = await Account.countDocuments({ _id: missingId });
          expect(count).toBe(0);
        }
      ),
      { numRuns: 30 }
    );
  });

  test('a malformed id (not an ObjectId) yields NotFoundError (404) via the controller guard', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom('Active', 'Frozen', 'Disabled'),
        // Non-ObjectId strings: too short / wrong charset / clearly malformed.
        fc
          .string({ minLength: 1, maxLength: 12 })
          .filter((s) => !mongoose.isValidObjectId(s)),
        async (target, malformedId) => {
          const totalBefore = await Account.countDocuments({});

          await expect(callUpdate(malformedId, target)).rejects.toBeInstanceOf(NotFoundError);

          // No state change across the collection.
          const totalAfter = await Account.countDocuments({});
          expect(totalAfter).toBe(totalBefore);
        }
      ),
      { numRuns: 30 }
    );
  });
});
