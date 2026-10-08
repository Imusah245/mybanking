// Authentication middleware (Auth_Middleware) — Requirements 3.1, 3.2, 3.3,
// 3.4, 3.5, 3.6, 14.
//
// `authMiddleware` is the single place where request identity is established.
// It reads the `Authorization: Bearer <token>` header, verifies the JWT with
// `env.JWT_SECRET`, and — on success — attaches a MINIMAL, TRUSTED identity to
// `req.user = { id, role }` derived SOLELY from the verified token claims
// (`sub` → id, `role` → role). Identity is NEVER read from the request body,
// query, or any other client-supplied header. This is what Property 12
// ("trusted identity") depends on: downstream controllers and `roleMiddleware`
// treat `req.user` as the only source of truth for who is acting.
//
// Rejection behavior (Property 13 — invalid/missing token rejected): a missing
// header, a malformed header, an invalid signature, or an expired token all
// result in an `AuthenticationError` (401) forwarded via `next(err)` so the
// central `errorMiddleware` shapes the standardized failure envelope. The JWT
// secret and the raw token value are NEVER included in any error or log
// (Requirement 13.3).
import jwt from 'jsonwebtoken';

import { env } from '../config/env.js';
import { AuthenticationError } from '../utils/errors.js';

/**
 * Extract the bearer token from an `Authorization` header value.
 *
 * Accepts exactly the shape `Bearer <token>` (scheme is matched
 * case-insensitively, a single space separator, a non-empty token with no
 * embedded whitespace). Anything else — absent header, wrong scheme, missing
 * token, extra parts — is treated as "no usable token" and returns `null`.
 *
 * @param {string | undefined} headerValue - Raw `Authorization` header value.
 * @returns {string | null} The token string, or `null` when absent/malformed.
 */
function extractBearerToken(headerValue) {
  if (typeof headerValue !== 'string') return null;

  const parts = headerValue.trim().split(/\s+/);
  if (parts.length !== 2) return null;

  const [scheme, token] = parts;
  if (scheme.toLowerCase() !== 'bearer') return null;
  if (!token) return null;

  return token;
}

/**
 * Express middleware that authenticates a request from its bearer token.
 *
 * On success, populates `req.user = { id, role }` from the verified token's
 * `sub` and `role` claims and calls `next()`. On any failure (missing header,
 * malformed header, invalid signature, expired token, or a token missing its
 * subject claim) it forwards an `AuthenticationError` (401) via `next(err)`
 * and does NOT call the next handler.
 *
 * @type {import('express').RequestHandler}
 */
export function authMiddleware(req, _res, next) {
  const token = extractBearerToken(req.headers?.authorization);

  if (token === null) {
    return next(new AuthenticationError('Authentication required'));
  }

  let payload;
  try {
    payload = jwt.verify(token, env.JWT_SECRET);
  } catch (err) {
    // Distinguish expiry from other failures for a clearer (still client-safe)
    // message, but never leak the secret or token value. Any other verify
    // failure — bad signature, malformed JWT, random garbage — collapses to a
    // generic "invalid token" 401.
    if (err instanceof jwt.TokenExpiredError) {
      return next(new AuthenticationError('Token expired'));
    }
    return next(new AuthenticationError('Invalid token'));
  }

  // A verified token must still carry a subject (the user id). Guard against a
  // structurally valid but identity-less token.
  if (!payload || typeof payload !== 'object' || !payload.sub) {
    return next(new AuthenticationError('Invalid token'));
  }

  // Trusted identity: id and role come ONLY from the verified claims.
  req.user = {
    id: String(payload.sub),
    role: payload.role,
  };

  return next();
}

export default authMiddleware;
