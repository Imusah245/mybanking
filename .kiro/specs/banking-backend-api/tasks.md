# Implementation Plan: Banking Backend API

## Overview

This plan converts the Banking Backend API design into incremental, test-driven coding tasks for a backend-only Node.js (ES Modules) + Express + MongoDB/Mongoose service. Tasks are ordered so each step builds on prior work and nothing references code that has not yet been built: scaffolding and config first, then models and utilities, then middleware, then the money-movement core (`bankService`) with its property-based tests, then the controller/route layers (auth, account/profile, transactions, admin), then app assembly, seeds, and final full-suite wiring.

All monetary values are integer pesewas. The acting user is always derived from `req.user` (JWT `sub` claim). Property-based tests use `fast-check` with a minimum of 100 runs per property and are tagged with the design property number and the requirement clause they validate. The test suite runs on `mongodb-memory-server` in single-node replica-set mode so transfer/registration transactions behave identically to production.

Tasks marked with `*` are optional (tests) and can be skipped for a faster MVP, though they are strongly recommended given the monetary invariants.

## Tasks

- [x] 1. Scaffold the backend project and tooling
  - Create the `backend/` directory tree per the design: `src/{config,controllers,middleware,models,routes,services,utils}`, `src/server.js`, `tests/`, `tests/properties/`, `seeds/`.
  - Create `package.json` with `"type": "module"`, runtime deps (`express`, `mongoose`, `jsonwebtoken`, `bcryptjs`, `helmet`, `cors`, `express-rate-limit`, `express-validator`, `dotenv`) and dev deps (`jest`, `supertest`, `mongodb-memory-server`, `fast-check`); add `start`, `dev`, `seed`, and `test` scripts.
  - Configure Jest for ES Modules (e.g. `node --experimental-vm-modules` test script or equivalent) and a global test setup that starts `mongodb-memory-server` as a single-node replica set and clears collections between tests.
  - Create `.env.example` (MONGO_URI, JWT_SECRET, JWT_EXPIRES_IN=3600, PORT, CORS_ALLOWLIST, BCRYPT_ROUNDS) and `.gitignore` (node_modules, .env, coverage).
  - _Requirements: 7 (replica set), 15.1_

- [x] 2. Implement configuration layer
  - [x] 2.1 Implement `src/config/env.js`
    - Load env vars via `dotenv`; validate presence/shape of `MONGO_URI`, `JWT_SECRET`, `JWT_EXPIRES_IN` (default 3600), `PORT`, `CORS_ALLOWLIST` (parse comma-separated to array), `BCRYPT_ROUNDS` (default sensible rounds). Fail fast with a clear error if a required secret is missing; never log `JWT_SECRET`.
    - _Requirements: 2.1, 13.3, 14.2_

  - [x] 2.2 Implement `src/config/db.js`
    - Export `connectDB()` that establishes the Mongoose connection to the replica-set URI and a `disconnectDB()` helper for tests; log connection state without secrets.
    - _Requirements: 7, 13.3_

  - [x] 2.3 Write unit tests for env validation
    - Assert `env.js` throws when a required var is missing and parses defaults/allowlist correctly; assert secrets are not included in thrown messages.
    - _Requirements: 2.1, 13.3_

- [x] 3. Implement utility helpers
  - [x] 3.1 Implement `src/utils/response.js`
    - `ok(res, status, message, data)` emits `{ success:true, message, data }`; provide an error-shaping helper feeding `errorMiddleware` that yields `{ success:false, message }` with no `data` field.
    - _Requirements: 13.1, 13.2_

  - [x] 3.2 Implement `src/utils/formatters.js`
    - `pesewasToDisplay(pesewas)` → `"GHS 1,234.56"` and `displayToPesewas(string)` → integer pesewas. Display/parsing only; never used in balance arithmetic.
    - _Requirements: 15.1_

  - [x] 3.3 Implement `src/utils/generateReference.js`
    - Produce `TXN-XXXXXXXX` (8 uppercase base36/hex chars) matching `^TXN-[A-Z0-9]{8}$`; retry on collision against the Transaction collection; accept an optional session.
    - _Requirements: 5.2, 6.2, 7.4_

  - [x] 3.4 Implement `src/utils/generateAccountNumber.js`
    - Produce a unique 10-digit numeric string matching `^\d{10}$`; retry on uniqueness collision against the Account collection; accept an optional session.
    - _Requirements: 1.2_

  - [x] 3.5 Write unit tests for formatters
    - Round-trip and formatting edge cases; assert conversions never introduce floating-point drift into integer values.
    - _Requirements: 15.1_

  - [x] 3.6 Write unit tests for reference and account-number generators
    - Assert format regexes and that generated values are unique across many iterations (collision retry path exercised with a seeded existing value).
    - _Requirements: 1.2, 5.2, 6.2, 7.4_

- [x] 4. Implement data models
  - [x] 4.1 Implement `src/models/User.js`
    - Define schema (firstName, lastName, email unique+lowercase+indexed, phone, dateOfBirth, address, password with `select:false`, role enum CUSTOMER/ADMIN default CUSTOMER indexed, timestamps). Add pre-save hook to bcrypt-hash the password only when modified (rounds from env), and a `comparePassword(candidate)` instance method.
    - _Requirements: 1.1, 14.8, 14.9_

  - [x] 4.2 Write unit tests for the User model
    - Password is stored as a bcrypt hash (never plaintext), excluded from default queries, re-selectable via `.select('+password')`; `comparePassword` returns true/false correctly; duplicate email triggers a unique-index error; role defaults to CUSTOMER.
    - _Requirements: 1.1, 1.3, 14.8, 14.9_

  - [x] 4.3 Implement `src/models/Account.js`
    - Define schema (userId ref+indexed, accountNumber unique+indexed matching `^\d{10}$`, accountType default Savings, balance integer in `[0, 9_999_999_999_999]` with `Number.isInteger` validator and `min:0`, currency default GHS, status enum Active/Frozen/Disabled default Active indexed, timestamps).
    - _Requirements: 1.2, 15.1_

  - [x] 4.4 Write unit tests for the Account model
    - Non-integer balance rejected, out-of-range balance rejected, bad accountNumber format rejected, invalid status rejected; defaults applied.
    - _Requirements: 1.2, 15.1_

  - [x] 4.5 Implement `src/models/Transaction.js`
    - Define schema (userId ref+indexed, accountId ref+indexed, type enum CREDIT/DEBIT/TRANSFER, amount integer in `[1, 999_999_999_999]` with validator, balanceBefore/balanceAfter integer `min:0` validators, description maxlength 255, reference unique matching `^TXN-[A-Z0-9]{8}$`, status enum COMPLETED/FAILED/REVERSED, relatedAccount ref nullable, timestamps). Add compound indexes `{ userId:1, createdAt:-1 }` and `{ userId:1, type:1, createdAt:-1 }`.
    - _Requirements: 5.2, 6.2, 7.4, 8.1, 15.1_

  - [x] 4.6 Write unit tests for the Transaction model
    - Non-integer/out-of-range amount rejected; bad reference format rejected; duplicate reference rejected by unique index; invalid type/status rejected.
    - _Requirements: 5.2, 6.2, 7.4, 15.1_

- [x] 5. Implement cross-cutting middleware
  - [x] 5.1 Implement typed application errors and `src/middleware/errorMiddleware.js`
    - Define typed errors (`ValidationError` 400, `AuthenticationError` 401, `AuthorizationError` 403, `NotFoundError` 404, `ConflictError` 409, `RateLimitError` 429, `InsufficientFundsError` 400). Implement the terminal `(err, req, res, next)` handler mapping to statuses in `{400,401,403,404,409,429,500}`, returning `{ success:false, message }` with no `data`, no stack trace in the body, and sanitizing passwords/hashes/JWTs/secrets from body and logs; unknown errors → 500.
    - _Requirements: 13.2, 13.3, 13.4_

  - [x] 5.2 Write unit tests for the error handler
    - Each typed error maps to its status; body has no `data` field, no stack trace, no secret substrings; unknown error → 500. (Supports Property 21, Property 22.)
    - _Requirements: 13.2, 13.3, 13.4_

  - [x] 5.3 Implement `src/middleware/authMiddleware.js`
    - Read `Authorization: Bearer <token>`, verify with `JWT_SECRET`, resolve identity from the `sub` claim, set `req.user = { id, role }`, and call `next()`. Never read identity from body/query. Distinct 401s: missing token, expired token, malformed/invalid token.
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_

  - [x] 5.4 Implement `src/middleware/roleMiddleware.js`
    - Factory `requireRole('ADMIN')` running after `authMiddleware`; reject with 403 "insufficient privileges" when `req.user.role` is not the required role, before the controller runs.
    - _Requirements: 10.1, 12.2_

  - [x] 5.5 Implement `src/middleware/validate.js`
    - Middleware that executes supplied express-validator chains, checks `validationResult`, and short-circuits with 400 listing failed fields (never calling the controller) on error. Chains also sanitize (trim, normalize email, `toInt` on amounts).
    - _Requirements: 1.4, 2.3, 14.4, 14.5_

  - [x] 5.6 Implement `src/middleware/rateLimiter.js`
    - IP-based `express-rate-limit` of 5 requests per 15-minute window on auth endpoints → 429. Plus an email-keyed login throttle: 5 consecutive failed logins for the same normalized email within 300s triggers a 900s lockout returning 429, leaving the User record unchanged (process-local in-memory store, documented).
    - _Requirements: 2.4, 14.3_

  - [x] 5.7 Write unit/integration tests for auth and role middleware
    - **Property 13: Invalid or missing token rejected** — tokens missing/expired/bad-signature/garbage → 401 before handler, no state change (`fast-check`, ≥100 runs).
    - **Property 15: Admin authorization** — non-ADMIN tokens on admin routes → 403, no data (`fast-check`, ≥100 runs).
    - _Requirements: 3.2, 3.3, 3.4, 10.1, 11.3, 12.2_

  - [x] 5.8 Write tests for validate and rateLimiter middleware
    - Example tests: invalid payload → 400 and controller not called; auth IP limiter → 429 past the window; login lockout → 429 after 5 failures within 300s with User unchanged.
    - _Requirements: 2.4, 14.3, 14.4, 14.5_

- [x] 6. Checkpoint - foundations
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Implement the money-movement core (`bankService`)
  - [x] 7.1 Implement atomic primitives in `src/services/bankService.js`
    - `creditAtomic(accountId, amount, session?)` → `findOneAndUpdate({ _id, status:'Active' }, { $inc:{ balance: amount } }, { new:true })`; returns updated doc or null. `debitAtomic(accountId, amount, session?)` → `findOneAndUpdate({ _id, status:'Active', balance:{ $gte: amount } }, { $inc:{ balance:-amount } }, { new:true })`; null means insufficient/not-active and balance unchanged. Derive `balanceAfter` from the returned doc and `balanceBefore = balanceAfter ∓ amount`.
    - _Requirements: 5.1, 6.1, 6.3, 6.6, 15.2, 15.3, 15.4_

  - [x] 7.2 Implement `bankService.deposit(userId, amount)`
    - Resolve the user's account, call `creditAtomic`; on null (Frozen/Disabled) throw `AuthorizationError` (403) with no transaction; on persistence failure throw a 500-mapped error recording no COMPLETED transaction; on success create one COMPLETED CREDIT Transaction with unique reference and balanceBefore/After; return `{ account, transaction }`.
    - _Requirements: 5.1, 5.2, 5.4, 5.5, 12.5, 15.3_

  - [x] 7.3 Implement `bankService.withdraw(userId, amount)`
    - Resolve account, call `debitAtomic`; null → distinguish insufficient funds (`InsufficientFundsError` 400) from non-active (`AuthorizationError` 403) by re-reading status; on success create one COMPLETED DEBIT Transaction with unique reference and balanceBefore/After; return `{ account, transaction }`.
    - _Requirements: 6.1, 6.2, 6.3, 6.5, 6.6, 12.5, 15.3, 15.4_

  - [x] 7.4 Implement `bankService.transfer(userId, recipientAccountNumber, amount)`
    - Reject self-transfer (400) before opening a session. Start a session/ACID transaction; resolve sender (by userId) and recipient (by accountNumber) in-session; recipient missing → `NotFoundError` (404) + abort; sender/recipient not Active → `AuthorizationError` (403) + abort; `debitAtomic(sender)` null → `InsufficientFundsError` (400) + abort; then `creditAtomic(recipient)`; insert a DEBIT TRANSFER txn and a CREDIT TRANSFER txn (each with unique reference, balanceBefore/After, `relatedAccount` counterparty); commit. Any error after session begins → `abortTransaction()` leaving both balances unchanged. Fail closed if transactions are unavailable.
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.7, 7.8, 7.9, 7.10, 12.5, 15.3, 15.4_

  - [x] 7.5 Implement `bankService.listTransactions(userId, filters)` and `getTransactionForUser(userId, txnId)`
    - `listTransactions` applies ownership scope, descending `createdAt` order, pagination (default page 1 / limit 20; limit 1–100), and `type` / `startDate`-`endDate` / `search` (case-insensitive substring on description or reference) filters; returns `{ items, total, page, limit }`. `getTransactionForUser` returns the txn only if owned, else null (controller maps to 404).
    - _Requirements: 8.1, 8.2, 8.3, 8.5, 8.6, 8.8, 8.9, 8.10, 8.11_

  - [x] 7.6 Property test — ledger identity (Property 1)
    - **Property 1: Ledger balanceAfter identity** across random deposit/withdraw/transfer sequences.
    - **Validates: Requirements 5.2, 6.2, 7.4, 15.3** (`fast-check`, ≥100 runs)

  - [x] 7.7 Property test — deposit effect (Property 2)
    - **Property 2: Deposit effect** — balance increases by amount, exactly one COMPLETED CREDIT recorded.
    - **Validates: Requirements 5.1, 5.2** (`fast-check`, ≥100 runs)

  - [x] 7.8 Property test — withdrawal effect and non-negativity (Property 3)
    - **Property 3: Withdrawal effect and non-negativity** — balance decreases by amount, never negative, one COMPLETED DEBIT recorded.
    - **Validates: Requirements 6.1, 6.2, 15.3** (`fast-check`, ≥100 runs)

  - [x] 7.9 Property test — concurrency and double-spend safety (Property 4)
    - **Property 4: Concurrency and double-spend safety** — N concurrent debits via `Promise.all`; final balance ≥ 0 and sum of applied debits ≤ initial balance.
    - **Validates: Requirements 6.6, 15.2, 15.4** (`fast-check`, ≥100 runs)

  - [x] 7.10 Property test — transfer conserves money (Property 5)
    - **Property 5: Successful transfer conserves money** — sender −amount, recipient +amount, combined unchanged, two TRANSFER txns with `relatedAccount`.
    - **Validates: Requirements 7.1, 7.2, 7.3, 7.4** (`fast-check`, ≥100 runs)

  - [x] 7.11 Property test — failed transfer atomicity (Property 6)
    - **Property 6: Failed transfer atomicity** — failure injected after debit; both balances unchanged, no COMPLETED transfer persists.
    - **Validates: Requirements 7.5, 7.10, 15.6** (`fast-check`, ≥100 runs)

  - [x] 7.12 Property test — non-active accounts reject money movement (Property 7)
    - **Property 7: Non-active accounts reject money movement** — Frozen/Disabled × {deposit, withdraw, transfer} rejected, balances unchanged, no COMPLETED txn.
    - **Validates: Requirements 5.4, 6.5, 7.9, 12.5** (`fast-check`, ≥100 runs)

  - [x] 7.13 Property test — reference uniqueness (Property 8)
    - **Property 8: Transaction reference uniqueness** — all references match `TXN-[A-Z0-9]{8}` and are unique across the system.
    - **Validates: Requirements 5.2, 6.2, 7.4** (`fast-check`, ≥100 runs)

  - [x] 7.14 Property test — invalid amount and insufficient funds (Properties 9, 10)
    - **Property 9: Invalid amount rejected without side effects** and **Property 10: Insufficient funds rejected without side effects** — amounts ≤0 / non-integer / >max and amount>balance rejected, balances unchanged.
    - **Validates: Requirements 5.3, 6.3, 6.4, 7.6, 7.10, 15.5, 15.6** (`fast-check`, ≥100 runs)

  - [x] 7.15 Property test — monetary integer-range invariant (Property 11)
    - **Property 11: Monetary values are integers within range** — after random op sequences every stored balance ∈ `[0, 9_999_999_999_999]` and every amount ∈ `[1, 999_999_999_999]`, all `Number.isInteger`.
    - **Validates: Requirements 15.1** (`fast-check`, ≥100 runs)

  - [x] 7.16 Example tests for service edge cases
    - Deposit increment persistence failure → 500 and no COMPLETED txn (mock); empty history → 200 empty set, total 0.
    - _Requirements: 5.5, 8.9_

- [x] 8. Checkpoint - money-movement core
  - Ensure all tests pass, ask the user if questions arise.

- [x] 9. Implement auth flow (controller + routes)
  - [x] 9.1 Implement `src/controllers/authController.js`
    - `register`: inside a session transaction create the User then one linked Account (balance 0, GHS, Active, unique 10-digit number); abort both on failure → 500 "registration could not be completed"; duplicate email → 409; return 201 with safe user + account (no password/hash). `login`: re-select password, verify via `comparePassword`, issue JWT (`sub=userId`, exp 3600s), return safe payload; invalid credentials → generic 401. `me`: return authenticated profile (password omitted) + account overview.
    - _Requirements: 1.1, 1.2, 1.3, 1.5, 1.6, 2.1, 2.2, 4.1, 4.2_

  - [x] 9.2 Implement `src/routes/authRoutes.js`
    - `POST /api/auth/register` and `POST /api/auth/login` with `rateLimiter` + `validate(rules)`; `GET /api/auth/me` with `authMiddleware`. Define express-validator rule chains for register (all fields incl. age ≥ 18, digits-only phone) and login (email format/length, password 8–128).
    - _Requirements: 1.4, 2.3, 3.1, 14.3, 14.4_

  - [x] 9.3 Write integration tests for the auth flow
    - register → login → `/api/auth/me`: envelope correct, token exp 3600, duplicate email → 409, invalid fields → 400, invalid credentials → 401 (non-disclosing), registration rollback on account-create failure → 500 (mock).
    - _Requirements: 1.3, 1.4, 1.5, 1.6, 2.1, 2.2, 4.1, 4.2_

  - [x] 9.4 Property test — trusted identity (Property 12)
    - **Property 12: Trusted identity — client-supplied identity is ignored** — requests with spoofed userId/accountId/balance/role/email affect only the `req.user`-owned record.
    - **Validates: Requirements 3.1, 3.5, 3.6, 9.4** (`fast-check`, ≥100 runs)

- [x] 10. Implement account and profile endpoints (controller + routes)
  - [x] 10.1 Implement `src/controllers/accountController.js`
    - `getAccount`: return accountNumber, balance, currency, accountType, status for `req.user.id`; 404 if none. `getProfile`: user profile without password. `updateProfile`: update only `phone` and `address`; ignore `balance`, `accountNumber`, `role`, `email`.
    - _Requirements: 4.3, 4.4, 9.1, 9.2, 9.3, 9.4_

  - [x] 10.2 Implement `src/routes/accountRoutes.js` and `src/routes/userRoutes.js`
    - `GET /api/accounts/me` (auth) → getAccount; `GET /api/users/me` (auth) → getProfile; `PUT /api/users/me` (auth + validate) → updateProfile with validation chain (phone 7–20 chars of digits/`+ - space ( )`, address 1–255).
    - _Requirements: 4.3, 9.1, 9.3, 9.5_

  - [x] 10.3 Write integration tests for account and profile endpoints
    - Account overview 200 / 404-no-account; profile 200 without password / 401 without token; update changes only phone+address and ignores protected fields; invalid phone/address → 400 with no change.
    - _Requirements: 4.3, 4.4, 9.1, 9.2, 9.3, 9.4, 9.5_

- [x] 11. Implement transaction endpoints (controller + routes)
  - [x] 11.1 Implement `src/controllers/transactionController.js`
    - `deposit` → `bankService.deposit(req.user.id, amount)`; `withdraw` → `bankService.withdraw`; `transfer` → `bankService.transfer(req.user.id, recipientAccountNumber, amount)`; `list` → `bankService.listTransactions` with query filters; `getById` → `getTransactionForUser` returning 404 when unowned/nonexistent. Wrap results in the response envelope; map service errors to statuses via the error handler.
    - _Requirements: 5.1, 6.1, 7.1, 8.1, 8.10, 8.11_

  - [x] 11.2 Implement `src/routes/transactionRoutes.js`
    - `POST /deposit`, `POST /withdraw`, `POST /transfer` (auth + validate body: integer amount in range; transfer recipientAccountNumber 10 digits); `GET /` (auth + validate query: page/limit/type/startDate/endDate/search); `GET /:id` (auth). Mount under `/api/transactions`.
    - _Requirements: 5.3, 6.4, 7.6, 8.3, 8.4, 8.7, 14.4_

  - [x] 11.3 Write integration tests for transaction endpoints (status codes)
    - deposit → withdraw → history balances/ledger; frozen account deposit/withdraw → 403; insufficient funds → 400; self-transfer → 400; unknown recipient → 404; transfer conservation and both records; `getById` unowned → 404; invalid amount → 400.
    - _Requirements: 5.3, 5.4, 6.3, 6.5, 7.7, 7.8, 7.9, 7.10, 8.1, 8.11_

  - [x] 11.4 Property test — pagination correctness (Property 16)
    - **Property 16: Pagination correctness** over random dataset × valid page/limit; returned slice equals expected, with correct total/page/size and defaults.
    - **Validates: Requirements 8.2, 8.3, 10.2, 10.5, 10.6** (`fast-check`, ≥100 runs)

  - [x] 11.5 Property test — history filter soundness and completeness (Property 17)
    - **Property 17: History filter soundness and completeness** for type / date-range / search over owned data.
    - **Validates: Requirements 8.5, 8.6, 8.8** (`fast-check`, ≥100 runs)

  - [x] 11.6 Property test — data ownership isolation (Property 14)
    - **Property 14: Data ownership isolation** — per-user reads return only owned records; cross-user fetch → 403/404.
    - **Validates: Requirements 8.1, 8.11, 14.6, 14.7** (`fast-check`, ≥100 runs)

- [x] 12. Checkpoint - customer-facing API
  - Ensure all tests pass, ask the user if questions arise.

- [x] 13. Implement admin endpoints (controller + routes)
  - [x] 13.1 Implement `src/controllers/adminController.js`
    - `listCustomers` (deterministic order, default size 20, range 1–100, optional search ≤256 chars), `listAccounts` (with current balance), `listTransactions` (system-wide), `statistics` (aggregation pipeline computing Total Customers, Total Accounts, System_Liquidity = sum of balances, Total Deposits/Withdrawals/Transfers; zeros for empty collections; aggregation failure → error with no partial data), `updateAccountStatus` (set status Active/Frozen/Disabled; 404 if account id missing).
    - _Requirements: 10.2, 10.3, 10.5, 10.6, 11.1, 11.2, 11.4, 11.5, 12.1, 12.3_

  - [x] 13.2 Implement `src/routes/adminRoutes.js`
    - All routes behind `authMiddleware` + `requireRole('ADMIN')`: `GET /customers`, `GET /accounts`, `GET /transactions` (validate query pagination/search), `GET /statistics`, `PUT /accounts/:id/status` (validate status body). Mount under `/api/admin`.
    - _Requirements: 10.1, 10.4, 11.3, 12.2, 12.4_

  - [x] 13.3 Write integration tests for admin endpoints (incl. RBAC)
    - Non-admin on every admin route → 403 with no data; customers/accounts/transactions pagination + search; invalid pagination → 400; statistics shape; status update 200 and subsequent transaction on a frozen account rejected (R12.5); status update on unknown id → 404.
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 11.3, 12.2, 12.3, 12.5_

  - [x] 13.4 Property test — statistics aggregation correctness (Property 18)
    - **Property 18: Statistics aggregation correctness** — compare aggregation output to an independent JS computation over a random dataset.
    - **Validates: Requirements 11.1, 11.5** (`fast-check`, ≥100 runs)

  - [x] 13.5 Property test — status update determinism/idempotence and not-found (Properties 19, 20)
    - **Property 19: Account status update is deterministic and idempotent** and **Property 20: Resource-not-found handling** (nonexistent account id / recipient / unowned txn → 404).
    - **Validates: Requirements 7.8, 8.11, 12.1, 12.3** (`fast-check`, ≥100 runs)

- [x] 14. Assemble the application in `src/server.js`
  - [x] 14.1 Build and export the Express app
    - Apply `helmet`, `cors` with the configured allowlist, and the JSON body parser; mount `authRoutes`, `accountRoutes`, `userRoutes`, `transactionRoutes`, `adminRoutes`; attach `errorMiddleware` last; export the app for Supertest. Add a startup path that calls `connectDB()` then `listen(PORT)` only when run directly (not when imported by tests).
    - _Requirements: 13.1, 14.1, 14.2_

  - [x] 14.2 Write security and envelope integration tests
    - **Property 21: Response envelope consistency** and **Property 22: No secret leakage** scanned across endpoints (`fast-check`, ≥100 runs). Example checks: Helmet headers present on a sample of endpoints; CORS allows allowlisted origins and denies others.
    - **Validates: Requirements 13.1, 13.2, 13.3, 13.4, 14.1, 14.2, 14.8, 14.9**

- [x] 15. Implement seed script `seeds/seed.js`
  - Connect via `connectDB()`, clear/seed one ADMIN user and several CUSTOMER users each with a linked Account and sample integer-pesewa transactions; make it idempotent and runnable via the `seed` npm script.
  - _Requirements: 10.2, 11.1, 15.1_

- [ ] 16. Final wiring and verification
  - [x] 16.1 Wire and run the full suite
    - Ensure every route is mounted and reachable through the exported app; run the complete Jest suite against `mongodb-memory-server` in replica-set mode and confirm all property-based tests (Properties 1–22) and example/integration tests pass; fix any integration gaps.
    - _Requirements: 7, 13.1, 15.1_

  - [x] 16.2 Write README operational notes
    - Document single-node replica-set setup (`mongod --replSet rs0` + `rs.initiate()` or a preconfigured Docker image), required `.env` variables, and the run/seed/test commands; note that transfers fail closed if transactions are unavailable.
    - _Requirements: 7_

## Notes

- Tasks marked with `*` are optional (unit, property, and integration tests) and can be skipped for a faster MVP, but are strongly recommended given the monetary invariants.
- Each correctness property (Properties 1–22) is implemented by exactly one property-based test using `fast-check` with a minimum of 100 runs, tagged with the design property number and the requirement clauses it validates.
- Each task references specific requirement clauses for traceability.
- Checkpoints ensure incremental validation at natural layer boundaries.
- The test suite runs on `mongodb-memory-server` in single-node replica-set mode so transfer and registration transactions behave identically to production.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1"] },
    { "id": 1, "tasks": ["2.1", "2.2", "3.1", "3.2"] },
    { "id": 2, "tasks": ["2.3", "3.3", "3.4", "3.5", "4.1", "4.3", "4.5", "5.1"] },
    { "id": 3, "tasks": ["3.6", "4.2", "4.4", "4.6", "5.2", "5.3", "5.4", "5.5", "5.6"] },
    { "id": 4, "tasks": ["5.7", "5.8", "7.1"] },
    { "id": 5, "tasks": ["7.2", "7.3", "7.4", "7.5"] },
    { "id": 6, "tasks": ["7.6", "7.7", "7.8", "7.9", "7.10", "7.11", "7.12", "7.13", "7.14", "7.15", "7.16"] },
    { "id": 7, "tasks": ["9.1", "10.1", "11.1", "13.1"] },
    { "id": 8, "tasks": ["9.2", "10.2", "11.2", "13.2"] },
    { "id": 9, "tasks": ["9.3", "9.4", "10.3", "11.3", "11.4", "11.5", "11.6", "13.3", "13.4", "13.5"] },
    { "id": 10, "tasks": ["14.1"] },
    { "id": 11, "tasks": ["14.2", "15"] },
    { "id": 12, "tasks": ["16.1"] },
    { "id": 13, "tasks": ["16.2"] }
  ]
}
```
