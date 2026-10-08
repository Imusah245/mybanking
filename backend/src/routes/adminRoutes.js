// Admin routes (adminRoutes) — Requirements 10.1, 10.4, 11.3, 12.2, 12.4.
//
// Administrative API surface, mounted under `/api/admin` by the app assembly
// (task 14). EVERY route in this router is admin-only: the router applies
// `authMiddleware` (verify JWT, populate the trusted `req.user`) followed by
// `requireAdmin` (RBAC gate rejecting non-ADMIN callers with 403) to all
// routes via `router.use(...)`. The ordering is significant and matches the
// design request-lifecycle: authentication (Requirement 3) MUST run before the
// role check (Requirements 10.1, 11.3, 12.2) so the role is read from a
// verified identity, never from client input.
//
// Per-route express-validator chains run through the shared `validate()`
// middleware, which sanitizes input and short-circuits with a 400 before the
// controller on failure (Requirements 10.4, 12.4). The controllers also guard
// defensively, so validation here is a first line of defence, not the only one.
//
// Route table (design "API Surface"):
//   GET  /customers              → adminController.listCustomers   (R10.1–10.4)
//   GET  /accounts               → adminController.listAccounts    (R10.5)
//   GET  /transactions           → adminController.listTransactions(R10.6)
//   GET  /statistics             → adminController.statistics      (R11)
//   PUT  /accounts/:id/status    → adminController.updateAccountStatus (R12)
import { Router } from 'express';
import { body, param, query } from 'express-validator';

import authMiddleware from '../middleware/authMiddleware.js';
import { requireAdmin } from '../middleware/roleMiddleware.js';
import { validate } from '../middleware/validate.js';
import { ACCOUNT_STATUS } from '../models/Account.js';
import adminController from '../controllers/adminController.js';

const router = Router();

// Allowed account-status values for the status-update endpoint (Requirement
// 12.4): ['Active', 'Frozen', 'Disabled'].
const ALLOWED_STATUSES = Object.values(ACCOUNT_STATUS);

// Shared pagination query validation for the list endpoints (Requirements
// 10.2, 10.4, 10.5, 10.6). Values are optional; when present they must be
// integers within range. `toInt()` sanitizes so the controller receives typed
// numbers. The controller re-validates defensively.
const paginationRules = [
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
];

// Optional case-insensitive search term for the customers list (Requirement
// 10.3): a trimmed string of at most 256 characters.
const searchRule = query('search')
  .optional()
  .isString()
  .withMessage('search must be a string')
  .trim()
  .isLength({ max: 256 })
  .withMessage('search must be at most 256 characters');

// Apply authentication THEN the admin RBAC gate to every admin route. Any
// request without a valid ADMIN token is rejected before reaching a handler.
router.use(authMiddleware, requireAdmin);

// GET /api/admin/customers — paginated customer list with optional search.
router.get('/customers', validate([...paginationRules, searchRule]), adminController.listCustomers);

// GET /api/admin/accounts — paginated account list with current balances.
router.get('/accounts', validate(paginationRules), adminController.listAccounts);

// GET /api/admin/transactions — paginated system-wide transaction list.
router.get('/transactions', validate(paginationRules), adminController.listTransactions);

// GET /api/admin/statistics — aggregate system statistics (no query input).
router.get('/statistics', adminController.statistics);

// PUT /api/admin/accounts/:id/status — set an account's status.
router.put(
  '/accounts/:id/status',
  validate([
    param('id').isMongoId().withMessage('account id must be a valid id'),
    body('status')
      .exists({ checkNull: true })
      .withMessage('status is required')
      .bail()
      .isIn(ALLOWED_STATUSES)
      .withMessage(`status must be one of: ${ALLOWED_STATUSES.join(', ')}`),
  ]),
  adminController.updateAccountStatus
);

export default router;
