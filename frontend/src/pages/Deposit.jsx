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

export default function Deposit() {
  const { account, refresh } = useAuth();
  const toast = useToast();

  const [amount, setAmount] = useState('');
  const [amountError, setAmountError] = useState(null);
  const [loading, setLoading] = useState(false);

  const handleAmountChange = (e) => {
    setAmount(e.target.value);
    if (amountError) setAmountError(null);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    // Validate
    const err = validateAmount(amount);
    if (err) {
      setAmountError(err);
      return;
    }

    const pesewas = displayToPesewas(amount);

    setLoading(true);
    try {
      await api.post('/api/transactions/deposit', { amount: pesewas });
      toast.success(`Deposited ${pesewasToDisplay(pesewas)} successfully`);
      setAmount('');
      setAmountError(null);
      await refresh();
    } catch (error) {
      toast.error(error.message || 'Deposit failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mx-auto max-w-lg space-y-6 px-4 py-8">
      <h1 className="text-2xl font-bold text-slate-900">Deposit Funds</h1>

      {/* Current balance */}
      {account && (
        <Card>
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-slate-500">Current Balance</span>
            <MoneyAmount pesewas={account.balance} className="text-xl text-slate-900" />
          </div>
        </Card>
      )}

      {/* Deposit form */}
      <Card title="Make a Deposit">
        <form onSubmit={handleSubmit} className="space-y-5">
          <Input
            label="Amount (GHS)"
            id="deposit-amount"
            name="amount"
            type="text"
            inputMode="decimal"
            placeholder="0.00"
            value={amount}
            onChange={handleAmountChange}
            error={amountError}
            hint="Enter the amount in GHS (e.g. 15.00)"
            required
            autoComplete="off"
          />

          <Button
            type="submit"
            loading={loading}
            className="w-full"
          >
            Deposit
          </Button>
        </form>
      </Card>
    </div>
  );
}
