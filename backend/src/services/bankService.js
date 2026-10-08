// bankService — the single owner of money movement.
//
// This module is the reusable business-logic core for all balance mutations and
// ledger-record creation. Centralizing these operations here is what lets the
// monetary invariants of Requirement 15 be enforced in exactly one place and not
// be bypassed or re-implemented inconsistently by callers (controllers, seeds,
// etc.).
//
// SCOPE OF THIS MODULE (atomic primitives):
//   - `withTransaction`  — run an operation inside a MongoDB session/ACID
//                           transaction with commit/abort and transient-error
//                           retry (replica set required; see design "Replica
//                           Set Requirement").
//   - `creditAtomic`     — conditional `$inc` that credits an Active account.
//   - `debitAtomic`      — conditional `$inc` that debits an Active account only
//                           when `balance >= amount` (the double-spend / non-
//                           negativity guard).
//   - `recordTransaction`— append one immutable Transaction ledger record,
//                           deriving balanceBefore from the post-update balance.
//   - `assertValidAmount`/`isValidAmount` — amount validation (positive safe
//                           integer within [AMOUNT_MIN, AMOUNT_MAX]).
//
// The higher-level public operations (`deposit`, `withdraw`, `transfer`,
// `listTransactions`, `getTransactionForUser`) are implemented in later tasks
// (7.2–7.5) by COMPOSING these primitives.
//
// MONETARY MODEL (Requirement 15):
//   - Every balance and amount is an INTEGER number of pesewas (100 = 1 GHS).
//     Floating point is never used in balance arithmetic.
//   - Balance changes are applied with `$inc` inside a `findOneAndUpdate`, never
//     a read-modify-write in application code, so concurrent operations cannot
//     overwrite each other (Requirement 15.2).
//   - Debits use a conditional filter (`balance: { $gte: amount }` + status
//     Active) so two concurrent debits can never both succeed past the available
//     balance and a balance can never go negative (Requirements 6.6, 15.4;
//     design Properties 3, 4).
//   - For every record, `balanceAfter = balanceBefore + signedAmount`
//     (Requirement 15.3; design Property 1). We read the post-update balance
//     from the returned document and derive `balanceBefore` consistently.

import mongoose from 'mongoose';

import Account, { ACCOUNT_STATUS } from '../models/Account.js';
import Transaction, {
  AMOUNT_MIN,
  AMOUNT_MAX,
  TRANSACTION_TYPES,
  TRANSACTION_STATUSES,
} from '../models/Transaction.js';
import generateReference from '../utils/generateReference.js';
import {
  ValidationError,
  NotFoundError,
  AuthorizationError,
  InsufficientFundsError,
  InternalError,
} from '../utils/errors.js';

/**
 * Maximum number of times `withTransaction` retries an operation that aborts
 * with a transient transaction error. MongoDB recommends retrying such
 * transactions; a small bounded retry avoids an unbounded loop if the cluster
 * is genuinely unhealthy.
 */
const MAX_TRANSIENT_RETRIES = 3;

/**
 * Determine whether an amount is a valid monetary value: a positive safe integer
 * within the inclusive bounds `[AMOUNT_MIN, AMOUNT_MAX]` pesewas.
 *
 * This is the single predicate behind the invalid-amount guard (design
 * Properties 9, 11). It rejects non-numbers, NaN/Infinity, non-integers
 * (floating-point amounts), zero/negative values, and anything above the max.
 *
 * @param {unknown} amount - Candidate amount in pesewas.
 * @returns {boolean} True if the amount is a valid integer pesewa value.
 */
export function isValidAmount(amount) {
  return (
    typeof amount === 'number' &&
    Number.isInteger(amount) &&
    amount >= AMOUNT_MIN &&
    amount <= AMOUNT_MAX
  );
}

/**
 * Assert that an amount is valid, throwing a `ValidationError` (HTTP 400) with a
 * client-safe message when it is not. Callers use this before attempting any
 * balance change so an invalid amount is rejected with no side effects
 * (Requirements 5.3, 6.4, 7.6, 15.5; design Property 9).
 *
 * @param {unknown} amount - Candidate amount in pesewas.
 * @returns {number} The validated amount (unchanged), for convenient chaining.
 * @throws {ValidationError} If the amount is not a positive integer in range.
 */
export function assertValidAmount(amount) {
  if (!isValidAmount(amount)) {
    throw new ValidationError(
      `amount must be a positive integer number of pesewas between ${AMOUNT_MIN} and ${AMOUNT_MAX}`
    );
  }
  return amount;
}

/**
 * Run an operation inside a MongoDB session + ACID transaction, committing on
 * success and aborting on any thrown error, with a bounded retry on
 * TransientTransactionError (per MongoDB's recommended retry pattern).
 *
 * Multi-document transactions require a replica set (see the design's "Replica
 * Set Requirement"); the test suite runs `mongodb-memory-server` in single-node
 * replica-set mode so this behaves identically to production. If transactions
 * are unavailable the underlying driver throws, the transaction aborts, and the
 * error propagates — i.e. operations that depend on this (transfers,
 * registration) fail closed rather than performing a partial, non-atomic write.
 *
 * The callback receives the active session and MUST pass it through to every
 * model operation (`creditAtomic`/`debitAtomic`/`recordTransaction` all accept a
 * `session`) so all reads and writes participate in the same transaction.
 *
 * @template T
 * @param {(session: import('mongoose').ClientSession) => Promise<T>} fn - The
 *   operation to run transactionally. Receives the active session.
 * @param {object} [options] - Options.
 * @param {import('mongoose').ClientSession} [options.session] - An existing
 *   session to reuse. When supplied, this function assumes the caller already
 *   owns the surrounding transaction and simply invokes `fn(session)` without
 *   starting/committing/ending a transaction of its own (avoids nested
 *   transactions).
 * @returns {Promise<T>} Resolves with the callback's return value after commit.
 */
export async function withTransaction(fn, { session: existingSession } = {}) {
  // If the caller already owns a session/transaction, compose into it rather
  // than nesting a new transaction.
  if (existingSession) {
    return fn(existingSession);
  }

  const session = await mongoose.startSession();
  try {
    for (let attempt = 0; ; attempt += 1) {
      try {
        let result;
        await session.withTransaction(async () => {
          result = await fn(session);
        });
        return result;
      } catch (error) {
        const isTransient =
          error?.hasErrorLabel?.('TransientTransactionError') === true;
        if (isTransient && attempt < MAX_TRANSIENT_RETRIES) {
          // Retry the whole transaction body; `session.withTransaction` has
          // already aborted the failed attempt.
          continue;
        }
        throw error;
      }
    }
  } finally {
    await session.endSession();
  }
}

/**
 * Atomically credit (increase) an Active account's balance by `amount` pesewas.
 *
 * Uses a single conditional `findOneAndUpdate` so the status gate and the
 * increment happen atomically with no read-then-write window:
 *   filter: `{ _id, status: 'Active' }`
 *   update: `{ $inc: { balance: +amount } }`
 *   options: `{ new: true }` → returns the POST-update document.
 *
 * A `null` return means the account was not found or was not Active (Frozen /
 * Disabled); in that case NO balance change occurred. Callers map `null` to the
 * appropriate error (NotFound / Authorization) — this primitive stays
 * mechanism-only and does not throw on a missing/non-active account.
 *
 * @param {import('mongoose').Types.ObjectId|string} accountId - Target account.
 * @param {number} amount - Positive integer pesewas to credit (validated).
 * @param {import('mongoose').ClientSession} [session] - Optional session so the
 *   update joins an in-flight ACID transaction (used by transfer/registration).
 * @returns {Promise<import('mongoose').Document|null>} The updated account
 *   document (post-increment) or `null` if not found / not Active.
 * @throws {ValidationError} If `amount` is not a valid integer pesewa value.
 */
export async function creditAtomic(accountId, amount, session) {
  assertValidAmount(amount);

  const query = Account.findOneAndUpdate(
    { _id: accountId, status: ACCOUNT_STATUS.ACTIVE },
    { $inc: { balance: amount } },
    { new: true }
  );
  if (session) {
    query.session(session);
  }
  return query;
}

/**
 * Atomically debit (decrease) an Active account's balance by `amount` pesewas,
 * but ONLY when the current balance is at least `amount`.
 *
 * This single conditional `findOneAndUpdate` is the race-condition and
 * double-spend guard (Requirements 6.6, 15.4; design Properties 3, 4):
 *   filter: `{ _id, status: 'Active', balance: { $gte: amount } }`
 *   update: `{ $inc: { balance: -amount } }`
 *   options: `{ new: true }` → returns the POST-update document.
 *
 * Because the balance condition is evaluated atomically at write time, two
 * concurrent debits can never both succeed past the available balance, and the
 * balance can never be driven negative.
 *
 * A `null` return means one of: the account was not found, it was not Active
 * (Frozen / Disabled), or the balance was insufficient. In ALL of these cases
 * NO balance change occurred. This primitive does not distinguish the causes or
 * throw — callers re-read the account status to map `null` to either
 * `InsufficientFundsError` (400) or `AuthorizationError` (403).
 *
 * @param {import('mongoose').Types.ObjectId|string} accountId - Target account.
 * @param {number} amount - Positive integer pesewas to debit (validated).
 * @param {import('mongoose').ClientSession} [session] - Optional session so the
 *   update joins an in-flight ACID transaction (used by transfer).
 * @returns {Promise<import('mongoose').Document|null>} The updated account
 *   document (post-decrement) or `null` if not found / not Active / insufficient.
 * @throws {ValidationError} If `amount` is not a valid integer pesewa value.
 */
export async function debitAtomic(accountId, amount, session) {
  assertValidAmount(amount);

  const query = Account.findOneAndUpdate(
    {
      _id: accountId,
      status: ACCOUNT_STATUS.ACTIVE,
      balance: { $gte: amount },
    },
    { $inc: { balance: -amount } },
    { new: true }
  );
  if (session) {
    query.session(session);
  }
  return query;
}

/**
 * Append one immutable Transaction ledger record for a balance-changing event.
 *
 * The post-update balance (`balanceAfter`) is taken directly from the document
 * returned by `creditAtomic`/`debitAtomic`, and `balanceBefore` is derived from
 * it using the signed amount so the ledger identity
 * `balanceAfter = balanceBefore + signedAmount` holds exactly (Requirement 15.3;
 * design Property 1). A fresh, collection-unique `reference` is generated within
 * the same session so the uniqueness invariant holds even for references
 * reserved earlier in an uncommitted transaction (design Property 8).
 *
 * @param {object} params - Ledger record fields.
 * @param {import('mongoose').Types.ObjectId|string} params.userId - Owner (from
 *   the authenticated identity).
 * @param {import('mongoose').Types.ObjectId|string} params.accountId - Account
 *   the record is written against.
 * @param {'CREDIT'|'DEBIT'|'TRANSFER'} params.type - Ledger entry type.
 * @param {number} params.amount - Positive integer pesewas moved (validated).
 * @param {number} params.balanceAfter - The account balance AFTER the mutation,
 *   as returned by the atomic update (integer pesewas).
 * @param {'CREDIT'|'DEBIT'} params.effect - The direction of the balance change
 *   this record represents. `'CREDIT'` means `+amount` was applied; `'DEBIT'`
 *   means `-amount`. (A TRANSFER record is a CREDIT effect on the recipient and
 *   a DEBIT effect on the sender.) Used to derive `balanceBefore`.
 * @param {string} [params.description] - Optional human-readable description.
 * @param {import('mongoose').Types.ObjectId|string} [params.relatedAccount] -
 *   Counterparty account for TRANSFER legs; omitted for single-account entries.
 * @param {string} [params.status] - Ledger status; defaults to COMPLETED.
 * @param {import('mongoose').ClientSession} [params.session] - Optional session
 *   so the insert and the reference-uniqueness check join an in-flight ACID
 *   transaction.
 * @returns {Promise<import('mongoose').Document>} The created Transaction doc.
 * @throws {ValidationError} If `amount` is invalid or `effect` is unrecognized.
 * @throws {InternalError} If `balanceAfter` is not a non-negative integer or the
 *   derived `balanceBefore` would be negative (an impossible/corrupt state).
 */
export async function recordTransaction({
  userId,
  accountId,
  type,
  amount,
  balanceAfter,
  effect,
  description = '',
  relatedAccount,
  status = TRANSACTION_STATUSES.COMPLETED,
  session,
}) {
  assertValidAmount(amount);

  if (effect !== 'CREDIT' && effect !== 'DEBIT') {
    throw new ValidationError("effect must be either 'CREDIT' or 'DEBIT'");
  }

  if (!Number.isInteger(balanceAfter) || balanceAfter < 0) {
    // This should be impossible: balanceAfter comes straight from the stored,
    // schema-validated balance. Treat it as an internal invariant breach.
    throw new InternalError('balanceAfter must be a non-negative integer');
  }

  const signedAmount = effect === 'CREDIT' ? amount : -amount;
  const balanceBefore = balanceAfter - signedAmount;

  if (balanceBefore < 0) {
    throw new InternalError('derived balanceBefore must not be negative');
  }

  const reference = await generateReference({ session });

  // `Model.create` with a session option takes an array of docs; it returns an
  // array, so unwrap the single created document.
  const [transaction] = await Transaction.create(
    [
      {
        userId,
        accountId,
        type,
        amount,
        balanceBefore,
        balanceAfter,
        description,
        reference,
        status,
        ...(relatedAccount ? { relatedAccount } : {}),
      },
    ],
    session ? { session } : {}
  );

  return transaction;
}

/**
 * Deposit `amount` pesewas into the authenticated user's account.
 *
 * This is the public deposit operation (Requirement 5), composed entirely from
 * the atomic primitives above so the monetary invariants live in one place:
 *
 *   1. Validate the amount first (`assertValidAmount`). An invalid amount is
 *      rejected with a `ValidationError` (HTTP 400) BEFORE any lookup or write,
 *      so there are no side effects (Requirements 5.3, 15.5; design Property 9).
 *   2. Resolve the user's account by `userId`. If the user has no account at
 *      all, throw `NotFoundError` (404). Resolving it up front lets us tell a
 *      missing account (404) apart from an existing-but-non-Active account
 *      (403), which `creditAtomic`'s `null` alone cannot distinguish.
 *   3. Credit atomically (`creditAtomic`). A `null` result here means the
 *      account exists but is Frozen/Disabled (the Active status gate failed),
 *      so throw `AuthorizationError` (403) with NO transaction recorded
 *      (Requirements 5.4, 12.5; design Property 7).
 *   4. On a successful credit, record exactly one COMPLETED CREDIT Transaction
 *      with a unique reference and derived balanceBefore/After (Requirements
 *      5.1, 5.2, 15.3; design Properties 1, 2, 8). If the ledger write fails,
 *      the error propagates and is mapped to 500 — no COMPLETED transaction is
 *      left behind for a credit that was not recorded (Requirement 5.5).
 *
 * The credit and the ledger write run inside `withTransaction` so the balance
 * change and the ledger record are atomic: either both persist or neither does
 * (design Properties 1, 2). `userId` always originates from the verified JWT
 * identity (`req.user`), never from a client payload (Requirement 3).
 *
 * @param {import('mongoose').Types.ObjectId|string} userId - Owner, from the
 *   authenticated identity. Used to resolve the account to credit.
 * @param {number} amount - Positive integer pesewas to deposit.
 * @returns {Promise<{ account: import('mongoose').Document, transaction: import('mongoose').Document }>}
 *   The post-credit account document and the created CREDIT transaction.
 * @throws {ValidationError} If `amount` is not a positive integer in range (400).
 * @throws {NotFoundError} If the user has no account (404).
 * @throws {AuthorizationError} If the account is not Active (Frozen/Disabled) (403).
 * @throws {InternalError} If the credit succeeds but cannot be persisted/recorded (500).
 */
export async function deposit(userId, amount) {
  // Validate before any lookup or write so an invalid amount has no side
  // effects (design Property 9).
  assertValidAmount(amount);

  // Resolve the account up front to distinguish "no account" (404) from
  // "account exists but not Active" (403) — creditAtomic's null cannot.
  const account = await Account.findOne({ userId });
  if (!account) {
    throw new NotFoundError('Account not found');
  }

  return withTransaction(async (session) => {
    const updatedAccount = await creditAtomic(account._id, amount, session);

    // null => account exists but is Frozen/Disabled (status gate failed). No
    // balance change occurred and no transaction is recorded.
    if (!updatedAccount) {
      throw new AuthorizationError(
        'Account is not active; deposits are not permitted'
      );
    }

    const transaction = await recordTransaction({
      userId,
      accountId: updatedAccount._id,
      type: TRANSACTION_TYPES.CREDIT,
      amount,
      balanceAfter: updatedAccount.balance,
      effect: 'CREDIT',
      status: TRANSACTION_STATUSES.COMPLETED,
      session,
    });

    return { account: updatedAccount, transaction };
  });
}

/**
 * Withdraw `amount` pesewas from the authenticated user's account.
 *
 * This is the public withdrawal operation (Requirement 6), composed entirely
 * from the atomic primitives above so the monetary invariants live in one
 * place and mirror `deposit`'s structure:
 *
 *   1. Validate the amount first (`assertValidAmount`). An invalid amount is
 *      rejected with a `ValidationError` (HTTP 400) BEFORE any lookup or write,
 *      so there are no side effects (Requirements 6.4, 15.5; design Property 9).
 *   2. Resolve the user's account by `userId`. If the user has no account at
 *      all, throw `NotFoundError` (404). Resolving it up front lets us tell a
 *      missing account (404) apart from an existing-but-non-Active account (403)
 *      and from insufficient funds (400), which `debitAtomic`'s single `null`
 *      result cannot distinguish on its own.
 *   3. Debit atomically (`debitAtomic`). The conditional
 *      `{ status:'Active', balance:{ $gte: amount } }` filter is the
 *      double-spend / non-negativity guard: the decrement applies only if the
 *      account is Active AND the balance still covers the amount at write time,
 *      so the balance can never go negative (Requirements 6.6, 15.4; design
 *      Properties 3, 4).
 *   4. A `null` result means the debit did not apply. Because the account was
 *      found in step 2, re-read its status to disambiguate the cause:
 *        - status !== Active → `AuthorizationError` (403): the account is
 *          Frozen/Disabled (Requirements 6.5, 12.5; design Property 7).
 *        - status === Active → `InsufficientFundsError` (400): the balance was
 *          less than the amount (Requirements 6.3, 15.6; design Property 10).
 *      In BOTH failure cases no balance change occurred and no transaction is
 *      recorded.
 *   5. On a successful debit, record exactly one COMPLETED DEBIT Transaction
 *      with a unique reference and derived balanceBefore/After so
 *      `balanceAfter = balanceBefore - amount` (Requirements 6.1, 6.2, 15.3;
 *      design Properties 1, 3).
 *
 * The debit and the ledger write run inside `withTransaction` so the balance
 * change and the ledger record are atomic: either both persist or neither does
 * (design Properties 1, 3). `userId` always originates from the verified JWT
 * identity (`req.user`), never from a client payload (Requirement 3).
 *
 * @param {import('mongoose').Types.ObjectId|string} userId - Owner, from the
 *   authenticated identity. Used to resolve the account to debit.
 * @param {number} amount - Positive integer pesewas to withdraw.
 * @returns {Promise<{ account: import('mongoose').Document, transaction: import('mongoose').Document }>}
 *   The post-debit account document and the created DEBIT transaction.
 * @throws {ValidationError} If `amount` is not a positive integer in range (400).
 * @throws {NotFoundError} If the user has no account (404).
 * @throws {AuthorizationError} If the account is not Active (Frozen/Disabled) (403).
 * @throws {InsufficientFundsError} If the Active balance is less than `amount` (400).
 * @throws {InternalError} If the debit succeeds but cannot be persisted/recorded (500).
 */
export async function withdraw(userId, amount) {
  // Validate before any lookup or write so an invalid amount has no side
  // effects (design Property 9).
  assertValidAmount(amount);

  // Resolve the account up front so we can distinguish "no account" (404) from
  // "account not Active" (403) and "insufficient funds" (400) — debitAtomic's
  // single null result cannot tell these apart.
  const account = await Account.findOne({ userId });
  if (!account) {
    throw new NotFoundError('Account not found');
  }

  return withTransaction(async (session) => {
    const updatedAccount = await debitAtomic(account._id, amount, session);

    // null => the conditional debit did not apply. The account was found in the
    // up-front lookup, so re-read its status to disambiguate the cause. No
    // balance change occurred and no transaction is recorded in either case.
    if (!updatedAccount) {
      const current = await Account.findById(account._id).session(session);

      if (!current || current.status !== ACCOUNT_STATUS.ACTIVE) {
        throw new AuthorizationError(
          'Account is not active; withdrawals are not permitted'
        );
      }

      // Active but the balance did not cover the amount.
      throw new InsufficientFundsError(
        'Insufficient funds for this withdrawal'
      );
    }

    const transaction = await recordTransaction({
      userId,
      accountId: updatedAccount._id,
      type: TRANSACTION_TYPES.DEBIT,
      amount,
      balanceAfter: updatedAccount.balance,
      effect: 'DEBIT',
      status: TRANSACTION_STATUSES.COMPLETED,
      session,
    });

    return { account: updatedAccount, transaction };
  });
}

/**
 * Transfer `amount` pesewas from the authenticated user's account to the account
 * identified by `recipientAccountNumber`.
 *
 * This is the public transfer operation (Requirement 7), composed from the atomic
 * primitives so money movement stays centralized and the monetary invariants hold
 * in one place. Both legs — the sender debit and the recipient credit — run inside
 * a SINGLE `withTransaction` session so they commit or abort together; a failure in
 * either leg aborts the whole transaction and leaves both balances exactly as they
 * were (design Property 6: failed-transfer atomicity; Requirements 7.5, 7.10).
 *
 *   1. Validate the amount first (`assertValidAmount`). An invalid amount is
 *      rejected with a `ValidationError` (HTTP 400) BEFORE any lookup or write, so
 *      there are no side effects (Requirements 7.6, 15.5; design Property 9).
 *   2. Resolve the sender's account by `userId`. If the user has no account at all,
 *      throw `NotFoundError` (404).
 *   3. Reject a self-transfer: if `recipientAccountNumber` equals the sender's own
 *      account number, throw `ValidationError` (HTTP 400) before opening a session
 *      (Requirement 7.7). This is checked after amount validation per the spec's
 *      ordering (amount → self-transfer → recipient existence).
 *   4. Resolve the recipient account by `recipientAccountNumber`. If no account
 *      matches, throw `NotFoundError` (404) (Requirement 7.8).
 *   5. Inside a single `withTransaction` (one session so both legs are atomic):
 *      a. Debit the sender atomically (`debitAtomic`). A `null` result means the
 *         conditional debit did not apply; re-read the sender's status to
 *         disambiguate the cause (both leave balances unchanged — the transaction
 *         aborts):
 *           - status !== Active → `AuthorizationError` (403): sender Frozen/Disabled
 *             (Requirements 7.9, 12.5; design Property 7).
 *           - status === Active → `InsufficientFundsError` (400): balance did not
 *             cover the amount (Requirements 7.10, 15.6; design Property 10).
 *      b. Credit the recipient atomically (`creditAtomic`). A `null` result means
 *         the recipient is not Active (Frozen/Disabled); throw `AuthorizationError`
 *         (403). This aborts the transaction, rolling back the sender debit from
 *         step (a) so both balances revert (Requirements 7.9, 12.5; design
 *         Properties 6, 7).
 *      c. Record exactly two COMPLETED TRANSFER ledger entries, each with its own
 *         unique reference and a `relatedAccount` link to the counterparty: a DEBIT
 *         effect on the sender and a CREDIT effect on the recipient. Each derives
 *         `balanceBefore`/`balanceAfter` from the post-update balance returned by
 *         the atomic update (Requirements 7.4, 15.3; design Properties 1, 5, 8).
 *   6. On commit, the sender balance is `-amount`, the recipient balance is
 *      `+amount`, and their combined balance is unchanged (design Property 5).
 *
 * If multi-document transactions are unavailable (no replica set), `withTransaction`
 * fails and the error propagates — the transfer fails closed rather than performing
 * a partial, non-atomic move. `userId` always originates from the verified JWT
 * identity (`req.user`), never from a client payload (Requirement 3).
 *
 * @param {import('mongoose').Types.ObjectId|string} userId - Sender owner, from the
 *   authenticated identity. Used to resolve the sender account to debit.
 * @param {string} recipientAccountNumber - The 10-digit account number of the
 *   recipient account to credit.
 * @param {number} amount - Positive integer pesewas to transfer.
 * @returns {Promise<{ debitTxn: import('mongoose').Document, creditTxn: import('mongoose').Document }>}
 *   The sender's DEBIT TRANSFER record and the recipient's CREDIT TRANSFER record.
 * @throws {ValidationError} If `amount` is invalid (400) or the transfer is a
 *   self-transfer (400).
 * @throws {NotFoundError} If the sender has no account or no account matches
 *   `recipientAccountNumber` (404).
 * @throws {AuthorizationError} If the sender or recipient account is not Active (403).
 * @throws {InsufficientFundsError} If the Active sender balance is less than `amount` (400).
 * @throws {InternalError} If a leg succeeds but a ledger record cannot be persisted (500).
 */
export async function transfer(userId, recipientAccountNumber, amount) {
  // Validate before any lookup or write so an invalid amount has no side effects
  // (design Property 9).
  assertValidAmount(amount);

  // Resolve the sender up front so we can distinguish "no sender account" (404)
  // and check the self-transfer guard against the sender's own account number.
  const senderAccount = await Account.findOne({ userId });
  if (!senderAccount) {
    throw new NotFoundError('Account not found');
  }

  // Self-transfer guard (Requirement 7.7): rejected after amount validation and
  // before opening a session, so no transaction work is done for a no-op transfer.
  if (senderAccount.accountNumber === recipientAccountNumber) {
    throw new ValidationError('Self-transfer is not permitted');
  }

  // Resolve the recipient by account number (Requirement 7.8). A missing recipient
  // is a 404 before any balance change.
  const recipientAccount = await Account.findOne({
    accountNumber: recipientAccountNumber,
  });
  if (!recipientAccount) {
    throw new NotFoundError('Recipient account not found');
  }

  return withTransaction(async (session) => {
    // Leg 1: debit the sender. The conditional { status:'Active', balance:$gte }
    // filter is the double-spend / non-negativity guard. A null result means the
    // debit did not apply — no balance change occurred and the transaction aborts.
    const updatedSender = await debitAtomic(senderAccount._id, amount, session);

    if (!updatedSender) {
      // Re-read the sender's status within the session to disambiguate the cause.
      const currentSender = await Account.findById(senderAccount._id).session(
        session
      );

      if (!currentSender || currentSender.status !== ACCOUNT_STATUS.ACTIVE) {
        throw new AuthorizationError(
          'Sender account is not active; transfers are not permitted'
        );
      }

      // Active but the balance did not cover the amount.
      throw new InsufficientFundsError('Insufficient funds for this transfer');
    }

    // Leg 2: credit the recipient. A null result means the recipient is not Active
    // (Frozen/Disabled); throwing here aborts the transaction and rolls back the
    // sender debit above so both balances revert (Property 6).
    const updatedRecipient = await creditAtomic(
      recipientAccount._id,
      amount,
      session
    );

    if (!updatedRecipient) {
      throw new AuthorizationError(
        'Recipient account is not active; transfers are not permitted'
      );
    }

    // Record both TRANSFER legs with unique references and counterparty links.
    const debitTxn = await recordTransaction({
      userId: senderAccount.userId,
      accountId: updatedSender._id,
      type: TRANSACTION_TYPES.TRANSFER,
      amount,
      balanceAfter: updatedSender.balance,
      effect: 'DEBIT',
      relatedAccount: recipientAccount._id,
      status: TRANSACTION_STATUSES.COMPLETED,
      session,
    });

    const creditTxn = await recordTransaction({
      userId: recipientAccount.userId,
      accountId: updatedRecipient._id,
      type: TRANSACTION_TYPES.TRANSFER,
      amount,
      balanceAfter: updatedRecipient.balance,
      effect: 'CREDIT',
      relatedAccount: senderAccount._id,
      status: TRANSACTION_STATUSES.COMPLETED,
      session,
    });

    return { debitTxn, creditTxn };
  });
}

// ---------------------------------------------------------------------------
// Read-only history queries (Requirement 8)
//
// These two operations never mutate state and never open a MongoDB session —
// they are pure, ownership-scoped reads. Both enforce data-ownership isolation
// (design Property 14): every query is constrained by `userId` so a caller can
// only ever see or fetch their own transactions, and a record owned by another
// user is indistinguishable from one that does not exist (404), never leaked.
// ---------------------------------------------------------------------------

/** Default page number when the caller omits `page` (Requirement 8.2). */
const DEFAULT_PAGE = 1;
/** Default page size when the caller omits `limit` (Requirement 8.2). */
const DEFAULT_LIMIT = 20;
/** Minimum allowed page size (Requirement 8.3). */
const LIMIT_MIN = 1;
/** Maximum allowed page size — caps how much a single query can return (R8.3). */
const LIMIT_MAX = 100;
/** Maximum allowed length of a `search` term (Requirement 8.8). */
const SEARCH_MAX_LENGTH = 255;

/**
 * Validate and normalize a pagination value (`page` or `limit`).
 *
 * Pagination inputs often arrive as query strings, so a numeric string such as
 * `"2"` is accepted and coerced to the integer `2`; but any value that is not a
 * clean integer (floats, non-numeric text, NaN/Infinity, booleans) is rejected
 * with a `ValidationError` (HTTP 400). When the value is `undefined`/`null`
 * (parameter absent) the supplied default is returned instead (Requirement 8.2).
 * This is REJECT-on-invalid rather than clamp, per Requirement 8.4: an
 * out-of-shape pagination parameter is a 400 and NO transactions are returned.
 *
 * @param {unknown} value - Raw page/limit value (number or numeric string).
 * @param {string} label - Field name for the error message ("page"/"limit").
 * @param {number} defaultValue - Value to use when `value` is absent.
 * @returns {number} The validated positive integer.
 * @throws {ValidationError} If present but not a positive integer.
 */
function normalizePaginationValue(value, label, defaultValue) {
  if (value === undefined || value === null || value === '') {
    return defaultValue;
  }

  // Accept integers and integer-valued numeric strings only. Reject booleans,
  // floats, and anything non-numeric. (Requirement 8.4)
  const isNumber = typeof value === 'number';
  const isNumericString =
    typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value));

  if (!isNumber && !isNumericString) {
    throw new ValidationError(`${label} must be a positive integer`);
  }

  const numeric = Number(value);
  if (!Number.isInteger(numeric)) {
    throw new ValidationError(`${label} must be a positive integer`);
  }

  return numeric;
}

/**
 * List the authenticated user's transactions, newest-first, with optional
 * pagination and filtering (Requirement 8; design Properties 14, 16, 17).
 *
 * OWNERSHIP ISOLATION (Property 14): the base query is ALWAYS `{ userId }`, so
 * only the caller's own transactions can ever be returned — foreign records are
 * never included regardless of the supplied filters (Requirement 8.1).
 *
 * ORDERING + PAGINATION (Property 16): results are sorted by `createdAt`
 * descending (newest-first), matching the `{ userId, createdAt }` and
 * `{ userId, type, createdAt }` compound indexes. `page`/`limit` default to
 * 1/20 when absent (Requirement 8.2); when present they must be positive
 * integers with `limit` in `[1, 100]`, otherwise the request is rejected with a
 * `ValidationError` (HTTP 400) and no transactions are returned (Requirements
 * 8.3, 8.4). The returned slice is `skip = (page - 1) * limit` through
 * `skip + limit`, and the response carries `total`, `page`, `limit`, and the
 * derived `totalPages` so callers can render pagination metadata.
 *
 * FILTERS (Property 17): applied conjunctively on top of the ownership scope so
 * the result contains EXACTLY the owned records matching every supplied filter
 * (none omitted, none extra):
 *   - `type`      — exact match against a defined transaction type; an
 *                   unrecognized type is a 400 (Requirement 8.5).
 *   - `startDate`/`endDate` — inclusive `createdAt` range. Each must parse to a
 *                   valid date and `startDate <= endDate`, else 400
 *                   (Requirements 8.6, 8.7).
 *   - `search`    — case-insensitive substring match against `description` OR
 *                   `reference`; must be 1–255 chars, else 400. The term is
 *                   regex-escaped so it is treated as a literal substring, not a
 *                   pattern (Requirement 8.8).
 *
 * When nothing matches, an empty `items` array and `total: 0` are returned with
 * no error (Requirement 8.9).
 *
 * This is a pure read: no session/transaction is opened and no state changes.
 *
 * @param {import('mongoose').Types.ObjectId|string} userId - Owner, from the
 *   authenticated identity (`req.user`), never a client payload (Requirement 3).
 * @param {object} [filters] - Optional pagination + filter parameters.
 * @param {number|string} [filters.page] - 1-based page number (default 1).
 * @param {number|string} [filters.limit] - Page size, 1–100 (default 20).
 * @param {'CREDIT'|'DEBIT'|'TRANSFER'} [filters.type] - Exact type filter.
 * @param {string|Date} [filters.startDate] - Inclusive lower bound on createdAt.
 * @param {string|Date} [filters.endDate] - Inclusive upper bound on createdAt.
 * @param {string} [filters.search] - Case-insensitive description/reference term.
 * @returns {Promise<{ items: import('mongoose').Document[], total: number, page: number, limit: number, totalPages: number }>}
 *   The page of transactions plus pagination metadata.
 * @throws {ValidationError} If pagination, type, date range, or search are
 *   present but invalid (HTTP 400); no transactions are returned in that case.
 */
export async function listTransactions(userId, filters = {}) {
  const { page: rawPage, limit: rawLimit, type, startDate, endDate, search } =
    filters || {};

  // --- Pagination (Requirements 8.2, 8.3, 8.4) -----------------------------
  const page = normalizePaginationValue(rawPage, 'page', DEFAULT_PAGE);
  const limit = normalizePaginationValue(rawLimit, 'limit', DEFAULT_LIMIT);

  if (page < DEFAULT_PAGE) {
    throw new ValidationError('page must be a positive integer greater than or equal to 1');
  }
  if (limit < LIMIT_MIN || limit > LIMIT_MAX) {
    throw new ValidationError(`limit must be an integer between ${LIMIT_MIN} and ${LIMIT_MAX}`);
  }

  // Base query: ALWAYS ownership-scoped (Property 14, Requirement 8.1).
  const query = { userId };

  // --- Type filter (Requirement 8.5) ---------------------------------------
  if (type !== undefined && type !== null && type !== '') {
    if (!Object.values(TRANSACTION_TYPES).includes(type)) {
      throw new ValidationError(
        `type must be one of: ${Object.values(TRANSACTION_TYPES).join(', ')}`
      );
    }
    query.type = type;
  }

  // --- Date range filter (Requirements 8.6, 8.7) ---------------------------
  const hasStart = startDate !== undefined && startDate !== null && startDate !== '';
  const hasEnd = endDate !== undefined && endDate !== null && endDate !== '';

  if (hasStart || hasEnd) {
    const createdAt = {};

    if (hasStart) {
      const start = new Date(startDate);
      if (Number.isNaN(start.getTime())) {
        throw new ValidationError('startDate must be a valid date');
      }
      createdAt.$gte = start;
    }

    if (hasEnd) {
      const end = new Date(endDate);
      if (Number.isNaN(end.getTime())) {
        throw new ValidationError('endDate must be a valid date');
      }
      createdAt.$lte = end;
    }

    if (hasStart && hasEnd && createdAt.$gte > createdAt.$lte) {
      throw new ValidationError('startDate must be less than or equal to endDate');
    }

    query.createdAt = createdAt;
  }

  // --- Search filter (Requirement 8.8) -------------------------------------
  if (search !== undefined && search !== null && search !== '') {
    if (typeof search !== 'string' || search.length > SEARCH_MAX_LENGTH) {
      throw new ValidationError(
        `search must be a string between 1 and ${SEARCH_MAX_LENGTH} characters`
      );
    }
    // Escape regex metacharacters so the term is matched as a literal
    // case-insensitive substring, not interpreted as a pattern.
    const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(escaped, 'i');
    query.$or = [{ description: pattern }, { reference: pattern }];
  }

  // --- Execute (newest-first, paginated) -----------------------------------
  const skip = (page - 1) * limit;

  const [items, total] = await Promise.all([
    Transaction.find(query).sort({ createdAt: -1, _id: -1 }).skip(skip).limit(limit),
    Transaction.countDocuments(query),
  ]);

  const totalPages = total === 0 ? 0 : Math.ceil(total / limit);

  return { items, total, page, limit, totalPages };
}

/**
 * Fetch a single transaction by id, scoped to the authenticated user.
 *
 * The query is ALWAYS `{ _id: txnId, userId }`, so a transaction owned by a
 * different user is treated exactly like a nonexistent one: a `NotFoundError`
 * (HTTP 404). This enforces ownership isolation (design Property 14) AND avoids
 * leaking the existence of other users' records (Requirements 8.10, 8.11;
 * design Property 20).
 *
 * A malformed id (one that cannot be cast to an ObjectId) is handled
 * gracefully: rather than surfacing a low-level CastError, it is mapped to the
 * same 404 as any other unowned/nonexistent record, so the endpoint behaves
 * uniformly and never leaks internals.
 *
 * This is a pure read: no session/transaction is opened and no state changes.
 *
 * @param {import('mongoose').Types.ObjectId|string} userId - Owner, from the
 *   authenticated identity (`req.user`), never a client payload (Requirement 3).
 * @param {string} txnId - The transaction id to fetch.
 * @returns {Promise<import('mongoose').Document>} The owned transaction.
 * @throws {NotFoundError} If no transaction with that id is owned by the user,
 *   or the id is not a valid ObjectId (HTTP 404).
 */
export async function getTransactionForUser(userId, txnId) {
  let transaction;
  try {
    transaction = await Transaction.findOne({ _id: txnId, userId });
  } catch (error) {
    // A CastError means `txnId` is not a valid ObjectId. Treat it as "not
    // found" so we never leak the existence of records or internal details.
    if (error?.name === 'CastError') {
      throw new NotFoundError('Transaction not found');
    }
    throw error;
  }

  if (!transaction) {
    throw new NotFoundError('Transaction not found');
  }

  return transaction;
}

export default {
  withTransaction,
  creditAtomic,
  debitAtomic,
  recordTransaction,
  assertValidAmount,
  isValidAmount,
  deposit,
  withdraw,
  transfer,
  listTransactions,
  getTransactionForUser,
};
