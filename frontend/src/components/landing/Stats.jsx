import useScrollReveal from '../../hooks/useScrollReveal';

const STATS = [
  { value: '50K+', label: 'Active accounts' },
  { value: 'GHS 2B+', label: 'Processed securely' },
  { value: '99.9%', label: 'Uptime' },
  { value: '4.9/5', label: 'Customer rating' },
];

/**
 * Stats — a headline-numbers band presented on an elevated gradient card
 * that overlaps the hero, so the section reads as lively rather than flat.
 */
export default function Stats() {
  const { ref, isVisible } = useScrollReveal();

  return (
    <section className="bg-white">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div
          ref={ref}
          className={`-mt-10 grid grid-cols-2 gap-px overflow-hidden rounded-3xl bg-navy-100 shadow-xl ring-1 ring-navy-100 md:grid-cols-4 ${
            isVisible ? 'animate-fade-in-up' : 'opacity-0'
          }`}
        >
          {STATS.map((stat) => (
            <div
              key={stat.label}
              className="bg-gradient-to-b from-white to-navy-50/60 px-6 py-10 text-center transition-colors hover:to-brand-50"
            >
              <p className="text-3xl font-extrabold text-gradient-brand sm:text-4xl">{stat.value}</p>
              <p className="mt-2 text-sm font-semibold text-navy-600">{stat.label}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
