import { Link } from 'react-router-dom';

const PRODUCT_LINKS = [
  { label: 'Features', href: '#features' },
  { label: 'How it works', href: '#how-it-works' },
  { label: 'Services', href: '#services' },
  { label: 'Security', href: '#security' },
];

const ACCOUNT_LINKS = [
  { label: 'Open an Account', to: '/register' },
  { label: 'Sign In', to: '/login' },
];

/**
 * Footer — the closing site footer. Light text on a deep navy surface
 * for strong contrast; the lowest row carries the copyright line.
 */
export default function Footer() {
  const year = new Date().getFullYear();

  return (
    <footer className="bg-navy-950 text-navy-200">
      <div className="mx-auto max-w-7xl px-4 py-14 sm:px-6 lg:px-8">
        <div className="grid gap-10 md:grid-cols-4">
          <div className="md:col-span-2">
            <div className="flex items-center gap-2">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-500 to-teal-400 font-extrabold text-white">
                M
              </span>
              <span className="text-lg font-extrabold tracking-tight text-white">
                My<span className="text-brand-400">Banking</span>
              </span>
            </div>
            <p className="mt-4 max-w-sm text-sm leading-relaxed text-navy-300">
              Simple, secure and accessible digital banking. Manage your money with confidence,
              anytime and anywhere.
            </p>
          </div>

          <div>
            <h3 className="text-sm font-bold uppercase tracking-wide text-white">Product</h3>
            <ul className="mt-4 space-y-3">
              {PRODUCT_LINKS.map((link) => (
                <li key={link.href}>
                  <a href={link.href} className="text-sm text-navy-300 transition-colors hover:text-white">
                    {link.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h3 className="text-sm font-bold uppercase tracking-wide text-white">Account</h3>
            <ul className="mt-4 space-y-3">
              {ACCOUNT_LINKS.map((link) => (
                <li key={link.to}>
                  <Link to={link.to} className="text-sm text-navy-300 transition-colors hover:text-white">
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="mt-12 flex flex-col items-center justify-between gap-4 border-t border-white/10 pt-8 sm:flex-row">
          <p className="text-sm text-navy-400">&copy; {year} MyBanking. All rights reserved.</p>
          <p className="text-sm text-navy-400">Built for secure, everyday banking.</p>
        </div>
      </div>
    </footer>
  );
}
