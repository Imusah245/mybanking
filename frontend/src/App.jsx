import { Routes, Route } from 'react-router-dom';

import ProtectedRoute from './components/ProtectedRoute';
import RoleRoute from './components/RoleRoute';
import AppLayout from './components/layout/AppLayout';
import AdminLayout from './components/layout/AdminLayout';

// Public pages
import Landing from './pages/Landing';
import Login from './pages/Login';
import Register from './pages/Register';
import NotFound from './pages/NotFound';

// Customer pages
import Dashboard from './pages/Dashboard';
import Account from './pages/Account';
import Deposit from './pages/Deposit';
import Withdraw from './pages/Withdraw';
import Transfer from './pages/Transfer';
import Transactions from './pages/Transactions';
import Profile from './pages/Profile';

// Admin pages
import AdminLogin from './pages/admin/AdminLogin';
import AdminDashboard from './pages/admin/AdminDashboard';
import AdminCustomers from './pages/admin/AdminCustomers';
import AdminAccounts from './pages/admin/AdminAccounts';
import AdminTransactions from './pages/admin/AdminTransactions';

/**
 * App — the route table for the MyBanking SPA.
 *
 * Providers (BrowserRouter, AuthProvider, ToastProvider) are wired in
 * main.jsx so the whole tree, including guards, can consume them.
 *
 * Route groups:
 *  - Public: /, /login, /register, /admin/login.
 *  - Customer (ProtectedRoute): redirects to /login when unauthenticated.
 *  - Admin (RoleRoute role=ADMIN): redirects to /admin/login when
 *    unauthenticated and to /dashboard when a non-admin user tries to enter.
 *  - Catch-all: a 404 page.
 */
export default function App() {
  return (
    <Routes>
      {/* Public routes */}
      <Route path="/" element={<Landing />} />
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route path="/admin/login" element={<AdminLogin />} />

      {/* Customer routes (require authentication, rendered inside AppLayout) */}
      <Route element={<ProtectedRoute />}>
        <Route element={<AppLayout />}>
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/account" element={<Account />} />
          <Route path="/deposit" element={<Deposit />} />
          <Route path="/withdraw" element={<Withdraw />} />
          <Route path="/transfer" element={<Transfer />} />
          <Route path="/transactions" element={<Transactions />} />
          <Route path="/profile" element={<Profile />} />
        </Route>
      </Route>

      {/* Admin routes (require ADMIN role, rendered inside AdminLayout) */}
      <Route element={<RoleRoute role="ADMIN" />}>
        <Route element={<AdminLayout />}>
          <Route path="/admin/dashboard" element={<AdminDashboard />} />
          <Route path="/admin/customers" element={<AdminCustomers />} />
          <Route path="/admin/accounts" element={<AdminAccounts />} />
          <Route path="/admin/transactions" element={<AdminTransactions />} />
        </Route>
      </Route>

      {/* Catch-all */}
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
