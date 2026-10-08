// Database seed script (Task 15).
//
// Seeds the banking backend with a repeatable, known dataset for local
// development: one ADMIN user and several CUSTOMER users, each with a linked
// Account (unique 10-digit accountNumber, integer-pesewa balance), plus a few
// sample transactions produced through `bankService` so the monetary invariants
// (integer pesewas, atomic balance changes, ledger records) are respected.
//
// Design alignment:
//   - All money is INTEGER PESEWAS (100 pesewas = 1 GHS). (Requirement 15.1)
//   - Users are created through the Mongoose model so the pre-save hook hashes
//     the password with bcrypt; plaintext passwords are NEVER inserted or
//     stored, only printed as dev login credentials by this script. (R14.8)
//   - Accounts use `generateAccountNumber` for unique 10-digit numbers. (R1.2)
//   - Sample deposits/transfers go through `bankService` so balances and
//     Transaction ledger records stay consistent and atomic. (R5, R7, R15)
//   - The dataset gives an admin something to oversee: customers, accounts,
//     and system-wide transactions/statistics. (R10.2, R11.1)
//
// Idempotency / safety to re-run:
//   This script performs a RESET seed — it clears the User, Account, and
//   Transaction collections first and then recreates the known dataset. Running
//   it repeatedly therefore produces the same end state and never collides with
//   the unique email / accountNumber / reference indexes.
//
// Secrets:
//   The script prints the seeded login emails and the plaintext DEV passwords it
//   set, so a developer can log in immediately. It NEVER logs password hashes,
//   JWTs, or JWT_SECRET. (Requirement 13.3)
//
// Transfers require a replica set (multi-document transactions). If the dev
// MONGO_URI is not a replica set, the sample-transfer step fails closed; the
// script logs a note and continues, so deposits are still seeded.

import { connectDB, disconnectDB } from '../src/config/db.js';
import User, { ROLES } from '../src/models/User.js';
import Account, { ACCOUNT_STATUS } from '../src/models/Account.js';
import Transaction from '../src/models/Transaction.js';
import generateAccountNumber from '../src/utils/generateAccountNumber.js';
import * as bankService from '../src/services/bankService.js';

// 1 GHS = 100 pesewas. Helper keeps the seed data readable while storing ints.
const GHS = (cedis) => Math.round(cedis * 100);

// Known DEV passwords. These are intentionally printed so a developer can log
// in. They are NEVER stored in plaintext — the User pre-save hook hashes them.
const ADMIN_PASSWORD = 'Admin123!';
const CUSTOMER_PASSWORD = 'Password123!';

// A fixed date-of-birth comfortably over 18 for every seeded user.
const DOB = new Date('1990-01-01T00:00:00.000Z');

/**
 * The admin account to seed. The admin has a role of ADMIN and (like every
 * user) a linked Account, so admin-facing listings/statistics include it.
 */
const ADMIN_SEED = {
  firstName: 'Ada',
  lastName: 'Admin',
  email: 'admin@mybanking.test',
  phone: '0200000000',
  address: '1 Admin Street, Accra',
  role: ROLES.ADMIN,
  // Starting balance in integer pesewas.
  openingBalance: GHS(0),
  status: ACCOUNT_STATUS.ACTIVE,
};

/**
 * The customer accounts to seed. Each gets a linked Account seeded with an
 * opening balance (integer pesewas) and a status. One account is Frozen on
 * purpose so admin status-control and the frozen-account rejection paths have
 * data to exercise.
 */
const CUSTOMER_SEEDS = [
  {
    firstName: 'Kwame',
    lastName: 'Mensah',
    email: 'kwame@mybanking.test',
    phone: '0241111111',
    address: '12 Independence Ave, Accra',
    openingBalance: GHS(1500), // 150,000 pesewas
    status: ACCOUNT_STATUS.ACTIVE,
  },
  {
    firstName: 'Ama',
    lastName: 'Owusu',
    email: 'ama@mybanking.test',
    phone: '0242222222',
    address: '34 Liberation Rd, Kumasi',
    openingBalance: GHS(500), // 50,000 pesewas
    status: ACCOUNT_STATUS.ACTIVE,
  },
  {
    firstName: 'Yaw',
    lastName: 'Boateng',
    email: 'yaw@mybanking.test',
    phone: '0243333333',
    address: '7 Cape Coast Rd, Cape Coast',
    openingBalance: GHS(0), // starts empty
    status: ACCOUNT_STATUS.ACTIVE,
  },
  {
    firstName: 'Akosua',
    lastName: 'Darko',
    email: 'akosua@mybanking.test',
    phone: '0244444444',
    address: '88 Ring Road, Tema',
    openingBalance: GHS(250), // 25,000 pesewas
    status: ACCOUNT_STATUS.FROZEN, // frozen on purpose
  },
];

/**
 * Remove all seedable data so the script is safe to re-run (reset seed).
 * Clearing before inserting avoids unique-index collisions on re-run.
 */
async function clearCollections() {
  await Promise.all([
    Transaction.deleteMany({}),
    Account.deleteMany({}),
    User.deleteMany({}),
  ]);
}

/**
 * Create one User (password hashed by the pre-save hook) and its linked Account
 * with a unique 10-digit account number and an integer-pesewa opening balance.
 *
 * @returns {Promise<{ user: import('mongoose').Document, account: import('mongoose').Document, password: string }>}
 */
async function createUserWithAccount(seed, password) {
  const user = new User({
    firstName: seed.firstName,
    lastName: seed.lastName,
    email: seed.email,
    phone: seed.phone,
    dateOfBirth: DOB,
    address: seed.address,
    password, // plaintext in; stored as a bcrypt hash by the pre-save hook.
    role: seed.role ?? ROLES.CUSTOMER,
  });
  await user.save();

  const accountNumber = await generateAccountNumber(Account);
  const account = await Account.create({
    userId: user._id,
    accountNumber,
    accountType: 'Savings',
    balance: seed.openingBalance, // integer pesewas
    currency: 'GHS',
    status: seed.status ?? ACCOUNT_STATUS.ACTIVE,
  });

  return { user, account, password };
}

/**
 * Seed a few sample transactions through `bankService` so balances and ledger
 * records stay consistent. Deposits always work on a standalone mongod; a
 * transfer needs a replica set, so it is attempted best-effort and failures are
 * reported without aborting the whole seed.
 *
 * @param {Array<{ user, account }>} customers - Active customers to transact on.
 * @returns {Promise<{ deposits: number, transfers: number, transferNote?: string }>}
 */
async function seedSampleTransactions(customers) {
  let deposits = 0;
  let transfers = 0;
  let transferNote;

  // Pick two Active customers for a sample deposit + transfer.
  const active = customers.filter(
    (c) => c.account.status === ACCOUNT_STATUS.ACTIVE
  );

  // Sample deposit: top up the first active customer by GHS 200.
  if (active[0]) {
    await bankService.deposit(active[0].user._id, GHS(200));
    deposits += 1;
  }

  // Sample transfer: move GHS 75 from the first active customer to the second.
  if (active[0] && active[1]) {
    try {
      await bankService.transfer(
        active[0].user._id,
        active[1].account.accountNumber,
        GHS(75)
      );
      transfers += 1;
    } catch (error) {
      // Transfers require a replica set. Fail closed and keep going so the rest
      // of the seed (users, accounts, deposits) still lands.
      transferNote =
        'Sample transfer skipped (multi-document transactions require a ' +
        `replica set): ${error?.message ?? 'unknown error'}`;
    }
  }

  return { deposits, transfers, transferNote };
}

/**
 * Run the seed: connect, reset, create users/accounts, seed sample
 * transactions, print a secret-free summary with dev credentials, and
 * disconnect cleanly.
 */
async function seed() {
  console.log('[seed] connecting to MongoDB...');
  await connectDB();

  console.log('[seed] clearing existing User / Account / Transaction data...');
  await clearCollections();

  console.log('[seed] creating admin + customers with linked accounts...');
  const admin = await createUserWithAccount(ADMIN_SEED, ADMIN_PASSWORD);

  const customers = [];
  for (const seedData of CUSTOMER_SEEDS) {
    // Sequential on purpose: keeps account-number generation checks simple.
    // eslint-disable-next-line no-await-in-loop
    const created = await createUserWithAccount(seedData, CUSTOMER_PASSWORD);
    customers.push(created);
  }

  console.log('[seed] seeding sample transactions...');
  const { deposits, transfers, transferNote } =
    await seedSampleTransactions(customers);

  const txnCount = await Transaction.countDocuments({});

  // --- Secret-free summary --------------------------------------------------
  console.log('\n========== SEED COMPLETE ==========');
  console.log(`Users created:        ${1 + customers.length}`);
  console.log(`  admins:             1`);
  console.log(`  customers:          ${customers.length}`);
  console.log(`Accounts created:     ${1 + customers.length}`);
  console.log(`Sample deposits:      ${deposits}`);
  console.log(`Sample transfers:     ${transfers}`);
  console.log(`Transaction records:  ${txnCount}`);
  if (transferNote) {
    console.log(`Note: ${transferNote}`);
  }

  console.log('\n--- Admin ---');
  console.log(`  email:          ${admin.user.email}`);
  console.log(`  account number: ${admin.account.accountNumber}`);
  console.log(`  role:           ${admin.user.role}`);

  console.log('\n--- Customers ---');
  for (const c of customers) {
    console.log(
      `  ${c.user.email.padEnd(26)} acct=${c.account.accountNumber} ` +
        `status=${c.account.status}`
    );
  }

  // Dev credentials: printing the plaintext DEV passwords is intentional and
  // acceptable for a local seed script. Hashes and JWT_SECRET are never logged.
  console.log('\n--- Dev login credentials (DEVELOPMENT ONLY) ---');
  console.log(`  ADMIN:    ${ADMIN_SEED.email} / ${ADMIN_PASSWORD}`);
  console.log(`  CUSTOMER: ${CUSTOMER_SEEDS[0].email} / ${CUSTOMER_PASSWORD}`);
  console.log('  (all seeded customers share the same dev password)');
  console.log('===================================\n');
}

// Entry point: run the seed, disconnect cleanly, and set the process exit code.
// 0 on success, non-zero on failure.
seed()
  .then(async () => {
    await disconnectDB();
    process.exit(0);
  })
  .catch(async (error) => {
    console.error(`[seed] FAILED: ${error?.message ?? 'unknown error'}`);
    try {
      await disconnectDB();
    } catch {
      // Ignore disconnect errors during failure cleanup.
    }
    process.exit(1);
  });
