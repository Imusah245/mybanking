import { useState } from 'react';
import { Outlet, useNavigate } from 'react-router-dom';

import { useAuth } from '../../context/AuthContext';
import { pesewasToDisplay } from '../../lib/money';
import Sidebar from './Sidebar';
import Topbar from './Topbar';
import MobileNav from './MobileNav';

/**
 * Customer-area navigation items. Icons are simple emoji glyphs to keep the
 * layout self-contained (no dependency on the ui/ icon set).
 */
const NAV_ITEMS = [
  { to: '/dashboard', label: 'Dashboard', icon: '▦' },
  { to: '/account', label: 'Account', icon: '◉' },
  { to: '/deposit', label: 'Deposit', icon: '↓' },
  { to: '/withdraw', label: 'Withdraw', icon: '↑' },
  { to: '/transfer', label: 'Transfer', icon: '⇄' },
  { to: '/transactions', label: 'Transactions', icon: '≡' },
  { to: '/profile', label: 'Profile', icon: '☺' },
];

const BRAND = 'MyBanking';

/**
 * AppLayout — the shell for the authenticated customer area.
 *
 * Renders a persistent left sidebar on md+ screens, a slide-in MobileNav on
 * small screens, and a Topbar carrying the signed-in user's name, current
 * balance, and a logout control. The routed page renders in <Outlet />.
 */
export default function AppLayout() {
  const { user, account, logout } = useAuth();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);

  const fullName = user
    ? [user.firstName, user.lastName].filter(Boolean).join(' ') || user.email
    : '';

  const balanceLabel =
    account && typeof account.balance === 'number'
      ? pesewasToDisplay(account.balance)
      : null;

  function handleLogout() {
    logout();
    navigate('/login');
  }

  const topbarRight = (
    <>
      <div className="hidden text-right sm:block">
        <div className="text-sm font-medium leading-tight text-slate-900">
          {fullName}
        </div>
        {balanceLabel && (
          <div className="text-xs font-semibold text-indigo-600">
            {balanceLabel}
          </div>
        )}
      </div>
      <div className="flex h-9 w-9 items-center justify-center rounded-full bg-indigo-100 text-sm font-semibold text-indigo-700">
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
    <div className="flex min-h-screen bg-slate-50 text-slate-900">
      {/* Desktop sidebar */}
      <aside className="hidden md:block">
        <div className="sticky top-0 h-screen">
          <Sidebar items={NAV_ITEMS} title={BRAND} accent="customer" />
        </div>
      </aside>

      {/* Mobile drawer */}
      <MobileNav
        items={NAV_ITEMS}
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        title={BRAND}
        accent="customer"
      />

      {/* Main column */}
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar
          title="Dashboard"
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
