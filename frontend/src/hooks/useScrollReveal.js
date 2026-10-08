import { useEffect, useRef, useState } from 'react';

/**
 * useScrollReveal - reveal an element once it scrolls into view.
 *
 * Returns a { ref, isVisible } pair. Attach ref to the element; isVisible
 * flips to true the first time the element intersects the viewport, then
 * the observer disconnects (reveal-once). Dependency-free.
 *
 * Falls back to visible immediately if IntersectionObserver is unavailable.
 *
 * @param {number} [threshold=0.15]
 */
export default function useScrollReveal(threshold = 0.15) {
  const ref = useRef(null);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) return undefined;

    // Graceful fallback for environments without IntersectionObserver.
    if (typeof IntersectionObserver === 'undefined') {
      setIsVisible(true);
      return undefined;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setIsVisible(true);
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold },
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [threshold]);

  return { ref, isVisible };
}
