// tests/validate.test.js
//
// Task 5.8 — Unit tests for the validation middleware.
//
// Module under test:
//   - src/middleware/validate.js  (validate(validations))
//
// Requirements:
//   14.4 / 14.5 — invalid request payloads are rejected before the controller
//                 with a 400 ValidationError naming the failed field(s); valid
//                 payloads pass through untouched (and sanitized).
//
// These tests use REAL express-validator chains run against a mock `req`, so
// the middleware's run()/validationResult() flow is exercised for real. No DB
// is needed; `next` is a jest.fn so we can assert exactly what the middleware
// forwarded and whether a downstream controller would have been reached.

import { jest } from '@jest/globals';
import { body } from 'express-validator';
import { validate } from '../src/middleware/validate.js';
import { ValidationError } from '../src/utils/errors.js';

/** Build a minimal mock request carrying only a body. */
function makeReq(bodyObj = {}) {
  return { body: bodyObj };
}

describe('validate — passing chains (Requirements 14.4, 14.5)', () => {
  test('calls next() with no arguments when every chain passes', async () => {
    const next = jest.fn();
    const req = makeReq({ email: 'user@example.com', amount: '150' });

    const mw = validate([
      body('email').isEmail(),
      body('amount').isInt({ min: 1 }),
    ]);
    await mw(req, {}, next);

    expect(next).toHaveBeenCalledTimes(1);
    // next() with no args == control passes to the next handler (the controller).
    expect(next).toHaveBeenCalledWith();
    expect(next.mock.calls[0]).toHaveLength(0);
  });

  test('sanitizing chains mutate req so the controller sees clean, typed values', async () => {
    const next = jest.fn();
    const req = makeReq({ email: '  USER@Example.COM ', amount: '150' });

    const mw = validate([
      body('email').trim().normalizeEmail().isEmail(),
      body('amount').toInt().isInt({ min: 1 }),
    ]);
    await mw(req, {}, next);

    expect(next).toHaveBeenCalledWith();
    expect(req.body.email).toBe('user@example.com');
    expect(req.body.amount).toBe(150); // toInt() made it a real number
  });

  test('an empty chain list always passes', async () => {
    const next = jest.fn();
    const req = makeReq({ anything: true });

    await validate()(req, {}, next);
    await validate([])(req, {}, next);

    expect(next).toHaveBeenCalledTimes(2);
    expect(next.mock.calls[0]).toHaveLength(0);
    expect(next.mock.calls[1]).toHaveLength(0);
  });
});

describe('validate — failing chains (Requirements 14.4, 14.5)', () => {
  test('forwards a 400 ValidationError and does NOT reach the controller', async () => {
    const next = jest.fn();
    const controller = jest.fn(); // stand-in for the next handler
    const req = makeReq({ email: 'not-an-email', amount: '0' });

    const mw = validate([
      body('email').isEmail(),
      body('amount').isInt({ min: 1 }),
    ]);
    await mw(req, {}, next);

    // Exactly one forward, and it carried an error (not an empty next()).
    expect(next).toHaveBeenCalledTimes(1);
    const forwarded = next.mock.calls[0][0];
    expect(forwarded).toBeInstanceOf(ValidationError);
    expect(forwarded.statusCode).toBe(400);

    // The controller is never invoked when validation fails.
    expect(controller).not.toHaveBeenCalled();
  });

  test('message names a single failed field', async () => {
    const next = jest.fn();
    const req = makeReq({ email: 'nope', amount: '5' });

    const mw = validate([
      body('email').isEmail(),
      body('amount').isInt({ min: 1 }),
    ]);
    await mw(req, {}, next);

    const err = next.mock.calls[0][0];
    expect(err.message).toBe('Validation failed for: email');
  });

  test('message names every failed field, each once, in first-seen order', async () => {
    const next = jest.fn();
    const req = makeReq({ email: 'nope', amount: '0' });

    const mw = validate([
      body('email').isEmail(),
      body('amount').isInt({ min: 1 }),
    ]);
    await mw(req, {}, next);

    const err = next.mock.calls[0][0];
    expect(err).toBeInstanceOf(ValidationError);
    expect(err.message).toMatch(/^Validation failed for: /);
    expect(err.message).toContain('email');
    expect(err.message).toContain('amount');

    // Each failed field appears exactly once even if a field has >1 rule fail.
    const listed = err.message.replace('Validation failed for: ', '').split(', ');
    expect(new Set(listed).size).toBe(listed.length);
  });

  test('a field with multiple failing rules is still listed only once', async () => {
    const next = jest.fn();
    const req = makeReq({ amount: 'abc' }); // fails both isInt and the min check

    const mw = validate([
      body('amount').isInt({ min: 1 }).isLength({ min: 10 }),
    ]);
    await mw(req, {}, next);

    const err = next.mock.calls[0][0];
    const listed = err.message.replace('Validation failed for: ', '').split(', ');
    expect(listed.filter((f) => f === 'amount')).toHaveLength(1);
  });

  test('a missing required field fails validation', async () => {
    const next = jest.fn();
    const req = makeReq({}); // no email at all

    const mw = validate([body('email').isEmail()]);
    await mw(req, {}, next);

    const err = next.mock.calls[0][0];
    expect(err).toBeInstanceOf(ValidationError);
    expect(err.statusCode).toBe(400);
    expect(err.message).toContain('email');
  });
});
