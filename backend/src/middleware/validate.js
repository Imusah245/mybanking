/**
 * Validation middleware (Validation_Middleware) — Requirements 1.4, 2.3, 14.4,
 * 14.5.
 *
 * `validate(validations)` runs a set of express-validator chains for a route,
 * then inspects the accumulated `validationResult`. The chains also sanitize
 * input (trim, normalize email, `toInt` on amounts), so by the time control
 * reaches the controller `req` holds typed, clean values.
 *
 * On failure the middleware does NOT call the controller. It aggregates the
 * failed fields into a single concise message and forwards a `ValidationError`
 * (HTTP 400) to the central `errorMiddleware`, which renders the standardized
 * `{ success: false, message }` failure envelope.
 */

import { validationResult } from 'express-validator';
import { ValidationError } from '../utils/errors.js';

/**
 * Build a concise, human-readable message from the collected validation
 * errors. Duplicate field names are collapsed so the message lists each failed
 * field once, in first-seen order.
 *
 * @param {Array<{ path?: string, param?: string, msg?: string }>} errors
 *   The array returned by `validationResult(req).array()`.
 * @returns {string} A message naming the fields that failed validation.
 */
function buildMessage(errors) {
  const fields = [];
  for (const err of errors) {
    // express-validator v7 exposes the field as `path`; older shapes use
    // `param`. Fall back gracefully so the message is always meaningful.
    const field = err.path ?? err.param;
    if (field && !fields.includes(field)) {
      fields.push(field);
    }
  }

  if (fields.length === 0) {
    return 'Validation failed';
  }

  return `Validation failed for: ${fields.join(', ')}`;
}

/**
 * Create a middleware that runs the supplied express-validator chains and
 * short-circuits with a 400 `ValidationError` when any chain reports an error.
 *
 * @param {Array<import('express-validator').ValidationChain>} [validations=[]]
 *   The express-validator chains to execute for the route.
 * @returns {import('express').RequestHandler} An async Express middleware.
 */
export function validate(validations = []) {
  const chains = Array.isArray(validations) ? validations : [validations];

  return async function validateMiddleware(req, _res, next) {
    try {
      // Run every chain against the request. Each chain both validates and
      // sanitizes (mutating req in place), so order is irrelevant and they can
      // run concurrently.
      await Promise.all(chains.map((chain) => chain.run(req)));

      const result = validationResult(req);
      if (result.isEmpty()) {
        return next();
      }

      // Aggregate failures into one concise message and forward a 400 to the
      // error handler. The controller is never reached.
      return next(new ValidationError(buildMessage(result.array())));
    } catch (err) {
      // A chain itself throwing (unexpected) is forwarded so the error handler
      // can map it rather than crashing the request.
      return next(err);
    }
  };
}

export default validate;
