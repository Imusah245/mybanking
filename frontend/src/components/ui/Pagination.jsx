/**
 * Pagination — compact Prev / Next controls with a page indicator.
 *
 * props:
 *   page         — current 1-based page
 *   totalPages   — total number of pages
 *   onPageChange — fn(nextPage) called when a control is clicked
 */

import Button from './Button';

export default function Pagination({ page, totalPages, onPageChange }) {
  const total = Math.max(1, totalPages || 1);
  const current = Math.min(Math.max(1, page || 1), total);

  const atStart = current <= 1;
  const atEnd = current >= total;

  return (
    <nav
      className="flex items-center justify-between gap-4"
      aria-label="Pagination"
    >
      <Button
        variant="secondary"
        onClick={() => onPageChange(current - 1)}
        disabled={atStart}
        aria-label="Previous page"
      >
        Previous
      </Button>

      <span className="text-sm text-slate-600" aria-live="polite">
        Page {current} of {total}
      </span>

      <Button
        variant="secondary"
        onClick={() => onPageChange(current + 1)}
        disabled={atEnd}
        aria-label="Next page"
      >
        Next
      </Button>
    </nav>
  );
}
