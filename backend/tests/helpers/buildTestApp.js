// tests/helpers/buildTestApp.js
//
// Integration-test app factory. This delegates to the REAL application factory
// (`src/app.js` → `createApp()`) so the app under test is assembled exactly
// like production: helmet, cors(allowlist), JSON body parser, the feature
// routers mounted on their `/api/*` prefixes, the `/health` route, a 404
// handler, and the terminal `errorMiddleware` — in that order.
//
// Sharing the production assembly means these tests exercise the same
// middleware stack the server runs, instead of a hand-rolled subset.
//
// IMPORTANT: `src/app.js` statically imports `src/config/env.js`, which
// validates `MONGO_URI`/`JWT_SECRET` at import time. Any test that imports this
// helper MUST set those env vars before importing it (do the dynamic `import()`
// after setting `process.env`).

import { createApp } from '../../src/app.js';

/**
 * Assemble an Express app wired with the real routers and middleware stack via
 * the production factory. No port is bound.
 *
 * @returns {import('express').Express} A configured Express app for Supertest.
 */
export function buildTestApp() {
  return createApp();
}

export default buildTestApp;
