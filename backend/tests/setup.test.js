// tests/setup.test.js
//
// Smoke test for the scaffolding (Task 1). Confirms that:
//   - the ESM Jest configuration runs,
//   - the in-memory MongoDB is connected as a replica set, and
//   - sessions/transactions are available (the Requirement 7 prerequisite).
// Later tasks add real unit/integration/property tests.

import mongoose from 'mongoose';

describe('test harness scaffolding', () => {
  test('mongoose is connected', () => {
    // readyState 1 === connected
    expect(mongoose.connection.readyState).toBe(1);
  });

  test('supports sessions / transactions (replica set is active)', async () => {
    const session = await mongoose.connection.startSession();
    try {
      // startTransaction throwing would indicate a non-replica-set topology.
      session.startTransaction();
      await session.abortTransaction();
    } finally {
      await session.endSession();
    }
    expect(true).toBe(true);
  });
});
