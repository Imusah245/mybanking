import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

// ── Mock the auth context ──────────────────────────────────────────
// useAuth is read inside ProtectedRoute; we drive its return value per test.
const mockUseAuth = vi.fn();
vi.mock('../context/AuthContext', () => ({
  useAuth: () => mockUseAuth(),
}));

import ProtectedRoute from '../components/ProtectedRoute';

function renderWithRouter() {
  return render(
    <MemoryRouter initialEntries={['/dashboard']}>
      <Routes>
        <Route element={<ProtectedRoute />}>
          <Route path="/dashboard" element={<div>Dashboard Page</div>} />
        </Route>
        <Route path="/login" element={<div>Login Page</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('ProtectedRoute redirect', () => {
  beforeEach(() => {
    mockUseAuth.mockReset();
  });

  it('redirects an unauthenticated visitor to /login', () => {
    mockUseAuth.mockReturnValue({ user: null, loading: false });

    renderWithRouter();

    // Guard should have redirected to the login route.
    expect(screen.getByText('Login Page')).toBeInTheDocument();
    expect(screen.queryByText('Dashboard Page')).not.toBeInTheDocument();
  });

  it('renders a loading indicator while auth is hydrating', () => {
    mockUseAuth.mockReturnValue({ user: null, loading: true });

    renderWithRouter();

    expect(screen.getByText(/loading/i)).toBeInTheDocument();
    expect(screen.queryByText('Login Page')).not.toBeInTheDocument();
    expect(screen.queryByText('Dashboard Page')).not.toBeInTheDocument();
  });

  it('renders the protected content for an authenticated user', () => {
    mockUseAuth.mockReturnValue({
      user: { id: '1', role: 'CUSTOMER' },
      loading: false,
    });

    renderWithRouter();

    expect(screen.getByText('Dashboard Page')).toBeInTheDocument();
    expect(screen.queryByText('Login Page')).not.toBeInTheDocument();
  });
});
