/**
 * Transaction reference generator (Requirements 5.2, 6.2, 7.4).
 *
 * Produces collision-resistant, unique transaction references of the form
 * `TXN-XXXXXXXX`, where the eight trailing characters are drawn from the
 * uppercase alphanumeric alphabet `[A-Z0-9]`. Every generated value matches
 * `^TXN-[A-Z0-9]{8}$`, which is the exact format enforced by the Transaction
 * model's `reference` field.
 *
 * Randomness comes from Node's `crypto` module (not `Math.random`) so values
 * are unpredictable and spread uniformly across the keyspace, minimizing the
 * chance of collisions. As a second line of defense, each candidate is checked
 * for uniqueness against the Transaction collection and regenerated on the rare
 * event of a collision, which supports the reference-uniqueness invariant
 * (design Property 8).
 */

import crypto from 'node:crypto';
import mongoose from 'mongoose';

const REFERENCE_PREFIX = 'TXN-';
const SEGMENT_LENGTH = 8;
// Uppercase base36 alphabet. 36^8 ≈ 2.8e12 possible segments.
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const ALPHABET_SIZE = ALPHABET.length;

// Guard against an unexpected inability to find a free reference (e.g. a
// misconfigured or saturated collection) rather than looping forever.
const MAX_ATTEMPTS = 10;

/**
 * Build a single random `TXN-XXXXXXXX` reference string using crypto bytes.
 *
 * Uses rejection sampling so each character is drawn uniformly from the
 * 36-character alphabet with no modulo bias.
 *
 * @returns {string} A candidate reference matching `^TXN-[A-Z0-9]{8}$`.
 */
export function buildReference() {
  // Largest multiple of ALPHABET_SIZE that fits in a byte; bytes at or above
  // this threshold are rejected to avoid modulo bias.
  const unbiasedCeiling = Math.floor(256 / ALPHABET_SIZE) * ALPHABET_SIZE;

  let segment = '';
  while (segment.length < SEGMENT_LENGTH) {
    // Request a small batch of random bytes at a time.
    const bytes = crypto.randomBytes(SEGMENT_LENGTH);
    for (let i = 0; i < bytes.length && segment.length < SEGMENT_LENGTH; i += 1) {
      const byte = bytes[i];
      if (byte < unbiasedCeiling) {
        segment += ALPHABET[byte % ALPHABET_SIZE];
      }
    }
  }

  return `${REFERENCE_PREFIX}${segment}`;
}

/**
 * Generate a transaction reference that is unique across the Transaction
 * collection.
 *
 * Generates crypto-random candidates and verifies each against the Transaction
 * collection, retrying on the rare collision until a free reference is found.
 * When a Mongoose session is supplied, the uniqueness check participates in the
 * same ACID transaction as the surrounding money movement, so a reference
 * reserved earlier in an uncommitted transaction is still observed.
 *
 * @param {object} [options] - Options.
 * @param {import('mongoose').ClientSession} [options.session] - Optional
 *   Mongoose session so the uniqueness check joins an in-flight transaction.
 * @param {import('mongoose').Model} [options.model] - Optional Transaction
 *   model override (primarily for testing). Defaults to the registered
 *   `Transaction` model when available.
 * @returns {Promise<string>} A unique reference matching `^TXN-[A-Z0-9]{8}$`.
 * @throws {Error} If a unique reference cannot be found within the retry limit.
 */
export async function generateReference({ session, model } = {}) {
  const Transaction =
    model ??
    (mongoose.models.Transaction
      ? mongoose.model('Transaction')
      : null);

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const reference = buildReference();

    // No model registered yet (e.g. earliest bootstrap/tests): the crypto
    // randomness alone provides the reference; skip the DB uniqueness check.
    if (!Transaction) {
      return reference;
    }

    const query = Transaction.exists({ reference });
    if (session) {
      query.session(session);
    }

    const existing = await query;
    if (!existing) {
      return reference;
    }
  }

  throw new Error(
    `Unable to generate a unique transaction reference after ${MAX_ATTEMPTS} attempts`
  );
}

export default generateReference;
