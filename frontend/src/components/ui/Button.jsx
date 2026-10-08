/**
 * Button — the primary action control for the app.
 *
 * props:
 *   children  — button label / content
 *   variant   — 'primary' | 'secondary' | 'danger' | 'ghost' (default 'primary')
 *   type      — native button type (default 'button')
 *   disabled  — when true, the button is disabled
 *   loading   — when true, shows a spinner AND disables the button
 *   onClick   — click handler
 *   className — extra classes merged after the variant styles
 *   ...rest   — forwarded to the underlying <button>
 *
 * When `loading` or `disabled` is true the button is actually disabled.
 */

import Spinner from './Spinner';

const BASE =
  'inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold ' +
  'transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 ' +
  'disabled:opacity-60 disabled:cursor-not-allowed';

const VARIANTS = {
  primary:
    'bg-indigo-600 text-white hover:bg-indigo-700 focus-visible:ring-indigo-500 ' +
    'disabled:hover:bg-indigo-600',
  secondary:
    'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 ' +
    'focus-visible:ring-slate-400 disabled:hover:bg-white',
  danger:
    'bg-red-600 text-white hover:bg-red-700 focus-visible:ring-red-500 ' +
    'disabled:hover:bg-red-600',
  ghost:
    'bg-transparent text-slate-600 hover:bg-slate-100 hover:text-slate-900 ' +
    'focus-visible:ring-slate-400 disabled:hover:bg-transparent',
};

export default function Button({
  children,
  variant = 'primary',
  type = 'button',
  disabled = false,
  loading = false,
  onClick,
  className = '',
  ...rest
}) {
  const isDisabled = disabled || loading;
  const variantClass = VARIANTS[variant] ?? VARIANTS.primary;

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={isDisabled}
      aria-busy={loading || undefined}
      className={`${BASE} ${variantClass} ${className}`}
      {...rest}
    >
      {loading && <Spinner size="sm" className="text-current" />}
      {children}
    </button>
  );
}
