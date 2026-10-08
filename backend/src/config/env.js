// Loads and validates environment variables at startup.
//
// Validation is fail-fast: if a required value is missing or malformed, this
// module throws immediately with a clear, actionable message. Secret values
// (notably JWT_SECRET) are NEVER included in error messages or logs
// (Requirement 13.3).
import dotenv from 'dotenv';

dotenv.config();

// Defaults for optional values.
const DEFAULT_JWT_EXPIRES_IN = 3600; // seconds (1 hour)
const DEFAULT_PORT = 5000;
const DEFAULT_BCRYPT_ROUNDS = 12; // sensible bcrypt cost factor

// bcrypt cost factor must stay within the range the algorithm supports.
const MIN_BCRYPT_ROUNDS = 4;
const MAX_BCRYPT_ROUNDS = 31;

/**
 * Collects every validation failure so the operator sees all problems at once
 * rather than fixing them one restart at a time. Secret values are referenced
 * only by variable name, never by value.
 */
class ConfigError extends Error {
  constructor(problems) {
    super(
      `Invalid environment configuration:\n` +
        problems.map((p) => `  - ${p}`).join('\n')
    );
    this.name = 'ConfigError';
    this.problems = problems;
  }
}

const problems = [];

/**
 * Returns the raw, trimmed value of a variable, or undefined when it is unset
 * or blank. Treats whitespace-only values as absent.
 */
function raw(name) {
  const value = process.env[name];
  if (value === undefined || value === null) return undefined;
  const trimmed = String(value).trim();
  return trimmed === '' ? undefined : trimmed;
}

/**
 * Requires a non-empty string. Records a problem (by name only) when missing so
 * that secret values are never echoed back.
 */
function requireString(name) {
  const value = raw(name);
  if (value === undefined) {
    problems.push(`${name} is required but was not set`);
    return undefined;
  }
  return value;
}

/**
 * Parses a positive integer, falling back to a default when the variable is
 * absent. A present-but-malformed value is a hard error.
 */
function parsePositiveInt(name, defaultValue, { min, max } = {}) {
  const value = raw(name);
  if (value === undefined) return defaultValue;

  if (!/^\d+$/.test(value)) {
    problems.push(`${name} must be a positive integer`);
    return defaultValue;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    problems.push(`${name} must be a positive integer`);
    return defaultValue;
  }
  if (min !== undefined && parsed < min) {
    problems.push(`${name} must be >= ${min}`);
    return defaultValue;
  }
  if (max !== undefined && parsed > max) {
    problems.push(`${name} must be <= ${max}`);
    return defaultValue;
  }
  return parsed;
}

/**
 * Parses a comma-separated allowlist into a de-duplicated array of trimmed,
 * non-empty origins. An unset allowlist yields an empty array.
 */
function parseAllowlist(name) {
  const value = raw(name);
  if (value === undefined) return [];
  const origins = value
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin !== '');
  return [...new Set(origins)];
}

// --- Required secrets / connection ---------------------------------------
const MONGO_URI = requireString('MONGO_URI');
const JWT_SECRET = requireString('JWT_SECRET');

// --- Optional values with defaults ---------------------------------------
const JWT_EXPIRES_IN = parsePositiveInt('JWT_EXPIRES_IN', DEFAULT_JWT_EXPIRES_IN);
const PORT = parsePositiveInt('PORT', DEFAULT_PORT, { max: 65535 });
const BCRYPT_ROUNDS = parsePositiveInt('BCRYPT_ROUNDS', DEFAULT_BCRYPT_ROUNDS, {
  min: MIN_BCRYPT_ROUNDS,
  max: MAX_BCRYPT_ROUNDS,
});
const CORS_ALLOWLIST = parseAllowlist('CORS_ALLOWLIST');

if (problems.length > 0) {
  // Fail fast. The message references variables by name only — no secret values.
  throw new ConfigError(problems);
}

/**
 * Validated, immutable application configuration.
 *
 * NOTE: `JWT_SECRET` is intentionally present here for use by the auth layer
 * but must never be logged. Do not serialize this object wholesale to logs.
 */
export const env = Object.freeze({
  MONGO_URI,
  JWT_SECRET,
  JWT_EXPIRES_IN,
  PORT,
  CORS_ALLOWLIST: Object.freeze(CORS_ALLOWLIST),
  BCRYPT_ROUNDS,
});

export { ConfigError };

export default env;
