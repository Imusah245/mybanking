# Tasks - Banking Frontend

## Task groups mapped to Checkpoints A-D

### Checkpoint A: Foundation and customer area

- [x] 1. Scaffold Vite + React + Tailwind + Router project
  - Create frontend/ with package.json (vite, react, react-dom, react-router-dom, axios, tailwindcss, postcss, autoprefixer, recharts, vitest, @testing-library/react, @testing-library/jest-dom, @testing-library/user-event, jsdom).
  - Configure vite.config.js, tailwind.config.js, postcss.config.js, index.html, src/index.css with @tailwind directives.
  - .env.example with VITE_API_URL=http://localhost:5000.
  - .gitignore (node_modules, dist, .env).
  - Run npm install and npm run build to confirm zero-error scaffold.
  - Requirements: 1.1, 1.5
- [x] 2. Implement core libraries
  - src/lib/api.js (axios instance, interceptors, Idempotency-Key).
  - src/lib/money.js (pesewasToDisplay, displayToPesewas).
  - src/lib/validation.js (all validators matching backend rules).
  - Requirements: 1.2, 1.3, 5.1, 5.3
- [x] 3. Implement AuthContext and toast system
  - src/context/AuthContext.jsx (user, account, token, loading, login, register, logout, refresh, useAuth).
  - src/context/ToastContext.jsx + src/components/Toast/Toast.jsx + ToastContainer.jsx (useToast).
  - Requirements: 1.4, 1.6
- [x] 4. Implement route guards and App shell
  - src/components/ProtectedRoute.jsx, src/components/RoleRoute.jsx.
  - src/App.jsx with full route table (placeholder pages initially).
  - src/main.jsx wiring providers (BrowserRouter, AuthProvider, ToastProvider).
  - Requirements: 3.4, 8.2, 8.3, 8.4
- [x] 5. Implement layouts
  - src/components/layout/AppLayout.jsx (customer sidebar + topbar).
  - src/components/layout/AdminLayout.jsx (admin sidebar + topbar).
  - src/components/layout/Sidebar.jsx, Topbar.jsx, MobileNav.jsx.
  - Professional banking style per design.
  - Requirements: 2.1, 2.2, 2.3
- [x] 6. Implement shared UI components
  - Button, Input, Card, StatCard, Table, Pagination, ConfirmDialog, Spinner, EmptyState, ErrorState, Badge, MoneyAmount in src/components/ui/.
  - Requirements: 4.4, 4.5, 5.2
- [x] 7. Implement auth pages (Login + Register)
  - src/pages/Login.jsx, src/pages/Register.jsx.
  - Client-side validation; call AuthContext login/register; toast on success/failure; redirect.
  - src/pages/Landing.jsx (marketing-style landing).
  - Requirements: 3.1, 3.2, 3.3
- [x] 8. Implement customer dashboard and account pages
  - src/pages/Dashboard.jsx (name, account number, type, balance, recent txns, credit/debit totals).
  - src/pages/Account.jsx (account details).
  - Requirements: 4.1, 4.2, 4.3
- [x] 9. Implement money operation pages
  - src/pages/Deposit.jsx, src/pages/Withdraw.jsx, src/pages/Transfer.jsx.
  - GHS input -> pesewas; confirmation dialogs; Idempotency-Key; disabled-while-pending; error handling.
  - Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6
- [x] 10. Implement transaction history page
  - src/pages/Transactions.jsx.
  - Search, type filter, date range, pagination, empty/loading states.
  - Requirements: 6.1, 6.2, 6.3
- [x] 11. Implement profile page
  - src/pages/Profile.jsx.
  - Display fields; edit phone + address; validation; success toast.
  - Requirements: 7.1, 7.2

### Checkpoint B: Admin area

- [x] 12. Implement admin login page
  - src/pages/admin/AdminLogin.jsx.
  - Posts to /api/auth/login; checks role === ADMIN; error if not admin.
  - Requirements: 8.2
- [x] 13. Implement admin dashboard
  - src/pages/admin/AdminDashboard.jsx.
  - Stat cards + recharts charts from /api/admin/statistics.
  - Requirements: 9.1, 9.2, 9.5
- [x] 14. Implement admin tables (customers, accounts, transactions)
  - src/pages/admin/AdminCustomers.jsx (search + pagination + detail).
  - src/pages/admin/AdminAccounts.jsx (pagination + activate/deactivate + confirmation).
  - src/pages/admin/AdminTransactions.jsx (pagination + detail).
  - Requirements: 9.3, 9.4

### Checkpoint C: Tests and verification

- [x] 15. Write frontend tests
  - Login validation test, protected-route redirect test, admin guard test, money form test.
  - Configure vitest + jsdom + RTL setup.
  - Run npm test and confirm pass.
  - Requirements: 10.1, 10.2
- [x] 16. End-to-end verification
  - Document the full customer and admin walkthrough steps and expected results.
  - If executable: run both servers and walk through; record results.
  - If not executable: provide exact commands and expected output.
  - Requirements: 11.1, 11.2, 11.3, 11.4

### Checkpoint D: Hardening and deployment

- [x] 17. Security check and deployment readiness
  - Verify no secrets in responses, rate limits active, CORS restricted, no secrets in git.
  - Document token-storage model and cross-domain CORS notes (cookies N/A).
  - Deployment notes for Render, Vercel, MongoDB Atlas.
  - Confirm npm run build succeeds.
  - Requirements: 12.1, 12.2, 12.3, 12.4
- [x] 18. Write README and PROGRESS.md
  - README: description, features, stack, structure, install, env vars, MongoDB setup, run commands, API docs, seed/test instructions, deployment steps, seed-credential warning.
  - PROGRESS.md: final report with what works, test results, known limitations, any backend fixes.
  - Also write the backend README.md (task 16.2 from the backend spec, still pending).
  - Requirements: 13.1, 13.2

### Checkpoint E: Landing page redesign (modern banking UI)

- [x] 19. Establish the banking design system (Tailwind theme + animations)
  - Extend tailwind.config.js theme with a named palette (navy, brand blue, teal, accent green, light bg) and keyframe animations (fade-in-up, fade-in, float).
  - Add src/assets/ with an SVG hero visual (digital banking dashboard/finance illustration) and any supporting SVGs/icons.
  - Add a tiny scroll-reveal helper (IntersectionObserver hook) for fade-in-on-scroll.
  - Requirements: landing redesign 6, 14, 17
- [x] 20. Build landing section components
  - src/components/landing/{Navbar,Hero,Stats,Features,HowItWorks,Services,Security,CallToAction,Footer}.jsx.
  - Professional banking visuals, strong contrast, visible text (no hover-only reveal), responsive, mobile hamburger menu, anchor nav + active state.
  - Requirements: landing redesign 1-13, 15, 18
- [x] 21. Compose Landing page, audit contrast, verify build
  - Rewrite src/pages/Landing.jsx to compose the sections; wire Open an Account -> /register and Sign In -> /login; smooth scrolling.
  - Audit every section + shared Button variants for white-on-light / hover-only / low-contrast text and fix.
  - Run npm build; confirm success; confirm existing routes untouched.
  - Requirements: landing redesign 5, 12, 16, 19
