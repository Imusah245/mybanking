import { useState, useEffect, useCallback } from 'react';
import api from '../../lib/api';
import Card from '../../components/ui/Card';
import Table from '../../components/ui/Table';
import Pagination from '../../components/ui/Pagination';
import Spinner from '../../components/ui/Spinner';
import EmptyState from '../../components/ui/EmptyState';
import ErrorState from '../../components/ui/ErrorState';
import Input from '../../components/ui/Input';
import Button from '../../components/ui/Button';

const LIMIT = 10;

/** Format an ISO date string for display. */
function formatDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

/** Table column definitions. */
const columns = [
  {
    key: 'name',
    header: 'Name',
    render: (row) => (
      <span className="font-medium text-slate-900">
        {row.firstName} {row.lastName}
      </span>
    ),
  },
  {
    key: 'email',
    header: 'Email',
    render: (row) => (
      <span className="text-slate-600">{row.email}</span>
    ),
  },
  {
    key: 'phone',
    header: 'Phone',
    render: (row) => (
      <span className="text-slate-600">{row.phone || '—'}</span>
    ),
  },
  {
    key: 'role',
    header: 'Role',
    render: (row) => (
      <span className="text-xs font-medium uppercase tracking-wide text-slate-500">
        {row.role}
      </span>
    ),
  },
  {
    key: 'createdAt',
    header: 'Joined',
    render: (row) => (
      <span className="whitespace-nowrap text-slate-600">
        {formatDate(row.createdAt)}
      </span>
    ),
  },
];

/** Detail panel — shows full customer info below the selected row. */
function CustomerDetail({ customer, onClose }) {
  return (
    <Card className="mt-4">
      <div className="flex items-start justify-between">
        <h3 className="text-lg font-semibold text-slate-900">
          {customer.firstName} {customer.lastName}
        </h3>
        <Button variant="ghost" onClick={onClose} aria-label="Close detail">
          ✕
        </Button>
      </div>
      <dl className="mt-4 grid grid-cols-1 gap-x-8 gap-y-3 sm:grid-cols-2">
        {[
          ['Email', customer.email],
          ['Phone', customer.phone || '—'],
          ['Role', customer.role],
          ['Date of Birth', customer.dateOfBirth ? new Date(customer.dateOfBirth).toLocaleDateString('en-GB') : '—'],
          ['Address', customer.address || '—'],
          ['Joined', formatDate(customer.createdAt)],
          ['Customer ID', customer._id || customer.id],
        ].map(([label, value]) => (
          <div key={label}>
            <dt className="text-xs font-medium uppercase tracking-wide text-slate-400">
              {label}
            </dt>
            <dd className="mt-0.5 text-sm text-slate-700">{value}</dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}

export default function AdminCustomers() {
  /* ── filter state ──────────────────────────────────────────── */
  const [search, setSearch] = useState('');

  /* ── data state ────────────────────────────────────────────── */
  const [page, setPage] = useState(1);
  const [items, setItems] = useState([]);
  const [pagination, setPagination] = useState({ total: 0, page: 1, totalPages: 1 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  /* ── detail state ──────────────────────────────────────────── */
  const [selectedId, setSelectedId] = useState(null);

  /* ── fetch ─────────────────────────────────────────────────── */
  const fetchCustomers = useCallback(async (currentPage, currentSearch) => {
    setLoading(true);
    setError(null);

    try {
      const params = { page: currentPage, limit: LIMIT };
      if (currentSearch) params.search = currentSearch;

      const res = await api.get('/api/admin/customers', { params });
      const data = res.data.data;

      setItems(data.items || []);
      setPagination({
        total: data.total || 0,
        page: data.page || 1,
        totalPages: data.totalPages || 1,
      });
    } catch (err) {
      setError(err.message || 'Failed to load customers');
    } finally {
      setLoading(false);
    }
  }, []);

  /* ── fetch on mount ────────────────────────────────────────── */
  useEffect(() => {
    fetchCustomers(page, search);
  }, [page]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── handlers ──────────────────────────────────────────────── */
  const handleApply = () => {
    setPage(1);
    setSelectedId(null);
    fetchCustomers(1, search);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') handleApply();
  };

  const handlePageChange = (newPage) => {
    setPage(newPage);
    setSelectedId(null);
    fetchCustomers(newPage, search);
  };

  const handleRetry = () => {
    fetchCustomers(page, search);
  };

  const handleRowClick = (row) => {
    const id = row._id || row.id;
    setSelectedId((prev) => (prev === id ? null : id));
  };

  /* ── build clickable columns (wrap render to add cursor) ─── */
  const clickableColumns = columns.map((col) => ({
    ...col,
    render: (row, index) => (
      <button
        type="button"
        className="w-full text-left focus:outline-none"
        onClick={() => handleRowClick(row)}
        aria-label={`View details for ${row.firstName} ${row.lastName}`}
      >
        {col.render ? col.render(row, index) : row[col.key]}
      </button>
    ),
  }));

  const selectedCustomer = items.find(
    (c) => (c._id || c.id) === selectedId,
  );

  /* ── render ────────────────────────────────────────────────── */
  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-8">
      <h1 className="text-2xl font-bold text-slate-900">Customers</h1>

      {/* ── search bar ──────────────────────────────────────────── */}
      <Card>
        <div className="flex flex-wrap items-end gap-4">
          <Input
            label="Search"
            id="customer-search"
            placeholder="Search by name or email…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={handleKeyDown}
            className="min-w-[240px] flex-1"
          />
          <Button onClick={handleApply}>Apply</Button>
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
          title="No customers found"
          message="No customers match your search. Try a different term."
        />
      ) : (
        <>
          <Table
            columns={clickableColumns}
            rows={items}
            rowKey={(row) => row._id || row.id}
          />

          {selectedCustomer && (
            <CustomerDetail
              customer={selectedCustomer}
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
