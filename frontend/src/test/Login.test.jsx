import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// ── Mocks ──────────────────────────────────────────────────────────
// Mock the auth context so we can provide (and spy on) the login action
// without a real provider / network.
const mockLogin = vi.fn();
vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ login: mockLogin }),
}));

// Mock the toast context so success/error calls are inert no-ops we can
// assert against.
const mockToast = { success: vi.fn(), error: vi.fn(), info: vi.fn() };
vi.mock('../context/ToastContext', () => ({
  useToast: () => mockToast,
}));

import Login from '../pages/Login';

function renderLogin() {
  return render(
    <MemoryRouter>
      <Login />
    </MemoryRouter>,
  );
}

describe('Login form validation', () => {
  beforeEach(() => {
    mockLogin.mockReset();
    mockToast.success.mockReset();
    mockToast.error.mockReset();
  });

  it('shows per-field errors and does NOT call login for invalid email + short password', () => {
    renderLogin();

    const email = screen.getByLabelText(/email/i);
    const password = screen.getByLabelText(/password/i);

    // Invalid email, password shorter than 8 chars.
    fireEvent.change(email, { target: { value: 'not-an-email' } });
    fireEvent.change(password, { target: { value: 'short' } });

    fireEvent.click(screen.getByRole('button', { name: /log in/i }));

    // Per-field error messages must appear in the DOM.
    expect(screen.getByText(/enter a valid email address/i)).toBeInTheDocument();
    expect(
      screen.getByText(/password must be at least 8 characters/i),
    ).toBeInTheDocument();

    // The API (via login) must NOT be called when validation fails.
    expect(mockLogin).not.toHaveBeenCalled();
  });

  it('shows "required" errors and does NOT call login when fields are empty', () => {
    renderLogin();

    fireEvent.click(screen.getByRole('button', { name: /log in/i }));

    expect(screen.getByText(/email is required/i)).toBeInTheDocument();
    expect(screen.getByText(/password must be at least 8 characters/i)).toBeInTheDocument();
    expect(mockLogin).not.toHaveBeenCalled();
  });

  it('calls login once with valid credentials', async () => {
    mockLogin.mockResolvedValue({ role: 'CUSTOMER' });
    renderLogin();

    fireEvent.change(screen.getByLabelText(/email/i), {
      target: { value: 'user@example.com' },
    });
    fireEvent.change(screen.getByLabelText(/password/i), {
      target: { value: 'password123' },
    });

    fireEvent.click(screen.getByRole('button', { name: /log in/i }));

    expect(mockLogin).toHaveBeenCalledTimes(1);
    expect(mockLogin).toHaveBeenCalledWith('user@example.com', 'password123');
  });
});
