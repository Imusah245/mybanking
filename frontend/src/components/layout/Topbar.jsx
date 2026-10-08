/**
 * Topbar — the horizontal header shown above the main content area.
 *
 * Props:
 *  - title: string — the page or brand title shown on the left.
 *  - right: React.ReactNode — a slot for the right side (user name, balance,
 *           logout button, etc.).
 *  - onMenuClick: () => void — opens the mobile nav; the hamburger button is
 *           only visible below the md breakpoint.
 */
export default function Topbar({ title, right, onMenuClick }) {
  return (
    <header className="sticky top-0 z-20 flex h-16 items-center justify-between gap-4 border-b border-slate-200 bg-white/90 px-4 backdrop-blur md:px-8">
      <div className="flex items-center gap-3">
        {/* Hamburger — mobile only */}
        <button
          type="button"
          onClick={onMenuClick}
          aria-label="Open navigation menu"
          className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100 md:hidden"
        >
          <svg
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <line x1="3" y1="6" x2="21" y2="6" />
            <line x1="3" y1="12" x2="21" y2="12" />
            <line x1="3" y1="18" x2="21" y2="18" />
          </svg>
        </button>

        <h1 className="text-lg font-semibold tracking-tight text-slate-900">
          {title}
        </h1>
      </div>

      {right ? <div className="flex items-center gap-3">{right}</div> : null}
    </header>
  );
}
