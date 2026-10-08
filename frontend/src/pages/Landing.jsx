import { useEffect } from 'react';

import Navbar from '../components/landing/Navbar';
import Hero from '../components/landing/Hero';
import Stats from '../components/landing/Stats';
import Features from '../components/landing/Features';
import HowItWorks from '../components/landing/HowItWorks';
import Services from '../components/landing/Services';
import Security from '../components/landing/Security';
import CallToAction from '../components/landing/CallToAction';
import Footer from '../components/landing/Footer';

/**
 * Landing — the public marketing entry page for MyBanking.
 *
 * Composes the modern landing sections (navbar, hero, stats, features,
 * how-it-works, services, security, call-to-action and footer). Enables
 * smooth scrolling for in-page anchor navigation while mounted, restoring
 * the previous behaviour on unmount so other routes are unaffected.
 */
export default function Landing() {
  useEffect(() => {
    const root = document.documentElement;
    const previous = root.style.scrollBehavior;
    root.style.scrollBehavior = 'smooth';
    return () => {
      root.style.scrollBehavior = previous;
    };
  }, []);

  return (
    <div className="min-h-screen bg-white font-sans text-navy-900">
      <Navbar />
      <main>
        <Hero />
        <Stats />
        <Features />
        <HowItWorks />
        <Services />
        <Security />
        <CallToAction />
      </main>
      <Footer />
    </div>
  );
}
