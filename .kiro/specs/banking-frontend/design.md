# Design - Banking Frontend

## Overview

A React + Vite single-page application styled with Tailwind CSS, using React Router for navigation and axios for API access. It consumes the frozen banking-backend-api over HTTP. Two areas share one codebase: a customer area and an admin area, separated by route guards keyed on the authenticated user role. All state that matters for auth lives in a single AuthContext; money is handled as integer pesewas end-to-end and only formatted to GHS at the view layer.

## Backend adaptation decisions (why the frontend looks the way it does)

1. Bearer-token auth, not cookies. The backend returns a JWT in the login/register response body and reads Authorization: Bearer <token>. Decision: store the token in localStorage (key mybanking_token) and attach it via an axios request interceptor. withCredentials is left true but is inert (no cookies). Rationale: match the backend exactly; cookie-based flows and cookie flags are not applicable and will be documented as such.
2. Idempotency-Key is sent but not enforced. The backend has no idempotency store. Decision: generate crypto.randomUUID() per money submit and send it as the Idempotency-Key header (forward-looking), and PREVENT double submits by disabling the submit button while the request is pending. Rationale: honor the requested behavior client-side without pretending the server dedupes.
3. Shared login, role-gated admin. There is one POST /api/auth/login and admin is determined by user.role === ADMIN. Decision: /admin/login posts to the same endpoint; after success the app checks role and only then routes into /admin/*. A non-admin who logs in via /admin/login is not granted admin access.
4. Money is integer pesewas. Decision: a money module converts GHS<->pesewas with integer-safe math; forms accept GHS and convert to integer pesewas before POST; all displays format pesewas to GHS.
5. Activate/deactivate maps to the status endpoint. Decision: Activate -> PUT status Active; Deactivate -> PUT status Disabled, each behind a confirmation dialog.
6. Customer credits/debits totals are computed client-side. The customer has no aggregate endpoint; the dashboard derives totals from the transaction list.

## Architecture

### Tech stack
- Vite + React 18 (JavaScript).
- React Router v6 for routing and guards.
- Tailwind CSS v3 for styling.
- axios for HTTP with a shared instance + interceptors.
- recharts for admin charts.
- Vitest + React Testing Library + jsdom for tests.

### Folder structure (frontend/)
- src/main.jsx — entry; mounts App inside providers.
- src/App.jsx — router + route table + guards.
- src/lib/api.js — axios instance + interceptors.
- src/lib/money.js — pesewas<->GHS helpers.
- src/lib/validation.js — shared client-side validators matching backend rules.
- src/context/AuthContext.jsx — auth state + actions + useAuth().
- src/context/ToastContext.jsx — toast state + useToast(); src/components/Toast/* — UI.
- src/components/ProtectedRoute.jsx, RoleRoute.jsx — guards.
- src/components/layout/* — Sidebar, Topbar, MobileNav, AppLayout, AdminLayout.
- src/components/ui/* — Button, Input, Card, StatCard, Table, Pagination, ConfirmDialog, Spinner, EmptyState, ErrorState, Badge, MoneyAmount.
- src/pages/* — Landing, Login, Register, Dashboard, Account, Deposit, Withdraw, Transfer, Transactions, Profile.
- src/pages/admin/* — AdminLogin, AdminDashboard, AdminCustomers, AdminAccounts, AdminTransactions.
- src/test/* — setup and tests.
- .env.example, .gitignore, index.html, tailwind.config.js, postcss.config.js, vite.config.js, vitest.config (or test block in vite.config).

## API client (src/lib/api.js)
- baseURL = import.meta.env.VITE_API_URL || http://localhost:5000.
- Request interceptor: if a token is in localStorage, set Authorization: Bearer token. For POST to /api/transactions/*, add Idempotency-Key = crypto.randomUUID() (documented as not server-enforced).
- Response interceptor: on success return response.data (the envelope). On error, normalize to { message, status } using response.data.message when present; on 401 remove the stored token (so guards redirect to login). Never throw raw axios errors to the UI.
- Thin API wrappers (src/lib/endpoints.js optional): authApi (register, login, me), accountApi (me), userApi (getProfile, updateProfile), txnApi (deposit, withdraw, transfer, list, getById), adminApi (customers, accounts, transactions, statistics, setAccountStatus).

## Auth state (src/context/AuthContext.jsx)
- State: { user, account, token, loading, error }.
- On mount: if token present, call GET /api/auth/me to hydrate user+account; set loading false when done. If /me returns 401, clear token and state.
- login(email,password): POST /api/auth/login; store data.token; set user; then fetch /me (or use returned user) and account. Returns the user so callers can branch on role.
- register(payload): POST /api/auth/register; store token; set user+account (register returns both).
- logout(): clear token + state; navigation handled by caller.
- refresh(): re-fetch /me to update account/balance after money ops.
- useAuth() hook exposes the above.

## Routing and guards (src/App.jsx)
- Public: /, /login, /register, /admin/login.
- Customer (ProtectedRoute -> redirect /login if no user): /dashboard, /account, /deposit, /withdraw, /transfer, /transactions, /profile, rendered inside AppLayout.
- Admin (RoleRoute role=ADMIN): /admin/dashboard, /admin/customers, /admin/accounts, /admin/transactions, rendered inside AdminLayout. RoleRoute: no user -> /admin/login; user.role !== ADMIN -> /dashboard.
- ProtectedRoute preserves intended location via state so post-login redirect returns the user there.

## Layout and visual design
- Professional banking aesthetic: deep navy/indigo primary, slate neutrals, generous spacing, card-based surfaces, subtle shadows and rounded corners, a clear top bar with account summary, a persistent left sidebar on desktop, and a bottom/hamburger mobile nav. Not a bare table/CRUD look.
- AppLayout: sidebar (Dashboard, Account, Deposit, Withdraw, Transfer, Transactions, Profile), topbar with name + balance + logout.
- AdminLayout: sidebar (Dashboard, Customers, Accounts, Transactions), topbar with admin name + logout.

## Pages (behavior)
- Landing /: marketing-ish entry with links to Login/Register.
- Login /login: email+password; client validation; on success route by role (ADMIN -> /admin/dashboard else /dashboard) or always /dashboard (admins use /admin/login); show error toast on failure.
- Register /register: full field set with validation (age>=18, phone 10-15 digits, etc.); on success store token and go to /dashboard.
- Dashboard /dashboard: cards for name, account number, type, balance; recent transactions (first page of GET /api/transactions); totals credits/debits computed from fetched transactions; loading/error/empty states.
- Account /account: account number, type, balance, status, currency.
- Deposit /deposit: GHS amount input -> pesewas; submit disabled while pending; success toast + refresh. (No confirm dialog required for deposit.)
- Withdraw /withdraw: GHS amount; confirmation dialog; disabled-while-pending; handles 400 insufficient / 403 inactive.
- Transfer /transfer: recipientAccountNumber (10 digits) + GHS amount; confirmation dialog showing recipient + amount; handles 404 unknown / 403 inactive / 400 insufficient / self-transfer 400.
- Transactions /transactions: table with newest-first list; search box, type select (All/CREDIT/DEBIT/TRANSFER), startDate/endDate; pagination controls using total/page/limit/totalPages; empty + loading states.
- Profile /profile: show all profile fields read-only except phone + address editable; validation; success toast on update.

## Admin pages
- AdminLogin /admin/login: posts to /api/auth/login; if role !== ADMIN show an error and do not enter admin; else go /admin/dashboard.
- AdminDashboard: six stat cards (Total Customers, Total Accounts, Total Deposits, Total Withdrawals, Total Transfers, Total Money Held [systemLiquidity as GHS]) from GET /api/admin/statistics; recharts bar/pie of the transaction-type counts and a card for money held.
- AdminCustomers: table from GET /api/admin/customers with search + pagination; row detail view.
- AdminAccounts: table from GET /api/admin/accounts with pagination; balance as GHS; status badge; activate/deactivate button -> ConfirmDialog -> PUT status; refresh on success.
- AdminTransactions: table from GET /api/admin/transactions with pagination; amount as GHS; type badge; detail view.

## Money handling (src/lib/money.js)
- pesewasToDisplay(pesewas): integer -> GHS string with thousands separators and 2 decimals (e.g. 123456 -> GHS 1,234.56). Integer-safe (no float division on the stored value).
- displayToPesewas(str): parse a GHS input (digits + optional . + up to 2 decimals) -> integer pesewas; reject malformed; used by forms before POST.
- Guard: amounts must be positive integers within [1, 999999999999] pesewas (mirrors backend).

## Validation (src/lib/validation.js)
- email: standard email shape; password: length 8-128; firstName/lastName: 1-50; phone: 10-15 digits for register (profile uses the backend 7-20 chars of digits/+/-/space/parens rule); address: 1-255; dateOfBirth: parseable and age >= 18; amount: valid GHS that converts to a positive integer pesewa in range; recipientAccountNumber: exactly 10 digits.

## Error and loading handling
- Every data view has explicit loading (Spinner), error (ErrorState with message + retry), and empty (EmptyState) branches.
- API errors surface via toast and inline messages; the 401 path clears the token and the guard sends the user to login.

## Testing (Vitest + RTL)
- login validation: invalid email / short password show errors and do not call the API.
- protected-route redirect: visiting a protected route with no token renders the login route.
- admin guard: a CUSTOMER visiting an /admin/* route is redirected to /dashboard.
- money form: a withdraw/transfer/deposit form validates input, converts GHS to pesewas correctly, and the submit button is disabled while a request is pending. API calls are mocked.

## Security and deployment (design-level)
- No secrets in the client bundle beyond VITE_API_URL. Token stored in localStorage; documented tradeoffs. Rate limiting and CORS are enforced by the backend; the frontend origin must be in the backend CORS allowlist.
- Build: vite build outputs static assets to dist/.
- Deploy: Vercel (static SPA, set VITE_API_URL to the backend URL; SPA rewrite to index.html). Backend on Render honoring process.env.PORT and CORS_ALLOWLIST including the Vercel origin; MongoDB Atlas as a replica set for transactions. Cross-domain: since auth is a Bearer header (not cookies), no SameSite/withCredentials cookie concerns; the only cross-origin requirement is the backend CORS allowlist plus allowing the Authorization header.

## Non-goals
- No backend changes. No server-side idempotency. No admin user management beyond the status endpoint. No TypeScript.
