import { useState, useEffect, useCallback } from 'react';
import api from '../../lib/api';
import Card from '../../components/ui/Card';
import Table from '../../components/ui/Table';
import Pagination from '../../components/ui/Pagination';
import Spinner from '../../components/ui/Spinner';
import EmptyState from '../../components/ui/EmptyState';
import ErrorState from '../../components/ui/ErrorState';
import Badge from '../../components/ui/Badge';
import MoneyAmount from '../../components/ui/MoneyAmount';
import Button from '../../components/ui/Button';

const LIMIT = 10;

/** Map transaction type to Badge colour. */
const TYPE_COLOR = {
  CREDIT: 'green',
  DEBIT: 'red',
  TRANSFER: 'indigo',
};

/** Format an ISO date string for display. */
function formatDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Detail panel — shows full transaction info below the selected row. */
function TransactionDetail({ txn, onClose }) {
  return (
    <Card className="mt-4">
      <div className="flex items-start justify-between">
        <h3 className="text-lg font-semibold text-slate-900">
          Transaction Detail
        </h3>
        <Button variant="ghost" onClick={onClose} aria-label="Close detail">
          ✕
        </Button>
      </div>
      <dl className="mt-4 grid grid-cols-1 gap-x-8 gap-y-3 sm:grid-cols-2">
        {[
          ['Transaction ID', txn._id || txn.id],
          ['Type', txn.type],
          ['Amount', null], // rendered specially below
          ['Reference', txn.reference],
          ['Description', txn.description || '—'],
          ['Status', txn.status || '—'],
          ['Balance After', null], // rendered specially below
          ['Account', txn.accountId || '—'],
          ['Recipient Account', txn.recipientAccountNumber || '—'],
          ['Date', formatDate(txn.createdAt)],
        ].map(([label, value]) => (
          <div key={label}>
            <dt className="text-xs font-medium uppercase tracking-wide text-slate-400">
              {label}
            </dt>
            <dd className="mt-0.5 text-sm text-slate-700">
              {label === 'Amount' ? (
                <MoneyAmount pesewas={txn.amount} />
              ) : label === 'Balance After' ? (
                txn.balanceAfter != null ? (
                  <MoneyAmount pesewas={txn.balanceAfter} />
                ) : (
                  '—'
                )
              ) : (
                value
              )}
            </dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}

export default function AdminTransactions() {
  /* ── data state ────────────────────────────────────────────── */
  const [page, setPage] = useState(1);
  const [items, setItems] = useState([]);
  const [pagination, setPagination] = useState({ total: 0, page: 1, totalPages: 1 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  /* ── detail state ──────────────────────────────────────────── */
  const [selectedId, setSelectedId] = useState(null);

  /* ── fetch ─────────────────────────────────────────────────── */
  const fetchTransactions = useCallback(async (currentPage) => {
    setLoading(true);
    setError(null);

    try {
      const res = await api.get('/api/admin/transactions', {
        params: { page: currentPage, limit: LIMIT },
      });
      const data = res.data.data;

      setItems(data.items || []);
      setPagination({
        total: data.total || 0,
        page: data.page || 1,
        totalPages: data.totalPages || 1,
      });
    } catch (err) {
      setError(err.message || 'Failed to load transactions');
    } finally {
      setLoading(false);
    }
  }, []);

  /* ── fetch on mount and page change ────────────────────────── */
  useEffect(() => {
    fetchTransactions(page);
  }, [page, fetchTransactions]);

  /* ── handlers ──────────────────────────────────────────────── */
  const handlePageChange = (newPage) => {
    setPage(newPage);
    setSelectedId(null);
  };

  const handleRetry = () => {
    fetchTransactions(page);
  };

  const handleRowClick = (row) => {
    const id = row._id || row.id;
    setSelectedId((prev) => (prev === id ? null : id));
  };

  /* ── base columns ──────────────────────────────────────────── */
  const baseColumns = [
    {
      key: 'createdAt',
      header: 'Date',
      render: (row) => (
        <span className="whitespace-nowrap text-slate-600">
          {formatDate(row.createdAt)}
        </span>
      ),
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
      render: (row) => <MoneyAmount pesewas={row.amount} />,
    },
    {
      key: 'reference',
      header: 'Reference',
      render: (row) => (
        <span className="font-mono text-xs text-slate-500">
          {row.reference}
        </span>
      ),
    },
    {
      key: 'description',
      header: 'Description',
      render: (row) => (
        <span className="max-w-[200px] truncate" title={row.description}>
          {row.description || '—'}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (row) => (
        <span className="text-sm text-slate-600">{row.status || '—'}</span>
      ),
    },
    {
      key: 'balanceAfter',
      header: 'Balance After',
      render: (row) =>
        row.balanceAfter != null ? (
          <MoneyAmount pesewas={row.balanceAfter} />
        ) : (
          <span className="text-slate-400">—</span>
        ),
    },
  ];

  /* ── wrap columns to make rows clickable ───────────────────── */
  const clickableColumns = baseColumns.map((col) => ({
    ...col,
    render: (row, index) => (
      <button
        type="button"
        className="w-full text-left focus:outline-none"
        onClick={() => handleRowClick(row)}
        aria-label={`View details for transaction ${row.reference}`}
      >
        {col.render ? col.render(row, index) : row[col.key]}
      </button>
    ),
  }));

  const selectedTxn = items.find((t) => (t._id || t.id) === selectedId);

  /* ── render ────────────────────────────────────────────────── */
  return (
    <div className="mx-auto max-w-7xl space-y-6 px-4 py-8">
      <h1 className="text-2xl font-bold text-slate-900">Transactions</h1>

      {loading ? (
        <div className="flex items-center justify-center py-24">
          <Spinner size="lg" />
        </div>
      ) : error ? (
        <ErrorState message={error} onRetry={handleRetry} />
      ) : items.length === 0 ? (
        <EmptyState
          title="No transactions"
          message="There are no transactions in the system yet."
        />
      ) : (
        <>
          <Table
            columns={clickableColumns}
            rows={items}
            rowKey={(row) => row._id || row.id}
          />

          {selectedTxn && (
            <TransactionDetail
              txn={selectedTxn}
              onClose={() => setSelectedId(null)}
            />
          )}

          {pagination.totalPages > 1 && (
            <Pagination
              page={pagination.page}
              totalPages={pagination.totalPages}
              onPageChange={handlePageChange}
            />
          )}
        </>
      )}
    </div>
  );
}
