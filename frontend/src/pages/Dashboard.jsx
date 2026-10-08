import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api from '../lib/api';
import { pesewasToDisplay } from '../lib/money';
import Card from '../components/ui/Card';
import StatCard from '../components/ui/StatCard';
import Spinner from '../components/ui/Spinner';
import EmptyState from '../components/ui/EmptyState';
import ErrorState from '../components/ui/ErrorState';
import Badge from '../components/ui/Badge';
import MoneyAmount from '../components/ui/MoneyAmount';
import Table from '../components/ui/Table';

/* ── helpers ──────────────────────────────────────────────────────── */

/** Map transaction type to a Badge colour. */
const TYPE_COLOR = { CREDIT: 'green', DEBIT: 'red', TRANSFER: 'indigo' };

/** Map account status to a Badge colour. */
const STATUS_COLOR = { Active: 'green', Frozen: 'amber', Disabled: 'red' };

/**
 * Compute totals over the *fetched* recent set.
 * Credits = sum of amounts where type === 'CREDIT'
 * Debits  = sum of amounts where type === 'DEBIT'
 */
function computeTotals(items) {
  let credits = 0;
  let debits = 0;
  for (const tx of items) {
    if (tx.type === 'CREDIT') credits += tx.amount;
    else if (tx.type === 'DEBIT') debits += tx.amount;
  }
  return { credits, debits };
}

/** Format an ISO date string into a short locale display. */
function fmtDate(iso) {
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/* ── column definitions for the transactions table ────────────────── */
const columns = [
  {
    key: 'createdAt',
    header: 'Date',
    render: (row) => <span className="whitespace-nowrap">{fmtDate(row.createdAt)}</span>,
  },
  {
    key: 'type',
    header: 'Type',
    render: (row) => (
      <Badge color={TYPE_COLOR[row.type] ?? 'slate'}>{row.type}</Badge>
    ),
  },
  {
    key: 'amount',
    header: 'Amount',
    render: (row) => (
      <MoneyAmount
        pesewas={row.amount}
        signed={row.type === 'CREDIT' ? 'credit' : 'debit'}
      />
    ),
  },
  {
    key: 'reference',
    header: 'Reference',
    render: (row) => (
      <span className="font-mono text-xs text-slate-500">{row.reference}</span>
    ),
  },
];

/* ── component ────────────────────────────────────────────────────── */

export default function Dashboard() {
  const { user, account, loading: authLoading } = useAuth();

  const [transactions, setTransactions] = useState([]);
  const [txLoading, setTxLoading] = useState(false);
  const [txError, setTxError] = useState(null);

  const fetchTransactions = useCallback(async () => {
    setTxLoading(true);
    setTxError(null);
    try {
      const res = await api.get('/api/transactions', { params: { limit: 10 } });
      setTransactions(res.data.data.items ?? []);
    } catch (err) {
      setTxError(err.message || 'Failed to load transactions');
    } finally {
      setTxLoading(false);
    }
  }, []);

  useEffect(() => {
    if (account) fetchTransactions();
  }, [account, fetchTransactions]);

  /* ── auth still loading ──────────────────────────────────────── */
  if (authLoading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Spinner size="lg" />
      </div>
    );
  }

  /* ── no account yet ──────────────────────────────────────────── */
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

  const { credits, debits } = computeTotals(transactions);

  return (
    <div className="mx-auto max-w-5xl space-y-8 px-4 py-8">
      {/* Greeting */}
      <h1 className="text-2xl font-bold text-slate-900">
        Welcome back, {user?.firstName ?? 'Customer'}
      </h1>

      {/* Summary stat cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Account Number"
          value={account.accountNumber}
          accent="indigo"
        />
        <StatCard
          label="Account Type"
          value={account.accountType}
          accent="slate"
        />
        <StatCard
          label="Current Balance"
          value={pesewasToDisplay(account.balance)}
          accent="green"
        />
        <StatCard
          label="Status"
          value={
            <Badge color={STATUS_COLOR[account.status] ?? 'slate'}>
              {account.status}
            </Badge>
          }
          accent="amber"
        />
      </div>

      {/* Totals (computed from the fetched recent set) */}
      <div className="grid gap-4 sm:grid-cols-2">
        <StatCard
          label="Total Credits (recent)"
          value={<MoneyAmount pesewas={credits} signed="credit" />}
          accent="green"
        />
        <StatCard
          label="Total Debits (recent)"
          value={<MoneyAmount pesewas={debits} signed="debit" />}
          accent="red"
        />
      </div>

      {/* Recent transactions */}
      <Card title="Recent Transactions">
        {txLoading && (
          <div className="flex justify-center py-10">
            <Spinner size="lg" />
          </div>
        )}

        {txError && !txLoading && (
          <ErrorState message={txError} onRetry={fetchTransactions} />
        )}

        {!txLoading && !txError && (
          <Table
            columns={columns}
            rows={transactions}
            rowKey="_id"
            empty={
              <EmptyState
                title="No transactions"
                message="You haven't made any transactions yet."
                action={
                  <Link
                    to="/deposit"
                    className="text-sm font-medium text-indigo-600 hover:text-indigo-500"
                  >
                    Make your first deposit →
                  </Link>
                }
              />
            }
          />
        )}
      </Card>
    </div>
  );
}
