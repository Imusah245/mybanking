/**
 * Badge — a small rounded status pill.
 *
 * props:
 *   children — label content
 *   color    — 'green' | 'red' | 'amber' | 'slate' | 'indigo' (default 'slate')
 *
 * Callers map domain values to colors, e.g.:
 *   account status: Active=green, Frozen=amber, Disabled=red
 *   txn type:       CREDIT=green, DEBIT=red, TRANSFER=indigo
 */

const COLORS = {
  green: 'bg-green-50 text-green-700 ring-green-600/20',
  red: 'bg-red-50 text-red-700 ring-red-600/20',
  amber: 'bg-amber-50 text-amber-700 ring-amber-600/20',
  slate: 'bg-slate-100 text-slate-700 ring-slate-500/20',
  indigo: 'bg-indigo-50 text-indigo-700 ring-indigo-600/20',
};

export default function Badge({ children, color = 'slate' }) {
  const colorClass = COLORS[color] ?? COLORS.slate;

  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${colorClass}`}
    >
      {children}
    </span>
  );
}
