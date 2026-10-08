import { NavLink } from 'react-router-dom';

/**
 * Sidebar — a vertical navigation column shared by the customer and admin
 * layouts. The caller supplies the brand `title` and the `items` to render.
 *
 * Props:
 *  - items: Array<{ to: string, label: string, icon?: React.ReactNode }>
 *  - title: string — brand/heading shown at the top.
 *  - accent: 'customer' | 'admin' — tints the surface so the admin area reads
 *            as visually distinct from the customer area.
 *
 * Active links get an indigo highlight via NavLink's isActive state.
 */
export default function Sidebar({ items = [], title, accent = 'customer' }) {
  const isAdmin = accent === 'admin';

  // Darker, admin-tinted surface vs. the deep indigo customer surface.
  const surface = isAdmin
    ? 'bg-slate-900 border-slate-800'
    : 'bg-indigo-950 border-indigo-900';

  const brandAccent = isAdmin ? 'text-amber-400' : 'text-indigo-300';

  return (
    <div className={`flex h-full w-64 flex-col border-r ${surface} text-slate-100`}>
      {/* Brand / title */}
      <div className="flex items-center gap-2 px-6 py-6">
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

      {/* Navigation */}
      <nav className="flex-1 space-y-1 px-3 py-2">
        {items.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end
            className={({ isActive }) =>
              [
                'group flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
                isActive
                  ? 'bg-indigo-600 text-white shadow-sm'
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

      {/* Footer */}
      <div className="px-6 py-4 text-[11px] text-slate-400">
        MyBanking &copy; {new Date().getFullYear()}
      </div>
    </div>
  );
}
