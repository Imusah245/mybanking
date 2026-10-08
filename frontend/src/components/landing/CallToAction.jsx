import { Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';

/**
 * CallToAction — a closing conversion band. White text on a vivid
 * brand-to-teal gradient; buttons use solid fills for strong contrast.
 */
export default function CallToAction() {
  const { user } = useAuth();

  return (
    <section className="bg-white py-16 sm:py-20">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="relative overflow-hidden rounded-3xl bg-gradient-to-r from-brand-700 via-brand-600 to-teal-600 px-6 py-14 text-center shadow-xl sm:px-12 sm:py-20">
          <div className="pointer-events-none absolute -right-16 -top-16 h-64 w-64 rounded-full bg-white/10 blur-2xl" aria-hidden="true" />
          <div className="pointer-events-none absolute -bottom-16 -left-16 h-64 w-64 rounded-full bg-white/10 blur-2xl" aria-hidden="true" />

          <h2 className="relative text-3xl font-extrabold tracking-tight text-white sm:text-4xl">
            Ready to take control of your money?
          </h2>
          <p className="relative mx-auto mt-4 max-w-2xl text-lg text-brand-50">
            Join thousands who bank smarter with MyBanking. Opening an account takes just a few minutes.
          </p>

          <div className="relative mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row">
            {user ? (
              <Link
                to="/dashboard"
                className="w-full rounded-xl bg-white px-8 py-3.5 text-center text-base font-bold text-brand-700 shadow-lg transition-colors hover:bg-brand-50 sm:w-auto"
              >
                Go to Dashboard
              </Link>
            ) : (
              <>
                <Link
                  to="/register"
                  className="w-full rounded-xl bg-white px-8 py-3.5 text-center text-base font-bold text-brand-700 shadow-lg transition-colors hover:bg-brand-50 sm:w-auto"
                >
                  Open an Account
                </Link>
                <Link
                  to="/login"
                  className="w-full rounded-xl bg-navy-900/30 px-8 py-3.5 text-center text-base font-bold text-white ring-1 ring-inset ring-white/40 transition-colors hover:bg-navy-900/50 sm:w-auto"
                >
                  Sign In
                </Link>
              </>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
