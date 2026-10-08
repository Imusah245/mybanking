/**
 * Unique account-number generator (Requirement 1.2).
 *
 * Produces an exactly-10-digit numeric string matching `^\d{10}$` that is
 * unique across the Account collection. Randomness comes from Node's `crypto`
 * module (cryptographically strong), which makes collisions vanishingly
 * unlikely; a bounded retry loop queries the Account collection and regenerates
 * on the rare collision, so the returned value is safe to persist against a
 * unique index on `Account.accountNumber`.
 */

import { randomInt } from 'node:crypto';

/** Exactly ten numeric digits. */
export const ACCOUNT_NUMBER_PATTERN = /^\d{10}$/;

const ACCOUNT_NUMBER_LENGTH = 10;
const DEFAULT_MAX_ATTEMPTS = 10;

/**
 * Generate a single candidate account number using cryptographic randomness.
 *
 * Each of the ten positions is an independent uniform digit (0-9) drawn from
 * `crypto.randomInt`, so the result always has a consistent, fixed length of
 * ten characters (leading zeros preserved).
 *
 * @returns {string} A 10-character numeric string matching `^\d{10}$`.
 */
export function randomAccountNumber() {
  let number = '';
  for (let i = 0; i < ACCOUNT_NUMBER_LENGTH; i += 1) {
    // randomInt(10) -> uniform integer in [0, 9], unbiased.
    number += String(randomInt(10));
  }
  return number;
}

/**
 * Generate a 10-digit account number that is unique within the Account
 * collection, retrying on the rare uniqueness collision.
 *
 * The uniqueness check is performed against the live collection (optionally
 * inside a provided Mongoose session so it participates in the surrounding
 * registration transaction). The random generation plus the unique index on
 * `Account.accountNumber` are the authoritative guards; this function reduces
 * the chance of hitting that index error in the common path.
 *
 * @param {import('mongoose').Model} AccountModel - The Account Mongoose model.
 * @param {object} [options] - Optional settings.
 * @param {import('mongoose').ClientSession} [options.session] - Session to scope
 *   the uniqueness lookup to an in-progress transaction.
 * @param {number} [options.maxAttempts=10] - Maximum generation attempts before
 *   giving up.
 * @returns {Promise<string>} A unique 10-digit numeric account number.
 * @throws {Error} If a unique value cannot be found within `maxAttempts`.
 */
export async function generateAccountNumber(AccountModel, options = {}) {
  const { session, maxAttempts = DEFAULT_MAX_ATTEMPTS } = options;

  if (!AccountModel || typeof AccountModel.exists !== 'function') {
    throw new TypeError(
      'generateAccountNumber requires the Account Mongoose model'
    );
  }

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const candidate = randomAccountNumber();

    const query = AccountModel.exists({ accountNumber: candidate });
    if (session) {
      query.session(session);
    }

    const clash = await query;
    if (!clash) {
      return candidate;
    }
  }

  throw new Error(
    `Unable to generate a unique account number after ${maxAttempts} attempts`
  );
}

export default generateAccountNumber;
