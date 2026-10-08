/**
 * ErrorState — a centered error panel with an optional retry action.
 *
 * props:
 *   message — error message to display (falls back to a generic message)
 *   onRetry — optional fn; when provided, a Retry button is shown
 */

import Button from './Button';

export default function ErrorState({ message, onRetry }) {
  return (
    <div
      role="alert"
      className="flex flex-col items-center justify-center rounded-xl border border-red-200 bg-red-50 px-6 py-12 text-center"
    >
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-red-100 text-red-500">
        <svg
          className="h-6 w-6"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
      </div>
      <h3 className="text-base font-semibold text-red-800">
        Something went wrong
      </h3>
      <p className="mt-1 max-w-sm text-sm text-red-700">
        {message || 'An unexpected error occurred. Please try again.'}
      </p>
      {onRetry && (
        <div className="mt-5">
          <Button variant="secondary" onClick={onRetry}>
            Retry
          </Button>
        </div>
      )}
    </div>
  );
}
