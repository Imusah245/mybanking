// tests/env.test.js
//
// Unit tests for the configuration layer (src/config/env.js), Task 2.3.
//
// env.js runs dotenv.config() and validates on IMPORT, throwing ConfigError
// when a required variable is missing/malformed. To exercise that behaviour we
// manipulate process.env, reset the module registry, and dynamically import the
// module inside each test so the top-level validation re-runs under the env we
// set.
//
// Covered (Requirements 2.1, 13.3, 14.2):
//   - missing required vars -> throws
//   - optional vars default correctly when absent
//   - CORS_ALLOWLIST comma-separated parsing (trim, de-dupe, drop empties)
//   - thrown error messages NEVER contain the JWT_SECRET value

import { jest } from '@jest/globals';

// A recognisably "secret" value we can scan error messages for.
const SECRET_VALUE = 'super-secret-jwt-signing-key-DO-NOT-LEAK-123456';

// A minimal, valid environment. Individual tests clone and mutate this.
const BASE_ENV = {
  MONGO_URI: 'mongodb://127.0.0.1:27017/mybanking?replicaSet=rs0',
  JWT_SECRET: SECRET_VALUE,
  JWT_EXPIRES_IN: '3600',
  PORT: '5000',
  CORS_ALLOWLIST: 'http://localhost:3000,http://localhost:5173',
  BCRYPT_ROUNDS: '12',
};

// Env vars this module reads; cleared before each test so leftover shell/CI
// values can't bleed into assertions.
const MANAGED_KEYS = [
  'MONGO_URI',
  'JWT_SECRET',
  'JWT_EXPIRES_IN',
  'PORT',
  'CORS_ALLOWLIST',
  'BCRYPT_ROUNDS',
];

let savedEnv;

/**
 * Replace process.env with the provided map (plus whatever non-managed keys
 * were already present) and import a fresh copy of env.js so its import-time
 * validation runs against this environment.
 */
async function loadEnv(overrides) {
  for (const key of MANAGED_KEYS) delete process.env[key];
  Object.assign(process.env, overrides);
  jest.resetModules();
  return import('../src/config/env.js');
}

beforeEach(() => {
  // Snapshot so each test starts from the real environment and restores it.
  savedEnv = { ...process.env };
});

afterEach(() => {
  for (const key of Object.keys(process.env)) delete process.env[key];
  Object.assign(process.env, savedEnv);
});

describe('env.js configuration validation', () => {
  describe('missing required variables', () => {
    test('throws when MONGO_URI is missing', async () => {
      const { ...rest } = BASE_ENV;
      delete rest.MONGO_URI;
      await expect(loadEnv(rest)).rejects.toThrow(/MONGO_URI/);
    });

    test('throws when JWT_SECRET is missing', async () => {
      const { ...rest } = BASE_ENV;
      delete rest.JWT_SECRET;
      await expect(loadEnv(rest)).rejects.toThrow(/JWT_SECRET/);
    });

    test('throws when a required var is only whitespace', async () => {
      await expect(loadEnv({ ...BASE_ENV, MONGO_URI: '   ' })).rejects.toThrow(
        /MONGO_URI/
      );
    });

    test('reports every missing required var at once', async () => {
      const rest = { ...BASE_ENV };
      delete rest.MONGO_URI;
      delete rest.JWT_SECRET;
      await expect(loadEnv(rest)).rejects.toThrow(/MONGO_URI/);

      // Re-import to inspect the full problem list on a single thrown error.
      let caught;
      try {
        await loadEnv(rest);
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeDefined();
      expect(caught.name).toBe('ConfigError');
      expect(caught.problems).toEqual(
        expect.arrayContaining([
          expect.stringContaining('MONGO_URI'),
          expect.stringContaining('JWT_SECRET'),
        ])
      );
    });

    test('throws ConfigError (named error type) on invalid config', async () => {
      const rest = { ...BASE_ENV };
      delete rest.JWT_SECRET;
      // The thrown error is a ConfigError; assert on its shape.
      let caught;
      try {
        await loadEnv(rest);
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeDefined();
      expect(caught.name).toBe('ConfigError');
      expect(Array.isArray(caught.problems)).toBe(true);
    });
  });

  describe('defaulting of optional variables', () => {
    test('applies defaults when optionals are absent', async () => {
      const required = {
        MONGO_URI: BASE_ENV.MONGO_URI,
        JWT_SECRET: BASE_ENV.JWT_SECRET,
      };
      const mod = await loadEnv(required);
      expect(mod.env.JWT_EXPIRES_IN).toBe(3600);
      expect(mod.env.PORT).toBe(5000);
      expect(mod.env.BCRYPT_ROUNDS).toBe(12);
      expect(mod.env.CORS_ALLOWLIST).toEqual([]);
    });

    test('honours explicitly provided optional values', async () => {
      const mod = await loadEnv({
        ...BASE_ENV,
        JWT_EXPIRES_IN: '7200',
        PORT: '8080',
        BCRYPT_ROUNDS: '10',
      });
      expect(mod.env.JWT_EXPIRES_IN).toBe(7200);
      expect(mod.env.PORT).toBe(8080);
      expect(mod.env.BCRYPT_ROUNDS).toBe(10);
    });

    test('throws when an optional var is present but malformed', async () => {
      await expect(
        loadEnv({ ...BASE_ENV, JWT_EXPIRES_IN: 'not-a-number' })
      ).rejects.toThrow(/JWT_EXPIRES_IN/);
    });

    test('throws when BCRYPT_ROUNDS is out of range', async () => {
      await expect(
        loadEnv({ ...BASE_ENV, BCRYPT_ROUNDS: '99' })
      ).rejects.toThrow(/BCRYPT_ROUNDS/);
    });
  });

  describe('CORS_ALLOWLIST parsing', () => {
    test('parses a comma-separated list into an array', async () => {
      const mod = await loadEnv({
        ...BASE_ENV,
        CORS_ALLOWLIST: 'http://a.com,http://b.com',
      });
      expect(mod.env.CORS_ALLOWLIST).toEqual(['http://a.com', 'http://b.com']);
    });

    test('trims whitespace and drops empty entries', async () => {
      const mod = await loadEnv({
        ...BASE_ENV,
        CORS_ALLOWLIST: '  http://a.com ,, http://b.com ,   ',
      });
      expect(mod.env.CORS_ALLOWLIST).toEqual(['http://a.com', 'http://b.com']);
    });

    test('de-duplicates repeated origins', async () => {
      const mod = await loadEnv({
        ...BASE_ENV,
        CORS_ALLOWLIST: 'http://a.com,http://a.com,http://b.com',
      });
      expect(mod.env.CORS_ALLOWLIST).toEqual(['http://a.com', 'http://b.com']);
    });

    test('yields an empty array when unset', async () => {
      const rest = { ...BASE_ENV };
      delete rest.CORS_ALLOWLIST;
      const mod = await loadEnv(rest);
      expect(mod.env.CORS_ALLOWLIST).toEqual([]);
    });
  });

  describe('secret safety (Requirement 13.3 / 14.2)', () => {
    test('error message does not contain the JWT_SECRET value', async () => {
      // Provide an invalid config (bad PORT) while a real secret is present, so
      // the thrown message is built with JWT_SECRET sitting in the environment.
      let caught;
      try {
        await loadEnv({ ...BASE_ENV, PORT: 'not-a-port' });
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeDefined();
      expect(caught.message).not.toContain(SECRET_VALUE);
      for (const problem of caught.problems) {
        expect(problem).not.toContain(SECRET_VALUE);
      }
    });

    test('missing-secret error references the var by name only', async () => {
      const rest = { ...BASE_ENV };
      delete rest.JWT_SECRET;
      let caught;
      try {
        await loadEnv(rest);
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeDefined();
      // Mentions the name...
      expect(caught.message).toContain('JWT_SECRET');
      // ...but never the (now-absent) secret value.
      expect(caught.message).not.toContain(SECRET_VALUE);
    });

    test('loaded config exposes JWT_SECRET for the auth layer but keeps it out of thrown errors', async () => {
      const mod = await loadEnv({ ...BASE_ENV });
      // Available to the app that needs to sign tokens...
      expect(mod.env.JWT_SECRET).toBe(SECRET_VALUE);

      // ...yet an unrelated validation failure never echoes it.
      let caught;
      try {
        await loadEnv({ ...BASE_ENV, BCRYPT_ROUNDS: '1' });
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeDefined();
      expect(JSON.stringify(caught.problems)).not.toContain(SECRET_VALUE);
    });
  });
});
