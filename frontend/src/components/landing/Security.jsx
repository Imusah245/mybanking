import useScrollReveal from '../../hooks/useScrollReveal';

const PILLARS = [
  {
    title: 'Encrypted sessions',
    description: 'Every request is protected with token-based authentication and secure transport.',
    icon: (
      <path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    ),
  },
  {
    title: 'Role-based access',
    description: 'Customer and administrator permissions are strictly separated and enforced server-side.',
    icon: (
      <path d="M12 11a4 4 0 100-8 4 4 0 000 8zM4 21v-1a6 6 0 0112 0v1" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    ),
  },
  {
    title: 'Full audit trail',
    description: 'Every transaction is recorded with a unique reference you can trace at any time.',
    icon: (
      <path d="M9 12l2 2 4-4m-9 9h12a2 2 0 002-2V5a2 2 0 00-2-2H6a2 2 0 00-2 2v14a2 2 0 002 2z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    ),
  },
];

/**
 * Security — a dark trust section. White headings and light-navy body copy
 * on a deep navy background deliver high contrast and a reassuring tone.
 */
export default function Security() {
  const { ref, isVisible } = useScrollReveal();

  return (
    <section id="security" className="relative overflow-hidden bg-navy-900 py-20 sm:py-24">
      <div className="pointer-events-none absolute -right-24 top-0 h-80 w-80 rounded-full bg-teal-500/10 blur-3xl" aria-hidden="true" />
      <div className="relative mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <span className="text-sm font-bold uppercase tracking-wide text-teal-300">Security</span>
          <h2 className="mt-3 text-3xl font-extrabold tracking-tight text-white sm:text-4xl">
            Your money and data, always protected
          </h2>
          <p className="mt-4 text-lg text-navy-200">
            Security is built into every layer of MyBanking, so you can transact with total peace of mind.
          </p>
        </div>

        <div
          ref={ref}
          className={`mt-14 grid gap-6 md:grid-cols-3 ${
            isVisible ? 'animate-fade-in-up' : 'opacity-0'
          }`}
        >
          {PILLARS.map((pillar) => (
            <div
              key={pillar.title}
              className="rounded-2xl bg-white/5 p-7 ring-1 ring-inset ring-white/10 backdrop-blur transition-colors hover:bg-white/10"
            >
              <span className="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-teal-500/20 text-teal-300">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  {pillar.icon}
                </svg>
              </span>
              <h3 className="mt-5 text-lg font-bold text-white">{pillar.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-navy-200">{pillar.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
