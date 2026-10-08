# MyBanking Frontend

React single-page application for the MyBanking backend API. Provides a customer area for everyday banking and an admin area for oversight and account management, all styled with a professional banking aesthetic.

## Features

### Customer Area

- **Register / Login** — full client-side validation matching backend rules; JWT stored on success.
- **Dashboard** — account name, number, type, balance, recent transactions, credit/debit totals.
- **Account** — detailed account overview (number, type, balance, status, currency).
- **Deposit** — GHS amount input converted to integer pesewas; submit disabled while pending.
- **Withdraw** — confirmation dialog before submission; handles insufficient-funds and inactive-account errors.
- **Transfer** — 10-digit recipient account number + GHS amount; confirmation dialog; handles unknown-recipient and self-transfer errors.
- **Transaction History** — newest-first list with text search, type filter (CREDIT / DEBIT / TRANSFER), date range, and pagination.
- **Profile** — view all profile fields; edit phone and address with validation.

### Admin Area

- **Admin Login** — posts to the shared `/api/auth/login`; grants admin access only when `role === ADMIN`.
- **Dashboard** — stat cards (Total Customers, Total Accounts, Total Deposits, Total Withdrawals, Total Transfers, Total Money Held) plus Recharts bar/pie charts.
- **Customers Table** — paginated list with search and detail view.
- **Accounts Table** — paginated list with balance, status badge, and activate/deactivate via `PUT /api/admin/accounts/:id/status` (Active ↔ Disabled) with confirmation dialog.
- **Transactions Table** — paginated system-wide transaction list with detail view.

## Tech Stack

| Layer       | Technology                                           |
| ----------- | ---------------------------------------------------- |
| Build       | Vite 6                                               |
| UI          | React 18, React Router v6                            |
| Styling     | Tailwind CSS v3, PostCSS, Autoprefixer               |
| HTTP        | Axios (shared instance with Bearer token interceptor) |
| Charts      | Recharts                                             |
| Tests       | Vitest 2, React Testing Library, @testing-library/jest-dom, jsdom |

## Project Structure

```
frontend/
├── index.html
├── vite.config.js
├── tailwind.config.js
├── postcss.config.js
├── .env.example
├── .gitignore
└── src/
    ├── main.jsx                  # Entry — mounts App inside providers
    ├── App.jsx                   # Router + route table + guards
    ├── index.css                 # Tailwind directives
    ├── lib/
    │   ├── api.js                # Axios instance + interceptors
    │   ├── money.js              # pesewasToDisplay / displayToPesewas
    │   └── validation.js         # Shared client-side validators
    ├── context/
    │   ├── AuthContext.jsx        # Auth state + actions + useAuth()
    │   └── ToastContext.jsx       # Toast state + useToast()
    ├── components/
    │   ├── ProtectedRoute.jsx    # Redirect to /login if no user
    │   ├── RoleRoute.jsx         # Redirect CUSTOMER away from /admin/*
    │   ├── layout/
    │   │   ├── AppLayout.jsx     # Customer sidebar + topbar
    │   │   ├── AdminLayout.jsx   # Admin sidebar + topbar
    │   │   ├── Sidebar.jsx
    │   │   ├── Topbar.jsx
    │   │   └── MobileNav.jsx
    │   ├── ui/                   # 12 reusable UI components
    │   │   ├── Badge.jsx
    │   │   ├── Button.jsx
    │   │   ├── Card.jsx
    │   │   ├── ConfirmDialog.jsx
    │   │   ├── EmptyState.jsx
    │   │   ├── ErrorState.jsx
    │   │   ├── Input.jsx
    │   │   ├── MoneyAmount.jsx
    │   │   ├── Pagination.jsx
    │   │   ├── Spinner.jsx
    │   │   ├── StatCard.jsx
    │   │   └── Table.jsx
    │   └── Toast/
    │       ├── Toast.jsx
    │       └── ToastContainer.jsx
    ├── pages/                    # 10 customer pages
    │   ├── Landing.jsx
    │   ├── Login.jsx
    │   ├── Register.jsx
    │   ├── Dashboard.jsx
    │   ├── Account.jsx
    │   ├── Deposit.jsx
    │   ├── Withdraw.jsx
    │   ├── Transfer.jsx
    │   ├── Transactions.jsx
    │   ├── Profile.jsx
    │   └── NotFound.jsx
    │   └── admin/                # 5 admin pages
    │       ├── AdminLogin.jsx
    │       ├── AdminDashboard.jsx
    │       ├── AdminCustomers.jsx
    │       ├── AdminAccounts.jsx
    │       └── AdminTransactions.jsx
    └── test/                     # Vitest + RTL tests
        ├── setup.js
        ├── Login.test.jsx
        ├── ProtectedRoute.test.jsx
        ├── AdminGuard.test.jsx
        └── Deposit.test.jsx
```

## Prerequisites

- **Node.js >= 18**
- **Running backend** — the frontend calls `VITE_API_URL` (default `http://localhost:5000`).

## Install

```bash
npm install
```

## Environment Variables

Copy `.env.example` and adjust:

```env
# Base URL of the MyBanking backend API. Override per environment.
VITE_API_URL=http://localhost:5000
```

## Run

### Development

```bash
npm run dev
```

Opens on `http://localhost:5173` by default.

### Production Build

```bash
npm run build
```

Static output lands in `dist/`.

### Tests

```bash
npm run test
```

Runs Vitest with jsdom. Currently **4 test suites / 15 tests**, all passing.

## Money Model

All money is stored and transmitted as **integer pesewas** (the smallest unit of GHS):

| Pesewas | GHS Display |
| ------- | ----------- |
| 100     | GHS 1.00    |
| 123456  | GHS 1,234.56 |
| 0       | GHS 0.00    |

- `100 pesewas = 1 GHS`.
- Forms accept GHS input and convert to integer pesewas before POST.
- Displays convert integer pesewas to GHS with thousands separators and 2 decimal places.
- No float division is performed on stored pesewa values.

## Auth Model

- **Bearer JWT in `localStorage`** — not cookies. This is by design: the backend returns a JWT in the login/register response body and reads `Authorization: Bearer <token>`.
- The axios request interceptor attaches the token on every request.
- On `401`, the response interceptor clears the stored token so route guards redirect to `/login`.
- `withCredentials` is set to `true` for forward-compatibility but is currently inert (no cookies are exchanged).

## Deployment

### Vercel (recommended for the frontend)

1. Import the `frontend/` directory as a Vercel project.
2. Set the build command to `npm run build` and output directory to `dist`.
3. Set the environment variable `VITE_API_URL` to your deployed backend URL (e.g. `https://mybanking-api.onrender.com`).
4. Add a `vercel.json` for SPA routing:

```json
{
  "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }]
}
```

5. Ensure the backend's `CORS_ALLOWLIST` includes the Vercel origin.

### Cross-Domain Notes

Since auth uses a Bearer header (not cookies), there are no `SameSite` / `withCredentials` cookie concerns. The only cross-origin requirement is that the backend CORS allowlist includes the frontend origin and allows the `Authorization` header.

## ⚠️ Seed Credentials — DEVELOPMENT ONLY

The backend seed script creates these accounts for local testing:

| Role     | Email                     | Password      |
| -------- | ------------------------- | ------------- |
| Admin    | admin@mybanking.test      | Admin123!     |
| Customer | kwame@mybanking.test      | Password123!  |

**These credentials are for development only and MUST be changed before any production deployment.** All seeded customers share the same dev password (`Password123!`).
