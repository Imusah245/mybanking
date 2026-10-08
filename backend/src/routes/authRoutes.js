// Auth routes (/api/auth) — Requirements 1.4, 2.3, 3.1, 14.3, 14.4.
//
// Wires the authentication surface onto an Express Router. Mounted at
// `/api/auth` by `server.js`, so the paths declared here are relative:
//   POST /register  → public  (rate-limited + validated)
//   POST /login     → public  (rate-limited + per-email throttled + validated)
//   GET  /me        → protected (JWT via authMiddleware)
//
// Per the design's API-surface table the middleware pipeline for each route is
// [rateLimiter] → [authMiddleware] → [validate(rules)] → controller, in that
// order. Concretely:
//   • register/login run the IP-based `authRateLimiter` FIRST so abusive
//     clients are shed before any validation or DB work (Requirement 14.3).
//   • login then runs `loginThrottle`, which short-circuits with 429 while an
//     email is inside an active lockout window (Requirement 2.4) — it reads
//     `req.body.email`, so it must sit before `validate` but is cheap and does
//     no DB work.
//   • `validate(rules)` runs the express-validator chains defined below; it
//     both validates and SANITIZES (trim, normalizeEmail, toDate) so the
//     controller receives clean, typed input, and short-circuits with 400 when
//     any field fails (Requirements 1.4, 2.3, 14.4).
//   • `authMiddleware` guards GET /me, deriving identity solely from the JWT
//     (Requirement 3.1) — no validation chain is needed since there is no body.
//
// The validation chains are defined inline here (the route is the natural home
// for a route's input contract) and intentionally mirror the field rules in
// Requirements 1.1 and 2.1/2.3.

import { Router } from 'express';
import { body } from 'express-validator';

import authController from '../controllers/authController.js';
import { validate } from '../middleware/validate.js';
import { authMiddleware } from '../middleware/authMiddleware.js';
import { authRateLimiter, loginThrottle } from '../middleware/rateLimiter.js';

const router = Router();

/** Minimum age (years) a registrant must meet (Requirement 1.1). */
const MINIMUM_AGE_YEARS = 18;

/**
 * Return true when `dateOfBirth` corresponds to an age of at least
 * `MINIMUM_AGE_YEARS` as of now. Compares against the exact birthday so a
 * registrant who turns 18 today passes and one whose birthday is tomorrow does
 * not. Rejects dates in the future and non-dates.
 *
 * @param {string} value - The raw dateOfBirth value from the request body.
 * @returns {boolean} Whether the implied age is >= the minimum.
 */
function isAtLeastMinimumAge(value) {
  const dob = new Date(value);
  if (Number.isNaN(dob.getTime())) return false;

  const now = new Date();
  // The earliest birth date that still counts as "at least MINIMUM_AGE_YEARS"
  // today: shift today's date back by the minimum age. A dob on or before this
  // threshold means the person has already had their Nth birthday.
  const threshold = new Date(
    now.getFullYear() - MINIMUM_AGE_YEARS,
    now.getMonth(),
    now.getDate()
  );
  return dob.getTime() <= threshold.getTime();
}

/**
 * express-validator chains for POST /register (Requirement 1.1, 1.4).
 *
 * Each chain validates the field's shape and, where useful, sanitizes it in
 * place so the controller receives trimmed/normalized values:
 *   firstName/lastName — required, trimmed, length 1–50.
 *   email              — required, valid email format, max 254 chars,
 *                        normalized (lowercased) to match the unique-index key.
 *   phone              — required, digits only, length 10–15.
 *   dateOfBirth        — required, a valid date implying age >= 18, coerced to
 *                        a Date for the model.
 *   address            — required, trimmed, length 1–255.
 *   password           — required, length 8–128 (never trimmed/sanitized).
 */
const registerValidation = [
  body('firstName')
    .trim()
    .isLength({ min: 1, max: 50 })
    .withMessage('firstName must be 1 to 50 characters'),
  body('lastName')
    .trim()
    .isLength({ min: 1, max: 50 })
    .withMessage('lastName must be 1 to 50 characters'),
  body('email')
    .isString()
    .withMessage('email is required')
    .bail()
    .trim()
    .isLength({ max: 254 })
    .withMessage('email must be at most 254 characters')
    .bail()
    .isEmail()
    .withMessage('email must be a valid email address')
    .normalizeEmail(),
  body('phone')
    .isString()
    .withMessage('phone is required')
    .bail()
    .trim()
    .matches(/^\d{10,15}$/)
    .withMessage('phone must be 10 to 15 digits'),
  body('dateOfBirth')
    .isISO8601()
    .withMessage('dateOfBirth must be a valid date')
    .bail()
    .custom(isAtLeastMinimumAge)
    .withMessage('dateOfBirth must correspond to an age of at least 18 years')
    .toDate(),
  body('address')
    .trim()
    .isLength({ min: 1, max: 255 })
    .withMessage('address must be 1 to 255 characters'),
  body('password')
    .isString()
    .withMessage('password is required')
    .bail()
    .isLength({ min: 8, max: 128 })
    .withMessage('password must be 8 to 128 characters'),
];

/**
 * express-validator chains for POST /login (Requirement 2.3).
 *
 * Mirrors the login validation contract: an email of valid format and at most
 * 254 chars (normalized to match stored emails) and a password within the 8–128
 * length band. Both fields are required; the generic "invalid credentials"
 * handling for a well-formed but non-matching pair lives in the controller.
 */
const loginValidation = [
  body('email')
    .isString()
    .withMessage('email is required')
    .bail()
    .trim()
    .isLength({ max: 254 })
    .withMessage('email must be at most 254 characters')
    .bail()
    .isEmail()
    .withMessage('email must be a valid email address')
    .normalizeEmail(),
  body('password')
    .isString()
    .withMessage('password is required')
    .bail()
    .isLength({ min: 8, max: 128 })
    .withMessage('password must be 8 to 128 characters'),
];

// POST /api/auth/register — rate-limit, validate, then create user + account.
router.post(
  '/register',
  authRateLimiter,
  validate(registerValidation),
  authController.register
);

// POST /api/auth/login — rate-limit, per-email lockout throttle, validate,
// then verify credentials and issue a token.
router.post(
  '/login',
  authRateLimiter,
  loginThrottle,
  validate(loginValidation),
  authController.login
);

// GET /api/auth/me — JWT-protected profile + account overview.
router.get('/me', authMiddleware, authController.me);

export default router;
