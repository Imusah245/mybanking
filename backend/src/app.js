// src/app.js
//
// Express application factory (Requirements 13.1, 14.1, 14.2).
//
// Assembly separates app CONSTRUCTION from LISTENING so that Supertest and the
// integration suite can import a fully wired app without binding a port. The
// startup path (connectDB + listen) lives in `src/server.js`.
//
// Global middleware order mirrors the design's assembly contract:
//   helmet() → cors(allowlist) → express.json() → routers → 404 → errorMiddleware
//
// The auth rate limiter is NOT applied app-wide; it is mounted per-route on the
// auth endpoints inside `authRoutes`, matching the design.

import express from 'express';
import helmet from 'helmet';
import cors from 'cors';

import { env } from './config/env.js';

import authRoutes from './routes/authRoutes.js';
import userRoutes from './routes/userRoutes.js';
import accountRoutes from './routes/accountRoutes.js';
import transactionRoutes from './routes/transactionRoutes.js';
import adminRoutes from './routes/adminRoutes.js';

import { errorMiddleware } from './middleware/errorMiddleware.js';
import { NotFoundError } from './utils/errors.js';
import { ok } from './utils/response.js';

/** Max accepted JSON body size — large enough for API payloads, small enough
 * to bound memory per request. */
const JSON_BODY_LIMIT = '100kb';

/**
 * Build a CORS options object from the configured allowlist.
 *
 * Behavior (Requirement 14.2):
 * - Requests whose `Origin` is on the allowlist are reflected back (so the
 *   browser receives the exact allowed origin and credentials may be sent).
 * - Requests with no `Origin` header (same-origin, curl, server-to-server) are
 *   allowed through — CORS only governs cross-origin browser requests.
 * - Any other origin is denied: no `Access-Control-Allow-Origin` header is
 *   emitted, so the browser blocks the response. The request itself is NOT
 *   rejected with an error (that would surface as a 500); it simply receives no
 *   CORS grant, which is the standard allowlist-deny posture.
 *
 * @param {readonly string[]} allowlist - configured allowed origins.
 * @returns {import('cors').CorsOptions}
 */
export function buildCorsOptions(allowlist) {
  const allowed = new Set(allowlist);
  return {
    origin(origin, callback) {
      // No Origin header → not a cross-origin browser request; allow.
      if (!origin) return callback(null, true);
      // Allowlisted origin → reflect it (true tells cors to echo the origin).
      if (allowed.has(origin)) return callback(null, true);
      // Not allowlisted → no CORS grant (deny) without throwing.
      return callback(null, false);
    },
    credentials: true,
  };
}

/**
 * Assemble and return a fully wired Express application.
 *
 * The returned app binds no port; call `app.listen()` separately (see
 * `src/server.js`) when you want to serve traffic.
 *
 * @returns {import('express').Express} configured Express app for Supertest.
 */
export function createApp() {
  const app = express();

  // Honor a single trusted proxy hop so `req.ip` reflects the real client via
  // X-Forwarded-For (needed by the IP-based auth rate limiter). A numeric hop
  // count avoids express-rate-limit's permissive-trust-proxy warning.
  app.set('trust proxy', 1);

  // 1. Security headers.
  app.use(helmet());

  // 2. CORS driven by the configured allowlist.
  app.use(cors(buildCorsOptions(env.CORS_ALLOWLIST)));

  // 3. JSON body parser with a bounded size limit.
  app.use(express.json({ limit: JSON_BODY_LIMIT }));

  // 4. Lightweight health check — no auth, no DB access. Returns the standard
  //    success envelope so monitors see a consistent shape.
  app.get('/health', (_req, res) => ok(res, 200, 'ok', { status: 'ok' }));

  // 5. Feature routers mounted on their API prefixes.
  app.use('/api/auth', authRoutes);
  app.use('/api/users', userRoutes);
  app.use('/api/accounts', accountRoutes);
  app.use('/api/transactions', transactionRoutes);
  app.use('/api/admin', adminRoutes);

  // 6. Unknown routes → forward a NotFoundError into the central handler so the
  //    404 response uses the standardized `{ success:false, message }` envelope.
  app.use((req, _res, next) => {
    next(new NotFoundError(`Route not found: ${req.method} ${req.originalUrl}`));
  });

  // 7. Terminal error-handling middleware — must be attached LAST.
  app.use(errorMiddleware);

  return app;
}

/** Default export: a ready-to-use app instance (lazy consumers can also call
 * createApp() to build an isolated instance). */
export const app = createApp();

export default app;
