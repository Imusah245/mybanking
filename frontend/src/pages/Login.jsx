import { useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';

import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { validateEmail, validatePassword } from '../lib/validation';
import Button from '../components/ui/Button';
import Input from '../components/ui/Input';
import Card from '../components/ui/Card';

/**
 * Login — centered card form with email + password.
 *
 * Validates on submit, calls useAuth().login, shows toast on success/failure,
 * and navigates to the intended destination (location.state.from) or /dashboard.
 */
export default function Login() {
  const { login } = useAuth();
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
      await login(email, password);
      toast.success('Login successful');
      const from = location.state?.from?.pathname || '/dashboard';
      navigate(from, { replace: true });
    } catch (err) {
      toast.error(err.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-md">
        {/* Brand */}
        <div className="mb-8 text-center">
          <Link to="/" className="inline-flex items-center gap-2">
            <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-600 text-lg font-bold text-white">
              M
            </span>
            <span className="text-xl font-bold text-slate-900">MyBanking</span>
          </Link>
        </div>

        <Card>
          <h1 className="mb-1 text-xl font-bold text-slate-900">
            Welcome back
          </h1>
          <p className="mb-6 text-sm text-slate-500">
            Sign in to your account to continue.
          </p>

          <form onSubmit={handleSubmit} noValidate className="space-y-4">
            <Input
              label="Email"
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              error={errors.email}
              required
              placeholder="you@example.com"
              autoComplete="email"
            />

            <Input
              label="Password"
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              error={errors.password}
              required
              placeholder="••••••••"
              autoComplete="current-password"
            />

            <Button
              type="submit"
              loading={loading}
              className="w-full"
            >
              Log in
            </Button>
          </form>

          <p className="mt-5 text-center text-sm text-slate-600">
            Don&apos;t have an account?{' '}
            <Link
              to="/register"
              className="font-semibold text-indigo-600 hover:text-indigo-500"
            >
              Create one
            </Link>
          </p>
        </Card>
      </div>
    </div>
  );
}
