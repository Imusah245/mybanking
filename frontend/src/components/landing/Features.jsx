import useScrollReveal from '../../hooks/useScrollReveal';

const FEATURES = [
  {
    title: 'Instant Transfers',
    description: 'Send money to any account in seconds with real-time confirmation and references.',
    icon: (
      <path d="M3 12h14m0 0l-5-5m5 5l-5 5M21 5v14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    ),
  },
  {
    title: 'Smart Deposits',
    description: 'Add funds to your account quickly and watch your balance update immediately.',
    icon: (
      <path d="M12 3v12m0 0l-4-4m4 4l4-4M5 21h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    ),
  },
  {
    title: 'Full History',
    description: 'Every deposit, withdrawal and transfer is logged with filters and pagination.',
    icon: (
      <path d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    ),
  },
  {
    title: 'Bank-grade Security',
    description: 'Token-based authentication and encrypted sessions protect every action.',
    icon: (
      <path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    ),
  },
  {
    title: 'Clear Balances',
    description: 'See exactly where your money is with precise, always-accurate balances.',
    icon: (
      <path d="M4 6h16v12H4zM4 10h16M8 15h4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    ),
  },
  {
    title: 'Mobile Ready',
    description: 'A responsive interface that works beautifully on phones, tablets and desktops.',
    icon: (
      <path d="M7 3h10v18H7zM11 18h2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    ),
  },
];

function FeatureCard({ feature, index }) {
  const { ref, isVisible } = useScrollReveal();
  return (
    <div
      ref={ref}
      style={{ animationDelay: `${index * 80}ms` }}
      className={`group relative overflow-hidden rounded-2xl border border-navy-100 bg-white p-7 shadow-sm transition-all hover:-translate-y-1.5 hover:border-brand-200 hover:shadow-xl ${
        isVisible ? 'animate-fade-in-up' : 'opacity-0'
      }`}
    >
      <span className="pointer-events-none absolute -right-10 -top-10 h-24 w-24 rounded-full bg-brand-50 opacity-0 transition-opacity group-hover:opacity-100" aria-hidden="true" />
      <span className="relative inline-flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-brand-500 to-teal-500 text-white shadow-md shadow-brand-900/10">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          {feature.icon}
        </svg>
      </span>
      <h3 className="relative mt-5 text-lg font-bold text-navy-900">{feature.title}</h3>
      <p className="relative mt-2 text-sm leading-relaxed text-navy-600">{feature.description}</p>
    </div>
  );
}

/**
 * Features — a responsive grid of product capabilities on a lightly textured
 * tinted band. Light cards with dark navy headings for strong readability.
 */
export default function Features() {
  return (
    <section id="features" className="relative bg-gradient-to-b from-white via-navy-50 to-white py-20 sm:py-24">
      <div className="pointer-events-none absolute inset-0 bg-dot-grid-light opacity-60" aria-hidden="true" />
      <div className="relative mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <span className="inline-block rounded-full bg-brand-100 px-3 py-1 text-sm font-bold uppercase tracking-wide text-brand-700">
            Features
          </span>
          <h2 className="mt-4 text-3xl font-extrabold tracking-tight text-navy-900 sm:text-4xl">
            Everything you need to{' '}
            <span className="text-gradient-brand">manage your money</span>
          </h2>
          <p className="mt-4 text-lg text-navy-600">
            Powerful tools wrapped in a clean, intuitive experience built for everyday banking.
          </p>
        </div>

        <div className="mt-14 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((feature, index) => (
            <FeatureCard key={feature.title} feature={feature} index={index} />
          ))}
        </div>
      </div>
    </section>
  );
}
