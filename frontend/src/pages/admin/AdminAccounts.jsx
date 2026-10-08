import { useState, useEffect, useCallback } from 'react';
import api from '../../lib/api';
import { useToast } from '../../context/ToastContext';
import Card from '../../components/ui/Card';
import Table from '../../components/ui/Table';
import Pagination from '../../components/ui/Pagination';
import Spinner from '../../components/ui/Spinner';
import EmptyState from '../../components/ui/EmptyState';
import ErrorState from '../../components/ui/ErrorState';
import Badge from '../../components/ui/Badge';
import MoneyAmount from '../../components/ui/MoneyAmount';
import Button from '../../components/ui/Button';
import ConfirmDialog from '../../components/ui/ConfirmDialog';

const LIMIT = 10;

/** Map account status to Badge colour. */
const STATUS_COLOR = {
  Active: 'green',
  Frozen: 'amber',
  Disabled: 'red',
};

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

export default function AdminAccounts() {
  const toast = useToast();

  /* ── data state ────────────────────────────────────────────── */
  const [page, setPage] = useState(1);
  const [items, setItems] = useState([]);
  const [pagination, setPagination] = useState({ total: 0, page: 1, totalPages: 1 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  /* ── confirm dialog state ──────────────────────────────────── */
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmTarget, setConfirmTarget] = useState(null); // { id, accountNumber, newStatus }
  const [confirmLoading, setConfirmLoading] = useState(false);

  /* ── fetch ─────────────────────────────────────────────────── */
  const fetchAccounts = useCallback(async (currentPage) => {
    setLoading(true);
    setError(null);

    try {
      const res = await api.get('/api/admin/accounts', {
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
      setError(err.message || 'Failed to load accounts');
    } finally {
      setLoading(false);
    }
  }, []);

  /* ── fetch on mount and page change ────────────────────────── */
  useEffect(() => {
    fetchAccounts(page);
  }, [page, fetchAccounts]);

  /* ── handlers ──────────────────────────────────────────────── */
  const handlePageChange = (newPage) => {
    setPage(newPage);
  };

  const handleRetry = () => {
    fetchAccounts(page);
  };

  /** Open the confirm dialog for a status toggle. */
  const openStatusConfirm = (account) => {
    const isActive = account.status === 'Active';
    setConfirmTarget({
      id: account._id,
      accountNumber: account.accountNumber,
      newStatus: isActive ? 'Disabled' : 'Active',
    });
    setConfirmOpen(true);
  };

  /** Execute the status update. */
  const handleConfirm = async () => {
    if (!confirmTarget) return;

    setConfirmLoading(true);
    try {
      await api.put(`/api/admin/accounts/${confirmTarget.id}/status`, {
        status: confirmTarget.newStatus,
      });
      toast.success(
        `Account ${confirmTarget.accountNumber} set to ${confirmTarget.newStatus}`,
      );
      setConfirmOpen(false);
      setConfirmTarget(null);
      // Refetch the current page to reflect the change.
      fetchAccounts(page);
    } catch (err) {
      toast.error(err.message || 'Failed to update account status');
    } finally {
      setConfirmLoading(false);
    }
  };

  const handleCancelConfirm = () => {
    if (confirmLoading) return;
    setConfirmOpen(false);
    setConfirmTarget(null);
  };

  /* ── columns ───────────────────────────────────────────────── */
  const columns = [
    {
      key: 'accountNumber',
      header: 'Account #',
      render: (row) => (
        <span className="font-mono text-sm text-slate-900">
          {row.accountNumber}
        </span>
      ),
    },
    {
      key: 'userId',
      header: 'Owner',
      render: (row) => (
        <span className="truncate text-xs text-slate-500" title={row.userId}>
          {row.userId}
        </span>
      ),
    },
    {
      key: 'accountType',
      header: 'Type',
      render: (row) => (
        <span className="text-sm text-slate-700">{row.accountType}</span>
      ),
    },
    {
      key: 'balance',
      header: 'Balance',
      render: (row) => <MoneyAmount pesewas={row.balance} />,
    },
    {
      key: 'status',
      header: 'Status',
      render: (row) => (
        <Badge color={STATUS_COLOR[row.status] ?? 'slate'}>
          {row.status}
        </Badge>
      ),
    },
    {
      key: 'createdAt',
      header: 'Created',
      render: (row) => (
        <span className="whitespace-nowrap text-slate-600">
          {formatDate(row.createdAt)}
        </span>
      ),
    },
    {
      key: 'actions',
      header: 'Action',
      render: (row) => {
        const isActive = row.status === 'Active';
        return (
          <Button
            variant={isActive ? 'danger' : 'primary'}
            onClick={() => openStatusConfirm(row)}
            className="text-xs"
          >
            {isActive ? 'Deactivate' : 'Activate'}
          </Button>
        );
      },
    },
  ];

  /* ── render ────────────────────────────────────────────────── */
  return (
    <div className="mx-auto max-w-7xl space-y-6 px-4 py-8">
      <h1 className="text-2xl font-bold text-slate-900">Accounts</h1>

      {loading ? (
        <div className="flex items-center justify-center py-24">
          <Spinner size="lg" />
        </div>
      ) : error ? (
        <ErrorState message={error} onRetry={handleRetry} />
      ) : items.length === 0 ? (
        <EmptyState
          title="No accounts"
          message="There are no accounts in the system yet."
        />
      ) : (
        <>
          <Card>
            <Table
              columns={columns}
              rows={items}
              rowKey={(row) => row._id}
            />
          </Card>

          {pagination.totalPages > 1 && (
            <Pagination
              page={pagination.page}
              totalPages={pagination.totalPages}
              onPageChange={handlePageChange}
            />
          )}
        </>
      )}

      {/* ── confirm dialog ────────────────────────────────────── */}
      <ConfirmDialog
        open={confirmOpen}
        title="Change Account Status"
        message={
          confirmTarget
            ? `Set account ${confirmTarget.accountNumber} to ${confirmTarget.newStatus}?`
            : ''
        }
        confirmLabel={
          confirmTarget?.newStatus === 'Active' ? 'Activate' : 'Deactivate'
        }
        onConfirm={handleConfirm}
        onCancel={handleCancelConfirm}
        loading={confirmLoading}
        danger={confirmTarget?.newStatus === 'Disabled'}
      />
    </div>
  );
}
