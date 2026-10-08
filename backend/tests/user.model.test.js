// tests/user.model.test.js
//
// Unit tests for the User model (src/models/User.js), Task 4.2.
//
// Covered (Requirements 1.1, 1.3, 14.8, 14.9):
//   - the password is stored as a bcrypt hash, never as plaintext (14.8)
//   - comparePassword returns true for the correct password and false otherwise
//   - the password is `select:false`: absent from default queries, re-selectable
//     via `.select('+password')` (14.9)
//   - role defaults to CUSTOMER (1.1)
//   - email is lowercased on save
//   - required-field validation fails when a mandatory field is missing (1.3)
//   - re-saving an unchanged document does not re-hash the password
//
// src/models/User.js statically imports src/config/env.js, which runs
// dotenv.config() and validates REQUIRED vars (MONGO_URI, JWT_SECRET) on import,
// throwing when absent. There is no committed .env, so (mirroring the project's
// env.test.js pattern of controlling the environment before importing an
// env-dependent module) we set the required vars here BEFORE dynamically
// importing the model. BCRYPT_ROUNDS is pinned low to keep hashing fast in CI
// while still exercising the real bcrypt code path (no mocks).
//
// The in-memory MongoDB replica set and per-test collection clearing are
// provided by tests/setup.js (wired via jest.config.js).

import bcrypt from 'bcryptjs';

// Must be set before the env-validating module is imported.
process.env.MONGO_URI =
  process.env.MONGO_URI ||
  'mongodb://127.0.0.1:27017/mybanking?replicaSet=rs0';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-value';
// A low-but-valid bcrypt cost factor keeps the real hashing fast in tests.
process.env.BCRYPT_ROUNDS = process.env.BCRYPT_ROUNDS || '4';

/** @type {import('mongoose').Model} */
let User;
/** @type {Readonly<Record<string, string>>} */
let ROLES;

beforeAll(async () => {
  // Dynamic import so the env vars set above are in place before
  // src/config/env.js runs its import-time validation.
  const mod = await import('../src/models/User.js');
  User = mod.default;
  ROLES = mod.ROLES;
});

/**
 * A complete, valid set of User fields. Tests clone and mutate this so each
 * starts from a known-good baseline.
 */
function validUserData(overrides = {}) {
  return {
    firstName: 'Ada',
    lastName: 'Lovelace',
    email: 'ada@example.com',
    phone: '0241234567',
    dateOfBirth: new Date('1990-01-01'),
    address: '10 Analytical Engine St',
    password: 'correct horse battery',
    ...overrides,
  };
}

describe('User model', () => {
  describe('password hashing (Requirement 14.8)', () => {
    test('stores the password as a bcrypt hash, not plaintext', async () => {
      const plaintext = 'correct horse battery';
      const user = await User.create(validUserData({ password: plaintext }));

      // The in-memory document already reflects the pre-save hook result.
      expect(user.password).toBeDefined();
      expect(user.password).not.toBe(plaintext);
      // bcrypt hashes start with the algorithm/cost prefix, e.g. "$2a$04$".
      expect(user.password).toMatch(/^\$2[aby]\$\d{2}\$/);

      // The persisted value (re-read with the hash selected) is a valid hash
      // that verifies against the original plaintext.
      const stored = await User.findById(user._id).select('+password');
      expect(stored.password).not.toBe(plaintext);
      expect(await bcrypt.compare(plaintext, stored.password)).toBe(true);
    });

    test('does not re-hash the password when re-saving an unchanged document', async () => {
      const user = await User.create(validUserData());

      const withPassword = await User.findById(user._id).select('+password');
      const hashBefore = withPassword.password;

      // Modify a non-password field and save again.
      withPassword.phone = '0557654321';
      await withPassword.save();

      const reread = await User.findById(user._id).select('+password');
      // The stored hash is unchanged: the pre-save hook skipped re-hashing.
      expect(reread.password).toBe(hashBefore);
      expect(reread.phone).toBe('0557654321');
    });

    test('re-hashes when the password is actually changed', async () => {
      const user = await User.create(validUserData({ password: 'first-pass' }));
      const first = (await User.findById(user._id).select('+password')).password;

      const doc = await User.findById(user._id).select('+password');
      doc.password = 'second-pass';
      await doc.save();

      const second = (await User.findById(user._id).select('+password'))
        .password;

      expect(second).not.toBe(first);
      expect(second).toMatch(/^\$2[aby]\$\d{2}\$/);
      expect(await bcrypt.compare('second-pass', second)).toBe(true);
      expect(await bcrypt.compare('first-pass', second)).toBe(false);
    });
  });

  describe('comparePassword instance method', () => {
    test('returns true for the correct password', async () => {
      const plaintext = 'the-right-password';
      const created = await User.create(validUserData({ password: plaintext }));

      // Reload with the hash selected so comparePassword has something to match.
      const user = await User.findById(created._id).select('+password');
      await expect(user.comparePassword(plaintext)).resolves.toBe(true);
    });

    test('returns false for the wrong password', async () => {
      const created = await User.create(
        validUserData({ password: 'the-right-password' })
      );
      const user = await User.findById(created._id).select('+password');
      await expect(user.comparePassword('a-wrong-password')).resolves.toBe(
        false
      );
    });

    test('resolves false (does not throw) when the hash was not selected', async () => {
      const created = await User.create(validUserData());
      // Default query => password is select:false, so it's absent here.
      const user = await User.findById(created._id);
      expect(user.password).toBeUndefined();
      await expect(user.comparePassword('anything')).resolves.toBe(false);
    });
  });

  describe('password select:false (Requirement 14.9)', () => {
    test('findById without +password returns no password field', async () => {
      const created = await User.create(validUserData());
      const user = await User.findById(created._id);
      expect(user).not.toBeNull();
      expect(user.password).toBeUndefined();
    });

    test('password is re-selectable via .select("+password")', async () => {
      const created = await User.create(validUserData());
      const user = await User.findById(created._id).select('+password');
      expect(typeof user.password).toBe('string');
      expect(user.password).toMatch(/^\$2[aby]\$\d{2}\$/);
    });

    test('find() without +password omits the password across results', async () => {
      await User.create(validUserData({ email: 'a@example.com' }));
      await User.create(validUserData({ email: 'b@example.com' }));
      const users = await User.find();
      expect(users).toHaveLength(2);
      for (const u of users) {
        expect(u.password).toBeUndefined();
      }
    });
  });

  describe('role defaulting (Requirement 1.1)', () => {
    test('defaults role to CUSTOMER when not provided', async () => {
      const user = await User.create(validUserData());
      expect(user.role).toBe('CUSTOMER');
      expect(user.role).toBe(ROLES.CUSTOMER);
    });

    test('honours an explicitly provided ADMIN role', async () => {
      const user = await User.create(validUserData({ role: 'ADMIN' }));
      expect(user.role).toBe(ROLES.ADMIN);
    });

    test('rejects a role outside the enum', async () => {
      await expect(
        User.create(validUserData({ role: 'SUPERUSER' }))
      ).rejects.toThrow();
    });
  });

  describe('email normalisation', () => {
    test('lowercases the email on save', async () => {
      const user = await User.create(
        validUserData({ email: 'Mixed.Case@Example.COM' })
      );
      expect(user.email).toBe('mixed.case@example.com');
    });
  });

  describe('required-field validation (Requirement 1.3)', () => {
    const requiredFields = [
      'firstName',
      'lastName',
      'email',
      'phone',
      'dateOfBirth',
      'address',
      'password',
    ];

    test.each(requiredFields)(
      'fails validation when %s is missing',
      async (field) => {
        const data = validUserData();
        delete data[field];
        await expect(User.create(data)).rejects.toThrow();
      }
    );
  });

  describe('ROLES export', () => {
    test('exposes CUSTOMER and ADMIN', () => {
      expect(ROLES).toEqual({ CUSTOMER: 'CUSTOMER', ADMIN: 'ADMIN' });
    });
  });
});
