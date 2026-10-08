import { useState, useEffect, useCallback } from 'react';
import api from '../lib/api';
import Card from '../components/ui/Card';
import Table from '../components/ui/Table';
import Pagination from '../components/ui/Pagination';
import Spinner from '../components/ui/Spinner';
import EmptyState from '../components/ui/EmptyState';
import ErrorState from '../components/ui/ErrorState';
import Badge from '../components/ui/Badge';
import MoneyAmount from '../components/ui/MoneyAmount';
import Input from '../components/ui/Input';
import Button from '../components/ui/Button';

const LIMIT = 10;

/** Map transaction type to Badge colour. */
const TYPE_COLOR = {
  CREDIT: 'green',
  DEBIT: 'red',
  TRANSFER: 'indigo',
};

/** Map transaction type to MoneyAmount signed prop. */
const TYPE_SIGNED = {
  CREDIT: 'credit',
  DEBIT: 'debit',
  TRANSFER: 'debit',
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

/** Table column definitions. */
const columns = [
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
    render: (row) => (
      <MoneyAmount
        pesewas={row.amount}
        signed={TYPE_SIGNED[row.type]}
      />
    ),
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
    key: 'balanceAfter',
    header: 'Balance After',
    render: (row) => <MoneyAmount pesewas={row.balanceAfter} />,
  },
];

export default function Transactions() {
  /* ── filter state ───────────────────────────────────────────── */
  const [search, setSearch] = useState('');
  const [type, setType] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  /* ── data state ─────────────────────────────────────────────── */
  const [page, setPage] = useState(1);
  const [items, setItems] = useState([]);
  const [pagination, setPagination] = useState({ total: 0, page: 1, totalPages: 1 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  /* ── fetch ──────────────────────────────────────────────────── */
  const fetchTransactions = useCallback(async (currentPage, filters) => {
    setLoading(true);
    setError(null);

    try {
      const params = { page: currentPage, limit: LIMIT };

      if (filters.search) params.search = filters.search;
      if (filters.type) params.type = filters.type;
      if (filters.startDate) params.startDate = new Date(filters.startDate).toISOString();
      if (filters.endDate) {
        // End of the selected day
        const end = new Date(filters.endDate);
        end.setHours(23, 59, 59, 999);
        params.endDate = end.toISOString();
      }

      const res = await api.get('/api/transactions', { params });
      const data = res.data.data;

      setItems(data.items || []);
      setPagination(data.pagination || { total: 0, page: 1, totalPages: 1 });
    } catch (err) {
      setError(err.message || 'Failed to load transactions');
    } finally {
      setLoading(false);
    }
  }, []);

  /* ── fetch on mount and whenever page changes ───────────────── */
  useEffect(() => {
    fetchTransactions(page, { search, type, startDate, endDate });
  }, [page, fetchTransactions]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── handlers ───────────────────────────────────────────────── */
  const handleApply = () => {
    setPage(1);
    fetchTransactions(1, { search, type, startDate, endDate });
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') handleApply();
  };

  const handlePageChange = (newPage) => {
    setPage(newPage);
    fetchTransactions(newPage, { search, type, startDate, endDate });
  };

  const handleRetry = () => {
    fetchTransactions(page, { search, type, startDate, endDate });
  };

  /* ── render ─────────────────────────────────────────────────── */
  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-8">
      <h1 className="text-2xl font-bold text-slate-900">Transaction History</h1>

      {/* ── filter bar ──────────────────────────────────────────── */}
      <Card>
        <div className="flex flex-wrap items-end gap-4">
          <Input
            label="Search"
            id="txn-search"
            placeholder="Search description or reference..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={handleKeyDown}
            className="min-w-[200px] flex-1"
          />

          <div className="min-w-[140px]">
            <label
              htmlFor="txn-type"
              className="mb-1 block text-sm font-medium text-slate-700"
            >
              Type
            </label>
            <select
              id="txn-type"
              value={type}
              onChange={(e) => setType(e.target.value)}
              className="block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm transition-colors focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            >
              <option value="">All</option>
              <option value="CREDIT">Credit</option>
              <option value="DEBIT">Debit</option>
              <option value="TRANSFER">Transfer</option>
            </select>
          </div>

          <Input
            label="Start Date"
            id="txn-start-date"
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="min-w-[150px]"
          />

          <Input
            label="End Date"
            id="txn-end-date"
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="min-w-[150px]"
          />

          <Button onClick={handleApply}>Search</Button>
        </div>
      </Card>

      {/* ── content ─────────────────────────────────────────────── */}
      {loading ? (
        <div className="flex items-center justify-center py-24">
          <Spinner size="lg" />
        </div>
      ) : error ? (
        <ErrorState message={error} onRetry={handleRetry} />
      ) : items.length === 0 ? (
        <EmptyState
          title="No transactions"
          message="No transactions match your current filters. Try adjusting the search or date range."
        />
      ) : (
        <>
          <Table
            columns={columns}
            rows={items}
            rowKey="_id"
          />

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
