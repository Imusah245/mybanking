/**
 * Spinner — an animated indigo loading indicator.
 *
 * props:
 *   size      — one of 'sm' | 'md' | 'lg' (default 'md') or a tailwind size class
 *   className — extra classes applied to the SVG
 */

const SIZE_CLASSES = {
  sm: 'h-4 w-4',
  md: 'h-6 w-6',
  lg: 'h-10 w-10',
};

export default function Spinner({ size = 'md', className = '' }) {
  const sizeClass = SIZE_CLASSES[size] ?? size ?? SIZE_CLASSES.md;

  return (
    <svg
      className={`animate-spin text-indigo-600 ${sizeClass} ${className}`}
      viewBox="0 0 24 24"
      fill="none"
      role="status"
      aria-label="Loading"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
      />
    </svg>
  );
}
