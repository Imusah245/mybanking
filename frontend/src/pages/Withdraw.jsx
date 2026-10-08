import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import api from '../lib/api';
import { displayToPesewas, pesewasToDisplay } from '../lib/money';
import { validateAmount } from '../lib/validation';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import Input from '../components/ui/Input';
import MoneyAmount from '../components/ui/MoneyAmount';
import ConfirmDialog from '../components/ui/ConfirmDialog';

export default function Withdraw() {
  const { account, refresh } = useAuth();
  const toast = useToast();

  const [amount, setAmount] = useState('');
  const [amountError, setAmountError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pesewasToSend, setPesewasToSend] = useState(0);

  const handleAmountChange = (e) => {
    setAmount(e.target.value);
    if (amountError) setAmountError(null);
  };

  const handleSubmit = (e) => {
    e.preventDefault();

    // Validate
    const err = validateAmount(amount);
    if (err) {
      setAmountError(err);
      return;
    }

    const pesewas = displayToPesewas(amount);
    setPesewasToSend(pesewas);
    setConfirmOpen(true);
  };

  const handleConfirm = async () => {
    setLoading(true);
    try {
      await api.post('/api/transactions/withdraw', { amount: pesewasToSend });
      toast.success(`Withdrew ${pesewasToDisplay(pesewasToSend)} successfully`);
      setAmount('');
      setAmountError(null);
      setConfirmOpen(false);
      await refresh();
    } catch (error) {
      toast.error(error.message || 'Withdrawal failed');
      setConfirmOpen(false);
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = () => {
    if (!loading) setConfirmOpen(false);
  };

  return (
    <div className="mx-auto max-w-lg space-y-6 px-4 py-8">
      <h1 className="text-2xl font-bold text-slate-900">Withdraw Funds</h1>

      {/* Current balance */}
      {account && (
        <Card>
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-slate-500">Current Balance</span>
            <MoneyAmount pesewas={account.balance} className="text-xl text-slate-900" />
          </div>
        </Card>
      )}

      {/* Withdraw form */}
      <Card title="Make a Withdrawal">
        <form onSubmit={handleSubmit} className="space-y-5">
          <Input
            label="Amount (GHS)"
            id="withdraw-amount"
            name="amount"
            type="text"
            inputMode="decimal"
            placeholder="0.00"
            value={amount}
            onChange={handleAmountChange}
            error={amountError}
            hint="Enter the amount in GHS (e.g. 50.00)"
            required
            autoComplete="off"
          />

          <Button
            type="submit"
            loading={loading}
            className="w-full"
          >
            Withdraw
          </Button>
        </form>
      </Card>

      {/* Confirmation dialog */}
      <ConfirmDialog
        open={confirmOpen}
        title="Confirm Withdrawal"
        message={`Withdraw ${pesewasToDisplay(pesewasToSend)} from your account?`}
        confirmLabel="Confirm"
        onConfirm={handleConfirm}
        onCancel={handleCancel}
        loading={loading}
      />
    </div>
  );
}
