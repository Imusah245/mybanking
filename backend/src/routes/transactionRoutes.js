// Transaction routes (API surface) — Requirements 5.3, 6.4, 7.6, 8.3, 8.4,
// 8.7, 14.4; design "Routes (routes/) — API Surface".
//
// This router wires the money-movement and history endpoints to their
// controllers, mounted under `/api/transactions` in `server.js`. Per the design
// request lifecycle, every transaction route is PROTECTED: `authMiddleware`
// runs first and establishes the trusted identity on `req.user` from the
// verified JWT `sub` claim, so the controllers never read identity from the
// request body/query (Requirement 3; design Property 12).
//
// Middleware order on each route follows the design pipeline:
//   authMiddleware → validate(rules) → controller
//
// The `validate` chains both validate AND sanitize. Monetary `amount` values
// are coerced to integers with `.toInt()` so controllers (and in turn
// `bankService`) always receive integer pesewas — the system never performs
// balance arithmetic on a non-integer (Requirement 15.1). Invalid input is
// short-circuited with a 400 before any controller/service runs (Requirements
// 5.3, 6.4, 7.6, 8.4; design Property 9).
import { Router } from 'express';
import { body, query, param } from 'express-validator';

import authMiddleware from '../middleware/authMiddleware.js';
import { validate } from '../middleware/validate.js';
import transactionController from '../controllers/transactionController.js';

const router = Router();

// Monetary bounds (integer pesewas) per the design money-and-precision
// strategy and the Transaction model: amount ∈ [1, 999_999_999_999].
const MIN_AMOUNT = 1;
const MAX_AMOUNT = 999_999_999_999;

// The set of transaction types a history query may filter by, mirroring the
// Transaction model `type` enum.
const TRANSACTION_TYPES = ['CREDIT', 'DEBIT', 'TRANSFER'];

/**
 * Shared amount validator for deposit/withdraw/transfer bodies.
 *
 * Rejects anything that is not a positive integer within the allowed pesewa
 * range, then coerces the surviving value to a Number via `.toInt()` so the
 * controller receives an integer. (Requirements 5.3, 6.4, 7.6, 15.5; design
 * Property 9.)
 */
const amountRule = body('amount')
  .exists({ checkFalsy: false })
  .withMessage('amount is required')
  .bail()
  .isInt({ min: MIN_AMOUNT, max: MAX_AMOUNT })
  .withMessage('amount must be a positive integer number of pesewas')
  .bail()
  .toInt();

/**
 * POST /api/transactions/deposit — credit the authenticated user's account.
 * auth → validate(amount) → deposit. (Requirement 5; design Properties 1, 2.)
 */
router.post(
  '/deposit',
  authMiddleware,
  validate([amountRule]),
  transactionController.deposit
);

/**
 * POST /api/transactions/withdraw — debit the authenticated user's account.
 * auth → validate(amount) → withdraw. (Requirement 6; design Properties 1, 3.)
 */
router.post(
  '/withdraw',
  authMiddleware,
  validate([amountRule]),
  transactionController.withdraw
);

/**
 * POST /api/transactions/transfer — move money from the authenticated user's
 * account to the account identified by a 10-digit `recipientAccountNumber`.
 * auth → validate(recipientAccountNumber, amount) → transfer.
 * (Requirement 7; design Property 5.)
 */
router.post(
  '/transfer',
  authMiddleware,
  validate([
    body('recipientAccountNumber')
      .exists({ checkFalsy: true })
      .withMessage('recipientAccountNumber is required')
      .bail()
      .isString()
      .withMessage('recipientAccountNumber must be a string')
      .bail()
      .trim()
      .matches(/^\d{10}$/)
      .withMessage('recipientAccountNumber must be exactly 10 digits'),
    amountRule,
  ]),
  transactionController.transfer
);

/**
 * GET /api/transactions — the authenticated user's transaction history,
 * newest-first, with optional pagination and filtering.
 * auth → validate(query) → list. (Requirements 8.1–8.9; design Properties
 * 14, 16, 17.)
 *
 * All query params are OPTIONAL. `page`/`limit` are coerced to integers;
 * `limit` is bounded to [1, 100] (service defaults to page 1 / limit 20 when
 * absent). `type` must be one of the Transaction enum values. `startDate` /
 * `endDate` must be ISO-8601 dates. `search` is a bounded free-text substring
 * matched case-insensitively against description/reference.
 */
router.get(
  '/',
  authMiddleware,
  validate([
    query('page')
      .optional()
      .isInt({ min: 1 })
      .withMessage('page must be a positive integer')
      .toInt(),
    query('limit')
      .optional()
      .isInt({ min: 1, max: 100 })
      .withMessage('limit must be an integer between 1 and 100')
      .toInt(),
    query('type')
      .optional()
      .isIn(TRANSACTION_TYPES)
      .withMessage(`type must be one of: ${TRANSACTION_TYPES.join(', ')}`),
    query('startDate')
      .optional()
      .isISO8601()
      .withMessage('startDate must be a valid ISO-8601 date')
      .toDate(),
    query('endDate')
      .optional()
      .isISO8601()
      .withMessage('endDate must be a valid ISO-8601 date')
      .toDate(),
    query('search')
      .optional()
      .isString()
      .withMessage('search must be a string')
      .bail()
      .trim()
      .isLength({ max: 256 })
      .withMessage('search must be at most 256 characters'),
  ]),
  transactionController.list
);

/**
 * GET /api/transactions/:id — a single transaction owned by the authenticated
 * user. auth → validate(id) → getById. A non-owned, nonexistent, or malformed
 * id is reported as 404 by the service (ownership isolation — Requirements
 * 8.10, 8.11; design Properties 14, 20).
 */
router.get(
  '/:id',
  authMiddleware,
  validate([
    param('id')
      .isMongoId()
      .withMessage('id must be a valid transaction id'),
  ]),
  transactionController.getById
);

export default router;
