import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// ── Hoisted mocks (vitest lifts vi.mock calls above imports; vi.hoisted
// runs at the same level so the variables are available in the factory) ──
const { mockPost, mockRefresh, mockUseAuth, mockToast } = vi.hoisted(() => ({
  mockPost: vi.fn(),
  mockRefresh: vi.fn().mockResolvedValue(undefined),
  mockUseAuth: vi.fn(),
  mockToast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

vi.mock('../lib/api', () => ({
  default: { post: mockPost },
}));

vi.mock('../context/AuthContext', () => ({
  useAuth: () => mockUseAuth(),
}));

vi.mock('../context/ToastContext', () => ({
  useToast: () => mockToast,
}));

import Deposit from '../pages/Deposit';

function renderDeposit() {
  return render(<Deposit />);
}

describe('Deposit money form', () => {
  beforeEach(() => {
    mockPost.mockReset();
    mockRefresh.mockClear();
    mockToast.success.mockReset();
    mockToast.error.mockReset();
    mockUseAuth.mockReturnValue({
      account: { balance: 500000, accountNumber: '1234567890' },
      refresh: mockRefresh,
    });
  });

  it('shows a validation error and does NOT call the API for an invalid amount (0)', () => {
    renderDeposit();

    const input = screen.getByLabelText(/amount/i);
    fireEvent.change(input, { target: { value: '0' } });
    fireEvent.click(screen.getByRole('button', { name: /deposit/i }));

    // A validation message appears...
    expect(
      screen.getByText(/between GHS 0\.01 and GHS 9,999,999,999\.99/i),
    ).toBeInTheDocument();
    // ...and the API must NOT be called.
    expect(mockPost).not.toHaveBeenCalled();
  });

  it('shows a validation error and does NOT call the API for a non-numeric amount', () => {
    renderDeposit();

    const input = screen.getByLabelText(/amount/i);
    fireEvent.change(input, { target: { value: 'abc' } });
    fireEvent.click(screen.getByRole('button', { name: /deposit/i }));

    expect(
      screen.getByText(/valid amount \(up to 2 decimal places\)/i),
    ).toBeInTheDocument();
    expect(mockPost).not.toHaveBeenCalled();
  });

  it('shows a validation error and does NOT call the API for a negative amount', () => {
    renderDeposit();

    const input = screen.getByLabelText(/amount/i);
    fireEvent.change(input, { target: { value: '-5' } });
    fireEvent.click(screen.getByRole('button', { name: /deposit/i }));

    // '-5' is malformed per displayToPesewas (regex rejects the sign).
    expect(
      screen.getByText(/valid amount \(up to 2 decimal places\)/i),
    ).toBeInTheDocument();
    expect(mockPost).not.toHaveBeenCalled();
  });

  it('converts a valid GHS amount to the correct integer pesewas before POST', async () => {
    mockPost.mockResolvedValue({ data: { success: true } });
    renderDeposit();

    const input = screen.getByLabelText(/amount/i);
    // 15.00 GHS -> 1500 pesewas
    fireEvent.change(input, { target: { value: '15.00' } });
    fireEvent.click(screen.getByRole('button', { name: /deposit/i }));

    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledTimes(1);
    });
    expect(mockPost).toHaveBeenCalledWith('/api/transactions/deposit', {
      amount: 1500,
    });
  });

  it('converts a fractional GHS amount (1,234.56) to pesewas correctly', async () => {
    mockPost.mockResolvedValue({ data: { success: true } });
    renderDeposit();

    const input = screen.getByLabelText(/amount/i);
    // 1,234.56 GHS -> 123456 pesewas (commas tolerated by displayToPesewas)
    fireEvent.change(input, { target: { value: '1,234.56' } });
    fireEvent.click(screen.getByRole('button', { name: /deposit/i }));

    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith('/api/transactions/deposit', {
        amount: 123456,
      });
    });
  });

  it('disables the submit button while the request is pending', async () => {
    // A promise we control, so the request stays pending until we resolve it.
    let resolveRequest;
    mockPost.mockReturnValue(
      new Promise((resolve) => {
        resolveRequest = resolve;
      }),
    );

    renderDeposit();

    const input = screen.getByLabelText(/amount/i);
    fireEvent.change(input, { target: { value: '20.00' } });

    const button = screen.getByRole('button', { name: /deposit/i });
    fireEvent.click(button);

    // While pending, the button is disabled.
    await waitFor(() => {
      expect(button).toBeDisabled();
    });

    // Resolve the request; the button becomes enabled again.
    resolveRequest({ data: { success: true } });
    await waitFor(() => {
      expect(button).not.toBeDisabled();
    });
  });
});
