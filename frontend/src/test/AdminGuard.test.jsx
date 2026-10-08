import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

// ── Mock the auth context ──────────────────────────────────────────
const mockUseAuth = vi.fn();
vi.mock('../context/AuthContext', () => ({
  useAuth: () => mockUseAuth(),
}));

import RoleRoute from '../components/RoleRoute';

function renderWithRouter() {
  return render(
    <MemoryRouter initialEntries={['/admin/dashboard']}>
      <Routes>
        <Route element={<RoleRoute role="ADMIN" />}>
          <Route path="/admin/dashboard" element={<div>Admin Dashboard</div>} />
        </Route>
        <Route path="/dashboard" element={<div>Customer Dashboard</div>} />
        <Route path="/admin/login" element={<div>Admin Login</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('Admin guard (RoleRoute) redirect', () => {
  beforeEach(() => {
    mockUseAuth.mockReset();
  });

  it('redirects a CUSTOMER away from /admin/* to /dashboard', () => {
    mockUseAuth.mockReturnValue({
      user: { role: 'CUSTOMER' },
      loading: false,
    });

    renderWithRouter();

    // A non-admin lands on the customer dashboard, never the admin area.
    expect(screen.getByText('Customer Dashboard')).toBeInTheDocument();
    expect(screen.queryByText('Admin Dashboard')).not.toBeInTheDocument();
  });

  it('redirects an unauthenticated visitor to /admin/login', () => {
    mockUseAuth.mockReturnValue({ user: null, loading: false });

    renderWithRouter();

    expect(screen.getByText('Admin Login')).toBeInTheDocument();
    expect(screen.queryByText('Admin Dashboard')).not.toBeInTheDocument();
  });

  it('renders the admin content for an ADMIN user', () => {
    mockUseAuth.mockReturnValue({
      user: { role: 'ADMIN' },
      loading: false,
    });

    renderWithRouter();

    expect(screen.getByText('Admin Dashboard')).toBeInTheDocument();
    expect(screen.queryByText('Customer Dashboard')).not.toBeInTheDocument();
  });
});
