import { Link } from 'react-router-dom';
import heroDashboard from '../../assets/hero-dashboard.svg';

/**
 * Hero — the opening section. Dark navy gradient background with a subtle
 * dot-grid texture and white text (high contrast), a paired illustration,
 * and two CTAs.
 */
export default function Hero() {
  return (
    <section
      id="home"
      className="relative overflow-hidden bg-gradient-to-br from-navy-900 via-navy-800 to-brand-800"
    >
      {/* texture + decorative glows */}
      <div className="pointer-events-none absolute inset-0 bg-dot-grid opacity-70" aria-hidden="true" />
      <div className="pointer-events-none absolute -right-24 -top-24 h-96 w-96 rounded-full bg-teal-500/25 blur-3xl" aria-hidden="true" />
      <div className="pointer-events-none absolute -bottom-32 -left-24 h-96 w-96 rounded-full bg-brand-500/25 blur-3xl" aria-hidden="true" />
      <div className="pointer-events-none absolute left-1/2 top-1/3 h-72 w-72 -translate-x-1/2 rounded-full bg-accent-500/10 blur-3xl" aria-hidden="true" />

      <div className="relative mx-auto grid max-w-7xl items-center gap-12 px-4 py-20 sm:px-6 lg:grid-cols-2 lg:px-8 lg:py-28">
        <div className="animate-fade-in-up text-center lg:text-left">
          <span className="inline-flex items-center gap-2 rounded-full bg-white/10 px-4 py-1.5 text-sm font-semibold text-teal-200 ring-1 ring-inset ring-white/20">
            <span className="h-2 w-2 animate-pulse rounded-full bg-accent-400" />
            Trusted digital banking
          </span>

          <h1 className="mt-6 text-4xl font-extrabold leading-tight tracking-tight text-white sm:text-5xl lg:text-6xl">
            Banking Made Simple,{' '}
            <span className="bg-gradient-to-r from-teal-300 to-accent-400 bg-clip-text text-transparent">
              Secure
            </span>{' '}
            and Accessible.
          </h1>

          <p className="mx-auto mt-6 max-w-xl text-lg leading-relaxed text-navy-100 lg:mx-0">
            Open an account in minutes, move money with confidence, and track every
            transaction in real time. Your finances, clearly in view and always protected.
          </p>

          <div className="mt-10 flex flex-col items-center gap-4 sm:flex-row lg:justify-start">
            <Link
              to="/register"
              className="w-full rounded-xl bg-accent-500 px-7 py-3.5 text-center text-base font-bold text-white shadow-lg shadow-accent-900/30 transition-all hover:-translate-y-0.5 hover:bg-accent-600 hover:shadow-xl sm:w-auto"
            >
              Open an Account
            </Link>
            <Link
              to="/login"
              className="w-full rounded-xl bg-white/10 px-7 py-3.5 text-center text-base font-bold text-white ring-1 ring-inset ring-white/30 backdrop-blur transition-colors hover:bg-white/20 sm:w-auto"
            >
              Sign In
            </Link>
          </div>

          <dl className="mt-12 grid grid-cols-3 gap-6 border-t border-white/10 pt-8 text-center lg:text-left">
            <div>
              <dt className="text-2xl font-extrabold text-white">256-bit</dt>
              <dd className="mt-1 text-sm text-navy-200">Encryption</dd>
            </div>
            <div>
              <dt className="text-2xl font-extrabold text-white">24/7</dt>
              <dd className="mt-1 text-sm text-navy-200">Access</dd>
            </div>
            <div>
              <dt className="text-2xl font-extrabold text-white">Instant</dt>
              <dd className="mt-1 text-sm text-navy-200">Transfers</dd>
            </div>
          </dl>
        </div>

        <div className="animate-fade-in flex justify-center lg:justify-end">
          <img
            src={heroDashboard}
            alt="Preview of the MyBanking dashboard showing an account balance and monthly activity chart"
            className="w-full max-w-lg animate-float drop-shadow-2xl"
            loading="eager"
            width="520"
            height="420"
          />
        </div>
      </div>

      {/* soft fade into the next (light) section */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-white/90 to-transparent" aria-hidden="true" />
    </section>
  );
}
