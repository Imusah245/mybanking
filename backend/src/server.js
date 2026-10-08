// src/server.js
//
// Application entry point (Requirements 13.1, 14.1, 14.2).
//
// The Express app is assembled in `src/app.js` (the factory `createApp()` and a
// default `app` instance). This module is responsible ONLY for the runtime
// startup path: connect to MongoDB, then begin listening — and it does that
// ONLY when the file is executed directly (`node src/server.js`), never when
// imported by the test suite. That separation lets Supertest import the app
// without binding a port or requiring a live database.

import { fileURLToPath } from 'node:url';
import process from 'node:process';

import app from './app.js';
import { connectDB } from './config/db.js';
import { env } from './config/env.js';

/**
 * Connect to the database, then start listening on the configured port.
 *
 * @returns {Promise<import('node:http').Server>} the running HTTP server.
 */
export async function start() {
  await connectDB();

  return app.listen(env.PORT, () => {
    console.log(`[server] listening on port ${env.PORT}`);
  });
}

// Only auto-start when this module is the process entry point. When imported by
// tests (or other modules) this guard is false, so no port is bound and no DB
// connection is attempted.
const isDirectRun =
  process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (isDirectRun) {
  start().catch((err) => {
    // Never leak secrets; log a terse message and exit non-zero so the
    // supervisor/orchestrator can react.
    console.error(`[server] failed to start: ${err?.message ?? 'unknown error'}`);
    process.exit(1);
  });
}

export { app };
export default app;
