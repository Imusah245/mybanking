# MyBanking Backend API

Node.js + Express + MongoDB banking API with integer-pesewa money, atomic transfers, JWT authentication, and role-based admin access.

## Features

- **Register / Login** — bcrypt password hashing, JWT issuance, per-email login throttle.
- **Deposit / Withdraw / Transfer** — all money operations use integer pesewas and atomic `$inc` with MongoDB sessions for ACID guarantees.
- **Transaction History** — filtering by type (CREDIT / DEBIT / TRANSFER), date range, text search, and pagination (newest-first).
- **Admin Statistics + Account Management** — aggregate stats (customers, accounts, totals), paginated customer/account/transaction listings, and account status control (Active / Frozen / Disabled).
- **Property-Based Testing** — 11 monetary invariants verified with fast-check across hundreds of random inputs per property.

## Tech Stack

| Layer          | Technology                                                        |
| -------------- | ----------------------------------------------------------------- |
| Runtime        | Node.js (>= 18, ESM)                                             |
| Framework      | Express 4                                                         |
| Database       | MongoDB replica set, Mongoose 8                                   |
| Auth           | JWT (jsonwebtoken), bcryptjs                                      |
| Security       | helmet, cors (allowlist), express-rate-limit                      |
| Validation     | express-validator                                                 |
| Tests          | Jest 29, Supertest 7, fast-check 3, mongodb-memory-server 10     |

## Project Structure

```
backend/
├── package.json
├── jest.config.js
├── .env.example
├── .gitignore
├── seeds/
│   └── seed.js                # Reset seed — admin + customers + sample txns
└── src/
    ├── server.js              # Entry — connectDB + listen
    ├── app.js                 # Express assembly (helmet, CORS, routes, error MW)
    ├── config/
    │   ├── db.js              # Mongoose connect / disconnect
    │   └── env.js             # Validated env vars with defaults
    ├── controllers/
    │   ├── authController.js      # register, login, me
    │   ├── accountController.js   # getAccount, getProfile, updateProfile
    │   ├── transactionController.js # deposit, withdraw, transfer, list, getById
    │   └── adminController.js     # listCustomers/Accounts/Transactions, statistics, updateAccountStatus
    ├── middleware/
    │   ├── authMiddleware.js  # JWT verification → req.user
    │   ├── roleMiddleware.js  # requireAdmin RBAC gate (403)
    │   ├── validate.js        # express-validator runner (400 on failure)
    │   ├── rateLimiter.js     # IP-based auth limiter + per-email login throttle
    │   └── errorMiddleware.js # Central error handler → { success, message }
    ├── models/
    │   ├── User.js            # firstName, lastName, email, phone, dateOfBirth, address, password, role
    │   ├── Account.js         # userId, accountNumber, accountType, balance (int pesewas), currency, status
    │   └── Transaction.js     # userId, accountId, type, amount (int pesewas), balance, description, reference
    ├── routes/
    │   ├── authRoutes.js      # /api/auth — register, login, me
    │   ├── userRoutes.js      # /api/users — profile get/update
    │   ├── accountRoutes.js   # /api/accounts — account overview
    │   ├── transactionRoutes.js # /api/transactions — money ops + history
    │   └── adminRoutes.js     # /api/admin — admin endpoints
    ├── services/
    │   └── bankService.js     # Core money-movement logic (deposit, withdraw, transfer, listTransactions, getTransactionById, statistics)
    └── utils/
        ├── errors.js          # Custom error classes (NotFoundError, ForbiddenError, etc.)
        ├── formatters.js      # Safe-profile formatter (strips password)
        ├── generateAccountNumber.js  # Unique 10-digit account number generator
        ├── generateReference.js      # Unique transaction reference generator
        └── response.js        # Standardized { success, message, data } envelope
```

## Prerequisites

- **Node.js >= 18**
- **MongoDB replica set** — required for multi-document ACID transactions (transfers, registration).

## Install

```bash
cd backend
npm install
```

## Environment Variables

Copy `.env.example` to `.env` and configure:

```env
# MongoDB connection string — must be a replica set.
MONGO_URI=mongodb://127.0.0.1:27017/mybanking?replicaSet=rs0

# JWT signing secret. Required. Never commit the real value.
JWT_SECRET=change-me-to-a-long-random-secret

# JWT lifetime in seconds (default: 3600 = 1 hour).
JWT_EXPIRES_IN=3600

# HTTP server port.
PORT=5000

# Comma-separated CORS allowed origins.
CORS_ALLOWLIST=http://localhost:3000,http://localhost:5173

# bcrypt cost factor.
BCRYPT_ROUNDS=12
```

## MongoDB Replica Set Setup

Transfers and registration use MongoDB multi-document transactions, which require a replica set.

### Local Single-Node Replica Set

```bash
mongod --replSet rs0 --dbpath /data/db
```

Then in `mongosh`:

```javascript
rs.initiate()
```

### Docker (single-node replica set)

```bash
docker run -d --name mongo-rs \
  -p 27017:27017 \
  mongo:7 --replSet rs0

docker exec mongo-rs mongosh --eval "rs.initiate()"
```

### MongoDB Atlas

Atlas clusters are replica sets by default. Use the provided connection string as `MONGO_URI`.

## Run

### Start the server

```bash
npm start          # production
npm run dev        # development (--watch mode)
```

### Seed the database

```bash
npm run seed
```

Seeds an admin user, 4 customers, linked accounts, and sample transactions. Prints dev login credentials on completion.

### Run tests

```bash
npm test
```

Currently **33 test suites / 404 tests**, all passing. Tests use `mongodb-memory-server` — no running MongoDB instance required.

## API Endpoints

### Auth (`/api/auth`)

| Method | Path                | Auth | Description                        |
| ------ | ------------------- | ---- | ---------------------------------- |
| POST   | `/api/auth/register` | —    | Register a new customer            |
| POST   | `/api/auth/login`    | —    | Login (returns JWT)                |
| GET    | `/api/auth/me`       | JWT  | Get authenticated user + account   |

### Accounts (`/api/accounts`)

| Method | Path                | Auth | Description                        |
| ------ | ------------------- | ---- | ---------------------------------- |
| GET    | `/api/accounts/me`   | JWT  | Get the user's account overview    |

### Users / Profile (`/api/users`)

| Method | Path               | Auth | Description                             |
| ------ | ------------------ | ---- | --------------------------------------- |
| GET    | `/api/users/me`    | JWT  | Get the user's safe profile             |
| PUT    | `/api/users/me`    | JWT  | Update phone and/or address only        |

### Transactions (`/api/transactions`)

| Method | Path                             | Auth | Description                                   |
| ------ | -------------------------------- | ---- | --------------------------------------------- |
| POST   | `/api/transactions/deposit`      | JWT  | Deposit (CREDIT) — integer pesewas            |
| POST   | `/api/transactions/withdraw`     | JWT  | Withdraw (DEBIT) — integer pesewas            |
| POST   | `/api/transactions/transfer`     | JWT  | Transfer to another account — integer pesewas |
| GET    | `/api/transactions`              | JWT  | List user's transactions (paginated, filterable) |
| GET    | `/api/transactions/:id`          | JWT  | Get a single transaction by ID (owned only)   |

**Transaction query parameters:** `page`, `limit`, `type` (CREDIT/DEBIT/TRANSFER), `startDate`, `endDate`, `search`.

### Admin (`/api/admin`) — all routes require ADMIN role

| Method | Path                              | Auth       | Description                             |
| ------ | --------------------------------- | ---------- | --------------------------------------- |
| GET    | `/api/admin/customers`            | JWT + ADMIN | Paginated customer list (with search)   |
| GET    | `/api/admin/accounts`             | JWT + ADMIN | Paginated account list                  |
| GET    | `/api/admin/transactions`         | JWT + ADMIN | Paginated system-wide transaction list  |
| GET    | `/api/admin/statistics`           | JWT + ADMIN | Aggregate statistics                    |
| PUT    | `/api/admin/accounts/:id/status`  | JWT + ADMIN | Set account status (Active/Frozen/Disabled) |

### Health Check

| Method | Path      | Auth | Description            |
| ------ | --------- | ---- | ---------------------- |
| GET    | `/health` | —    | Returns `{ status: "ok" }` |

### Response Envelope

All responses use a standardized envelope:

```json
// Success
{ "success": true, "message": "...", "data": { ... } }

// Error
{ "success": false, "message": "..." }
```

## Seed & Test Instructions

### Seed

```bash
npm run seed
```

This is a **reset seed** — it clears all User, Account, and Transaction documents, then recreates:

- 1 ADMIN user (Ada Admin)
- 4 CUSTOMER users (Kwame, Ama, Yaw, Akosua — one account frozen)
- Sample deposit + transfer transactions (transfer requires a replica set)

### Tests

```bash
npm test
```

Runs **33 test suites / 404 tests** covering:

- Config and environment validation
- Models (User, Account, Transaction — schema, validation, hooks)
- Middleware (auth, RBAC, validation, rate limiting, error handling)
- Service layer (bankService — deposit, withdraw, transfer, history, statistics)
- Route integration tests (auth, accounts, users, transactions, admin)
- 17 property-based test suites (fast-check) verifying 11 monetary invariants:
  - Deposit balance correctness
  - Withdraw balance + insufficient-funds guard
  - Transfer atomicity and money conservation
  - Reference uniqueness
  - Ownership isolation
  - Non-active account rejection
  - Pagination correctness
  - History filter correctness
  - Statistics aggregation
  - Trusted-identity (JWT-only auth)
  - Admin status-update correctness
  - Integer-range enforcement
  - Concurrency / double-spend resistance
  - Invalid-amount / insufficient-funds rejection
  - Ledger identity

## Deployment

### Render (recommended for the backend)

1. Create a Web Service pointing at the `backend/` directory.
2. **Build command:** `npm install`
3. **Start command:** `npm start`
4. Set environment variables: `MONGO_URI`, `JWT_SECRET`, `JWT_EXPIRES_IN`, `PORT` (Render provides this), `CORS_ALLOWLIST` (include the frontend origin), `BCRYPT_ROUNDS`.
5. The server honors `process.env.PORT` automatically.

### MongoDB Atlas

Use Atlas as your replica set (required for transactions). Set `MONGO_URI` to the Atlas connection string.

### CORS

Ensure `CORS_ALLOWLIST` includes every frontend origin that should access the API. Auth uses Bearer tokens in the `Authorization` header, so no cookie configuration is needed.

## ⚠️ WARNING: Seed Credentials Are Development-Only

| Role     | Email                     | Password      |
| -------- | ------------------------- | ------------- |
| Admin    | admin@mybanking.test      | Admin123!     |
| Customer | kwame@mybanking.test      | Password123!  |

**These credentials exist only for local development. They MUST be changed or removed before any production deployment.** All seeded customers share the same password (`Password123!`).
