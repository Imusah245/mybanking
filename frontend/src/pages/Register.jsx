import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import {
  validateFirstName,
  validateLastName,
  validateEmail,
  validatePhone,
  validateDateOfBirth,
  validateAddress,
  validatePassword,
} from '../lib/validation';
import Button from '../components/ui/Button';
import Input from '../components/ui/Input';
import Card from '../components/ui/Card';

/**
 * Register — centered card form with the full registration field set.
 *
 * Validates each field on submit using the shared validators, calls
 * useAuth().register, and navigates to /dashboard on success.
 */

const INITIAL = {
  firstName: '',
  lastName: '',
  email: '',
  phone: '',
  dateOfBirth: '',
  address: '',
  password: '',
};

const VALIDATORS = {
  firstName: validateFirstName,
  lastName: validateLastName,
  email: validateEmail,
  phone: validatePhone,
  dateOfBirth: validateDateOfBirth,
  address: validateAddress,
  password: validatePassword,
};

export default function Register() {
  const { register } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();

  const [fields, setFields] = useState(INITIAL);
  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(false);

  function handleChange(e) {
    const { name, value } = e.target;
    setFields((prev) => ({ ...prev, [name]: value }));
  }

  function validate() {
    const next = {};
    for (const [key, fn] of Object.entries(VALIDATORS)) {
      const err = fn(fields[key]);
      if (err) next[key] = err;
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!validate()) return;

    setLoading(true);
    try {
      await register({
        firstName: fields.firstName.trim(),
        lastName: fields.lastName.trim(),
        email: fields.email.trim(),
        phone: fields.phone.trim(),
        dateOfBirth: fields.dateOfBirth, // already yyyy-mm-dd from <input type=date>
        address: fields.address.trim(),
        password: fields.password,
      });
      toast.success('Account created successfully');
      navigate('/dashboard', { replace: true });
    } catch (err) {
      toast.error(err.message || 'Registration failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-10">
      <div className="w-full max-w-lg">
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
            Create your account
          </h1>
          <p className="mb-6 text-sm text-slate-500">
            Open a MyBanking account in minutes.
          </p>

          <form onSubmit={handleSubmit} noValidate className="space-y-4">
            {/* Name row */}
            <div className="grid gap-4 sm:grid-cols-2">
              <Input
                label="First name"
                id="firstName"
                name="firstName"
                value={fields.firstName}
                onChange={handleChange}
                error={errors.firstName}
                required
                placeholder="Kwame"
                autoComplete="given-name"
              />
              <Input
                label="Last name"
                id="lastName"
                name="lastName"
                value={fields.lastName}
                onChange={handleChange}
                error={errors.lastName}
                required
                placeholder="Mensah"
                autoComplete="family-name"
              />
            </div>

            <Input
              label="Email"
              id="email"
              name="email"
              type="email"
              value={fields.email}
              onChange={handleChange}
              error={errors.email}
              required
              placeholder="you@example.com"
              autoComplete="email"
            />

            {/* Phone and DOB row */}
            <div className="grid gap-4 sm:grid-cols-2">
              <Input
                label="Phone"
                id="phone"
                name="phone"
                type="tel"
                value={fields.phone}
                onChange={handleChange}
                error={errors.phone}
                required
                placeholder="0241234567"
                autoComplete="tel"
              />
              <Input
                label="Date of birth"
                id="dateOfBirth"
                name="dateOfBirth"
                type="date"
                value={fields.dateOfBirth}
                onChange={handleChange}
                error={errors.dateOfBirth}
                required
                autoComplete="bday"
              />
            </div>

            <Input
              label="Address"
              id="address"
              name="address"
              value={fields.address}
              onChange={handleChange}
              error={errors.address}
              required
              placeholder="12 Independence Ave, Accra"
              autoComplete="street-address"
            />

            <Input
              label="Password"
              id="password"
              name="password"
              type="password"
              value={fields.password}
              onChange={handleChange}
              error={errors.password}
              required
              placeholder="••••••••"
              hint="At least 8 characters"
              autoComplete="new-password"
            />

            <Button
              type="submit"
              loading={loading}
              className="w-full"
            >
              Create account
            </Button>
          </form>

          <p className="mt-5 text-center text-sm text-slate-600">
            Already have an account?{' '}
            <Link
              to="/login"
              className="font-semibold text-indigo-600 hover:text-indigo-500"
            >
              Log in
            </Link>
          </p>
        </Card>
      </div>
    </div>
  );
}
