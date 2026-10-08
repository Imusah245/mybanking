import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import api from '../lib/api';
import { validateProfilePhone, validateAddress } from '../lib/validation';
import Card from '../components/ui/Card';
import Input from '../components/ui/Input';
import Button from '../components/ui/Button';
import Spinner from '../components/ui/Spinner';

/**
 * Profile /profile
 *
 * Displays the signed-in user's profile. firstName, lastName, email,
 * dateOfBirth and role are READ-ONLY (the backend ignores changes to them).
 * Only phone and address are editable — validated client-side against the
 * backend rules (validateProfilePhone / validateAddress) and persisted via
 * PUT /api/users/me { phone, address }.
 */

/** Format a date-ish value to a readable date, falling back gracefully. */
function formatDate(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

/** A labelled read-only value row. */
function ReadOnlyField({ label, value }) {
  return (
    <div>
      <span className="mb-1 block text-sm font-medium text-slate-700">
        {label}
      </span>
      <div className="block w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
        {value || '—'}
      </div>
    </div>
  );
}

export default function Profile() {
  const { user, loading, refresh } = useAuth();
  const toast = useToast();

  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [errors, setErrors] = useState({ phone: null, address: null });
  const [pending, setPending] = useState(false);

  // Pre-fill editable fields once the user is available (and keep in sync
  // after a refresh updates the user).
  useEffect(() => {
    if (user) {
      setPhone(user.phone ?? '');
      setAddress(user.address ?? '');
    }
  }, [user]);

  // ── Loading state ────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <Spinner size="lg" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="p-8 text-slate-600">Unable to load your profile.</div>
    );
  }

  const fullName = [user.firstName, user.lastName].filter(Boolean).join(' ');

  // ── Submit ───────────────────────────────────────────────────────
  async function handleSubmit(e) {
    e.preventDefault();

    const phoneError = validateProfilePhone(phone);
    const addressError = validateAddress(address);

    if (phoneError || addressError) {
      setErrors({ phone: phoneError, address: addressError });
      return;
    }

    setErrors({ phone: null, address: null });
    setPending(true);

    try {
      await api.put('/api/users/me', {
        phone: phone.trim(),
        address: address.trim(),
      });
      toast.success('Profile updated');
      await refresh();
    } catch (err) {
      toast.error(err.message || 'Failed to update profile');
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-4 sm:p-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Profile</h1>
        <p className="mt-1 text-sm text-slate-500">
          View your account details. Only your phone number and address can be
          changed.
        </p>
      </div>

      {/* Read-only account details */}
      <Card title="Account details">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <ReadOnlyField label="First name" value={user.firstName} />
          <ReadOnlyField label="Last name" value={user.lastName} />
          <ReadOnlyField label="Email" value={user.email} />
          <ReadOnlyField
            label="Date of birth"
            value={formatDate(user.dateOfBirth)}
          />
          <ReadOnlyField label="Role" value={user.role} />
          <ReadOnlyField label="Full name" value={fullName} />
        </div>
        <p className="mt-4 text-xs text-slate-400">
          Name, email, date of birth and role cannot be changed here.
        </p>
      </Card>

      {/* Editable contact details */}
      <Card title="Contact details">
        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <Input
            label="Phone number"
            id="phone"
            name="phone"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            error={errors.phone}
            hint="7-20 characters: digits, spaces, and + - ( ) allowed."
            required
            disabled={pending}
          />

          <Input
            label="Address"
            id="address"
            name="address"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            error={errors.address}
            hint="1-255 characters."
            required
            disabled={pending}
          />

          <div className="flex justify-end">
            <Button type="submit" loading={pending} disabled={pending}>
              {pending ? 'Saving…' : 'Save changes'}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
