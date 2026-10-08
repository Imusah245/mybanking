import { NavLink } from 'react-router-dom';

/**
 * MobileNav — a slide-in drawer that surfaces the sidebar navigation on small
 * screens. It renders a dimmed backdrop and an off-canvas panel; it closes when
 * the backdrop is clicked or a nav item is selected.
 *
 * Props:
 *  - items: Array<{ to: string, label: string, icon?: React.ReactNode }>
 *  - open: boolean — whether the drawer is visible.
 *  - onClose: () => void — called on backdrop click or item selection.
 *  - title: string — brand/heading shown at the top of the drawer.
 *  - accent: 'customer' | 'admin' — tints the drawer to match the active area.
 */
export default function MobileNav({
  items = [],
  open,
  onClose,
  title,
  accent = 'customer',
}) {
  const isAdmin = accent === 'admin';
  const surface = isAdmin ? 'bg-slate-900' : 'bg-indigo-950';
  const brandAccent = isAdmin ? 'text-amber-400' : 'text-indigo-300';

  return (
    <div
      className={`fixed inset-0 z-40 md:hidden ${open ? '' : 'pointer-events-none'}`}
      aria-hidden={!open}
    >
      {/* Backdrop */}
      <div
        onClick={onClose}
        className={`absolute inset-0 bg-slate-900/60 transition-opacity duration-200 ${
          open ? 'opacity-100' : 'opacity-0'
        }`}
      />

      {/* Panel */}
      <div
        role="dialog"
        aria-modal="true"
        className={`absolute inset-y-0 left-0 flex w-72 max-w-[80%] flex-col text-slate-100 shadow-xl transition-transform duration-200 ease-out ${surface} ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex items-center justify-between px-6 py-6">
          <div className="flex items-center gap-2">
            <span className={`inline-flex h-9 w-9 items-center justify-center rounded-lg bg-white/10 text-lg font-bold ${brandAccent}`}>
              ₵
            </span>
            <div className="leading-tight">
              <div className="text-base font-semibold tracking-tight">{title}</div>
              {isAdmin && (
                <div className="text-[11px] font-medium uppercase tracking-wider text-amber-400">
                  Admin
                </div>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close navigation menu"
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-slate-300 hover:bg-white/10"
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <line x1="6" y1="6" x2="18" y2="18" />
              <line x1="6" y1="18" x2="18" y2="6" />
            </svg>
          </button>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-2">
          {items.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end
              onClick={onClose}
              className={({ isActive }) =>
                [
                  'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-indigo-600 text-white'
                    : 'text-slate-300 hover:bg-white/10 hover:text-white',
                ].join(' ')
              }
            >
              {item.icon ? (
                <span className="flex h-5 w-5 items-center justify-center text-base">
                  {item.icon}
                </span>
              ) : null}
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>
      </div>
    </div>
  );
}
