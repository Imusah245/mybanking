// tests/generators.test.js
//
// Unit tests for the identifier generators (Task 3.6):
//   - src/utils/generateReference.js    (buildReference, generateReference)
//   - src/utils/generateAccountNumber.js (randomAccountNumber, generateAccountNumber)
//
// These helpers back the reference-uniqueness invariant (design Property 8,
// Requirements 5.2 / 6.2 / 7.4) and the unique 10-digit account number
// (Requirement 1.2). The tests assert:
//   - Format correctness over many samples (regex + length).
//   - Varied output across many calls (collision-rarity sanity, not statistics).
//   - The DB-backed uniqueness/retry path: a stub model whose `exists()` reports
//     a collision once then clears is retried and eventually yields a value.
//   - generateAccountNumber throws after `maxAttempts` when `exists()` always
//     reports a collision.
//
// The generators call `const query = model.exists(...); if (session)
// query.session(session); const result = await query;` — so the mock `exists()`
// must return an object that is BOTH awaitable (a thenable/Promise) AND exposes
// a chainable `.session()` method. The helper below builds exactly that.

import { jest } from '@jest/globals';
import {
  buildReference,
  generateReference,
} from '../src/utils/generateReference.js';
import {
  randomAccountNumber,
  generateAccountNumber,
  ACCOUNT_NUMBER_PATTERN,
} from '../src/utils/generateAccountNumber.js';

const REFERENCE_PATTERN = /^TXN-[A-Z0-9]{8}$/;

/**
 * Build a stub Mongoose-like model whose `exists()` returns a value that is
 * awaitable AND has a `.session()` method (mirroring a Mongoose Query).
 *
 * @param {(filter: object) => (boolean|object)} resolver - Given the query
 *   filter, returns the truthy/falsy "already exists" result for that call.
 * @returns {{ exists: jest.Mock, sessionCalls: object[] }}
 */
function makeStubModel(resolver) {
  const sessionCalls = [];

  const exists = jest.fn((filter) => {
    const result = resolver(filter);
    // A Promise is already a thenable; attach a chainable `.session()` so both
    // `await query` and `query.session(session)` work exactly as the code does.
    const query = Promise.resolve(result);
    query.session = (session) => {
      sessionCalls.push(session);
      return query;
    };
    return query;
  });

  return { exists, sessionCalls };
}

describe('buildReference', () => {
  test('matches ^TXN-[A-Z0-9]{8}$ over many samples', () => {
    for (let i = 0; i < 5000; i += 1) {
      const reference = buildReference();
      expect(reference).toMatch(REFERENCE_PATTERN);
      expect(reference).toHaveLength(12); // "TXN-" (4) + 8 chars
    }
  });

  test('uses only the uppercase alphanumeric alphabet after the prefix', () => {
    for (let i = 0; i < 1000; i += 1) {
      const segment = buildReference().slice(4);
      expect(segment).toMatch(/^[A-Z0-9]{8}$/);
    }
  });

  test('produces varied values across many calls (collision rarity)', () => {
    const seen = new Set();
    const iterations = 5000;
    for (let i = 0; i < iterations; i += 1) {
      seen.add(buildReference());
    }
    // 36^8 ≈ 2.8e12 keyspace: 5000 draws should essentially never collide.
    // Allow a tiny slack to avoid flakiness while still catching a broken
    // (e.g. constant or low-entropy) generator.
    expect(seen.size).toBeGreaterThanOrEqual(iterations - 1);
  });
});

describe('generateReference', () => {
  test('returns a well-formed reference when no model is supplied (crypto-only path)', async () => {
    const reference = await generateReference();
    expect(reference).toMatch(REFERENCE_PATTERN);
  });

  test('returns a well-formed reference with an explicit null model', async () => {
    const reference = await generateReference({ model: null });
    expect(reference).toMatch(REFERENCE_PATTERN);
  });

  test('returns the first candidate when the model reports no collision', async () => {
    const model = makeStubModel(() => false);

    const reference = await generateReference({ model: { exists: model.exists } });

    expect(reference).toMatch(REFERENCE_PATTERN);
    expect(model.exists).toHaveBeenCalledTimes(1);
  });

  test('retries on a collision and returns a unique reference', async () => {
    // exists() reports a collision on the first candidate, then clears.
    let call = 0;
    const model = makeStubModel(() => {
      call += 1;
      return call === 1; // truthy once, falsy afterwards
    });

    const reference = await generateReference({ model: { exists: model.exists } });

    expect(reference).toMatch(REFERENCE_PATTERN);
    expect(model.exists).toHaveBeenCalledTimes(2); // one collision + one success
  });

  test('scopes the uniqueness check to the provided session', async () => {
    const model = makeStubModel(() => false);
    const session = { id: 'txn-session' };

    await generateReference({ model: { exists: model.exists }, session });

    expect(model.exists).toHaveBeenCalledTimes(1);
    expect(model.sessionCalls).toEqual([session]);
  });

  test('queries by the generated reference each attempt', async () => {
    let call = 0;
    const filters = [];
    const exists = jest.fn((filter) => {
      filters.push(filter);
      call += 1;
      const query = Promise.resolve(call === 1); // collide once
      query.session = () => query;
      return query;
    });

    const reference = await generateReference({ model: { exists } });

    // Each attempt queried a reference-shaped filter; the final filter equals
    // the returned reference.
    expect(filters).toHaveLength(2);
    filters.forEach((f) => expect(f.reference).toMatch(REFERENCE_PATTERN));
    expect(filters[1].reference).toBe(reference);
  });

  test('throws after exhausting retries when every candidate collides', async () => {
    const model = makeStubModel(() => true); // always a collision

    await expect(
      generateReference({ model: { exists: model.exists } })
    ).rejects.toThrow(/unique transaction reference/i);

    // MAX_ATTEMPTS is 10 in the implementation.
    expect(model.exists).toHaveBeenCalledTimes(10);
  });
});

describe('randomAccountNumber', () => {
  test('matches ^\\d{10}$ over many samples', () => {
    for (let i = 0; i < 5000; i += 1) {
      const number = randomAccountNumber();
      expect(number).toMatch(ACCOUNT_NUMBER_PATTERN);
      expect(number).toHaveLength(10);
    }
  });

  test('preserves leading zeros (always exactly ten characters)', () => {
    // Over many samples some will begin with 0; none may ever be shorter.
    for (let i = 0; i < 2000; i += 1) {
      expect(randomAccountNumber()).toHaveLength(10);
    }
  });

  test('produces varied values across many calls (collision rarity)', () => {
    const seen = new Set();
    const iterations = 5000;
    for (let i = 0; i < iterations; i += 1) {
      seen.add(randomAccountNumber());
    }
    // 10^10 keyspace: 5000 draws should essentially never collide.
    expect(seen.size).toBeGreaterThanOrEqual(iterations - 1);
  });
});

describe('generateAccountNumber', () => {
  test('throws a TypeError when no valid model is supplied', async () => {
    await expect(generateAccountNumber()).rejects.toThrow(TypeError);
    await expect(generateAccountNumber({})).rejects.toThrow(TypeError);
    await expect(generateAccountNumber(null)).rejects.toThrow(TypeError);
  });

  test('returns the first candidate when the model reports no collision', async () => {
    const model = makeStubModel(() => false);

    const number = await generateAccountNumber({ exists: model.exists });

    expect(number).toMatch(ACCOUNT_NUMBER_PATTERN);
    expect(model.exists).toHaveBeenCalledTimes(1);
  });

  test('retries on a collision and returns a unique account number', async () => {
    let call = 0;
    const model = makeStubModel(() => {
      call += 1;
      return call === 1; // collide once, then succeed
    });

    const number = await generateAccountNumber({ exists: model.exists });

    expect(number).toMatch(ACCOUNT_NUMBER_PATTERN);
    expect(model.exists).toHaveBeenCalledTimes(2);
  });

  test('scopes the uniqueness check to the provided session', async () => {
    const model = makeStubModel(() => false);
    const session = { id: 'acct-session' };

    await generateAccountNumber({ exists: model.exists }, { session });

    expect(model.exists).toHaveBeenCalledTimes(1);
    expect(model.sessionCalls).toEqual([session]);
  });

  test('queries by the generated accountNumber each attempt', async () => {
    const filters = [];
    let call = 0;
    const exists = jest.fn((filter) => {
      filters.push(filter);
      call += 1;
      const query = Promise.resolve(call === 1); // collide once
      query.session = () => query;
      return query;
    });

    const number = await generateAccountNumber({ exists });

    expect(filters).toHaveLength(2);
    filters.forEach((f) => expect(f.accountNumber).toMatch(ACCOUNT_NUMBER_PATTERN));
    expect(filters[1].accountNumber).toBe(number);
  });

  test('throws after maxAttempts when every candidate collides', async () => {
    const model = makeStubModel(() => true); // always a collision

    await expect(
      generateAccountNumber({ exists: model.exists }, { maxAttempts: 3 })
    ).rejects.toThrow(/unique account number/i);

    expect(model.exists).toHaveBeenCalledTimes(3);
  });

  test('defaults to 10 attempts before giving up', async () => {
    const model = makeStubModel(() => true);

    await expect(
      generateAccountNumber({ exists: model.exists })
    ).rejects.toThrow(/unique account number/i);

    expect(model.exists).toHaveBeenCalledTimes(10);
  });
});
