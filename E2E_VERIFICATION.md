# End-to-End Verification Guide — MyBanking

> **Important:** This is a **manual walkthrough guide**, not an automated test execution report. The commands, steps, and expected results below are documented so a human tester can follow them against the running system and confirm each behavior. No servers were started and no steps were executed as part of producing this document.
>
> If automated E2E testing were in scope (e.g. Cypress or Playwright), these same steps would be scripted. That is out of scope for this spec — see the note at the end.

---

## 1. Prerequisites

| Requirement        | Details                                                                                              |
| ------------------ | ---------------------------------------------------------------------------------------------------- |
| **Node.js**        | v18 or later                                                                                         |
| **MongoDB**        | A running **replica set** (required for multi-document transactions used by transfers and registration). See "MongoDB Replica Set Setup" below. |
| **Ports**          | 5000 (backend), 5173 (frontend Vite dev server)                                                      |
| **Browsers**       | Any modern browser (Chrome, Firefox, Edge, Safari)                                                   |

### 1.1 MongoDB Replica Set Setup

The backend requires a replica set for ACID transactions. A standalone `mongod` will cause transfers (and registration) to fail.

**Option A — Single-node replica set (local dev):**

```bash
# Start mongod with replica set name rs0
mongod --replSet rs0 --dbpath /data/db --port 27017

# In a separate terminal, initiate the replica set (one-time):
mongosh --eval "rs.initiate()"
```

**Option B — Docker single-node replica set:**

```bash
docker run -d --name mongo-rs \
  -p 27017:27017 \
  mongo:7 mongod --replSet rs0

# Wait a few seconds, then initiate:
docker exec mongo-rs mongosh --eval "rs.initiate()"
```

**Option C — MongoDB Atlas:**

Atlas clusters are replica sets by default. Use the connection string from Atlas as `MONGO_URI`.

---

## 2. Setup — Starting the System

### 2.1 Backend Setup

```bash
cd backend

# 1. Copy and configure environment
cp .env.example .env
# Edit .env and set:
#   MONGO_URI=mongodb://127.0.0.1:27017/mybanking?replicaSet=rs0
#   JWT_SECRET=change-me-to-a-long-random-secret
#   PORT=5000
#   CORS_ALLOWLIST=http://localhost:3000,http://localhost:5173

# 2. Install dependencies
npm install

# 3. Seed the database
npm run seed
```

**Expected seed output:**

```
[seed] connecting to MongoDB...
[seed] clearing existing User / Account / Transaction data...
[seed] creating admin + customers with linked accounts...
[seed] seeding sample transactions...

========== SEED COMPLETE ==========
Users created:        5
  admins:             1
  customers:          4
Accounts created:     5
Sample deposits:      1
Sample transfers:     1
Transaction records:  3

--- Admin ---
  email:          admin@mybanking.test
  account number: <10-digit number>
  role:           ADMIN

--- Customers ---
  kwame@mybanking.test         acct=<10-digit number> status=Active
  ama@mybanking.test           acct=<10-digit number> status=Active
  yaw@mybanking.test           acct=<10-digit number> status=Active
  akosua@mybanking.test        acct=<10-digit number> status=Frozen

--- Dev login credentials (DEVELOPMENT ONLY) ---
  ADMIN:    admin@mybanking.test / Admin123!
  CUSTOMER: kwame@mybanking.test / Password123!
  (all seeded customers share the same dev password)
===================================
```

> **Action:** Note the 10-digit account numbers printed for each customer. You will need Ama's account number for the transfer step. If the sample transfer was skipped (no replica set), you will see a `Note:` line explaining that.

```bash
# 4. Start the backend server
npm start
```

**Expected output:**

```
[server] listening on port 5000
```

**Verify health:**

```bash
curl http://localhost:5000/health
```

**Expected response:**

```json
{ "status": "ok" }
```

### 2.2 Frontend Setup

Open a **second terminal**:

```bash
cd frontend

# 1. Copy and configure environment
cp .env.example .env
# Edit .env and set (or confirm):
#   VITE_API_URL=http://localhost:5000

# 2. Install dependencies
npm install

# 3. Start the Vite dev server
npm run dev
```

**Expected output (approximate):**

```
  VITE v6.x.x  ready in XXXms

  ➜  Local:   http://localhost:5173/
  ➜  Network: use --host to expose
```

---

## 3. Customer Workflow (Manual Walkthrough)

### Step 1 — Landing Page

**Action:** Open `http://localhost:5173` in a browser.

**Expected:** The landing page loads with a professional banking design. There are visible links/buttons to **Login** and **Register** (or "Get Started"). No errors in the browser console.

---

### Step 2 — Register a New Customer

**Action:** Click **Register** (or navigate to `http://localhost:5173/register`). Fill in the form with:

| Field           | Value                  |
| --------------- | ---------------------- |
| First Name      | `Test`                 |
| Last Name       | `User`                 |
| Email           | `testuser@example.com` |
| Password        | `TestPass123!`         |
| Phone           | `0241234567`           |
| Date of Birth   | `1990-01-01`           |
| Address         | `1 Test St`            |

Click **Submit / Register**.

**Expected:**
- The form validates client-side (no inline errors).
- A POST request is sent to `POST /api/auth/register` with the form data (password in plaintext over HTTPS; money fields are not relevant here).
- On success: a **success toast** appears (e.g. "Registration successful"), the browser redirects to `/dashboard`, and the user is now authenticated.
- The dashboard displays:
  - Name: **Test User**
  - Account Number: a **10-digit number** (newly assigned)
  - Account Type: **Savings**
  - Balance: **GHS 0.00**
  - Recent transactions: empty or "No transactions yet"

**If registration fails:** Check the browser console and network tab. Common causes:
- MongoDB not running or not a replica set (registration uses a transaction).
- Backend CORS_ALLOWLIST does not include `http://localhost:5173`.
- Duplicate email (if the user was already registered).

---

### Step 3 — Deposit GHS 100.00

**Action:** Navigate to `/deposit` (via sidebar or URL).

**Expected:** A deposit form with a GHS amount input field.

**Action:** Enter `100.00` (or `100`) in the amount field. Click **Submit / Deposit**.

**Expected:**
- The frontend converts GHS 100.00 → **10000 pesewas** and sends `POST /api/transactions/deposit` with `{ "amount": 10000 }`.
- An `Idempotency-Key` header is included (UUID, forward-looking — not enforced server-side).
- The submit button is **disabled** while the request is in flight.
- On success: a **success toast** appears (e.g. "Deposit successful").
- Balance updates to **GHS 100.00** (visible on dashboard or reflected on the deposit page).

---

### Step 4 — Withdraw GHS 25.00

**Action:** Navigate to `/withdraw` (via sidebar or URL). Enter `25.00` in the amount field. Click **Submit / Withdraw**.

**Expected:**
- A **confirmation dialog** appears showing the withdrawal amount (GHS 25.00). 
- Click **Confirm**.
- The frontend sends `POST /api/transactions/withdraw` with `{ "amount": 2500 }`.
- Submit button is disabled while pending.
- On success: **success toast** appears.
- Balance updates to **GHS 75.00**.

---

### Step 5 — Transfer GHS 10.00 to Ama

**Action:** Navigate to `/transfer`. Fill in:

| Field                    | Value                                         |
| ------------------------ | --------------------------------------------- |
| Recipient Account Number | *(Ama's 10-digit account number from seed output)* |
| Amount                   | `10.00`                                       |

Click **Submit / Transfer**.

**Expected:**
- A **confirmation dialog** appears showing the recipient account number and amount (GHS 10.00).
- Click **Confirm**.
- The frontend sends `POST /api/transactions/transfer` with `{ "recipientAccountNumber": "<ama-acct>", "amount": 1000 }`.
- Submit button is disabled while pending.
- On success: **success toast** appears.
- Balance updates to **GHS 65.00**.

**Error cases to be aware of:**
- If you enter the test user's own account number → error toast: "Self-transfer is not permitted" (400).
- If the recipient account number doesn't exist → error toast: "Recipient account not found" (404).
- If Ama's account were Frozen/Disabled → error toast: "Recipient account is not active" (403).

---

### Step 6 — Transaction History

**Action:** Navigate to `/transactions`.

**Expected:**
- A table showing **3 transactions**, newest first:
  1. **TRANSFER** — GHS 10.00 (debit)
  2. **DEBIT** — GHS 25.00 (withdrawal)
  3. **CREDIT** — GHS 100.00 (deposit)
- Each row shows: type, amount, reference, date, and description.
- Pagination metadata visible (page 1 of 1, total 3).

**Filter tests:**

| Filter                          | Expected Result                                      |
| ------------------------------- | ---------------------------------------------------- |
| Type = **CREDIT**               | Shows only the deposit (1 row)                       |
| Type = **DEBIT**                | Shows only the withdrawal (1 row)                    |
| Type = **TRANSFER**             | Shows only the transfer (1 row)                      |
| Search = *(reference string)*   | Shows only the transaction matching that reference    |
| Date range = today              | Shows all 3 transactions (all created today)         |
| Date range = yesterday only     | Shows 0 transactions / empty state                   |

**Action:** Clear all filters. Confirm all 3 transactions are visible again.

---

### Step 7 — Profile View and Edit

**Action:** Navigate to `/profile`.

**Expected:** Profile details displayed:
- Name: Test User
- Email: testuser@example.com
- Phone: 0241234567
- Address: 1 Test St
- Date of Birth: 1990-01-01

**Action:** Change phone to `0550000000`. Click **Save / Update**.

**Expected:**
- Client-side validation passes (10 digits).
- `PUT /api/users/me` is sent with `{ "phone": "0550000000" }`.
- A **success toast** appears (e.g. "Profile updated").
- The phone field now shows **0550000000**.

---

### Step 8 — Logout

**Action:** Click **Logout** (in the topbar or sidebar).

**Expected:**
- The token is removed from localStorage.
- The browser redirects to `/login`.
- Attempting to visit `/dashboard` directly redirects back to `/login`.

---

### Customer Workflow — Expected Database State

After completing steps 1–8, the database should contain:

**Test User account:**
- Balance: **6500 pesewas** (GHS 65.00)
- Transactions: 3 records
  - CREDIT: +10000 pesewas (deposit), balanceBefore=0, balanceAfter=10000
  - DEBIT: -2500 pesewas (withdrawal), balanceBefore=10000, balanceAfter=7500
  - TRANSFER (debit leg): -1000 pesewas, balanceBefore=7500, balanceAfter=6500, relatedAccount=Ama's account

**Ama's account:**
- Balance: **50000 + 1000 = 51000 pesewas** (GHS 510.00) — her seeded GHS 500.00 plus the GHS 10.00 transfer received.
- Transactions: includes a TRANSFER (credit leg) of +1000 pesewas from the test user.

> **Note:** Ama may also have 1 additional transaction from the seed (if the sample transfer succeeded during seeding). Her seed balance starts at 50000 pesewas (GHS 500.00), and if the seed transfer (GHS 75 from Kwame) succeeded, she starts at 57500 pesewas. Adjust expected values accordingly based on seed output.

---

## 4. Admin Workflow (Manual Walkthrough)

### Step 1 — Admin Login

**Action:** Navigate to `http://localhost:5173/admin/login`. Enter:

| Field    | Value                   |
| -------- | ----------------------- |
| Email    | `admin@mybanking.test`  |
| Password | `Admin123!`             |

Click **Login**.

**Expected:**
- `POST /api/auth/login` is sent with the credentials.
- The backend returns a JWT and `user.role === "ADMIN"`.
- The frontend confirms the admin role and redirects to `/admin/dashboard`.
- If a non-admin logs in via `/admin/login`, an error is shown (e.g. "Access denied — admin only") and no redirect to the admin area occurs.

---

### Step 2 — Admin Dashboard

**Action:** Observe the admin dashboard at `/admin/dashboard`.

**Expected:**
- **Six stat cards** from `GET /api/admin/statistics`:
  - Total Customers (5 after registration — the 4 seeded + testuser)
  - Total Accounts (5)
  - Total Deposits (count)
  - Total Withdrawals (count)
  - Total Transfers (count)
  - Total Money Held / System Liquidity (formatted as GHS)
- **Charts** (recharts): bar or pie chart visualizing transaction type distribution and/or system liquidity.
- Numbers reflect the seeded data plus the test user's activity from the customer walkthrough.

---

### Step 3 — Admin Customers

**Action:** Navigate to `/admin/customers`.

**Expected:** A paginated table of all customers (4 seeded + testuser if registered).

**Action:** Use the search box, type `testuser` or `Test`.

**Expected:** The table filters to show the test user (Test User, testuser@example.com). Click the row for detail view — profile info is displayed.

---

### Step 4 — Admin Accounts — Deactivate

**Action:** Navigate to `/admin/accounts`.

**Expected:** A paginated table of all accounts, each showing account number, balance (GHS), status badge (Active/Frozen/Disabled), and activate/deactivate controls.

**Action:** Find the test user's account. Click **Deactivate** (or a similar control).

**Expected:**
- A **confirmation dialog** appears: "Are you sure you want to deactivate this account?" (or similar).
- Click **Confirm**.
- `PUT /api/admin/accounts/<accountId>/status` is sent with `{ "status": "Disabled" }`.
- On success: the status badge changes from **Active** to **Disabled**.
- A success toast appears.

---

### Step 5 — Verify: Deactivated Account Cannot Transact

**Action:** In a separate browser tab or incognito window, log in as the test user (`testuser@example.com` / `TestPass123!`). Navigate to `/deposit`. Attempt to deposit GHS 10.00.

**Expected:**
- The `POST /api/transactions/deposit` returns **403** with message: "Account is not active; deposits are not permitted".
- The frontend shows an **error toast** with the message.
- Balance remains **GHS 65.00** — no change.

---

### Step 6 — Admin Accounts — Reactivate

**Action:** Return to the admin tab. On the same test user account, click **Activate**.

**Expected:**
- A **confirmation dialog** appears.
- Click **Confirm**.
- `PUT /api/admin/accounts/<accountId>/status` is sent with `{ "status": "Active" }`.
- The status badge changes back to **Active**.
- Success toast appears.

**Optional verification:** Go back to the customer tab and try a deposit — it should succeed again now.

---

### Step 7 — Admin Transactions

**Action:** Navigate to `/admin/transactions`.

**Expected:**
- A paginated table showing **all transactions in the system** (not scoped to one user).
- Includes the seeded sample transactions plus the test user's 3 transactions.
- Each row shows: type (CREDIT/DEBIT/TRANSFER), amount (GHS), reference, date, account info.
- Pagination works if there are more transactions than the page limit.

---

### Step 8 — Admin Logout

**Action:** Click **Logout** in the admin topbar.

**Expected:**
- Token cleared from localStorage.
- Redirected to `/admin/login`.
- Attempting to visit `/admin/dashboard` redirects to `/admin/login`.

---

## 5. Database Verification (mongosh)

After completing both workflows, you can verify the database state directly using `mongosh`:

```bash
mongosh "mongodb://127.0.0.1:27017/mybanking?replicaSet=rs0"
```

### 5.1 Check Test User Balance

```javascript
// Find the test user
const user = db.users.findOne({ email: "testuser@example.com" });
user;
// Expected: { firstName: "Test", lastName: "User", role: "CUSTOMER", ... }

// Find their account
const account = db.accounts.findOne({ userId: user._id });
account;
// Expected: { balance: 6500, status: "Active", currency: "GHS", accountType: "Savings", ... }
// balance = 6500 pesewas = GHS 65.00
```

### 5.2 Check Test User Transactions

```javascript
db.transactions.find({ userId: user._id }).sort({ createdAt: -1 }).pretty();
// Expected: 3 documents
// 1. { type: "TRANSFER", amount: 1000, balanceBefore: 7500, balanceAfter: 6500, ... }
// 2. { type: "DEBIT",    amount: 2500, balanceBefore: 10000, balanceAfter: 7500, ... }
// 3. { type: "CREDIT",   amount: 10000, balanceBefore: 0,    balanceAfter: 10000, ... }
```

### 5.3 Check Ama's Balance After Transfer

```javascript
const ama = db.users.findOne({ email: "ama@mybanking.test" });
const amaAcct = db.accounts.findOne({ userId: ama._id });
amaAcct.balance;
// Expected: 51000 pesewas (GHS 510.00) — seeded GHS 500 + GHS 10 transfer
// Note: If the seed transfer (GHS 75 from Kwame) also succeeded,
// her balance would be: 50000 + 7500 + 1000 = 58500 pesewas (GHS 585.00)
```

### 5.4 Verify Ledger Identity

For every transaction, the following invariant must hold:

```javascript
db.transactions.find().forEach(txn => {
  const expected = txn.balanceBefore + (
    txn.type === "DEBIT" ? -txn.amount :
    txn.type === "CREDIT" ? txn.amount :
    // TRANSFER: check the effect direction
    (txn.balanceAfter > txn.balanceBefore ? txn.amount : -txn.amount)
  );
  if (expected !== txn.balanceAfter) {
    print(`INVARIANT VIOLATION: ${txn.reference} — expected ${expected}, got ${txn.balanceAfter}`);
  }
});
// Expected: No output (no violations)
```

### 5.5 Count System-Wide Records

```javascript
db.users.countDocuments();
// Expected: 5 (1 admin + 4 seeded customers) — or 6 if testuser was registered

db.accounts.countDocuments();
// Expected: same as users count

db.transactions.countDocuments();
// Expected: seeded transactions (1 deposit + 2 transfer legs if replica set, or just 1 deposit)
//   + 3 from testuser (deposit, withdrawal, transfer debit leg)
//   + 1 credit leg on Ama's side from the transfer
//   Total varies based on whether the seed transfer succeeded.
```

---

## 6. Edge Cases Worth Testing Manually

| Scenario                                     | How to Test                                                      | Expected Result                                                     |
| -------------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------- |
| Withdraw more than balance                   | Withdraw GHS 999.00 with only GHS 65.00 balance                 | 400 error: "Insufficient funds for this withdrawal"                 |
| Transfer to self                             | Enter your own account number in the transfer form               | 400 error: "Self-transfer is not permitted"                         |
| Transfer to non-existent account             | Enter `0000000000` as recipient                                  | 404 error: "Recipient account not found"                            |
| Deposit/withdraw on frozen account           | Admin freezes account; customer tries to deposit                 | 403 error: "Account is not active; deposits are not permitted"      |
| Invalid email on login                       | Enter `notanemail` in the email field                            | Client-side validation error (no API call made)                     |
| Short password on register                   | Enter a 3-character password                                     | Client-side validation error: password must be 8-128 characters     |
| Under-18 date of birth on register           | Enter DOB = 2015-01-01                                           | Client-side validation error: must be at least 18 years old         |
| Protected route without login                | Clear localStorage, navigate to `/dashboard`                     | Redirect to `/login`                                                |
| Customer accessing admin route               | Log in as customer, navigate to `/admin/dashboard`               | Redirect to `/dashboard` (not admin)                                |
| Unauthenticated accessing admin route        | Clear localStorage, navigate to `/admin/dashboard`               | Redirect to `/admin/login`                                          |
| Rate limiting                                | Rapidly send 100+ login attempts                                 | 429 "Too many requests" response from backend rate limiter          |

---

## 7. API Quick-Reference for Manual Testing (curl)

These curl commands can be used to verify backend behavior independently of the frontend.

### Register

```bash
curl -X POST http://localhost:5000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "firstName": "Curl",
    "lastName": "Tester",
    "email": "curl@example.com",
    "password": "CurlPass123!",
    "phone": "0241112233",
    "dateOfBirth": "1990-06-15",
    "address": "99 Curl Lane"
  }'
```

### Login

```bash
curl -X POST http://localhost:5000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{ "email": "kwame@mybanking.test", "password": "Password123!" }'
# Save the returned token for subsequent requests
```

### Deposit (with token)

```bash
TOKEN="<paste-jwt-here>"
curl -X POST http://localhost:5000/api/transactions/deposit \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Idempotency-Key: $(uuidgen)" \
  -d '{ "amount": 10000 }'
```

### Get Transactions

```bash
curl http://localhost:5000/api/transactions?page=1&limit=20&type=CREDIT \
  -H "Authorization: Bearer $TOKEN"
```

### Admin Statistics

```bash
ADMIN_TOKEN="<admin-jwt>"
curl http://localhost:5000/api/admin/statistics \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

---

## 8. Note on Automated vs. Manual Testing

This document is a **manual walkthrough guide**. Every step, command, and expected result is documented so a human tester can:

1. Start both servers following the exact commands above.
2. Walk through each step in a browser.
3. Verify that the observed behavior matches the expected results.
4. Optionally check the database state using the provided mongosh queries.

**Why not automated E2E tests?**

Automated browser testing with tools like Cypress or Playwright is out of scope for this spec. The frontend spec (Requirement 10) covers unit/integration tests via Vitest + React Testing Library. A full browser automation suite would require:

- An additional dependency (Cypress, Playwright, or similar)
- A test database management strategy (seed before, tear down after)
- CI pipeline integration
- Significantly more development time

The manual walkthrough above covers all user flows specified in Requirements 11.1 through 11.4 and serves as the verification plan until automated E2E testing is added.

**Per Requirement 11.4:** Since these commands and steps were not executed in the development environment, this document provides the exact commands and expected output as a documented verification plan. No claim of execution is made.
