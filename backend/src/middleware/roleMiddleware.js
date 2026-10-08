// Role-based access control middleware (Role_Middleware) — Requirements 10.1,
// 12.2, 14.
//
// `requireRole(...roles)` is a middleware factory that gates a route to one or
// more roles. It MUST run AFTER `authMiddleware`, which is responsible for
// verifying the JWT and populating `req.user = { id, role }` from the trusted
// `sub` claim. This middleware never reads identity or role from the request
// body or query — the only source of truth is `req.user`.
//
// Behavior:
// - If `req.user` is missing (the route was not protected by `authMiddleware`,
//   or auth did not run), reject with an AuthenticationError (401). This is a
//   defensive guard: role checks are meaningless without an authenticated
//   identity.
// - If the authenticated user's role is not among the allowed roles, reject
//   with an AuthorizationError (403) BEFORE the controller runs.
// - Otherwise, call `next()` to proceed.
//
// Errors are forwarded via `next(err)` so the central `errorMiddleware` shapes
// the standardized failure envelope.
import { AuthenticationError, AuthorizationError } from '../utils/errors.js';
import { ROLES } from '../models/User.js';

/**
 * Build a middleware that only permits requests from an authenticated user
 * whose role is one of the supplied roles.
 *
 * Accepts either a spread list of roles or a single array of roles:
 *   requireRole('ADMIN')
 *   requireRole(ROLES.ADMIN, ROLES.CUSTOMER)
 *   requireRole(['ADMIN', 'CUSTOMER'])
 *
 * @param {...(string | string[])} roles - Allowed role(s). Must be non-empty.
 * @returns {import('express').RequestHandler} Express middleware.
 * @throws {Error} If called with no roles (programmer error at wiring time).
 */
export function requireRole(...roles) {
  // Flatten so both requireRole('ADMIN') and requireRole(['ADMIN']) work.
  const allowed = roles.flat();

  if (allowed.length === 0) {
    throw new Error('requireRole requires at least one role');
  }

  return function roleGuard(req, _res, next) {
    const user = req.user;

    // No authenticated identity → auth did not run / token was absent.
    if (!user || typeof user.role === 'undefined' || user.role === null) {
      return next(new AuthenticationError('Authentication required'));
    }

    // Authenticated but not permitted for this resource.
    if (!allowed.includes(user.role)) {
      return next(new AuthorizationError('Insufficient privileges'));
    }

    return next();
  };
}

/**
 * Convenience guard for admin-only routes. Equivalent to
 * `requireRole(ROLES.ADMIN)`.
 *
 * @type {import('express').RequestHandler}
 */
export const requireAdmin = requireRole(ROLES.ADMIN);

export default requireRole;
