import { useState } from 'react';
import { Outlet, useNavigate } from 'react-router-dom';

import { useAuth } from '../../context/AuthContext';
import Sidebar from './Sidebar';
import Topbar from './Topbar';
import MobileNav from './MobileNav';

/**
 * Admin-area navigation items.
 */
const NAV_ITEMS = [
  { to: '/admin/dashboard', label: 'Dashboard', icon: '▦' },
  { to: '/admin/customers', label: 'Customers', icon: '☺' },
  { to: '/admin/accounts', label: 'Accounts', icon: '◉' },
  { to: '/admin/transactions', label: 'Transactions', icon: '≡' },
];

const BRAND = 'MyBanking';

/**
 * AdminLayout — the shell for the admin area.
 *
 * Mirrors AppLayout's structure but uses a visually distinct, darker
 * admin-tinted sidebar (via the `accent="admin"` prop) to signal that the
 * operator is in the administrative area. The Topbar shows the admin's name
 * and a logout control that returns to the admin login. The routed page
 * renders in <Outlet />.
 */
export default function AdminLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);

  const fullName = user
    ? [user.firstName, user.lastName].filter(Boolean).join(' ') || user.email
    : '';

  function handleLogout() {
    logout();
    navigate('/admin/login');
  }

  const topbarRight = (
    <>
      <div className="hidden text-right sm:block">
        <div className="text-sm font-medium leading-tight text-slate-900">
          {fullName}
        </div>
        <div className="text-xs font-semibold uppercase tracking-wide text-amber-600">
          Administrator
        </div>
      </div>
      <div className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-800 text-sm font-semibold text-amber-400">
        {(fullName || '?').charAt(0).toUpperCase()}
      </div>
      <button
        type="button"
        onClick={handleLogout}
        className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
      >
        Logout
      </button>
    </>
  );

  return (
    <div className="flex min-h-screen bg-slate-100 text-slate-900">
      {/* Desktop sidebar */}
      <aside className="hidden md:block">
        <div className="sticky top-0 h-screen">
          <Sidebar items={NAV_ITEMS} title={BRAND} accent="admin" />
        </div>
      </aside>

      {/* Mobile drawer */}
      <MobileNav
        items={NAV_ITEMS}
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        title={BRAND}
        accent="admin"
      />

      {/* Main column */}
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar
          title="Admin Console"
          right={topbarRight}
          onMenuClick={() => setMenuOpen(true)}
        />
        <main className="flex-1 px-4 py-6 md:px-8 md:py-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
