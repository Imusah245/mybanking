/**
 * Toast — a single notification pill.
 *
 * Colored by type:
 *   success -> green
 *   error   -> red
 *   info    -> slate
 *
 * Accessible: errors use role="alert" (assertive), others role="status".
 */

const TYPE_STYLES = {
  success: {
    container: 'bg-green-50 border-green-500 text-green-800',
    icon: 'text-green-500',
    close: 'text-green-500 hover:bg-green-100',
  },
  error: {
    container: 'bg-red-50 border-red-500 text-red-800',
    icon: 'text-red-500',
    close: 'text-red-500 hover:bg-red-100',
  },
  info: {
    container: 'bg-slate-50 border-slate-400 text-slate-800',
    icon: 'text-slate-500',
    close: 'text-slate-500 hover:bg-slate-100',
  },
};

const ICONS = {
  success: 'M5 13l4 4L19 7',
  error: 'M6 18L18 6M6 6l12 12',
  info: 'M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
};

export default function Toast({ type = 'info', message, onClose }) {
  const styles = TYPE_STYLES[type] ?? TYPE_STYLES.info;

  return (
    <div
      role={type === 'error' ? 'alert' : 'status'}
      aria-live={type === 'error' ? 'assertive' : 'polite'}
      className={`flex items-start gap-3 w-80 max-w-[90vw] rounded-lg border-l-4 px-4 py-3 shadow-lg ${styles.container}`}
    >
      <svg
        className={`mt-0.5 h-5 w-5 flex-shrink-0 ${styles.icon}`}
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        viewBox="0 0 24 24"
        aria-hidden="true"
      >
        <path strokeLinecap="round" strokeLinejoin="round" d={ICONS[type] ?? ICONS.info} />
      </svg>

      <p className="flex-1 text-sm font-medium leading-snug break-words">{message}</p>

      <button
        type="button"
        onClick={onClose}
        aria-label="Dismiss notification"
        className={`-mr-1 -mt-1 flex-shrink-0 rounded p-1 transition-colors ${styles.close}`}
      >
        <svg
          className="h-4 w-4"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}
