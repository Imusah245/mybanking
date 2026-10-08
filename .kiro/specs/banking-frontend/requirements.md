# Requirements - Banking Frontend

## Introduction

This spec covers the web frontend for the MyBanking platform. The backend (banking-backend-api) is complete, tested, and FROZEN. The frontend adapts to the backend actual contract and must not require backend changes. It is a React + Vite + Tailwind single-page app with a customer area and an admin area consuming the backend REST API.

### Backend contract (authoritative)

- Base URL VITE_API_URL default http://localhost:5000; API routes under /api/*; health at GET /health.
- Auth is BEARER-TOKEN not cookies. login and register return data.token (a JWT). Client stores it and sends Authorization: Bearer <token>. Backend sets no cookies.
- Envelope: success is { success:true, message, data }; failure is { success:false, message }. Error statuses 400,401,403,404,409,429,500.
- Money is INTEGER PESEWAS (100 pesewas = 1 GHS, currency GHS). UI shows GHS and converts to/from pesewas.
- One login endpoint; admin is user.role === ADMIN. No separate admin-login or admin-creation endpoint; only the seeded admin exists.
- No server-side idempotency. Client sends a fresh Idempotency-Key header per money submit (forward-looking) and disables the submit button while pending.
- Endpoints: POST /api/auth/register, POST /api/auth/login, GET /api/auth/me; GET /api/accounts/me; GET /api/users/me, PUT /api/users/me (phone/address only); POST /api/transactions/{deposit,withdraw,transfer}, GET /api/transactions, GET /api/transactions/:id; GET /api/admin/{customers,accounts,transactions,statistics}, PUT /api/admin/accounts/:id/status (Active|Frozen|Disabled). Transaction type filter: CREDIT|DEBIT|TRANSFER.

## Requirements

### Requirement 1: Project foundation and API client

User Story: As a developer, I want a scaffolded React/Vite/Tailwind app with a configured API client and auth state, so pages build on a consistent foundation.

Acceptance Criteria:
1. WHEN set up THEN it SHALL use Vite + React + Tailwind + React Router and npm build SHALL succeed.
2. THE axios instance SHALL use baseURL from VITE_API_URL and attach Authorization: Bearer token from stored state.
3. WHEN a response is 401 THEN the client SHALL clear the stored token.
4. THE AuthContext SHALL expose user, account, token, loading, login, register, logout, refresh and hydrate from GET /api/auth/me when a token exists.
5. THE project SHALL include a .env.example documenting VITE_API_URL.
6. THE SYSTEM SHALL show success toasts and surface API error messages.

### Requirement 2: Layout and navigation

User Story: As a user, I want a professional banking layout.

Acceptance Criteria:
1. THE SYSTEM SHALL render a desktop sidebar and mobile navigation.
2. THE style SHALL be professional banking (not a basic CRUD look).
3. THE layout SHALL show signed-in context and a logout control.

### Requirement 3: Authentication pages

User Story: As a customer, I want to register and log in.

Acceptance Criteria:
1. /login and /register SHALL have client-side validation matching backend rules (email; password 8-128; register firstName/lastName 1-50, phone 10-15 digits, address 1-255, dateOfBirth age>=18).
2. WHEN auth succeeds THEN store token, navigate to /dashboard, show success toast.
3. WHEN auth fails THEN show backend error and do not navigate.
4. WHEN an unauthenticated user hits a protected route THEN redirect to /login preserving destination.

### Requirement 4: Customer dashboard and account

User Story: As a customer, I want a dashboard with my real data.

Acceptance Criteria:
1. THE dashboard SHALL show name, account number, account type, balance from live API data.
2. THE dashboard SHALL show recent transactions and totals for credits and debits (computed client-side).
3. THE /account page SHALL show account number, type, balance, status, currency.
4. THE SYSTEM SHALL show loading, error, and empty states.
5. Money SHALL display from integer pesewas formatted as GHS.

### Requirement 5: Money operations

User Story: As a customer, I want to deposit, withdraw, and transfer.

Acceptance Criteria:
1. /deposit, /withdraw, /transfer SHALL validate client-side; GHS amounts SHALL convert to integer pesewas before sending.
2. WHEN submitting a withdrawal or transfer THEN show a confirmation dialog first.
3. THE SYSTEM SHALL attach a fresh Idempotency-Key per submit AND disable the submit button while pending.
4. WHEN an operation succeeds THEN show a success toast and refresh account/balance.
5. WHEN it fails (insufficient 400, inactive 403, unknown recipient 404) THEN show the backend message and leave state unchanged.
6. THE transfer form SHALL require a 10-digit recipient account number.

### Requirement 6: Transaction history

User Story: As a customer, I want to search and filter history.

Acceptance Criteria:
1. /transactions SHALL list newest-first with pagination (page, limit, totalPages).
2. THE SYSTEM SHALL provide text search, type filter (CREDIT|DEBIT|TRANSFER), and date range, sent as search/type/startDate/endDate.
3. THE SYSTEM SHALL show empty and loading states.

### Requirement 7: Profile

User Story: As a customer, I want to view and edit my profile.

Acceptance Criteria:
1. /profile SHALL display profile fields and allow editing phone and address only, validated to backend rules.
2. WHEN update succeeds THEN show success toast and reflect new values.

### Requirement 8: Admin area and role guard

User Story: As an admin, I want an admin area protected from customers.

Acceptance Criteria:
1. THE SYSTEM SHALL provide /admin/login, /admin/dashboard, /admin/customers, /admin/accounts, /admin/transactions.
2. /admin/login SHALL use POST /api/auth/login and grant admin access only when role === ADMIN.
3. WHEN a CUSTOMER visits /admin/* THEN redirect away (to /dashboard).
4. WHEN unauthenticated visits /admin/* THEN redirect to /admin/login.

### Requirement 9: Admin dashboard, tables, account control

User Story: As an admin, I want statistics, charts, and tables.

Acceptance Criteria:
1. THE admin dashboard SHALL show stat cards: Total Customers, Total Accounts, Total Deposits, Total Withdrawals, Total Transfers, Total Money Held from GET /api/admin/statistics.
2. THE admin dashboard SHALL render simple charts (recharts).
3. Customers, accounts, transactions pages SHALL render tables with search (where supported), pagination, and detail views.
4. THE accounts table SHALL activate/deactivate via PUT /api/admin/accounts/:id/status (Active/Disabled) with confirmation, refreshing on success.
5. Money SHALL display from integer pesewas as GHS.

### Requirement 10: Frontend tests

User Story: As a developer, I want automated frontend tests.

Acceptance Criteria:
1. THE SYSTEM SHALL include tests for: login validation, protected-route redirect, admin guard redirect for a customer, and one money form (validation + GHS->pesewas + submit disabled while pending).
2. THE test command SHALL run and pass.

### Requirement 11: End-to-end verification

User Story: As a stakeholder, I want full workflows verified against the running backend.

Acceptance Criteria:
1. WITH both servers running, the customer workflow (register, login, deposit, withdraw, transfer to the second seeded customer, history filters, profile edit, logout) SHALL complete without error.
2. WITH both servers running, the admin workflow (login, statistics, search, deactivate then reactivate an account) SHALL complete without error.
3. Database balances and transaction records SHALL match after each money step.
4. IF code cannot be executed THEN exact commands and expected output SHALL be documented instead of claiming success.

### Requirement 12: Security and deployment readiness

User Story: As an operator, I want the app secure and deployable.

Acceptance Criteria:
1. THE SYSTEM SHALL confirm no passwords/secrets appear in rendered responses, rate limits are active, and CORS is restricted via the backend allowlist.
2. Auth is token-based (no cookies); THE SYSTEM SHALL document token storage and the cross-domain CORS/Authorization model; cookie-flag guidance SHALL be marked not-applicable.
3. THE SYSTEM SHALL provide deployment notes for Render (platform PORT), Vercel, and MongoDB Atlas, and npm run build SHALL succeed.
4. THE SYSTEM SHALL ensure no secrets are committed (.gitignore covers .env, node_modules, dist).

### Requirement 13: Documentation and progress report

User Story: As a maintainer, I want complete docs and a final report.

Acceptance Criteria:
1. THE README SHALL include description, features, stack, structure, install, env vars, MongoDB/replica-set setup, run commands, API docs, seed and test instructions, deployment steps, and a clear warning that seed credentials are development-only and must be changed.
2. PROGRESS.md SHALL contain a final report: what works, test results, known limitations, and any backend fixes made.
