import useScrollReveal from '../../hooks/useScrollReveal';

const STEPS = [
  {
    step: '01',
    title: 'Create your account',
    description: 'Register in minutes with just your details. A secure account number is generated instantly.',
  },
  {
    step: '02',
    title: 'Add your funds',
    description: 'Make your first deposit and watch your balance update in real time, down to the pesewa.',
  },
  {
    step: '03',
    title: 'Bank with confidence',
    description: 'Transfer, withdraw and track every transaction from one clean, secure dashboard.',
  },
];

/**
 * HowItWorks — a three-step onboarding story on a softly tinted surface with
 * dark navy text and a connecting gradient line between numbered steps.
 */
export default function HowItWorks() {
  const { ref, isVisible } = useScrollReveal();

  return (
    <section id="how-it-works" className="relative bg-white py-20 sm:py-24">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <span className="inline-block rounded-full bg-teal-100 px-3 py-1 text-sm font-bold uppercase tracking-wide text-teal-700">
            How it works
          </span>
          <h2 className="mt-4 text-3xl font-extrabold tracking-tight text-navy-900 sm:text-4xl">
            Get started in{' '}
            <span className="text-gradient-brand">three simple steps</span>
          </h2>
          <p className="mt-4 text-lg text-navy-600">
            From sign-up to your first transfer, the whole journey takes just a few minutes.
          </p>
        </div>

        <div
          ref={ref}
          className={`relative mt-16 grid gap-10 md:grid-cols-3 ${
            isVisible ? 'animate-fade-in-up' : 'opacity-0'
          }`}
        >
          <div className="absolute left-0 right-0 top-7 hidden h-0.5 bg-gradient-to-r from-brand-300 via-teal-300 to-accent-300 md:block" aria-hidden="true" />
          {STEPS.map((item) => (
            <div key={item.step} className="relative flex flex-col items-center rounded-2xl bg-navy-50/60 p-8 text-center ring-1 ring-navy-100 transition-colors hover:bg-navy-50 md:bg-transparent md:p-0 md:ring-0 md:hover:bg-transparent">
              <span className="relative z-10 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-600 to-teal-500 text-lg font-extrabold text-white shadow-lg shadow-brand-900/20 ring-4 ring-white">
                {item.step}
              </span>
              <h3 className="mt-6 text-xl font-bold text-navy-900">{item.title}</h3>
              <p className="mx-auto mt-3 max-w-xs text-sm leading-relaxed text-navy-600">{item.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
