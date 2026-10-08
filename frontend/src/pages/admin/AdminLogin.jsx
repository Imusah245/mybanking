import { useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';

import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { validateEmail, validatePassword } from '../../lib/validation';
import Button from '../../components/ui/Button';
import Input from '../../components/ui/Input';

/**
 * AdminLogin — centered card form for the admin portal.
 *
 * Posts to the shared POST /api/auth/login endpoint. Admin access is granted
 * only when the returned user.role === 'ADMIN'. Non-admin users who
 * authenticate here are immediately logged out (token cleared) and shown an
 * error — the app does NOT navigate into /admin/*.
 */
export default function AdminLogin() {
  const { login, logout } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const location = useLocation();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(false);

  function validate() {
    const next = {};
    const emailErr = validateEmail(email);
    if (emailErr) next.email = emailErr;
    const pwErr = validatePassword(password);
    if (pwErr) next.password = pwErr;
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!validate()) return;

    setLoading(true);
    try {
      const user = await login(email, password);

      if (user?.role === 'ADMIN') {
        toast.success('Welcome to the Admin Portal');
        const from = location.state?.from?.pathname;
        const dest = from && from.startsWith('/admin') ? from : '/admin/dashboard';
        navigate(dest, { replace: true });
      } else {
        // Valid credentials but not an admin — clear the non-admin token.
        toast.error(
          'Admin access only — this account does not have admin privileges'
        );
        logout();
      }
    } catch (err) {
      toast.error(err.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-900 px-4">
      <div className="w-full max-w-md">
        {/* Brand */}
        <div className="mb-8 text-center">
          <span className="inline-flex items-center gap-2">
            <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-500 text-lg font-bold text-white">
              M
            </span>
            <span className="text-xl font-bold text-white">MyBanking</span>
          </span>
        </div>

        {/* Card — built manually so the dark header goes edge-to-edge */}
        <div className="overflow-hidden rounded-xl border border-slate-700 bg-white shadow-sm">
          {/* Dark admin header */}
          <div className="bg-slate-800 px-5 py-6 text-center">
            <span className="inline-flex items-center gap-2 rounded-full bg-slate-700 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-indigo-300">
              Restricted
            </span>
            <h1 className="mt-3 text-xl font-bold text-white">Admin Portal</h1>
            <p className="mt-1 text-sm text-slate-300">
              Sign in with your administrator account.
            </p>
          </div>

          {/* Form body */}
          <div className="p-5">
            <form onSubmit={handleSubmit} noValidate className="space-y-4">
              <Input
                label="Email"
                id="admin-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                error={errors.email}
                required
                placeholder="admin@example.com"
                autoComplete="email"
              />

              <Input
                label="Password"
                id="admin-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                error={errors.password}
                required
                placeholder="••••••••"
                autoComplete="current-password"
              />

              <Button type="submit" loading={loading} className="w-full">
                Sign in to Admin
              </Button>
            </form>

            <p className="mt-5 text-center text-sm text-slate-600">
              Not an administrator?{' '}
              <Link
                to="/login"
                className="font-semibold text-indigo-600 hover:text-indigo-500"
              >
                Customer login
              </Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
