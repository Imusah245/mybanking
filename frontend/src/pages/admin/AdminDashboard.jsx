import { useState, useEffect, useCallback } from 'react';
import {
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import api from '../../lib/api';
import { pesewasToDisplay } from '../../lib/money';
import Card from '../../components/ui/Card';
import StatCard from '../../components/ui/StatCard';
import Spinner from '../../components/ui/Spinner';
import ErrorState from '../../components/ui/ErrorState';

/* ── palette for transaction-type distribution ────────────────────── */
const COLORS = {
  deposits: '#16a34a', // green-600
  withdrawals: '#dc2626', // red-600
  transfers: '#4f46e5', // indigo-600
};

/* ── icons for the stat cards ─────────────────────────────────────── */
const Icon = ({ d }) => (
  <svg
    className="h-5 w-5"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    viewBox="0 0 24 24"
    aria-hidden="true"
  >
    <path strokeLinecap="round" strokeLinejoin="round" d={d} />
  </svg>
);

const ICONS = {
  customers:
    'M17 20h5v-2a4 4 0 00-3-3.87M9 20H4v-2a4 4 0 013-3.87m6-1.13a4 4 0 10-4-4 4 4 0 004 4z',
  accounts: 'M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z',
  deposits: 'M12 4v16m0 0l-4-4m4 4l4-4',
  withdrawals: 'M12 20V4m0 0L8 8m4-4l4 4',
  transfers: 'M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4',
  money: 'M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
};

export default function AdminDashboard() {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchStats = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get('/api/admin/statistics');
      setStats(res.data.data);
    } catch (err) {
      setError(err.message || 'Failed to load statistics');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  /* ── loading ─────────────────────────────────────────────────── */
  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Spinner size="lg" />
      </div>
    );
  }

  /* ── error ───────────────────────────────────────────────────── */
  if (error) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-12">
        <ErrorState message={error} onRetry={fetchStats} />
      </div>
    );
  }

  const {
    totalCustomers = 0,
    totalAccounts = 0,
    systemLiquidity = 0,
    totalDeposits = 0,
    totalWithdrawals = 0,
    totalTransfers = 0,
  } = stats ?? {};

  /* ── chart data (transaction-type distribution) ──────────────── */
  const chartData = [
    { name: 'Deposits', value: totalDeposits, fill: COLORS.deposits },
    { name: 'Withdrawals', value: totalWithdrawals, fill: COLORS.withdrawals },
    { name: 'Transfers', value: totalTransfers, fill: COLORS.transfers },
  ];

  const hasChartData = totalDeposits + totalWithdrawals + totalTransfers > 0;

  return (
    <div className="mx-auto max-w-6xl space-y-8 px-4 py-8">
      {/* Heading */}
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Admin Dashboard</h1>
        <p className="mt-1 text-sm text-slate-500">
          System-wide overview of customers, accounts, and transaction activity.
        </p>
      </div>

      {/* Stat cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard
          label="Total Customers"
          value={totalCustomers.toLocaleString()}
          accent="indigo"
          icon={<Icon d={ICONS.customers} />}
        />
        <StatCard
          label="Total Accounts"
          value={totalAccounts.toLocaleString()}
          accent="slate"
          icon={<Icon d={ICONS.accounts} />}
        />
        <StatCard
          label="Total Money Held"
          value={pesewasToDisplay(systemLiquidity)}
          accent="green"
          icon={<Icon d={ICONS.money} />}
        />
        <StatCard
          label="Total Deposits"
          value={totalDeposits.toLocaleString()}
          accent="green"
          icon={<Icon d={ICONS.deposits} />}
        />
        <StatCard
          label="Total Withdrawals"
          value={totalWithdrawals.toLocaleString()}
          accent="red"
          icon={<Icon d={ICONS.withdrawals} />}
        />
        <StatCard
          label="Total Transfers"
          value={totalTransfers.toLocaleString()}
          accent="indigo"
          icon={<Icon d={ICONS.transfers} />}
        />
      </div>

      {/* Charts */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Bar chart */}
        <Card title="Transactions by Type">
          {hasChartData ? (
            <div className="h-72 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={chartData}
                  margin={{ top: 8, right: 16, left: 0, bottom: 8 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis
                    dataKey="name"
                    tick={{ fontSize: 12, fill: '#64748b' }}
                    axisLine={{ stroke: '#cbd5e1' }}
                    tickLine={false}
                  />
                  <YAxis
                    allowDecimals={false}
                    tick={{ fontSize: 12, fill: '#64748b' }}
                    axisLine={{ stroke: '#cbd5e1' }}
                    tickLine={false}
                  />
                  <Tooltip
                    cursor={{ fill: 'rgba(148,163,184,0.1)' }}
                    contentStyle={{
                      borderRadius: 8,
                      border: '1px solid #e2e8f0',
                      fontSize: 12,
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar
                    dataKey="value"
                    name="Count"
                    radius={[6, 6, 0, 0]}
                    maxBarSize={72}
                  >
                    {chartData.map((entry) => (
                      <Cell key={entry.name} fill={entry.fill} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="py-16 text-center text-sm text-slate-500">
              No transaction activity to chart yet.
            </p>
          )}
        </Card>

        {/* Pie chart */}
        <Card title="Transaction Distribution">
          {hasChartData ? (
            <div className="h-72 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={chartData}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    outerRadius={90}
                    innerRadius={45}
                    paddingAngle={2}
                    label={({ name, percent }) =>
                      `${name} ${(percent * 100).toFixed(0)}%`
                    }
                    labelLine={false}
                  >
                    {chartData.map((entry) => (
                      <Cell key={entry.name} fill={entry.fill} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      borderRadius: 8,
                      border: '1px solid #e2e8f0',
                      fontSize: 12,
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="py-16 text-center text-sm text-slate-500">
              No transaction activity to chart yet.
            </p>
          )}
        </Card>
      </div>
    </div>
  );
}
