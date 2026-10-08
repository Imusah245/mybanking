// transactionController — thin HTTP layer for the money-movement endpoints
// (Requirements 5, 6, 7, 8; design "Controllers are thin").
//
// Every handler here is a thin adapter between HTTP and `bankService`, which is
// the single owner of money movement. Controllers NEVER contain balance math or
// transaction orchestration — they:
//   1. read the trusted identity from `req.user` (populated by authMiddleware
//      from the verified JWT subject claim), NEVER from the request body/query
//      (Requirement 3; design Property 12);
//   2. read already-validated/sanitized input from `req.body`/`req.query`
//      (validate.js runs the express-validator chains first and coerces
//      `amount` to an integer via `toInt`, so amounts arrive as integer
//      pesewas);
//   3. delegate to the matching `bankService` operation; and
//   4. wrap the successful result in the standardized `{ success, message, data }`
//      envelope via `ok()` (Requirement 13.1).
//
// Error handling is centralized: every handler is `async` and forwards any
// thrown error to the terminal `errorMiddleware` via `next(err)`. The typed
// errors thrown by `bankService` (`ValidationError` 400, `InsufficientFundsError`
// 400, `AuthorizationError` 403, `NotFoundError` 404, `InternalError` 500) carry
// their own HTTP status, so controllers do not map statuses themselves — they
// just let the error propagate (design "Error Handling").
//
// Status codes (design status-code mapping / transfer sequence diagram): all
// money-movement operations and all reads return HTTP 200 on success with the
// result under `data`.

import bankService from '../services/bankService.js';
import { ok } from '../utils/response.js';

/**
 * POST /api/transactions/deposit — deposit into the authenticated user's account.
 *
 * Delegates to `bankService.deposit(userId, amount)` where `userId` is the
 * trusted JWT identity (`req.user.id`) and `amount` is the validated integer
 * pesewa value from the request body. Returns 200 with the post-credit account
 * and the created CREDIT transaction (Requirements 5.1, 5.2; design Properties
 * 1, 2).
 *
 * @type {import('express').RequestHandler}
 */
export async function deposit(req, res, next) {
  try {
    const { amount } = req.body;
    const { account, transaction } = await bankService.deposit(
      req.user.id,
      amount
    );
    return ok(res, 200, 'Deposit successful', { account, transaction });
  } catch (err) {
    return next(err);
  }
}

/**
 * POST /api/transactions/withdraw — withdraw from the authenticated user's account.
 *
 * Delegates to `bankService.withdraw(userId, amount)`. The service's conditional
 * atomic debit is the non-negativity / double-spend guard; it throws
 * `InsufficientFundsError` (400) or `AuthorizationError` (403) as appropriate,
 * which this handler forwards unchanged. Returns 200 with the post-debit account
 * and the created DEBIT transaction (Requirements 6.1, 6.2; design Properties
 * 1, 3).
 *
 * @type {import('express').RequestHandler}
 */
export async function withdraw(req, res, next) {
  try {
    const { amount } = req.body;
    const { account, transaction } = await bankService.withdraw(
      req.user.id,
      amount
    );
    return ok(res, 200, 'Withdrawal successful', { account, transaction });
  } catch (err) {
    return next(err);
  }
}

/**
 * POST /api/transactions/transfer — transfer from the authenticated user's
 * account to the account identified by `recipientAccountNumber`.
 *
 * Delegates to `bankService.transfer(userId, recipientAccountNumber, amount)`,
 * which runs both legs inside a single ACID transaction (atomic or nothing).
 * The service rejects a self-transfer (400), an unknown recipient (404), a
 * non-active party (403), and insufficient funds (400); those typed errors are
 * forwarded unchanged. Returns 200 with the sender's DEBIT and recipient's
 * CREDIT transfer records (Requirements 7.1–7.4; design Property 5).
 *
 * @type {import('express').RequestHandler}
 */
export async function transfer(req, res, next) {
  try {
    const { recipientAccountNumber, amount } = req.body;
    const { debitTxn, creditTxn } = await bankService.transfer(
      req.user.id,
      recipientAccountNumber,
      amount
    );
    return ok(res, 200, 'Transfer successful', { debitTxn, creditTxn });
  } catch (err) {
    return next(err);
  }
}

/**
 * GET /api/transactions — list the authenticated user's transactions,
 * newest-first, with optional pagination and filtering.
 *
 * Delegates to `bankService.listTransactions(userId, filters)` with the filters
 * taken from `req.query` (`page`, `limit`, `type`, `startDate`, `endDate`,
 * `search`). The service enforces ownership isolation — the query is always
 * scoped to `userId`, so only the caller's own records are ever returned
 * (design Property 14) — and applies pagination (Property 16) and filtering
 * (Property 17), throwing `ValidationError` (400) on invalid pagination/type/
 * date/search without returning any records. Returns 200 with the page of
 * `items` plus pagination metadata (`total`, `page`, `limit`, `totalPages`).
 *
 * @type {import('express').RequestHandler}
 */
export async function list(req, res, next) {
  try {
    const { page, limit, type, startDate, endDate, search } = req.query;
    const result = await bankService.listTransactions(req.user.id, {
      page,
      limit,
      type,
      startDate,
      endDate,
      search,
    });

    const { items, total, page: currentPage, limit: pageSize, totalPages } =
      result;

    return ok(res, 200, 'Transactions retrieved', {
      items,
      pagination: {
        total,
        page: currentPage,
        limit: pageSize,
        totalPages,
      },
    });
  } catch (err) {
    return next(err);
  }
}

/**
 * GET /api/transactions/:id — fetch a single transaction owned by the
 * authenticated user.
 *
 * Delegates to `bankService.getTransactionForUser(userId, id)`, whose query is
 * always scoped to `{ _id, userId }`. A transaction owned by another user (or a
 * nonexistent/malformed id) is treated identically to "not found": the service
 * throws `NotFoundError` (404), which this handler forwards unchanged, so no
 * foreign data is leaked (Requirements 8.10, 8.11; design Properties 14, 20).
 * Returns 200 with the owned transaction.
 *
 * @type {import('express').RequestHandler}
 */
export async function getById(req, res, next) {
  try {
    const transaction = await bankService.getTransactionForUser(
      req.user.id,
      req.params.id
    );
    return ok(res, 200, 'Transaction retrieved', { transaction });
  } catch (err) {
    return next(err);
  }
}

export default {
  deposit,
  withdraw,
  transfer,
  list,
  getById,
};
