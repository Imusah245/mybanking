# MyBanking — Final Project Report

## Project Summary

MyBanking is a full-stack banking application consisting of a Node.js/Express/MongoDB backend and a React/Vite/Tailwind frontend. It implements an **integer-pesewa money model** (100 pesewas = 1 GHS), **ACID transfers** backed by MongoDB multi-document transactions, **JWT authentication**, **role-based admin access**, and a **professional banking UI** across a customer area and an admin area.

The two codebases live under one repository:

- `backend/` — the REST API (complete, tested, frozen).
- `frontend/` — the React SPA that consumes it (complete, tested).

---

## Backend Status: ✅ COMPLETE

- **33 test suites / 404 tests passing.**
- **All 11 monetary property invariants verified** via fast-check property-based testing.

### Coverage

- **Config** — environment validation (`env.js`) with sensible defaults, Mongoose connect/disconnect (`db.js`).
- **Models** — `User` (with bcrypt pre-save hashing), `Account` (integer-pesewa balance, status enum), `Transaction` (CREDIT/DEBIT/TRANSFER ledger records).
- **Middleware** — JWT auth (`authMiddleware`), RBAC gate (`roleMiddleware.requireAdmin`), express-validator runner (`validate`), IP-based auth rate limiter + per-email login throttle (`rateLimiter`), central error handler (`errorMiddleware`).
- **Atomic money-movement core** (`bankService`) — deposit / withdraw / transfer using conditional `$inc` with MongoDB sessions, guaranteeing balance correctness and transfer atomicity.
- **REST API** — auth, accounts, users, transactions, and admin surfaces, each with validation and ownership isolation.
- **App assembly** (`app.js`) — helmet security headers, CORS allowlist, bounded JSON body parser, health check, feature routers, 404 handling, terminal error middleware.
- **Seed script** — reset seed producing an admin, 4 customers, linked accounts, and sample transactions through the real service layer.

---

## Frontend Status: ✅ COMPLETE

- **4 test suites / 15 tests passing.**
- **Build succeeds** (746 modules transformed, output in `dist/`).

### Coverage

- **Scaffold** — Vite + React 18 + Tailwind CSS v3 + React Router v6.
- **API client** (`lib/api.js`) — shared axios instance with Bearer-token request interceptor, per-submit `Idempotency-Key` on transaction POSTs, and 401 handling that clears the stored token.
- **State** — `AuthContext` (user, account, token, loading, login, register, logout, refresh) and a toast system (`ToastContext` + Toast components).
- **Route guards** — `ProtectedRoute` (redirect to `/login` when unauthenticated) and `RoleRoute` (redirect non-admins away from `/admin/*`).
- **Layouts** — professional banking layouts with desktop sidebar + topbar and mobile navigation (`AppLayout`, `AdminLayout`, `Sidebar`, `Topbar`, `MobileNav`).
- **12 UI components** — Badge, Button, Card, ConfirmDialog, EmptyState, ErrorState, Input, MoneyAmount, Pagination, Spinner, StatCard, Table.
- **10 customer pages** — Landing, Login, Register, Dashboard, Account, Deposit, Withdraw, Transfer, Transactions, Profile (plus a NotFound page).
- **5 admin pages** — AdminLogin, AdminDashboard (with Recharts charts), AdminCustomers, AdminAccounts, AdminTransactions.
- **End-to-end verification guide** — documented customer and admin walkthrough steps with expected results.

---

## Backend Adaptations (documented in the frontend)

The frontend adapts to the frozen backend contract. These decisions shaped the UI:

1. **Bearer-token auth, not cookies.** The backend returns a JWT in the login/register body and reads `Authorization: Bearer <token>`. The frontend stores it in `localStorage` and attaches it via an interceptor. Cookie flows are not applicable.
2. **Idempotency-Key sent but not server-enforced.** The client generates a fresh `crypto.randomUUID()` per money submit (forward-looking); the real double-submit guard is disabling the submit button while a request is pending.
3. **Shared login endpoint with role check.** There is one `POST /api/auth/login`; admin access is granted only when `user.role === ADMIN`.
4. **GHS display from integer pesewas.** All money is handled as integer pesewas end-to-end and formatted to GHS only at the view layer.
5. **Activate/deactivate via the status endpoint.** Activate → `PUT status Active`; Deactivate → `PUT status Disabled`, each behind a confirmation dialog.
6. **Customer credit/debit totals computed client-side.** There is no aggregate endpoint for customers, so the dashboard derives totals from the fetched transaction list.

---

## Known Limitations

- **No server-side idempotency enforcement.** The `Idempotency-Key` header is sent but not deduplicated by the backend; double-submits are prevented client-side only (disabled submit button).
- **Token stored in `localStorage`.** This exposes an XSS surface (documented). `httpOnly` cookies are not applicable with this Bearer-token backend.
- **No automated end-to-end browser tests.** The full customer/admin workflow is documented as a manual walkthrough with exact commands and expected output rather than an automated Playwright/Cypress suite.
- **Charts bundle size.** Recharts adds roughly ~400 kB to the frontend bundle.
- **Admin area scope.** The admin area has no user creation or password reset beyond the seed; account management is limited to the status endpoint.

---

## Backend Bugs Found

**NONE.** No backend changes were made. The frontend adapted to the backend's existing contract without requiring any modifications.

---

## Test Results

| Component | Suites | Tests | Status      |
| --------- | ------ | ----- | ----------- |
| Backend   | 33     | 404   | ✅ All passing |
| Frontend  | 4      | 15    | ✅ All passing |

- **Backend:** `cd backend && npm test` → 33 suites / 404 tests passing (uses `mongodb-memory-server`).
- **Frontend:** `cd frontend && npm run test` → 4 suites / 15 tests passing; `npm run build` succeeds.
