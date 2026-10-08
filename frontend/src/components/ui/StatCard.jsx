/**
 * StatCard — a dashboard stat tile.
 *
 * props:
 *   label  — small descriptive label
 *   value  — large value (string or node)
 *   icon   — optional node rendered in a colored badge
 *   accent — optional accent color key: 'indigo' | 'green' | 'red' | 'amber' | 'slate'
 *            (default 'indigo'). Drives the left accent bar and icon badge.
 */

const ACCENTS = {
  indigo: { bar: 'bg-indigo-500', badge: 'bg-indigo-50 text-indigo-600' },
  green: { bar: 'bg-green-500', badge: 'bg-green-50 text-green-600' },
  red: { bar: 'bg-red-500', badge: 'bg-red-50 text-red-600' },
  amber: { bar: 'bg-amber-500', badge: 'bg-amber-50 text-amber-600' },
  slate: { bar: 'bg-slate-500', badge: 'bg-slate-100 text-slate-600' },
};

export default function StatCard({ label, value, icon, accent = 'indigo' }) {
  const colors = ACCENTS[accent] ?? ACCENTS.indigo;

  return (
    <div className="relative overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <span className={`absolute inset-y-0 left-0 w-1 ${colors.bar}`} aria-hidden="true" />
      <div className="flex items-start justify-between gap-3 p-5 pl-6">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-slate-500">{label}</p>
          <p className="mt-1 text-2xl font-bold tracking-tight text-slate-900">
            {value}
          </p>
        </div>
        {icon && (
          <span
            className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg ${colors.badge}`}
            aria-hidden="true"
          >
            {icon}
          </span>
        )}
      </div>
    </div>
  );
}
