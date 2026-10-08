import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import api from '../lib/api';
import { displayToPesewas, pesewasToDisplay } from '../lib/money';
import { validateAmount, validateAccountNumber } from '../lib/validation';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import Input from '../components/ui/Input';
import MoneyAmount from '../components/ui/MoneyAmount';
import ConfirmDialog from '../components/ui/ConfirmDialog';

export default function Transfer() {
  const { account, refresh } = useAuth();
  const toast = useToast();

  const [recipient, setRecipient] = useState('');
  const [recipientError, setRecipientError] = useState(null);
  const [amount, setAmount] = useState('');
  const [amountError, setAmountError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pesewasToSend, setPesewasToSend] = useState(0);

  const handleRecipientChange = (e) => {
    setRecipient(e.target.value);
    if (recipientError) setRecipientError(null);
  };

  const handleAmountChange = (e) => {
    setAmount(e.target.value);
    if (amountError) setAmountError(null);
  };

  const handleSubmit = (e) => {
    e.preventDefault();

    // Validate both fields
    const recErr = validateAccountNumber(recipient);
    const amtErr = validateAmount(amount);

    setRecipientError(recErr);
    setAmountError(amtErr);

    if (recErr || amtErr) return;

    const pesewas = displayToPesewas(amount);
    setPesewasToSend(pesewas);
    setConfirmOpen(true);
  };

  const handleConfirm = async () => {
    setLoading(true);
    try {
      await api.post('/api/transactions/transfer', {
        recipientAccountNumber: recipient.trim(),
        amount: pesewasToSend,
      });
      toast.success(
        `Transferred ${pesewasToDisplay(pesewasToSend)} to account ${recipient.trim()}`
      );
      setRecipient('');
      setAmount('');
      setRecipientError(null);
      setAmountError(null);
      setConfirmOpen(false);
      await refresh();
    } catch (error) {
      toast.error(error.message || 'Transfer failed');
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
      <h1 className="text-2xl font-bold text-slate-900">Transfer Funds</h1>

      {/* Current balance */}
      {account && (
        <Card>
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-slate-500">Current Balance</span>
            <MoneyAmount pesewas={account.balance} className="text-xl text-slate-900" />
          </div>
        </Card>
      )}

      {/* Transfer form */}
      <Card title="Send Money">
        <form onSubmit={handleSubmit} className="space-y-5">
          <Input
            label="Recipient Account Number"
            id="transfer-recipient"
            name="recipientAccountNumber"
            type="text"
            inputMode="numeric"
            placeholder="10-digit account number"
            value={recipient}
            onChange={handleRecipientChange}
            error={recipientError}
            hint="Enter the recipient's 10-digit account number"
            maxLength={10}
            required
            autoComplete="off"
          />

          <Input
            label="Amount (GHS)"
            id="transfer-amount"
            name="amount"
            type="text"
            inputMode="decimal"
            placeholder="0.00"
            value={amount}
            onChange={handleAmountChange}
            error={amountError}
            hint="Enter the amount in GHS (e.g. 25.00)"
            required
            autoComplete="off"
          />

          <Button
            type="submit"
            loading={loading}
            className="w-full"
          >
            Transfer
          </Button>
        </form>
      </Card>

      {/* Confirmation dialog */}
      <ConfirmDialog
        open={confirmOpen}
        title="Confirm Transfer"
        message={`Transfer ${pesewasToDisplay(pesewasToSend)} to account ${recipient.trim()}?`}
        confirmLabel="Confirm"
        onConfirm={handleConfirm}
        onCancel={handleCancel}
        loading={loading}
      />
    </div>
  );
}
