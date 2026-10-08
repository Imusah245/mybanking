// tests/setup.js
//
// Global test harness. MongoDB multi-document transactions (used by transfers
// and registration) require a replica set, so the in-memory server is started
// in SINGLE-NODE REPLICA-SET mode. This makes transaction-backed code behave in
// tests exactly as it does against a production replica set (Requirement 7).
//
// Lifecycle:
//   beforeAll  - start mongodb-memory-server (replSet) and connect Mongoose.
//   afterEach  - clear every collection so tests are isolated.
//   afterAll   - disconnect Mongoose and stop the in-memory server.
//
// This file is wired via `setupFilesAfterEach`/`setupFilesAfterEnv` in
// jest.config.js and runs once per test file.

import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';

/** @type {MongoMemoryReplSet} */
let replSet;

beforeAll(async () => {
  // Single-node replica set ("rs0") enables sessions/transactions in-memory.
  replSet = await MongoMemoryReplSet.create({
    replSet: { count: 1 },
  });

  const uri = replSet.getUri();
  await mongoose.connect(uri);
});

afterEach(async () => {
  // Clear all collections between tests for isolation without paying the
  // cost of restarting the server.
  const { collections } = mongoose.connection;
  await Promise.all(
    Object.values(collections).map((collection) => collection.deleteMany({}))
  );
});

afterAll(async () => {
  await mongoose.disconnect();
  if (replSet) {
    await replSet.stop();
  }
});
