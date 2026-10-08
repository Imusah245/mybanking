import { useAuth } from '../context/AuthContext';
import { pesewasToDisplay } from '../lib/money';
import Card from '../components/ui/Card';
import Spinner from '../components/ui/Spinner';
import EmptyState from '../components/ui/EmptyState';
import Badge from '../components/ui/Badge';
import MoneyAmount from '../components/ui/MoneyAmount';

/** Map account status to a Badge colour. */
const STATUS_COLOR = { Active: 'green', Frozen: 'amber', Disabled: 'red' };

/** A single label / value detail row. */
function DetailRow({ label, children }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-slate-100 py-3 last:border-b-0">
      <span className="text-sm font-medium text-slate-500">{label}</span>
      <span className="text-right text-sm font-semibold text-slate-900">
        {children}
      </span>
    </div>
  );
}

export default function Account() {
  const { account, loading } = useAuth();

  /* ── loading ─────────────────────────────────────────────────── */
  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Spinner size="lg" />
      </div>
    );
  }

  /* ── no account ──────────────────────────────────────────────── */
  if (!account) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-12">
        <EmptyState
          title="No account"
          message="You don't have a bank account yet. Please contact support or wait for account activation."
        />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6 px-4 py-8">
      <h1 className="text-2xl font-bold text-slate-900">Account Details</h1>

      <Card title="Overview">
        <div className="divide-y divide-slate-100">
          <DetailRow label="Account Number">
            <span className="font-mono">{account.accountNumber}</span>
          </DetailRow>
          <DetailRow label="Account Type">{account.accountType}</DetailRow>
          <DetailRow label="Balance">
            <MoneyAmount pesewas={account.balance} />
          </DetailRow>
          <DetailRow label="Currency">{account.currency}</DetailRow>
          <DetailRow label="Status">
            <Badge color={STATUS_COLOR[account.status] ?? 'slate'}>
              {account.status}
            </Badge>
          </DetailRow>
        </div>
      </Card>
    </div>
  );
}
