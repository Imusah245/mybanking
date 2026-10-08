import useScrollReveal from '../../hooks/useScrollReveal';

const SERVICES = [
  {
    name: 'Personal Accounts',
    description: 'Everyday banking with instant account creation, clear balances and full transaction history.',
    points: ['No hidden fees', 'Real-time balance', 'Instant account number'],
  },
  {
    name: 'Transfers & Payments',
    description: 'Move money between accounts securely with unique references for every transaction.',
    points: ['Account-to-account', 'Traceable references', 'Immediate confirmation'],
  },
  {
    name: 'Deposits & Withdrawals',
    description: 'Add or take out funds with precise pesewa-level accuracy and a complete audit trail.',
    points: ['Precise amounts', 'Audit trail', 'Status tracking'],
  },
];

function ServiceCard({ service, index }) {
  const { ref, isVisible } = useScrollReveal();
  return (
    <div
      ref={ref}
      style={{ animationDelay: `${index * 100}ms` }}
      className={`group relative flex flex-col overflow-hidden rounded-2xl bg-white p-8 shadow-md ring-1 ring-navy-100 transition-all hover:-translate-y-1.5 hover:shadow-xl ${
        isVisible ? 'animate-fade-in-up' : 'opacity-0'
      }`}
    >
      <span className="absolute inset-x-0 top-0 h-1.5 bg-gradient-to-r from-brand-500 to-teal-500" aria-hidden="true" />
      <h3 className="text-xl font-bold text-navy-900">{service.name}</h3>
      <p className="mt-3 flex-1 text-sm leading-relaxed text-navy-600">{service.description}</p>
      <ul className="mt-6 space-y-2">
        {service.points.map((point) => (
          <li key={point} className="flex items-center gap-2 text-sm font-medium text-navy-700">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true" className="shrink-0 text-accent-600">
              <path d="M20 6L9 17l-5-5" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            {point}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Services — a grid describing the core banking products on a soft tinted
 * band. Light cards with a gradient top accent and dark navy text.
 */
export default function Services() {
  return (
    <section id="services" className="relative overflow-hidden bg-gradient-to-br from-navy-50 via-brand-50/40 to-teal-50/40 py-20 sm:py-24">
      <div className="pointer-events-none absolute -left-24 top-1/4 h-72 w-72 rounded-full bg-brand-200/30 blur-3xl" aria-hidden="true" />
      <div className="pointer-events-none absolute -right-24 bottom-0 h-72 w-72 rounded-full bg-teal-200/30 blur-3xl" aria-hidden="true" />
      <div className="relative mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <span className="inline-block rounded-full bg-accent-100 px-3 py-1 text-sm font-bold uppercase tracking-wide text-accent-700">
            Services
          </span>
          <h2 className="mt-4 text-3xl font-extrabold tracking-tight text-navy-900 sm:text-4xl">
            Banking services built{' '}
            <span className="text-gradient-brand">around you</span>
          </h2>
          <p className="mt-4 text-lg text-navy-600">
            A focused set of services that cover everything you need, without the clutter.
          </p>
        </div>

        <div className="mt-14 grid gap-6 lg:grid-cols-3">
          {SERVICES.map((service, index) => (
            <ServiceCard key={service.name} service={service} index={index} />
          ))}
        </div>
      </div>
    </section>
  );
}
