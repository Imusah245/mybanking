/**
 * Standardized response envelope helpers (Requirements 13.1, 13.2).
 *
 * Every successful response uses the `{ success: true, message, data }` shape.
 * Every failing response uses the `{ success: false, message }` shape with no
 * `data` field. These helpers are the single place that constructs those
 * envelopes so the shape stays consistent across the whole API.
 */

/**
 * Emit a successful response envelope.
 *
 * @param {import('express').Response} res - Express response object.
 * @param {number} status - HTTP status code to send.
 * @param {string} message - Human-readable success message.
 * @param {*} [data=null] - Payload to return under the `data` field.
 * @returns {import('express').Response} The Express response, for chaining.
 */
export function ok(res, status, message, data = null) {
  return res.status(status).json({
    success: true,
    message,
    data,
  });
}

/**
 * Shape an error into the standardized failure envelope body.
 *
 * This is the error path that feeds `errorMiddleware`: it never includes a
 * `data` field. The returned object is the exact response body
 * `errorMiddleware` sends for a failed request (Requirement 13.2).
 *
 * @param {string} message - Human-readable failure message.
 * @returns {{ success: false, message: string }} The error envelope body.
 */
export function errorBody(message) {
  return {
    success: false,
    message,
  };
}

/**
 * Emit a failure response envelope directly.
 *
 * Convenience wrapper used where an error is shaped and sent in one place
 * (e.g. `errorMiddleware`). Produces `{ success: false, message }` with no
 * `data` field (Requirement 13.2).
 *
 * @param {import('express').Response} res - Express response object.
 * @param {number} status - HTTP status code to send.
 * @param {string} message - Human-readable failure message.
 * @returns {import('express').Response} The Express response, for chaining.
 */
export function fail(res, status, message) {
  return res.status(status).json(errorBody(message));
}
