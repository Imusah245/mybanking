// jest.config.js
//
// Jest is run through `node --experimental-vm-modules` (see the "test" script
// in package.json) so native ES Modules load without a Babel transform.
// `transform: {}` disables transformation and keeps the real ESM loader.
export default {
  testEnvironment: 'node',
  transform: {},
  // Global per-test-file setup: boots an in-memory MongoDB replica set,
  // connects Mongoose, clears collections between tests, and tears down after.
  setupFilesAfterEnv: ['<rootDir>/tests/setup.js'],
  // Collect test files from the tests/ tree (unit, integration, and properties).
  testMatch: ['**/tests/**/*.test.js'],
  // Replica-set spin-up on first connect can be slow on cold machines.
  testTimeout: 30000,
  clearMocks: true,
  verbose: true,
};
